import * as THREE from 'three';
import { RaycastVehicleController } from './vehicleController.js';
import { PIXEL_LIGHTING_UNIFORMS } from './pixelTheme.js';

/**
 * AI Everyday Traffic Fleet Definitions (using the 3 extracted low-poly cars)
 */
const AI_PAINT_PALETTE = [
  0xf4f6f9, // Pearl White
  0xc8d0db, // Frost Silver
  0x858e9c, // Steel Grey
  0x464d57, // Gunmetal Graphite
  0x1d2026, // Midnight Black
  0xd32f2f, // Crimson Red
  0xff4b3e, // Rally Coral
  0x8c1c2f, // Deep Burgundy
  0x154c9b, // Ocean Blue
  0x2b7de9, // Electric Cobalt
  0x4fc3f7, // Sky Cyan
  0x12264a, // Midnight Navy
  0xe65c19, // Sunset Orange
  0xff8f26, // Tangerine
  0xb86b35, // Burnt Copper
  0x1b7a4c, // Emerald Green
  0x4ea832, // Vivid Lime
  0x164a32, // British Racing Green
  0x5ec7a3, // Mint Sage
  0xeab308, // Golden Yellow
  0xf5d547, // Sunburst Yellow
  0x268996, // Teal Slate
  0x6b3fa0, // Royal Plum
  0xb388eb, // Metallic Lavender
  0xd6c7a9, // Champagne Sand
  0xe85d9e, // Neon Rose
];

const AI_VEHICLE_SPECS = [
  {
    id: 'ai_golf',
    name: 'VW Golf GTI',
    url: '/assets/car_golf.glb',
    chassisDims: new THREE.Vector3(1.92, 1.00, 4.28),
    mass: 1320,
    maxEngineForce: 7400,
    speedFactor: 0.96,
  },
  {
    id: 'ai_rs6',
    name: 'Audi RS6 Avant',
    url: '/assets/car_rs6.glb',
    chassisDims: new THREE.Vector3(1.96, 0.98, 4.58),
    mass: 1480,
    maxEngineForce: 8000,
    speedFactor: 1.04,
  },
  {
    id: 'ai_coupe',
    name: 'Sport Coupe',
    url: '/assets/car_coupe.glb',
    chassisDims: new THREE.Vector3(1.94, 0.96, 4.46),
    mass: 1360,
    maxEngineForce: 7600,
    speedFactor: 1.00,
  },
];

// Membership = 0x0004 (AI vehicle hull), Collides with everything (0xFFFF).
// Wheel raycasts use filter 0x0001 (track/terrain only), so tires never ride on car roofs.
const AI_CHASSIS_COLLISION_GROUPS = (0x0004 << 16) | 0xFFFF;
// Remote traffic proxies on guests collide ONLY with the local player (0x0008), skipping trimesh/prop/cross-proxy solver cost.
const REMOTE_TRAFFIC_COLLISION_GROUPS = (0x0004 << 16) | 0x0008;

const LANE_SPEEDS = {
  highway: 15.8,   // ~57 km/h (calm everyday highway traffic)
  secondary: 11.8, // ~42 km/h
  narrow: 9.4,     // ~34 km/h
  roundabout: 8.2, // ~30 km/h
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function getLaneOffset(route, laneSlot) {
  if (route.type === 'highway') {
    return laneSlot === 1 ? 2.10 : 5.30;
  }
  if (route.type === 'narrow') {
    return 1.80;
  }
  return 2.60; // secondary & roundabouts
}

function getBaseSpeed(route, laneSlot) {
  if (route.isRoundabout) return LANE_SPEEDS.roundabout;
  let base = LANE_SPEEDS[route.type] || LANE_SPEEDS.secondary;
  if (route.type === 'highway' && laneSlot === 1) {
    base += 2.0;
  }
  return base;
}

function closestPointOnSegmentXZ(px, pz, ax, az, bx, bz) {
  const vx = bx - ax;
  const vz = bz - az;
  const lenSq = vx * vx + vz * vz;
  let t = 0;
  if (lenSq > 1e-6) {
    t = clamp(((px - ax) * vx + (pz - az) * vz) / lenSq, 0, 1);
  }
  const cx = ax + t * vx;
  const cz = az + t * vz;
  const dist = Math.hypot(px - cx, pz - cz);
  const len = Math.sqrt(lenSq) || 1;
  return { dist, cx, cz, t, ux: vx / len, uz: vz / len, len };
}

export class TrafficSystem {
  constructor(RAPIER, world, scene, createAICarPartsFn, options = {}) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.createAICarParts = createAICarPartsFn;

    this.maxVehicles = options.maxVehicles ?? 16;
    this.localVehicleShare = options.localVehicleShare ?? 10; // ~10 near player + ~6 map-wide roamers
    this.minSpawnDist = options.minSpawnDist ?? 58;
    this.maxSpawnDist = options.maxSpawnDist ?? 360;
    this.despawnDist = options.despawnDist ?? 540;
    this.offRouteTimeoutSec = options.offRouteTimeoutSec ?? 22.0;
    this.stuckTimeoutSec = options.stuckTimeoutSec ?? 14.0;

    this.routes = [];
    this.routeById = new Map();
    this.junctionNodes = []; // Flat list of route-graph junction states for cross-map journey planning
    this.isReady = false;
    this.agents = [];
    this._pendingSpawns = 0;
    this._spawnCooldown = 0.08;
    this._nextId = 1;
    this._specCursor = 0;
    this._simTime = 0;
    this._recentTurnTimes = new Map();

    // Reusable scratch vectors to minimize GC in physics loop
    this._vFwd = new THREE.Vector3();
    this._vUp = new THREE.Vector3();
    this._vLeft = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._qTmp = new THREE.Quaternion();
    this._projVec = new THREE.Vector3();

    // Multiplayer sync state (host exports snapshots; guests run kinematic proxies)
    this.remoteSyncMode = false;
    this.remoteAgents = new Map();
    this._remoteClockOffset = null;
    this._remoteJitterMs = 0;
    this._remoteLastSenderTs = null;
    this._remoteLastRecvMs = null;

    // Pooled real SpotLights matching the player car's headlight beam spec (2 nearest traffic cars)
    this._headlightPool = [];
    this._hlBestD2 = [0, 0];
    this._hlBestPos = [null, null];
    this._hlBestRot = [null, null];
    if (this.scene) {
      for (let i = 0; i < 2; i++) {
        const spot = new THREE.SpotLight(0xfff1d6, 0, 48, Math.PI * 0.28, 0.58, 1.35);
        spot.castShadow = false;
        const target = new THREE.Object3D();
        this.scene.add(spot);
        this.scene.add(target);
        spot.target = target;
        this._headlightPool.push({ spot, target });
      }
    }
  }

  /**
   * Builds directed lane metadata, junction links, and cross-map journey graph from map_routes.json
   */
  initFromRoutesData(routesData) {
    if (this.isReady || !routesData || !routesData.routes) return;

    const rawGround = routesData.routes.filter(
      (r) => (!r.layer || r.layer === 'ground') && !r.id.startsWith('overpass_bridge') && r.id !== 'alpine_tunnel'
    );

    this.routes = [];
    this.routeById.clear();

    for (const r of rawGround) {
      if (!r.points || r.points.length < 4) continue;
      const pts = r.points.map((p) =>
        Array.isArray(p)
          ? { x: p[0], y: p.length > 2 ? p[1] : 0, z: p.length > 2 ? p[2] : p[1] }
          : { x: p.x, y: p.y ?? 0, z: p.z }
      );

      const isClosed = Boolean(r.closed || r.id === 'hwy');
      let ringLen = pts.length;
      if (isClosed && ringLen > 2) {
        const first = pts[0];
        const last = pts[ringLen - 1];
        if (Math.hypot(first.x - last.x, first.z - last.z) < 1.0) {
          pts.pop();
          ringLen = pts.length;
        }
      }

      const tangents = new Array(ringLen);
      const rights = new Array(ringLen);
      for (let i = 0; i < ringLen; i++) {
        const iPrev = isClosed ? (i - 1 + ringLen) % ringLen : Math.max(0, i - 1);
        const iNext = isClosed ? (i + 1) % ringLen : Math.min(ringLen - 1, i + 1);
        const dx = pts[iNext].x - pts[iPrev].x;
        const dz = pts[iNext].z - pts[iPrev].z;
        const len = Math.hypot(dx, dz) || 1;
        const tx = dx / len;
        const tz = dz / len;
        tangents[i] = { x: tx, z: tz };
        rights[i] = { x: -tz, z: tx };
      }

      let totalLength = 0;
      for (let i = 1; i < ringLen; i++) {
        totalLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      }

      const routeObj = {
        id: r.id,
        name: r.name || r.id,
        type: r.type || 'secondary',
        isClosed,
        isRoundabout: r.id.includes('roundabout'),
        pts,
        ringLen,
        totalLength,
        tangents,
        rights,
        startLinks: [],
        endLinks: [],
        midExits: new Map(),
        juncIndices: [], // sorted unique indices on this route where junctions exist
        jNodeAtIdx: new Map(), // idx -> jNode id for cross-map graph search
      };

      this.routes.push(routeObj);
      this.routeById.set(routeObj.id, routeObj);
    }

    this._buildJunctionLinksAndGraph();
    this.isReady = this.routes.length > 0;
  }

  _buildJunctionLinksAndGraph() {
    const addMidExit = (parentRoute, parentIdx, targetRoute, targetIdx, targetDir) => {
      let arr = parentRoute.midExits.get(parentIdx);
      if (!arr) {
        arr = [];
        parentRoute.midExits.set(parentIdx, arr);
      }
      arr.push({ route: targetRoute, idx: targetIdx, dir: targetDir });
    };

    const findCandidatesNearPoint = (sourceRoute, anchorPt) => {
      const candidates = [];
      for (const other of this.routes) {
        if (other === sourceRoute) continue;
        let bestIdx = -1;
        let bestDist = 6.5;
        for (let j = 0; j < other.ringLen; j++) {
          const p = other.pts[j];
          if (Math.abs(p.y - anchorPt.y) >= 3.8) continue;
          const d = Math.hypot(p.x - anchorPt.x, p.z - anchorPt.z);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = j;
          }
        }
        if (bestIdx === -1) continue;

        if (other.isClosed) {
          candidates.push({ route: other, idx: bestIdx, dir: 1 });
          if (!other.isRoundabout) {
            candidates.push({ route: other, idx: bestIdx, dir: -1 });
          }
        } else {
          const margin = Math.min(8, Math.floor(other.ringLen * 0.25));
          if (bestIdx <= margin) {
            candidates.push({ route: other, idx: bestIdx, dir: 1 });
          } else if (bestIdx >= other.ringLen - 1 - margin) {
            candidates.push({ route: other, idx: bestIdx, dir: -1 });
          } else {
            candidates.push({ route: other, idx: bestIdx, dir: 1 });
            candidates.push({ route: other, idx: bestIdx, dir: -1 });
          }
        }
      }
      return candidates;
    };

    for (const r of this.routes) {
      if (r.isClosed) continue;

      const pStart = r.pts[0];
      r.startLinks = findCandidatesNearPoint(r, pStart);
      for (const link of r.startLinks) {
        if (link.route.isClosed || (link.idx > 6 && link.idx < link.route.ringLen - 7)) {
          addMidExit(link.route, link.idx, r, 0, 1);
        }
      }

      const pEnd = r.pts[r.ringLen - 1];
      r.endLinks = findCandidatesNearPoint(r, pEnd);
      for (const link of r.endLinks) {
        if (link.route.isClosed || (link.idx > 6 && link.idx < link.route.ringLen - 7)) {
          addMidExit(link.route, link.idx, r, r.ringLen - 1, -1);
        }
      }
    }

    // Build junction graph across all 65 routes so every car can plan unique cross-map itineraries
    this.junctionNodes = [];
    for (const r of this.routes) {
      const idxSet = new Set();
      if (!r.isClosed) {
        idxSet.add(0);
        idxSet.add(r.ringLen - 1);
      }
      for (const k of r.midExits.keys()) idxSet.add(k);
      const sorted = [...idxSet].sort((a, b) => a - b);
      r.juncIndices = sorted;

      for (const idx of sorted) {
        const jId = this.junctionNodes.length;
        r.jNodeAtIdx.set(idx, jId);
        this.junctionNodes.push({
          id: jId,
          route: r,
          idx,
          edges: [], // { toId, type: 'along'|'turn', dir, toDir, dist, turnDot? }
        });
      }
    }

    // Connect consecutive junctions along each route + across route intersections
    for (const r of this.routes) {
      const jList = r.juncIndices;
      if (!jList.length) continue;

      if (r.isClosed) {
        for (let k = 0; k < jList.length; k++) {
          const iA = jList[k];
          const iB = jList[(k + 1) % jList.length];
          const nSteps = iB > iA ? (iB - iA) : (r.ringLen - iA + iB);
          const dist = Math.max(2.5, nSteps * 2.5);
          const nodeA = this.junctionNodes[r.jNodeAtIdx.get(iA)];
          const nodeB = this.junctionNodes[r.jNodeAtIdx.get(iB)];
          nodeA.edges.push({ toId: nodeB.id, type: 'along', dir: 1, dist });
          if (!r.isRoundabout) {
            nodeB.edges.push({ toId: nodeA.id, type: 'along', dir: -1, dist });
          }
        }
      } else {
        for (let k = 0; k < jList.length - 1; k++) {
          const iA = jList[k];
          const iB = jList[k + 1];
          const dist = Math.max(2.5, (iB - iA) * 2.5);
          const nodeA = this.junctionNodes[r.jNodeAtIdx.get(iA)];
          const nodeB = this.junctionNodes[r.jNodeAtIdx.get(iB)];
          nodeA.edges.push({ toId: nodeB.id, type: 'along', dir: 1, dist });
          nodeB.edges.push({ toId: nodeA.id, type: 'along', dir: -1, dist });
        }
      }

      // Connect intersection turn edges
      for (const idx of jList) {
        const jNode = this.junctionNodes[r.jNodeAtIdx.get(idx)];
        let links = [];
        if (!r.isClosed && idx === 0) links = r.startLinks;
        else if (!r.isClosed && idx === r.ringLen - 1) links = r.endLinks;
        else links = r.midExits.get(idx) || [];

        for (const lk of links) {
          // Resolve closest junction index on target route (exact key if registered)
          let targetJId = lk.route.jNodeAtIdx.get(lk.idx);
          if (targetJId === undefined) {
            // Find nearest juncIndex on target route within 2 indices
            for (const ji of lk.route.juncIndices) {
              if (Math.abs(ji - lk.idx) <= 2) {
                targetJId = lk.route.jNodeAtIdx.get(ji);
                break;
              }
            }
          }
          if (targetJId === undefined) continue;
          const tVec = lk.route.tangents[lk.idx];
          jNode.edges.push({
            toId: targetJId,
            type: 'turn',
            toRoute: lk.route,
            toIdx: lk.idx,
            toDir: lk.dir,
            toFwdX: tVec.x * lk.dir,
            toFwdZ: tVec.z * lk.dir,
            dist: 8.0,
          });
        }
      }
    }
  }

  /**
   * Plans a unique multi-route turn itinerary (`turnQueue`) across 4–10+ different routes on the map.
   * Uses randomized Dijkstra weighted away from recently visited routes so every AI car takes its own trip.
   */
  _planUniqueJourney(agent, startRoute, startIdx, startDir) {
    if (!this.junctionNodes.length || !startRoute.juncIndices.length) return [];

    // Find the first junction strictly ahead of startIdx (at least 5 nodes = 12.5m ahead)
    let firstJIdx = -1;
    let bestAheadSteps = Infinity;
    const len = startRoute.ringLen;

    for (const ji of startRoute.juncIndices) {
      let steps = -1;
      if (startRoute.isClosed) {
        steps = startDir > 0 ? (ji - startIdx + len) % len : (startIdx - ji + len) % len;
        if (steps < 5) steps += len;
      } else {
        steps = startDir > 0 ? (ji - startIdx) : (startIdx - ji);
        if (steps < 5) continue;
      }
      if (steps < bestAheadSteps) {
        bestAheadSteps = steps;
        firstJIdx = ji;
      }
    }
    if (firstJIdx === -1) return [];
    const startNodeId = startRoute.jNodeAtIdx.get(firstJIdx);
    if (startNodeId === undefined) return [];

    // Pick a diverse goal route not recently visited by this car (and less crowded across active traffic)
    const activeRouteCounts = new Map();
    const activeDirCounts = new Map();
    const turnEdgeUsage = new Map();
    for (const a of this.agents) {
      if (a === agent) continue;
      const rid = a.cursor.route.id;
      activeRouteCounts.set(rid, (activeRouteCounts.get(rid) || 0) + 1);
      const dKey = `${rid}:${a.cursor.dir}`;
      activeDirCounts.set(dKey, (activeDirCounts.get(dKey) || 0) + 1);
      if (a.turnQueue) {
        for (const t of a.turnQueue) {
          const tk = `${t.fromRoute.id}:${t.atIdx}->${t.toRoute.id}:${t.toIdx}:${t.toDir}`;
          turnEdgeUsage.set(tk, (turnEdgeUsage.get(tk) || 0) + 1);
        }
      }
    }

    const goalPool = this.routes.filter(
      (r) => r !== startRoute && !agent.recentRoutes.includes(r.id) && r.juncIndices.length > 0
    );
    const pool = goalPool.length > 0 ? goalPool : this.routes.filter((r) => r !== startRoute && r.juncIndices.length > 0);
    if (!pool.length) return [];

    // Weight selection strongly toward uncrowded routes across the entire map
    let minCount = Infinity;
    for (const r of pool) {
      const c = activeRouteCounts.get(r.id) || 0;
      if (c < minCount) minCount = c;
    }
    const preferredPool = pool.filter((r) => (activeRouteCounts.get(r.id) || 0) <= minCount + 1);
    const goalRoute = preferredPool[Math.floor(Math.random() * preferredPool.length)];

    // Randomized Dijkstra over the ~150 junction nodes to produce unique organic paths
    const n = this.junctionNodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prevNode = new Int32Array(n).fill(-1);
    const prevEdge = new Array(n).fill(null);
    const visited = new Uint8Array(n);

    // Track incoming travel direction at each node to penalize awkward sharp U-turns
    const inDir = new Array(n).fill(null);
    const t0 = startRoute.tangents[firstJIdx];
    inDir[startNodeId] = { fx: t0.x * startDir, fz: t0.z * startDir, alongDir: startDir };
    dist[startNodeId] = 0;

    // Seed an initial random jitter per route so this car avoids highways/loops other cars are using
    const routeNoise = new Map();
    for (const r of this.routes) {
      let mult = 0.65 + Math.random() * 0.90;
      if (agent.recentRoutes.includes(r.id)) mult *= 2.4;
      if ((activeRouteCounts.get(r.id) || 0) > 1) mult *= 1.35;
      routeNoise.set(r.id, mult);
    }

    let goalReachedId = -1;
    for (let iter = 0; iter < n; iter++) {
      let u = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (!visited[i] && dist[i] < bestD) {
          bestD = dist[i];
          u = i;
        }
      }
      if (u === -1 || bestD === Infinity) break;
      visited[u] = 1;

      const uNode = this.junctionNodes[u];
      if (uNode.route === goalRoute && u !== startNodeId) {
        goalReachedId = u;
        break;
      }

      const curIn = inDir[u];
      for (const edge of uNode.edges) {
        if (visited[edge.toId]) continue;
        // Must continue in current travel direction if stepping 'along' the same route
        if (edge.type === 'along' && curIn && curIn.alongDir !== null && edge.dir !== curIn.alongDir) {
          continue;
        }
        const toNode = this.junctionNodes[edge.toId];
        let stepCost = edge.dist * (routeNoise.get(toNode.route.id) || 1.0);
        let nextFx = curIn ? curIn.fx : 0;
        let nextFz = curIn ? curIn.fz : 0;
        let nextAlongDir = edge.type === 'along' ? edge.dir : edge.toDir;

        if (edge.type === 'turn') {
          if (curIn) {
            const dot = curIn.fx * edge.toFwdX + curIn.fz * edge.toFwdZ;
            if (dot < -0.25) stepCost += 650.0; // avoid abrupt acute reversals unless forced
          }
          // Strongly diversify exits/turns across cars unless this is the only logical way
          const tKey = `${uNode.route.id}:${uNode.idx}->${edge.toRoute.id}:${edge.toIdx}:${edge.toDir}`;
          const plannedTurnCount = turnEdgeUsage.get(tKey) || 0;
          if (plannedTurnCount > 0) {
            stepCost += plannedTurnCount * 420.0;
          }
          const lastTurnTime = this._recentTurnTimes.get(tKey);
          if (lastTurnTime !== undefined && (this._simTime - lastTurnTime) < 8.0) {
            stepCost += 320.0;
          }
          const sameDirCount = activeDirCounts.get(`${edge.toRoute.id}:${edge.toDir}`) || 0;
          if (sameDirCount > 0) {
            stepCost += sameDirCount * 90.0;
          }
          nextFx = edge.toFwdX;
          nextFz = edge.toFwdZ;
          // Note: must check along direction on destination route after turning
          nextAlongDir = edge.toDir;
        } else {
          const tv = toNode.route.tangents[toNode.idx];
          nextFx = tv.x * edge.dir;
          nextFz = tv.z * edge.dir;
        }

        const nd = bestD + stepCost;
        if (nd < dist[edge.toId]) {
          dist[edge.toId] = nd;
          prevNode[edge.toId] = u;
          prevEdge[edge.toId] = edge;
          inDir[edge.toId] = { fx: nextFx, fz: nextFz, alongDir: nextAlongDir };
        }
      }
    }

    if (goalReachedId === -1) return [];

    // Reconstruct sequence of 'turn' actions cleanly
    const turns = [];
    let cur = goalReachedId;
    while (cur !== -1 && cur !== startNodeId) {
      const p = prevNode[cur];
      const e = prevEdge[cur];
      if (e && e.type === 'turn' && p !== -1) {
        const fromNode = this.junctionNodes[p];
        turns.push({
          fromRoute: fromNode.route,
          atIdx: fromNode.idx,
          toRoute: e.toRoute,
          toIdx: e.toIdx,
          toDir: e.toDir,
        });
      }
      cur = p;
    }
    turns.reverse();
    return turns;
  }

  _computeLanePoint(route, idx, dir, laneOffset) {
    const p = route.pts[idx];
    const t = route.tangents[idx];
    const r = route.rights[idx];
    const fwdX = t.x * dir;
    const fwdZ = t.z * dir;
    const rightX = r.x * dir;
    const rightZ = r.z * dir;
    return {
      x: p.x + rightX * laneOffset,
      y: p.y,
      z: p.z + rightZ * laneOffset,
      centerX: p.x,
      centerZ: p.z,
      fwdX,
      fwdZ,
      rightX,
      rightZ,
      route,
      centerIdx: idx,
      dir,
      laneOffset,
    };
  }

  _chooseNextRouteFromLinks(links, currFwdX, currFwdZ) {
    if (!links || !links.length) return null;
    const good = [];
    const fallback = [];
    for (const lk of links) {
      const t = lk.route.tangents[lk.idx];
      const candFwdX = t.x * lk.dir;
      const candFwdZ = t.z * lk.dir;
      const dot = currFwdX * candFwdX + currFwdZ * candFwdZ;
      if (dot > -0.25) {
        good.push(lk);
      } else {
        fallback.push(lk);
      }
    }
    const pool = good.length > 0 ? good : fallback;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _appendJunctionBezierArc(agent, nextRoute, entryIdx, nextDir, nextLaneSlot) {
    const cur = agent.cursor;
    const q = agent.queue;

    const trimCount = Math.min(2, Math.max(0, q.length - 4));
    for (let i = 0; i < trimCount; i++) q.pop();

    const pStart = q.length > 0
      ? q[q.length - 1]
      : this._computeLanePoint(cur.route, cur.idx, cur.dir, cur.smoothOffset);

    const nextOffset = getLaneOffset(nextRoute, nextLaneSlot);
    const skip = Math.min(3, Math.floor(nextRoute.ringLen / 4));
    const exitIdx = nextRoute.isClosed
      ? (entryIdx + skip * nextDir + nextRoute.ringLen) % nextRoute.ringLen
      : clamp(entryIdx + skip * nextDir, 0, nextRoute.ringLen - 1);

    const pEnd = this._computeLanePoint(nextRoute, exitIdx, nextDir, nextOffset);

    const dist = Math.hypot(pEnd.x - pStart.x, pEnd.z - pStart.z);
    const arm = clamp(dist * 0.5, 2.5, 9.0);
    const ctrlX = pStart.x + pStart.fwdX * arm;
    const ctrlZ = pStart.z + pStart.fwdZ * arm;
    const ctrlY = (pStart.y + pEnd.y) * 0.5;
    const turnSpeed = Math.min(
      getBaseSpeed(cur.route, cur.laneSlot),
      getBaseSpeed(nextRoute, nextLaneSlot),
      8.2
    ) * agent.spec.speedFactor * agent.driverPace;

    const steps = 4;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const omt = 1 - t;
      const bx = omt * omt * pStart.x + 2 * omt * t * ctrlX + t * t * pEnd.x;
      const by = omt * omt * pStart.y + 2 * omt * t * ctrlY + t * t * pEnd.y;
      const bz = omt * omt * pStart.z + 2 * omt * t * ctrlZ + t * t * pEnd.z;

      const dtx = 2 * omt * (ctrlX - pStart.x) + 2 * t * (pEnd.x - ctrlX);
      const dtz = 2 * omt * (ctrlZ - pStart.z) + 2 * t * (pEnd.z - ctrlZ);
      const dtLen = Math.hypot(dtx, dtz) || 1;
      const fx = dtx / dtLen;
      const fz = dtz / dtLen;

      q.push({
        x: bx,
        y: by,
        z: bz,
        centerX: bx,
        centerZ: bz,
        fwdX: fx,
        fwdZ: fz,
        rightX: -fz,
        rightZ: fx,
        route: s === steps ? nextRoute : cur.route,
        centerIdx: s === steps ? exitIdx : cur.idx,
        dir: s === steps ? nextDir : cur.dir,
        laneOffset: nextOffset,
        baseSpeed: turnSpeed,
      });
    }

    cur.route = nextRoute;
    cur.idx = exitIdx;
    cur.dir = nextDir;
    cur.laneSlot = nextLaneSlot;
    cur.smoothOffset = nextOffset;
    cur.exitCooldown = 10;

    agent.recentRoutes.push(nextRoute.id);
    if (agent.recentRoutes.length > 8) agent.recentRoutes.shift();
  }

  _advanceCursorAndAppend(agent) {
    const cur = agent.cursor;
    const route = cur.route;
    let nextIdx = cur.idx + cur.dir;

    if (route.isClosed) {
      nextIdx = (nextIdx + route.ringLen) % route.ringLen;
    }

    // Check planned turnQueue first so cars strictly execute unique multi-route trips!
    if (agent.turnQueue && agent.turnQueue.length > 0) {
      const nextTurn = agent.turnQueue[0];
      if (nextTurn.fromRoute === route && Math.abs(nextIdx - nextTurn.atIdx) <= 1) {
        agent.turnQueue.shift();
        const tKey = `${nextTurn.fromRoute.id}:${nextTurn.atIdx}->${nextTurn.toRoute.id}:${nextTurn.toIdx}:${nextTurn.toDir}`;
        this._recentTurnTimes.set(tKey, this._simTime);
        const nextDir = nextTurn.toRoute.isRoundabout ? 1 : nextTurn.toDir;
        const nextLaneSlot = nextTurn.toRoute.type === 'highway' ? (Math.random() < 0.5 ? 0 : 1) : 0;
        this._appendJunctionBezierArc(agent, nextTurn.toRoute, nextTurn.toIdx, nextDir, nextLaneSlot);
        return;
      }
    } else if (cur.exitCooldown <= 0) {
      // Refill fresh unique itinerary when previous multi-route journey finishes
      agent.turnQueue = this._planUniqueJourney(agent, route, clamp(nextIdx, 0, route.ringLen - 1), cur.dir);
    }

    if (route.isClosed) {
      // Secondary fallback opportunistic exit if plan didn't queue one soon
      if (cur.exitCooldown <= 0 && (!agent.turnQueue || !agent.turnQueue.length)) {
        const exits = route.midExits.get(nextIdx);
        if (exits && exits.length > 0 && Math.random() < 0.42) {
          const currT = route.tangents[nextIdx];
          const currFwdX = currT.x * cur.dir;
          const currFwdZ = currT.z * cur.dir;
          const viable = exits.filter((ex) => {
            const exT = ex.route.tangents[ex.idx];
            return currFwdX * (exT.x * ex.dir) + currFwdZ * (exT.z * ex.dir) > 0.12;
          });
          if (viable.length > 0) {
            viable.sort((a, b) => {
              const tA = this._recentTurnTimes.get(`${route.id}:${nextIdx}->${a.route.id}:${a.idx}:${a.dir}`) ?? -999;
              const tB = this._recentTurnTimes.get(`${route.id}:${nextIdx}->${b.route.id}:${b.idx}:${b.dir}`) ?? -999;
              return tA - tB;
            });
            const chosen = viable[0];
            this._recentTurnTimes.set(`${route.id}:${nextIdx}->${chosen.route.id}:${chosen.idx}:${chosen.dir}`, this._simTime);
            const nextDir = chosen.route.isRoundabout ? 1 : chosen.dir;
            const nextLaneSlot = chosen.route.type === 'highway' ? (Math.random() < 0.5 ? 0 : 1) : 0;
            this._appendJunctionBezierArc(agent, chosen.route, chosen.idx, nextDir, nextLaneSlot);
            agent.turnQueue = this._planUniqueJourney(agent, cur.route, cur.idx, cur.dir);
            return;
          }
        }
      } else if (cur.exitCooldown > 0) {
        cur.exitCooldown--;
      }

      cur.idx = nextIdx;
      this._pushCursorWaypoint(agent);
      return;
    }

    if (nextIdx >= 0 && nextIdx < route.ringLen) {
      if (cur.exitCooldown > 0) cur.exitCooldown--;
      cur.idx = nextIdx;
      this._pushCursorWaypoint(agent);
      return;
    }

    // End of open route: switch smoothly onto connected junction route and re-plan if needed
    const endIdx = cur.dir > 0 ? route.ringLen - 1 : 0;
    const links = cur.dir > 0 ? route.endLinks : route.startLinks;
    const currT = route.tangents[endIdx];
    const currFwdX = currT.x * cur.dir;
    const currFwdZ = currT.z * cur.dir;

    const chosen = this._chooseNextRouteFromLinks(links, currFwdX, currFwdZ);
    if (chosen) {
      const nextDir = chosen.route.isRoundabout ? 1 : chosen.dir;
      const nextLaneSlot = chosen.route.type === 'highway' ? (Math.random() < 0.65 ? 0 : 1) : 0;
      this._appendJunctionBezierArc(agent, chosen.route, chosen.idx, nextDir, nextLaneSlot);
      if (!agent.turnQueue || !agent.turnQueue.length) {
        agent.turnQueue = this._planUniqueJourney(agent, cur.route, cur.idx, cur.dir);
      }
      return;
    }

    cur.dir *= -1;
    cur.idx = clamp(cur.idx + cur.dir, 0, route.ringLen - 1);
    this._pushCursorWaypoint(agent);
  }

  _pushCursorWaypoint(agent) {
    const cur = agent.cursor;
    const targetOffset = getLaneOffset(cur.route, cur.laneSlot);
    cur.smoothOffset += (targetOffset - cur.smoothOffset) * 0.34;
    const wp = this._computeLanePoint(cur.route, cur.idx, cur.dir, cur.smoothOffset);
    wp.baseSpeed = getBaseSpeed(cur.route, cur.laneSlot) * agent.spec.speedFactor * agent.driverPace;
    agent.queue.push(wp);
    return wp;
  }

  /**
   * Stratified spawn sampler: balances cars across distinct routes (avoiding stacking on one route).
   * `mode === 'local'` spawns within [minSpawnDist, maxSpawnDist] around player;
   * `mode === 'global'` spawns anywhere across all 65 routes in the entire open world!
   */
  _isPointVisibleToCamera(pt, camera) {
    if (!camera) return false;
    const distCam = Math.hypot(pt.x - camera.position.x, pt.z - camera.position.z);
    if (distCam < 58.0) return true;
    this._projVec.set(pt.x, pt.y + 1.0, pt.z).project(camera);
    const inFront = this._projVec.z >= -1.0 && this._projVec.z <= 1.0;
    const inScreen = Math.abs(this._projVec.x) <= 1.15 && Math.abs(this._projVec.y) <= 1.18;
    return inFront && inScreen && distCam < 320.0;
  }

  _findSpawnCandidate(playerPos, mode = 'local', relaxMinDist = false, playerVel = null, camera = null, isFreeCam = false) {
    const checkVis = !isFreeCam && !!camera;
    const minD = checkVis ? Math.max(58, this.minSpawnDist) : (relaxMinDist ? 42 : this.minSpawnDist);
    const maxD = this.maxSpawnDist;

    const pSpeed = playerVel ? Math.hypot(playerVel.x, playerVel.z) : 0;
    const hasHeading = pSpeed > 12.0;
    const pFwdX = hasHeading ? playerVel.x / pSpeed : 0;
    const pFwdZ = hasHeading ? playerVel.z / pSpeed : 0;

    // Count active vehicles currently on each route so spawns spread proportionally by route length
    const activeCountByRoute = new Map();
    for (const a of this.agents) {
      const rid = a.cursor.route.id;
      activeCountByRoute.set(rid, (activeCountByRoute.get(rid) || 0) + 1);
    }

    // Group candidate sample indices by route
    const routeBuckets = [];
    for (const r of this.routes) {
      const ptsInRange = [];
      const aheadPtsInRange = [];
      for (let i = 0; i < r.ringLen; i += 4) {
        if (!r.isClosed && (i < 6 || i > r.ringLen - 7)) continue;
        const p = r.pts[i];
        const dx = p.x - playerPos.x;
        const dz = p.z - playerPos.z;
        const d = Math.hypot(dx, dz);
        if (mode === 'local') {
          if (d >= minD && d <= maxD) {
            if (checkVis && this._isPointVisibleToCamera(p, camera)) continue;
            ptsInRange.push(i);
            if (hasHeading && (dx * pFwdX + dz * pFwdZ) > -40.0) {
              aheadPtsInRange.push(i);
            }
          }
        } else {
          if (d >= minD) {
            if (checkVis && this._isPointVisibleToCamera(p, camera)) continue;
            ptsInRange.push(i);
          }
        }
      }
      if (ptsInRange.length > 0) {
        const count = activeCountByRoute.get(r.id) || 0;
        const cap = Math.max(2, Math.ceil((r.totalLength || 250) / 140));
        routeBuckets.push({
          route: r,
          indices: aheadPtsInRange.length > 0 ? aheadPtsInRange : ptsInRange,
          count,
          cap,
          density: count / cap,
        });
      }
    }
    if (!routeBuckets.length) return null;

    // Sort buckets by density (active / length-capacity) ascending + small random tie-breaker
    routeBuckets.sort((a, b) => (a.density + Math.random() * 0.25) - (b.density + Math.random() * 0.25));

    // Try least-dense routes first
    const maxTries = Math.min(routeBuckets.length * 2, 32);
    for (let attempt = 0; attempt < maxTries; attempt++) {
      const bucket = routeBuckets[attempt % routeBuckets.length];
      if (mode === 'local' && bucket.count >= bucket.cap && routeBuckets[0].count < routeBuckets[0].cap) {
        continue;
      }
      const r = bucket.route;
      const idx = bucket.indices[Math.floor(Math.random() * bucket.indices.length)];
      const dir = r.isRoundabout ? 1 : (Math.random() < 0.5 ? 1 : -1);
      const laneSlot = r.type === 'highway' ? (Math.random() < 0.65 ? 0 : 1) : 0;
      const laneOffset = getLaneOffset(r, laneSlot);
      const lanePt = this._computeLanePoint(r, idx, dir, laneOffset);

      const dPlayer = Math.hypot(lanePt.x - playerPos.x, lanePt.z - playerPos.z);
      if (dPlayer < minD) continue;
      if (checkVis && this._isPointVisibleToCamera(lanePt, camera)) continue;

      let crowded = false;
      for (const a of this.agents) {
        if (!a.vehicle || !a.vehicle.rigidBody) continue;
        const ap = a.vehicle.rigidBody.translation();
        const sameRoute = a.cursor && a.cursor.route && a.cursor.route.id === r.id;
        const minGap = sameRoute ? 55.0 : 24.0;
        if (Math.hypot(lanePt.x - ap.x, lanePt.z - ap.z) < minGap) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;

      const ray = new this.RAPIER.Ray(
        { x: lanePt.x, y: lanePt.y + 3.0, z: lanePt.z },
        { x: 0, y: -1, z: 0 }
      );
      const hit = this.world.castRay(ray, 7.5, true, undefined, (0xFFFF << 16) | 0x0001);
      if (!hit || hit.timeOfImpact < 0.5) continue;

      const surfaceY = lanePt.y + 3.0 - hit.timeOfImpact;

      // Sample front & rear road heights along forward vector so cars spawn pitched flush with inclines
      const rayMask = (0xFFFF << 16) | 0x0001;
      const probeDist = 1.5;
      const hitF = this.world.castRay(
        new this.RAPIER.Ray(
          { x: lanePt.x + lanePt.fwdX * probeDist, y: lanePt.y + 4.5, z: lanePt.z + lanePt.fwdZ * probeDist },
          { x: 0, y: -1, z: 0 }
        ),
        10.0,
        true,
        undefined,
        rayMask
      );
      const hitR = this.world.castRay(
        new this.RAPIER.Ray(
          { x: lanePt.x - lanePt.fwdX * probeDist, y: lanePt.y + 4.5, z: lanePt.z - lanePt.fwdZ * probeDist },
          { x: 0, y: -1, z: 0 }
        ),
        10.0,
        true,
        undefined,
        rayMask
      );

      let pitch = 0;
      let bestSurfaceY = surfaceY;
      if (hitF && hitF.timeOfImpact >= 0.5 && hitR && hitR.timeOfImpact >= 0.5) {
        const yF = lanePt.y + 4.5 - hitF.timeOfImpact;
        const yR = lanePt.y + 4.5 - hitR.timeOfImpact;
        if (Math.abs(yF - yR) > 1.8) continue;
        pitch = clamp(-Math.atan2(yF - yR, probeDist * 2.0), -0.65, 0.65);
        bestSurfaceY = Math.max(surfaceY, (yF + yR) * 0.5);
      }

      return { route: r, idx, dir, laneSlot, laneOffset, lanePt, surfaceY: bestSurfaceY, pitch, mode };
    }
    return null;
  }

  async _spawnOne(playerPos, mode = 'local', playerVel = null, camera = null, isFreeCam = false) {
    const candidate = this._findSpawnCandidate(playerPos, mode, this.agents.length < 5, playerVel, camera, isFreeCam);
    if (this.remoteSyncMode || !candidate) return;

    this._pendingSpawns++;
    try {
      const specIndex = this._specCursor % AI_VEHICLE_SPECS.length;
      const spec = AI_VEHICLE_SPECS[specIndex];
      this._specCursor++;
      const brakeUniform = { value: 0.0 };
      const paintColorHex = AI_PAINT_PALETTE[Math.floor(Math.random() * AI_PAINT_PALETTE.length)];

      const { parts, clonedMaterials } = await this.createAICarParts(spec.url, brakeUniform, paintColorHex);
      if (this.remoteSyncMode || !this.world || !this.scene) return;

      const id = this._nextId++;
      const vehicle = new RaycastVehicleController(this.RAPIER, this.world, parts, {
        rootName: `AI_Vehicle_${spec.id}_${id}`,
        chassisDims: spec.chassisDims.clone(),
        mass: spec.mass,
        maxEngineForce: spec.maxEngineForce,
        maxReverseForce: 4500,
        maxBrakeForce: 12500,
        handbrakeForce: 5000,
        maxSteerAngle: 0.62,
        highSpeedSteerFactor: 0.010,
        steerSpeed: 10.5,
        frontLateralGrip: 2.85,
        rearLateralGrip: 2.75,
        yawAssistTorque: 3200,
        downforceCoeff: 0.35,
        isTraffic: true,
        collisionGroups: AI_CHASSIS_COLLISION_GROUPS,
      });

      const yaw = Math.atan2(candidate.lanePt.fwdX, candidate.lanePt.fwdZ);
      const pitch = candidate.pitch || 0;
      const spawnY = candidate.surfaceY + vehicle.chassisLocalOffset.y + 0.14;
      vehicle.reset(new THREE.Vector3(candidate.lanePt.x, spawnY, candidate.lanePt.z), yaw, pitch);

      const initSpeed = getBaseSpeed(candidate.route, candidate.laneSlot) * 0.65;
      const cosP = Math.cos(pitch);
      const sinP = -Math.sin(pitch);
      vehicle.rigidBody.setLinvel(
        {
          x: candidate.lanePt.fwdX * cosP * initSpeed,
          y: sinP * initSpeed,
          z: candidate.lanePt.fwdZ * cosP * initSpeed,
        },
        true
      );

      this.scene.add(vehicle.rootGroup);

      const agent = {
        id,
        role: candidate.mode, // 'local' (circles player region) | 'global' (roams entire map)
        spec,
        specIndex,
        paintColorHex,
        vehicle,
        brakeUniform,
        clonedMaterials,
        driverPace: 0.90 + Math.random() * 0.22,
        state: 'CRUISING',
        unrecoverableTimer: 0,
        lowProgressTimer: 0,
        yieldWaitTimer: 0,
        yieldOverrideTimer: 0,
        reverseTimer: 0,
        reverseSteerSign: 1,
        nearestRouteSearchCooldown: 0,
        recentRoutes: [candidate.route.id],
        turnQueue: [],
        cursor: {
          route: candidate.route,
          idx: candidate.idx,
          dir: candidate.dir,
          laneSlot: candidate.laneSlot,
          smoothOffset: candidate.laneOffset,
          exitCooldown: 4,
        },
        queue: [],
        controlInput: {
          steerAnalog: 0,
          throttleAnalog: 0,
          brakeAnalog: 0,
          reverseAnalog: 0,
          handbrake: false,
        },
        targetBrakeLight: 0,
      };

      // Assign unique multi-route cross-map itinerary immediately!
      agent.turnQueue = this._planUniqueJourney(agent, candidate.route, candidate.idx, candidate.dir);

      this._pushCursorWaypoint(agent);
      for (let i = 0; i < 23; i++) {
        this._advanceCursorAndAppend(agent);
      }

      this.agents.push(agent);
    } catch (e) {
      console.warn('Failed to spawn AI traffic vehicle:', e);
    } finally {
      this._pendingSpawns = Math.max(0, this._pendingSpawns - 1);
    }
  }

  _despawnAgentAt(index) {
    const agent = this.agents[index];
    if (!agent) return;
    agent.vehicle.destroy();
    for (const mat of agent.clonedMaterials) {
      mat.dispose();
    }
    this.agents.splice(index, 1);
  }

  _measureLaneTracking(agent, pos) {
    const q = agent.queue;
    if (q.length < 2) {
      return { dist: 0, signedCte: 0, segIdx: 0, fwdX: this._vFwd.x, fwdZ: this._vFwd.z };
    }

    const searchMax = Math.min(q.length - 1, 6);
    let best = null;
    let bestIdx = 0;

    for (let i = 0; i < searchMax; i++) {
      const a = q[i];
      const b = q[i + 1];
      const seg = closestPointOnSegmentXZ(pos.x, pos.z, a.x, a.z, b.x, b.z);
      if (!best || seg.dist < best.dist) {
        best = seg;
        bestIdx = i;
      }
    }

    const dx = pos.x - best.cx;
    const dz = pos.z - best.cz;
    const segLeftX = best.uz;
    const segLeftZ = -best.ux;
    const signedCte = dx * segLeftX + dz * segLeftZ;

    return {
      dist: best.dist,
      signedCte,
      segIdx: bestIdx,
      closestX: best.cx,
      closestZ: best.cz,
      segFwdX: best.ux,
      segFwdZ: best.uz,
      segT: best.t,
    };
  }

  _reacquireClosestLane(agent, pos) {
    let bestRoute = null;
    let bestIdx = 0;
    let bestDist = Infinity;

    for (const r of this.routes) {
      for (let i = 0; i < r.ringLen; i += 2) {
        const p = r.pts[i];
        if (Math.abs(p.y - pos.y) > 5.0) continue;
        const d = Math.hypot(p.x - pos.x, p.z - pos.z);
        if (d < bestDist) {
          bestDist = d;
          bestRoute = r;
          bestIdx = i;
        }
      }
    }
    if (!bestRoute) return;

    const dir = bestRoute.isRoundabout
      ? 1
      : (this._vFwd.x * bestRoute.tangents[bestIdx].x + this._vFwd.z * bestRoute.tangents[bestIdx].z >= 0 ? 1 : -1);

    const laneSlot = bestRoute.type === 'highway' ? (Math.random() < 0.65 ? 0 : 1) : 0;
    const laneOffset = getLaneOffset(bestRoute, laneSlot);
    const skipAhead = 2;
    const targetIdx = bestRoute.isClosed
      ? (bestIdx + skipAhead * dir + bestRoute.ringLen) % bestRoute.ringLen
      : clamp(bestIdx + skipAhead * dir, 0, bestRoute.ringLen - 1);

    agent.cursor = {
      route: bestRoute,
      idx: targetIdx,
      dir,
      laneSlot,
      smoothOffset: laneOffset,
      exitCooldown: 6,
    };
    agent.turnQueue = this._planUniqueJourney(agent, bestRoute, targetIdx, dir);
    agent.queue.length = 0;
    this._pushCursorWaypoint(agent);
    for (let i = 0; i < 23; i++) {
      this._advanceCursorAndAppend(agent);
    }
  }

  _computeCurveSpeedCap(agent) {
    const q = agent.queue;
    if (q.length < 5) return 11.0;

    let minCap = q[0].baseSpeed || 11.5;
    const maxSample = Math.min(q.length - 3, 18);
    for (let i = 0; i < maxSample; i++) {
      const a = q[i];
      const b = q[i + 2];
      const dot = clamp(a.fwdX * b.fwdX + a.fwdZ * b.fwdZ, -1, 1);
      const angle = Math.acos(dot);
      if (angle > 0.03) {
        const arc = Math.max(2.5, Math.hypot(b.x - a.x, b.z - a.z));
        const radius = arc / angle;
        const vCurve = Math.sqrt(3.2 * radius);
        if (vCurve < minCap) minCap = vCurve;
      }
      if (b.baseSpeed && b.baseSpeed < minCap) {
        minCap = Math.min(minCap, b.baseSpeed + 1.0);
      }
    }
    return clamp(minCap, 4.8, 19.0);
  }

  _detectBlockerAhead(agent, pos, fwdX, fwdZ, rightX, rightZ, playerVehicle) {
    let minBlockDist = Infinity;
    let blockerFwdSpeed = 0;
    let blockerAgent = null;
    let blockerIsCrossing = false;
    let blockerSpeedAbs = 0;
    const ignoreCrossing = agent.yieldOverrideTimer > 0;

    const considerVehicle = (otherBody, otherDimsHalfX = 0.98, otherAgent = null) => {
      if (!otherBody) return;
      const op = otherBody.translation();
      if (Math.abs(op.y - pos.y) > 3.5) return;

      const dx = op.x - pos.x;
      const dz = op.z - pos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 34.0 * 34.0) return;

      const ahead = dx * fwdX + dz * fwdZ;
      const lat = dx * rightX + dz * rightZ;

      const ov = otherBody.linvel();
      const otherSpeedAbs = Math.hypot(ov.x, ov.z);
      const otherFwdSpeed = ov.x * fwdX + ov.z * fwdZ;

      // Determine whether the other vehicle is crossing/opposing our heading
      let isCrossing = false;
      if (otherAgent && otherAgent.vehicle && otherAgent.vehicle.rootGroup) {
        const oq = otherAgent.vehicle.rootGroup.quaternion;
        // Local +Z forward in Three.js
        const oFwdX = 2 * (oq.x * oq.z + oq.w * oq.y);
        const oFwdZ = 1 - 2 * (oq.x * oq.x + oq.y * oq.y);
        isCrossing = (oFwdX * fwdX + oFwdZ * fwdZ) < 0.45;
      } else if (otherSpeedAbs > 1.2) {
        isCrossing = (otherFwdSpeed / otherSpeedAbs) < 0.45;
      }

      // Direct forward corridor (tightened so opposing/adjacent lanes don't falsely trigger)
      const directHalfWidth = 0.85 + otherDimsHalfX * 0.70;
      if (ahead > -0.2 && ahead < 30.0 && Math.abs(lat) < directHalfWidth) {
        // When breaking an intersection deadlock, only stop for immediate bumper-level obstacles
        if (ignoreCrossing && isCrossing && ahead > 7.2) return;
        if (ahead < minBlockDist) {
          minBlockDist = ahead;
          blockerFwdSpeed = otherFwdSpeed;
          blockerAgent = otherAgent;
          blockerIsCrossing = isCrossing;
          blockerSpeedAbs = otherSpeedAbs;
        }
        return;
      }

      // Curved-path corridor along upcoming queue waypoints
      const qCheckCount = Math.min(agent.queue.length, 12);
      let pathDist = 0;
      for (let i = 0; i < qCheckCount; i++) {
        const wp = agent.queue[i];
        if (i === 0) {
          pathDist = Math.hypot(wp.x - pos.x, wp.z - pos.z);
        } else {
          const prev = agent.queue[i - 1];
          pathDist += Math.hypot(wp.x - prev.x, wp.z - prev.z);
        }
        if (pathDist > 28.0) break;
        const dToWp = Math.hypot(op.x - wp.x, op.z - wp.z);
        if (dToWp < 2.05) {
          // Don't deadlock on a stopped crossing/opposing car far ahead on the turn arc
          if (isCrossing && otherSpeedAbs < 1.2 && pathDist > 12.0) break;
          if (ignoreCrossing && isCrossing && pathDist > 7.2) break;
          if (pathDist < minBlockDist) {
            minBlockDist = pathDist;
            blockerFwdSpeed = otherFwdSpeed;
            blockerAgent = otherAgent;
            blockerIsCrossing = isCrossing;
            blockerSpeedAbs = otherSpeedAbs;
          }
          break;
        }

        // Predictive intersection conflict check: yield to lower-ID moving crossing car whose path intersects ours
        if (
          isCrossing &&
          !ignoreCrossing &&
          otherAgent &&
          agent.id > otherAgent.id &&
          otherSpeedAbs > 1.5 &&
          pathDist < 20.0 &&
          otherAgent.queue &&
          otherAgent.queue.length > 3
        ) {
          const oMax = Math.min(otherAgent.queue.length, 6);
          let futureHit = false;
          for (let j = 1; j < oMax; j += 2) {
            const owp = otherAgent.queue[j];
            if (Math.hypot(owp.x - wp.x, owp.z - wp.z) < 2.5) {
              futureHit = true;
              break;
            }
          }
          if (futureHit && pathDist < minBlockDist) {
            minBlockDist = pathDist;
            blockerFwdSpeed = 0;
            blockerAgent = otherAgent;
            blockerIsCrossing = true;
            blockerSpeedAbs = otherSpeedAbs;
            break;
          }
        }
      }
    };

    if (playerVehicle && playerVehicle.rigidBody) {
      considerVehicle(playerVehicle.rigidBody, 0.98, null);
    }
    for (const other of this.agents) {
      if (other === agent || !other.vehicle || !other.vehicle.rigidBody) continue;
      considerVehicle(other.vehicle.rigidBody, 0.98, other);
    }

    return {
      dist: minBlockDist,
      fwdSpeed: blockerFwdSpeed,
      agent: blockerAgent,
      isCrossing: blockerIsCrossing,
      speedAbs: blockerSpeedAbs,
    };
  }

  updatePhysicsStep(subDt, playerVehicle) {
    if (this.remoteSyncMode) {
      this._updateRemotePhysicsStep(playerVehicle);
      return;
    }
    if (!this.isReady) return;

    for (const agent of this.agents) {
      const v = agent.vehicle;
      const body = v.rigidBody;
      if (!body) continue;

      const pos = body.translation();
      const rot = body.rotation();
      this._quat.set(rot.x, rot.y, rot.z, rot.w);
      this._vFwd.set(0, 0, 1).applyQuaternion(this._quat).normalize();
      this._vUp.set(0, 1, 0).applyQuaternion(this._quat).normalize();
      this._vLeft.set(1, 0, 0).applyQuaternion(this._quat).normalize();

      const fwdLenXZ = Math.hypot(this._vFwd.x, this._vFwd.z) || 1;
      const fwdX = this._vFwd.x / fwdLenXZ;
      const fwdZ = this._vFwd.z / fwdLenXZ;
      const rightX = -fwdZ;
      const rightZ = fwdX;

      while (agent.queue.length < 24) {
        this._advanceCursorAndAppend(agent);
      }

      const tracking = this._measureLaneTracking(agent, pos);
      if (tracking.segIdx > 0) {
        agent.queue.splice(0, tracking.segIdx);
      }
      while (agent.queue.length > 2) {
        const a = agent.queue[0];
        const b = agent.queue[1];
        const seg = closestPointOnSegmentXZ(pos.x, pos.z, a.x, a.z, b.x, b.z);
        if (seg.t >= 0.98) {
          agent.queue.shift();
          this._advanceCursorAndAppend(agent);
        } else {
          break;
        }
      }
      while (agent.queue.length < 24) {
        this._advanceCursorAndAppend(agent);
      }

      const distToLane = tracking.dist;
      agent.nearestRouteSearchCooldown -= subDt;
      if (distToLane > 16.0 && agent.nearestRouteSearchCooldown <= 0) {
        agent.nearestRouteSearchCooldown = 1.6;
        this._reacquireClosestLane(agent, pos);
      }

      const offRoute = distToLane > 6.5 || this._vUp.y < 0.55;
      agent.state = offRoute ? 'RECOVERING' : 'CRUISING';

      const speedAbs = Math.abs(v.forwardSpeed);
      const curveSpeedCap = this._computeCurveSpeedCap(agent);
      const lookaheadDist = offRoute
        ? clamp(distToLane * 0.8 + 9.0, 12.0, 24.0)
        : clamp(4.8 + speedAbs * 0.36, 5.2, 11.2);

      let targetPt = agent.queue[0];
      let accDist = Math.hypot(targetPt.x - pos.x, targetPt.z - pos.z);
      for (let i = 1; i < agent.queue.length; i++) {
        const prev = agent.queue[i - 1];
        const curr = agent.queue[i];
        accDist += Math.hypot(curr.x - prev.x, curr.z - prev.z);
        targetPt = curr;
        if (accDist >= lookaheadDist) break;
      }

      const toX = targetPt.x - pos.x;
      const toZ = targetPt.z - pos.z;
      const ld = Math.max(1.0, Math.hypot(toX, toZ));
      const dirX = toX / ld;
      const dirZ = toZ / ld;

      const leftXZLen = Math.hypot(this._vLeft.x, this._vLeft.z) || 1;
      const leftX = this._vLeft.x / leftXZLen;
      const leftZ = this._vLeft.z / leftXZLen;
      const localLeft = dirX * leftX + dirZ * leftZ;
      const localFwd = dirX * fwdX + dirZ * fwdZ;
      const alpha = Math.atan2(localLeft, localFwd);

      if (agent.yieldOverrideTimer > 0) {
        agent.yieldOverrideTimer = Math.max(0, agent.yieldOverrideTimer - subDt);
      }

      const blocker = this._detectBlockerAhead(agent, pos, fwdX, fwdZ, rightX, rightZ, playerVehicle);
      if (agent.yieldOverrideTimer > 0 && blocker.dist < 10.0 && blocker.speedAbs >= 1.5) {
        agent.yieldOverrideTimer = 0;
      }
      const isWaitingForTraffic =
        blocker.dist < 22.0 && blocker.fwdSpeed < 2.5 && !offRoute;

      if (isWaitingForTraffic && speedAbs < 1.5) {
        agent.yieldWaitTimer += subDt;
        // If physically wedged nose-to-side/bumper-to-bumper, back up gently to clear the collision
        if (
          blocker.dist < 5.0 &&
          agent.yieldWaitTimer > 1.0 &&
          agent.reverseTimer <= 0 &&
          (!blocker.agent || agent.id > blocker.agent.id)
        ) {
          agent.reverseTimer = 1.05;
          agent.reverseSteerSign = alpha >= 0 ? -1 : 1;
          agent.yieldWaitTimer = 0;
        } else if (
          agent.yieldWaitTimer > 1.2 &&
          blocker.agent &&
          blocker.speedAbs < 1.5 &&
          (blocker.isCrossing || blocker.agent.yieldWaitTimer > 0.6) &&
          agent.id < blocker.agent.id
        ) {
          // Break mutual intersection deadlocks deterministically: lower ID proceeds
          agent.yieldOverrideTimer = 2.6;
          agent.yieldWaitTimer = 0;
        }
      } else {
        agent.yieldWaitTimer = Math.max(0, agent.yieldWaitTimer - subDt * 2.0);
      }

      let desiredSpeed = curveSpeedCap;
      if (offRoute) {
        desiredSpeed = Math.min(desiredSpeed, 8.2);
      }

      const hardStopDist = 7.2;
      if (blocker.dist < hardStopDist) {
        desiredSpeed = 0;
      } else if (blocker.dist < 28.0) {
        const gapRatio = (blocker.dist - hardStopDist) / (28.0 - hardStopDist);
        const followCap = Math.max(0, blocker.fwdSpeed * 0.90) + gapRatio * 14.5;
        desiredSpeed = Math.min(desiredSpeed, followCap);
      }

      const isFlipped = this._vUp.y < 0.45;
      const facingWrongWay = localFwd < -0.25 && !offRoute;
      if (agent.reverseTimer > 0) {
        agent.reverseTimer -= subDt;
      } else if (!isWaitingForTraffic && !isFlipped && (speedAbs < 1.2 || facingWrongWay)) {
        agent.lowProgressTimer += subDt;
        if (agent.lowProgressTimer > (facingWrongWay ? 0.9 : 2.2)) {
          agent.reverseTimer = 1.35;
          agent.reverseSteerSign = alpha >= 0 ? -1 : 1;
          agent.lowProgressTimer = 0;
        }
      } else {
        agent.lowProgressTimer = Math.max(0, agent.lowProgressTimer - subDt * 2.0);
      }

      const isGenuinelyStalled =
        (!isWaitingForTraffic && agent.lowProgressTimer > 1.8 && desiredSpeed > 2.5) ||
        agent.yieldWaitTimer > 10.0;
      if (offRoute || isFlipped || isGenuinelyStalled) {
        agent.unrecoverableTimer += subDt;
      } else {
        agent.unrecoverableTimer = Math.max(0, agent.unrecoverableTimer - subDt * 3.0);
      }

      const inp = agent.controlInput;
      if (agent.reverseTimer > 0) {
        inp.steerAnalog = agent.reverseSteerSign * 0.80;
        inp.throttleAnalog = 0;
        inp.brakeAnalog = 0;
        inp.reverseAnalog = 0.78;
        agent.targetBrakeLight = 0.0;
      } else {
        inp.reverseAnalog = 0;

        const wheelbase = 2.65;
        let steerRad = Math.atan2(2.0 * wheelbase * Math.sin(alpha), ld);
        if (localFwd < -0.1) {
          steerRad = (alpha >= 0 ? 1 : -1) * v.params.maxSteerAngle;
        }

        if (!offRoute && localFwd > 0.35) {
          const alignSign = (tracking.segFwdX * fwdX + tracking.segFwdZ * fwdZ) >= 0 ? 1 : -1;
          const cteSteer = -alignSign * Math.atan2(1.25 * tracking.signedCte, speedAbs + 3.2);
          steerRad += cteSteer;
        }

        const speedFactor = 1 / (1 + speedAbs * v.params.highSpeedSteerFactor);
        const effMaxSteer = Math.max(0.18, v.params.maxSteerAngle * speedFactor);
        inp.steerAnalog = clamp(steerRad / effMaxSteer, -1.0, 1.0);

        const speedErr = desiredSpeed - v.forwardSpeed;
        if (desiredSpeed < 0.8 && v.forwardSpeed < 1.6) {
          inp.throttleAnalog = 0;
          inp.brakeAnalog = 0.85;
          agent.targetBrakeLight = blocker.dist < 38.0 ? 1.0 : 0.0;
        } else if (speedErr > 0.35) {
          inp.throttleAnalog = clamp(speedErr * 0.32, 0.10, 0.88);
          inp.brakeAnalog = 0;
          agent.targetBrakeLight = 0.0;
        } else if (speedErr < -0.7) {
          inp.throttleAnalog = 0;
          inp.brakeAnalog = clamp((-speedErr - 0.7) * 0.30, 0.12, 0.95);
          agent.targetBrakeLight = inp.brakeAnalog > 0.12 ? 1.0 : 0.0;
        } else {
          inp.throttleAnalog = desiredSpeed > 2.0 ? 0.16 : 0;
          inp.brakeAnalog = 0;
          agent.targetBrakeLight = 0.0;
        }
      }

      v.updatePhysicsStep(subDt, inp);
    }
  }

  updateFrame(dt, playerVehicle, isPaused = false, camera = null, isFreeCam = false) {
    if (this.remoteSyncMode) {
      const focusPos = (isFreeCam && camera)
        ? camera.position
        : (playerVehicle && playerVehicle.rigidBody ? playerVehicle.rigidBody.translation() : (camera ? camera.position : null));
      this._updateRemoteFrame(dt, focusPos);
      return;
    }
    if (!this.isReady || !playerVehicle || !playerVehicle.rigidBody || this.raceSuspended) return;

    const playerPos = playerVehicle.rigidBody.translation();
    const playerVel = playerVehicle.rigidBody.linvel();
    const playerSpeed = Math.hypot(playerVel.x, playerVel.z);
    const pFwdX = playerSpeed > 8.0 ? playerVel.x / playerSpeed : 0;
    const pFwdZ = playerSpeed > 8.0 ? playerVel.z / playerSpeed : 0;

    if (!isPaused) {
      this._simTime += dt;
      let localCount = 0;
      for (let i = this.agents.length - 1; i >= 0; i--) {
        const a = this.agents[i];
        const body = a.vehicle.rigidBody;
        if (!body) {
          this._despawnAgentAt(i);
          continue;
        }
        const pos = body.translation();
        const dxP = pos.x - playerPos.x;
        const dzP = pos.z - playerPos.z;
        const distPlayer = Math.hypot(dxP, dzP);

        const timedOut = a.unrecoverableTimer >= (a.state === 'RECOVERING' ? this.offRouteTimeoutSec : this.stuckTimeoutSec);
        const fellInAbyss = pos.y < -6.0;
        // Recycle local vehicles if very far, OR when driving fast and left > 320m behind the player
        const behindAndFar =
          playerSpeed > 8.0 &&
          (dxP * pFwdX + dzP * pFwdZ) < -30.0 &&
          distPlayer > Math.min(this.despawnDist, 320);
        const tooFar = a.role === 'local' && (distPlayer > this.despawnDist || behindAndFar);

        if (timedOut || fellInAbyss || tooFar) {
          this._despawnAgentAt(i);
        } else if (a.role === 'local') {
          localCount++;
        }
      }

      this._spawnCooldown -= dt;
      if (
        this._spawnCooldown <= 0 &&
        this.agents.length + this._pendingSpawns < this.maxVehicles
      ) {
        if (camera && !isFreeCam) camera.updateMatrixWorld();
        const deficit = this.maxVehicles - (this.agents.length + this._pendingSpawns);
        const burst = Math.min(4, deficit);
        this._spawnCooldown = deficit > 4 ? 0.02 : 0.05;
        for (let b = 0; b < burst; b++) {
          const spawnMode = localCount < this.localVehicleShare ? 'local' : 'global';
          if (spawnMode === 'local') localCount++;
          this._spawnOne(playerPos, spawnMode, playerVel, camera, isFreeCam);
        }
      }
    }

    const brakeLerp = 1 - Math.exp(-20.0 * dt);
    for (const a of this.agents) {
      a.vehicle.syncVisuals();
      a.brakeUniform.value += (a.targetBrakeLight - a.brakeUniform.value) * brakeLerp;
    }
    this._updateTrafficHeadlightSpots((isFreeCam && camera) ? camera.position : playerPos, false);
  }

  _updateTrafficHeadlightSpots(focusPos, isRemote) {
    if (!this._headlightPool || this._headlightPool.length === 0) return;
    const nf = Math.max(0.0, Math.min(1.0, PIXEL_LIGHTING_UNIFORMS.uNightFactor.value || 0.0));
    const baseInt = nf > 0.04 ? (nf * nf * 135.0 + nf * 22.0) : 0.0;
    if (baseInt <= 0.01 || !focusPos) {
      for (let i = 0; i < this._headlightPool.length; i++) {
        this._headlightPool[i].spot.intensity = 0.0;
      }
      return;
    }

    const poolSize = this._headlightPool.length;
    const bestD2 = this._hlBestD2;
    const bestPos = this._hlBestPos;
    const bestRot = this._hlBestRot;
    const maxDistSq = 12100.0; // 110m^2
    for (let i = 0; i < poolSize; i++) {
      bestD2[i] = maxDistSq;
      bestPos[i] = null;
      bestRot[i] = null;
    }

    const fx = focusPos.x;
    const fz = focusPos.z;
    const consider = (pos, rot) => {
      const dx = pos.x - fx;
      const dz = pos.z - fz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= bestD2[poolSize - 1]) return;
      let slot = poolSize - 1;
      while (slot > 0 && d2 < bestD2[slot - 1]) {
        bestD2[slot] = bestD2[slot - 1];
        bestPos[slot] = bestPos[slot - 1];
        bestRot[slot] = bestRot[slot - 1];
        slot--;
      }
      bestD2[slot] = d2;
      bestPos[slot] = pos;
      bestRot[slot] = rot;
    };

    if (isRemote) {
      for (const proxy of this.remoteAgents.values()) {
        if (!proxy.rootGroup) continue;
        const pos = proxy.rigidBody ? proxy.rigidBody.translation() : proxy.pose;
        const rot = proxy.rigidBody ? proxy.rigidBody.rotation() : proxy.pose;
        consider(
          pos.x !== undefined ? pos : { x: pos.px, y: pos.py, z: pos.pz },
          rot.x !== undefined ? rot : { x: rot.qx, y: rot.qy, z: rot.qz, w: rot.qw }
        );
      }
    } else {
      for (let i = 0; i < this.agents.length; i++) {
        const body = this.agents[i].vehicle && this.agents[i].vehicle.rigidBody;
        if (!body) continue;
        consider(body.translation(), body.rotation());
      }
    }

    for (let i = 0; i < poolSize; i++) {
      const slot = this._headlightPool[i];
      const pos = bestPos[i];
      const rot = bestRot[i];
      if (pos && rot) {
        this._quat.set(rot.x, rot.y, rot.z, rot.w);
        this._vFwd.set(0, 0, 1).applyQuaternion(this._quat).normalize();
        const dist = Math.sqrt(bestD2[i]);
        const fade = dist < 80.0 ? 1.0 : Math.max(0.0, 1.0 - (dist - 80.0) / 30.0);

        slot.spot.position.set(
          pos.x + this._vFwd.x * 1.95,
          pos.y + 0.78,
          pos.z + this._vFwd.z * 1.95
        );
        slot.target.position.set(
          pos.x + this._vFwd.x * 20.0,
          pos.y - 0.55,
          pos.z + this._vFwd.z * 20.0
        );
        slot.spot.intensity = baseInt * fade;
      } else {
        slot.spot.intensity = 0.0;
      }
    }
  }

  setSuspendedForRace(suspended) {
    const next = Boolean(suspended);
    if (this.raceSuspended === next) return;
    this.raceSuspended = next;
    if (next) {
      while (this.agents.length > 0) {
        this._despawnAgentAt(this.agents.length - 1);
      }
      if (this._headlightPool) {
        for (let i = 0; i < this._headlightPool.length; i++) {
          this._headlightPool[i].spot.intensity = 0.0;
        }
      }
    } else {
      this._spawnCooldown = 0.05;
    }
  }

  setRemoteSyncMode(enabled) {
    const next = Boolean(enabled);
    if (this.remoteSyncMode === next) return;
    this.remoteSyncMode = next;
    this._remoteClockOffset = null;
    this._remoteJitterMs = 0;
    this._remoteLastSenderTs = null;
    this._remoteLastRecvMs = null;

    if (next) {
      while (this.agents.length > 0) {
        this._despawnAgentAt(this.agents.length - 1);
      }
    } else {
      this._clearRemoteAgents();
      this._spawnCooldown = 0.05;
    }
  }

  _clearRemoteAgents() {
    for (const proxy of this.remoteAgents.values()) {
      this._destroyRemoteProxy(proxy);
    }
    this.remoteAgents.clear();
  }

  _destroyRemoteProxy(proxy) {
    if (!proxy) return;
    proxy.disposed = true;
    if (proxy.rigidBody && this.world) {
      try {
        this.world.removeRigidBody(proxy.rigidBody);
      } catch (_) {}
      proxy.rigidBody = null;
    }
    if (proxy.rootGroup && proxy.rootGroup.parent) {
      proxy.rootGroup.parent.remove(proxy.rootGroup);
    }
    if (proxy.clonedMaterials) {
      for (const mat of proxy.clonedMaterials) {
        mat.dispose();
      }
    }
  }

  exportSyncSnapshot() {
    const vehicles = [];
    for (const a of this.agents) {
      const v = a.vehicle;
      const body = v?.rigidBody;
      if (!body) continue;
      const pos = body.translation();
      const rot = body.rotation();
      const vel = body.linvel();
      const spinAngle = v.wheels && v.wheels[0] ? v.wheels[0].spinAngle : 0;
      vehicles.push({
        id: a.id,
        specIndex: a.specIndex ?? 0,
        paintColorHex: a.paintColorHex ?? AI_PAINT_PALETTE[0],
        px: pos.x,
        py: pos.y,
        pz: pos.z,
        qx: rot.x,
        qy: rot.y,
        qz: rot.z,
        qw: rot.w,
        vx: vel.x,
        vy: vel.y,
        vz: vel.z,
        steer: v.currentSteer || 0,
        spin: spinAngle,
        brake: a.targetBrakeLight || 0,
      });
    }
    return {
      timestamp: performance.now(),
      vehicles,
    };
  }

  async syncInitialSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.vehicles)) return;
    const promises = this._ingestSyncSnapshot(snapshot);
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  applySyncSnapshot(snapshot) {
    if (!this.remoteSyncMode || !snapshot || !Array.isArray(snapshot.vehicles)) return;
    this._ingestSyncSnapshot(snapshot);
  }

  _ingestSyncSnapshot(snapshot) {
    const nowMs = performance.now();
    const senderTs = Number.isFinite(snapshot.timestamp) ? snapshot.timestamp : nowMs;
    const rawOffset = nowMs - senderTs;
    if (this._remoteClockOffset === null) {
      this._remoteClockOffset = rawOffset;
    } else {
      const alpha = rawOffset < this._remoteClockOffset ? 0.35 : 0.04;
      this._remoteClockOffset += (rawOffset - this._remoteClockOffset) * alpha;
    }
    if (this._remoteLastSenderTs !== null && this._remoteLastRecvMs !== null) {
      const dtSender = senderTs - this._remoteLastSenderTs;
      const dtRecv = nowMs - this._remoteLastRecvMs;
      const jitter = Math.abs(dtRecv - dtSender);
      this._remoteJitterMs = this._remoteJitterMs * 0.8 + Math.min(jitter, 120) * 0.2;
    }
    this._remoteLastSenderTs = senderTs;
    this._remoteLastRecvMs = nowMs;

    const sampleTime = senderTs + this._remoteClockOffset;
    const seenIds = new Set();
    const spawnPromises = [];

    for (const item of snapshot.vehicles) {
      seenIds.add(item.id);
      let proxy = this.remoteAgents.get(item.id);
      if (!proxy) {
        proxy = {
          id: item.id,
          specIndex: item.specIndex ?? 0,
          paintColorHex: item.paintColorHex ?? AI_PAINT_PALETTE[0],
          snapshots: [],
          rootGroup: null,
          wheels: [],
          chassisLocalOffset: new THREE.Vector3(0, 0.36, 0),
          rigidBody: null,
          chassisCollider: null,
          cabinCollider: null,
          lastContactMs: 0,
          brakeUniform: { value: item.brake || 0 },
          targetBrakeLight: item.brake || 0,
          clonedMaterials: [],
          disposed: false,
          pose: {
            px: item.px,
            py: item.py,
            pz: item.pz,
            qx: item.qx,
            qy: item.qy,
            qz: item.qz,
            qw: item.qw,
            vx: item.vx || 0,
            vy: item.vy || 0,
            vz: item.vz || 0,
            steer: item.steer || 0,
            spin: item.spin || 0,
          },
        };
        this.remoteAgents.set(item.id, proxy);
        spawnPromises.push(this._spawnRemoteTrafficProxy(proxy));
      }

      proxy.targetBrakeLight = item.brake || 0;
      const snaps = proxy.snapshots;
      if (snaps.length === 0 || sampleTime > snaps[snaps.length - 1].t) {
        snaps.push({
          t: sampleTime,
          px: item.px,
          py: item.py,
          pz: item.pz,
          qx: item.qx,
          qy: item.qy,
          qz: item.qz,
          qw: item.qw,
          vx: item.vx || 0,
          vy: item.vy || 0,
          vz: item.vz || 0,
          steer: item.steer || 0,
          spin: item.spin || 0,
        });
        if (snaps.length > 8) snaps.shift();
      }
    }

    for (const [id, proxy] of this.remoteAgents.entries()) {
      if (!seenIds.has(id)) {
        this._destroyRemoteProxy(proxy);
        this.remoteAgents.delete(id);
      }
    }

    return spawnPromises;
  }

  async _spawnRemoteTrafficProxy(proxy) {
    const spec = AI_VEHICLE_SPECS[proxy.specIndex % AI_VEHICLE_SPECS.length] || AI_VEHICLE_SPECS[0];
    try {
      const { parts, clonedMaterials } = await this.createAICarParts(
        spec.url,
        proxy.brakeUniform,
        proxy.paintColorHex
      );
      if (proxy.disposed || !this.remoteSyncMode || !this.world || !this.scene) {
        for (const mat of clonedMaterials) mat.dispose();
        return;
      }

      const rootGroup = new THREE.Group();
      rootGroup.name = `Synced_AI_${spec.id}_${proxy.id}`;
      const chassisMesh = parts.Chassis_Body;
      proxy.chassisLocalOffset.copy(chassisMesh.position);
      rootGroup.add(chassisMesh);

      const wheelOrder = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
      proxy.wheels = wheelOrder.map((id, idx) => {
        const mesh = parts[id];
        mesh.rotation.order = 'YXZ';
        rootGroup.add(mesh);
        return {
          mesh,
          isFront: idx < 2,
          restPos: mesh.position.clone(),
        };
      });

      const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(proxy.pose.px, proxy.pose.py, proxy.pose.pz)
        .setRotation({ x: proxy.pose.qx, y: proxy.pose.qy, z: proxy.pose.qz, w: proxy.pose.qw })
        .setGravityScale(0.0)
        .setLinearDamping(0.6)
        .setAngularDamping(6.0)
        .setCanSleep(false);
      const rigidBody = this.world.createRigidBody(bodyDesc);

      const dims = spec.chassisDims;
      const proxyMass = spec.mass || 1360;
      const lowerHull = this.RAPIER.ColliderDesc.cuboid(dims.x * 0.48, 0.16, dims.z * 0.48)
        .setTranslation(0, 0.11, 0)
        .setMass(proxyMass * 0.85)
        .setFriction(0.12)
        .setRestitution(0.0)
        .setCollisionGroups(REMOTE_TRAFFIC_COLLISION_GROUPS);
      const upperCabin = this.RAPIER.ColliderDesc.cuboid(dims.x * 0.42, 0.20, dims.z * 0.25)
        .setTranslation(0, 0.44, -0.15)
        .setMass(proxyMass * 0.15)
        .setFriction(0.12)
        .setRestitution(0.0)
        .setCollisionGroups(REMOTE_TRAFFIC_COLLISION_GROUPS);

      proxy.chassisCollider = this.world.createCollider(lowerHull, rigidBody);
      proxy.cabinCollider = this.world.createCollider(upperCabin, rigidBody);

      proxy.rootGroup = rootGroup;
      proxy.rigidBody = rigidBody;
      proxy.clonedMaterials = clonedMaterials;
      this._applyRemoteProxyVisuals(proxy);
      this.scene.add(rootGroup);
    } catch (err) {
      console.warn('Failed to spawn synced traffic car:', err);
    }
  }

  _evaluateRemoteProxyPose(proxy, evalTimeMs) {
    const snaps = proxy.snapshots;
    if (snaps.length === 0) return;

    const latest = snaps[snaps.length - 1];
    const p = proxy.pose;

    if (snaps.length === 1 || evalTimeMs >= latest.t) {
      const dtExtra = clamp((evalTimeMs - latest.t) * 0.001, 0, 0.12);
      p.px = latest.px + latest.vx * dtExtra;
      p.py = latest.py + latest.vy * dtExtra;
      p.pz = latest.pz + latest.vz * dtExtra;
      p.vx = latest.vx;
      p.vy = latest.vy;
      p.vz = latest.vz;
      p.qx = latest.qx;
      p.qy = latest.qy;
      p.qz = latest.qz;
      p.qw = latest.qw;
      p.steer = latest.steer;
      p.spin = latest.spin;
      return;
    }

    if (evalTimeMs <= snaps[0].t) {
      const s = snaps[0];
      p.px = s.px;
      p.py = s.py;
      p.pz = s.pz;
      p.vx = s.vx;
      p.vy = s.vy;
      p.vz = s.vz;
      p.qx = s.qx;
      p.qy = s.qy;
      p.qz = s.qz;
      p.qw = s.qw;
      p.steer = s.steer;
      p.spin = s.spin;
      return;
    }

    let s0 = snaps[0];
    let s1 = snaps[1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= evalTimeMs && evalTimeMs <= snaps[i + 1].t) {
        s0 = snaps[i];
        s1 = snaps[i + 1];
        break;
      }
    }

    const spanMs = Math.max(1, s1.t - s0.t);
    const t = clamp((evalTimeMs - s0.t) / spanMs, 0, 1);
    const dtSec = spanMs * 0.001;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    p.px = h00 * s0.px + h10 * dtSec * s0.vx + h01 * s1.px + h11 * dtSec * s1.vx;
    p.py = h00 * s0.py + h10 * dtSec * s0.vy + h01 * s1.py + h11 * dtSec * s1.vy;
    p.pz = h00 * s0.pz + h10 * dtSec * s0.vz + h01 * s1.pz + h11 * dtSec * s1.vz;
    p.vx = s0.vx + (s1.vx - s0.vx) * t;
    p.vy = s0.vy + (s1.vy - s0.vy) * t;
    p.vz = s0.vz + (s1.vz - s0.vz) * t;

    this._quat.set(s0.qx, s0.qy, s0.qz, s0.qw);
    this._qTmp.set(s1.qx, s1.qy, s1.qz, s1.qw);
    this._quat.slerp(this._qTmp, t);
    p.qx = this._quat.x;
    p.qy = this._quat.y;
    p.qz = this._quat.z;
    p.qw = this._quat.w;
    p.steer = s0.steer + (s1.steer - s0.steer) * t;
    p.spin = s0.spin + (s1.spin - s0.spin) * t;
  }

  _updateRemotePhysicsStep(playerVehicle) {
    const nowMs = performance.now();
    const interpDelay = clamp(65 + this._remoteJitterMs * 1.6, 55, 160);
    const evalTime = nowMs - interpDelay;
    const pPos = playerVehicle && playerVehicle.rigidBody ? playerVehicle.rigidBody.translation() : null;
    const maxPhysDistSq = 220 * 220;

    for (const proxy of this.remoteAgents.values()) {
      this._evaluateRemoteProxyPose(proxy, evalTime);
      const body = proxy.rigidBody;
      if (!body) continue;

      const p = proxy.pose;
      if (pPos) {
        const dx = p.px - pPos.x;
        const dz = p.pz - pPos.z;
        if (dx * dx + dz * dz > maxPhysDistSq) {
          body.setTranslation({ x: p.px, y: p.py, z: p.pz }, true);
          body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
          body.setLinvel({ x: 0, y: 0, z: 0 }, true);
          body.setAngvel({ x: 0, y: 0, z: 0 }, true);
          continue;
        }
      }

      const cur = body.translation();
      const dx = p.px - cur.x;
      const dy = p.py - cur.y;
      const dz = p.pz - cur.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > 14.0 * 14.0) {
        body.setTranslation({ x: p.px, y: p.py, z: p.pz }, true);
        body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }

      const inContact = nowMs - proxy.lastContactMs < 200;
      const kHoriz = inContact ? 0.8 : 28.0;
      const velBlend = inContact ? 0.25 : 1.0;

      const curVel = body.linvel();
      const targetVx = (p.vx || 0) * velBlend + dx * kHoriz;
      const targetVz = (p.vz || 0) * velBlend + dz * kHoriz;
      const targetVy = clamp((p.vy || 0) + dy * 16.0, -5.0, 5.0);

      const alpha = inContact ? 0.14 : 0.90;
      body.setLinvel(
        {
          x: curVel.x + (targetVx - curVel.x) * alpha,
          y: targetVy,
          z: curVel.z + (targetVz - curVel.z) * alpha,
        },
        true
      );
      if (!inContact) {
        body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  _hasVehicleContact(localVehicle, otherChassis, otherCabin) {
    let touching = false;
    if (localVehicle.chassisCollider && otherChassis) {
      this.world.contactPair(localVehicle.chassisCollider, otherChassis, () => {
        touching = true;
      });
    }
    if (!touching && localVehicle.chassisCollider && otherCabin) {
      this.world.contactPair(localVehicle.chassisCollider, otherCabin, () => {
        touching = true;
      });
    }
    if (!touching && localVehicle.cabinCollider && otherChassis) {
      this.world.contactPair(localVehicle.cabinCollider, otherChassis, () => {
        touching = true;
      });
    }
    if (!touching && localVehicle.cabinCollider && otherCabin) {
      this.world.contactPair(localVehicle.cabinCollider, otherCabin, () => {
        touching = true;
      });
    }
    return touching;
  }

  _resolveMergedTrafficOverlap(localBody, otherBody) {
    const lp = localBody.translation();
    const op = otherBody.translation();
    let dx = lp.x - op.x;
    let dz = lp.z - op.z;
    const dist = Math.hypot(dx, dz);
    // Cars are ~1.9m wide and ~4.3m long; if centers are closer than 1.75m in XZ they are overlapping/merged
    if (dist < 1.75) {
      let nx = 1;
      let nz = 0;
      if (dist > 0.02) {
        nx = dx / dist;
        nz = dz / dist;
      } else {
        const lq = localBody.rotation();
        const rightX = 1 - 2 * (lq.y * lq.y + lq.z * lq.z);
        const rightZ = 2 * (lq.x * lq.z - lq.w * lq.y);
        const rLen = Math.hypot(rightX, rightZ) || 1;
        nx = rightX / rLen;
        nz = rightZ / rLen;
      }
      const push = Math.min(0.22, (1.82 - dist) * 0.35);
      localBody.setTranslation({ x: lp.x + nx * push, y: lp.y, z: lp.z + nz * push }, true);
      otherBody.setTranslation({ x: op.x - nx * push, y: op.y, z: op.z - nz * push }, true);

      const lv = localBody.linvel();
      const ov = otherBody.linvel();
      const relOut = (lv.x - ov.x) * nx + (lv.z - ov.z) * nz;
      if (relOut < 3.0) {
        const boost = (3.0 - relOut) * 0.5;
        localBody.setLinvel({ x: lv.x + nx * boost, y: Math.min(lv.y, 1.2), z: lv.z + nz * boost }, true);
        otherBody.setLinvel({ x: ov.x - nx * boost, y: Math.min(ov.y, 1.2), z: ov.z - nz * boost }, true);
      }
    }
  }

  postPhysicsStep(playerVehicle) {
    if (!this.world || !playerVehicle || !playerVehicle.rigidBody || !playerVehicle.chassisCollider) return;
    const nowMs = performance.now();
    const localBody = playerVehicle.rigidBody;
    const localVel = localBody.linvel();
    let anyContact = false;

    if (this.remoteSyncMode) {
      for (const proxy of this.remoteAgents.values()) {
        if (!proxy.rigidBody || !proxy.chassisCollider) continue;
        if (this._hasVehicleContact(playerVehicle, proxy.chassisCollider, proxy.cabinCollider)) {
          anyContact = true;
          proxy.lastContactMs = nowMs;
          this._resolveMergedTrafficOverlap(localBody, proxy.rigidBody);
        }
      }
    } else {
      for (const agent of this.agents) {
        const av = agent.vehicle;
        if (!av || !av.rigidBody || !av.chassisCollider) continue;
        if (this._hasVehicleContact(playerVehicle, av.chassisCollider, av.cabinCollider)) {
          anyContact = true;
          this._resolveMergedTrafficOverlap(localBody, av.rigidBody);
          const aVel = av.rigidBody.linvel();
          if (aVel.y > 1.6) {
            av.rigidBody.setLinvel({ x: aVel.x, y: 1.6, z: aVel.z }, true);
          }
        }
      }
    }

    if (anyContact) {
      if (localVel.y > 1.6) {
        localBody.setLinvel({ x: localVel.x, y: 1.6, z: localVel.z }, true);
      }
      const angVel = localBody.angvel();
      if (Math.abs(angVel.x) > 2.2 || Math.abs(angVel.z) > 2.2) {
        localBody.setAngvel(
          {
            x: clamp(angVel.x, -2.2, 2.2),
            y: angVel.y,
            z: clamp(angVel.z, -2.2, 2.2),
          },
          true
        );
      }
    }
  }

  _applyRemoteProxyVisuals(proxy) {
    if (!proxy.rootGroup) return;
    const p = proxy.pose;
    const pos = proxy.rigidBody ? proxy.rigidBody.translation() : p;
    const rot = proxy.rigidBody ? proxy.rigidBody.rotation() : p;
    const px = pos.x !== undefined ? pos.x : p.px;
    const py = pos.y !== undefined ? pos.y : p.py;
    const pz = pos.z !== undefined ? pos.z : p.pz;
    const qx = rot.x !== undefined ? rot.x : p.qx;
    const qy = rot.y !== undefined ? rot.y : p.qy;
    const qz = rot.z !== undefined ? rot.z : p.qz;
    const qw = rot.w !== undefined ? rot.w : p.qw;
    proxy.rootGroup.position.set(
      px - proxy.chassisLocalOffset.x,
      py - proxy.chassisLocalOffset.y,
      pz - proxy.chassisLocalOffset.z
    );
    proxy.rootGroup.quaternion.set(qx, qy, qz, qw);
    for (const w of proxy.wheels) {
      w.mesh.position.copy(w.restPos);
      w.mesh.rotation.y = w.isFront ? p.steer : 0;
      w.mesh.rotation.x = p.spin;
      w.mesh.rotation.z = 0;
    }
  }

  _updateRemoteFrame(dt, focusPos = null) {
    const brakeLerp = 1 - Math.exp(-20.0 * dt);
    for (const proxy of this.remoteAgents.values()) {
      this._applyRemoteProxyVisuals(proxy);
      proxy.brakeUniform.value += (proxy.targetBrakeLight - proxy.brakeUniform.value) * brakeLerp;
    }
    this._updateTrafficHeadlightSpots(focusPos, true);
  }
}

import * as THREE from 'three';

/**
 * Forza Horizon 5 / 6 Style Real-Time GPS Navigation & 3D Road Chevron System
 * ============================================================================
 * Features:
 *  - Graph-based A* pathfinding across all 8 routes (2,762 nodes)
 *  - Continuous real-time path recalculation & perpendicular road-segment projection
 *    (including straddling segment before startNode) so the route updates every frame
 *    with zero jumps regardless of which lane you drive in
 *  - Destination-anchored 3D chevron arrow stations along the road centerline so
 *    chevrons stay locked to the asphalt as you drive over them
 *  - Live synchronization with the World Map, Pause Menu Mini-Map, and HUD telemetry
 */

export class GPSNavigationSystem {
  constructor(scene, vehicle) {
    this.scene = scene;
    this.vehicle = vehicle;

    // Road network graph
    this.nodes = [];
    this.isGraphReady = false;

    // Active Navigation State
    this.activeWaypoint = null; // { x, y, z, name, type }
    this.roadNodesPath = [];    // Pure A* road centerline nodes (never overwritten with carPos)
    this.activePath = [];       // Trimmed centerline path starting at car's perpendicular road projection
    this.roadChevronPath = [];  // Strictly on-road centerline path for 3D asphalt chevrons
    this.remainingDistance = 0; // in meters
    this.onRouteUpdated = null; // Callback for UI / Map sync
    this.lastRouteBroadcastTime = 0;
    this.lastSolveTimeMs = 0;
    this.lastSolveCarPos = { x: Infinity, y: Infinity, z: Infinity };
    this.lastSyncCarPos = { x: Infinity, y: Infinity, z: Infinity };

    // 3D Chevron Road Mesh System
    this.maxChevrons = 55;
    this.chevronSpacing = 4.2; // meters between chevrons along true arc length
    this.init3DChevrons();
  }

  /**
   * Builds the connected graph from map_routes.json across all 8 drivable routes
   */
  initGraph(routesData) {
    if (!routesData || !routesData.routes) return;
    this.nodes = [];
    const routes = routesData.routes.filter(
      (r) => (!r.layer || r.layer === 'ground') && !r.id.startsWith('overpass_bridge') && r.id !== 'alpine_tunnel'
    );

    // 1. Create Nodes
    const branchEndpoints = [];
    for (const route of routes) {
      const startIndex = this.nodes.length;
      const pts = route.points;
      const isClosed = Boolean(route.closed || route.id === 'hwy');
      for (let i = 0; i < pts.length; i++) {
        const pt = pts[i];
        this.nodes.push({
          id: this.nodes.length,
          routeId: route.id,
          x: pt[0],
          y: pt.length > 2 ? pt[1] : 0.0,
          z: pt.length > 2 ? pt[2] : pt[1],
          neighbors: [],
        });
      }

      if (!isClosed && pts.length > 0) {
        branchEndpoints.push(this.nodes[startIndex]);
        if (pts.length > 1) {
          branchEndpoints.push(this.nodes[startIndex + pts.length - 1]);
        }
      }

      // Link sequential points within route
      for (let i = 0; i < pts.length - 1; i++) {
        const n1 = this.nodes[startIndex + i];
        const n2 = this.nodes[startIndex + i + 1];
        const d = Math.hypot(n2.x - n1.x, n2.z - n1.z);
        n1.neighbors.push({ id: n2.id, dist: d });
        n2.neighbors.push({ id: n1.id, dist: d });
      }

      // Close loop only for genuinely closed routes (e.g. Horizon Grand Expressway)
      if (isClosed) {
        const nFirst = this.nodes[startIndex];
        const nLast = this.nodes[startIndex + pts.length - 1];
        const d = Math.hypot(nLast.x - nFirst.x, nLast.z - nFirst.z);
        nFirst.neighbors.push({ id: nLast.id, dist: d });
        nLast.neighbors.push({ id: nFirst.id, dist: d });
      }
    }

    // 2. Link ONLY branch endpoints to their single closest parent-route junction node
    //    (prevents 8.5m diagonal grass-cutting chords across T-junction corners while keeping bridges isolated)
    for (const ep of branchEndpoints) {
      let bestTarget = null;
      let bestDist = 4.5;
      for (const cand of this.nodes) {
        if (cand.routeId === ep.routeId) continue;
        if (Math.abs(ep.y - cand.y) >= 3.8) continue;
        const d2 = Math.hypot(ep.x - cand.x, ep.z - cand.z);
        if (d2 < bestDist) {
          bestDist = d2;
          bestTarget = cand;
        }
      }
      if (bestTarget) {
        const already = ep.neighbors.some((nb) => nb.id === bestTarget.id);
        if (!already) {
          ep.neighbors.push({ id: bestTarget.id, dist: bestDist });
          bestTarget.neighbors.push({ id: ep.id, dist: bestDist });
        }
      }
    }

    this.isGraphReady = true;
  }

  /**
   * Finds the closest node on the road network to (wx, wz), with optional elevation awareness (wy)
   * so bridges and underpasses resolve to the correct vertical level.
   */
  findClosestNode(wx, wz, wy = null) {
    if (!this.nodes.length) return null;
    let bestNode = null;
    let bestScore = Infinity;
    for (const node of this.nodes) {
      const dXZ = Math.hypot(node.x - wx, node.z - wz);
      let elevPenalty = 0;
      if (wy !== null && Number.isFinite(wy)) {
        const dy = Math.abs(node.y - wy);
        if (dy > 3.5) elevPenalty = dy * 4.0;
      }
      const score = dXZ + elevPenalty;
      if (score < bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }
    return bestNode;
  }

  /**
   * Calculates the shortest driving path using A* search, and prepends the straddling
   * neighbor behind `startNode` so the car's perpendicular projection onto the road
   * is always continuous even when `startNode` is slightly ahead of the car.
   */
  calculateAStarPath(startPos, targetPos, prependBehind = true) {
    if (!this.isGraphReady || !this.nodes.length) return [];
    const startNode = this.findClosestNode(startPos.x, startPos.z, startPos.y);
    const goalNode = this.findClosestNode(targetPos.x, targetPos.z, targetPos.y);
    if (!startNode || !goalNode) return [];

    if (startNode.id === goalNode.id) {
      return [{ id: startNode.id, x: startNode.x, y: startNode.y, z: startNode.z }];
    }

    const distMap = new Float32Array(this.nodes.length).fill(Infinity);
    const prevMap = new Int32Array(this.nodes.length).fill(-1);
    const visited = new Uint8Array(this.nodes.length);

    distMap[startNode.id] = 0;

    // Binary min-heap of [fScore, nodeId] for O(E log V) A* pathfinding
    const heapF = [Math.hypot(startNode.x - goalNode.x, startNode.z - goalNode.z)];
    const heapN = [startNode.id];
    const pushHeap = (f, nodeId) => {
      let idx = heapN.length;
      heapF.push(f);
      heapN.push(nodeId);
      while (idx > 0) {
        const parent = (idx - 1) >> 1;
        if (heapF[parent] <= heapF[idx]) break;
        const tf = heapF[parent]; heapF[parent] = heapF[idx]; heapF[idx] = tf;
        const tn = heapN[parent]; heapN[parent] = heapN[idx]; heapN[idx] = tn;
        idx = parent;
      }
    };
    const popHeap = () => {
      const top = heapN[0];
      const lastF = heapF.pop();
      const lastN = heapN.pop();
      if (heapN.length > 0) {
        heapF[0] = lastF;
        heapN[0] = lastN;
        let idx = 0;
        const n = heapN.length;
        while (true) {
          let smallest = idx;
          const left = idx * 2 + 1;
          const right = left + 1;
          if (left < n && heapF[left] < heapF[smallest]) smallest = left;
          if (right < n && heapF[right] < heapF[smallest]) smallest = right;
          if (smallest === idx) break;
          const tf = heapF[smallest]; heapF[smallest] = heapF[idx]; heapF[idx] = tf;
          const tn = heapN[smallest]; heapN[smallest] = heapN[idx]; heapN[idx] = tn;
          idx = smallest;
        }
      }
      return top;
    };

    while (heapN.length > 0) {
      const curr = popHeap();
      if (visited[curr]) continue;
      if (curr === goalNode.id) break;
      visited[curr] = 1;

      const neighbors = this.nodes[curr].neighbors;
      for (let i = 0; i < neighbors.length; i++) {
        const edge = neighbors[i];
        if (visited[edge.id]) continue;
        const newDist = distMap[curr] + edge.dist;
        if (newDist < distMap[edge.id]) {
          distMap[edge.id] = newDist;
          prevMap[edge.id] = curr;
          const nbNode = this.nodes[edge.id];
          const h = Math.hypot(nbNode.x - goalNode.x, nbNode.z - goalNode.z);
          pushHeap(newDist + h, edge.id);
        }
      }
    }

    if (distMap[goalNode.id] === Infinity) return [];

    const path = [];
    let curr = goalNode.id;
    while (curr !== -1) {
      const n = this.nodes[curr];
      path.push({ id: n.id, x: n.x, y: n.y, z: n.z });
      curr = prevMap[curr];
    }
    path.reverse();

    // If startNode is slightly ahead of the car, prepend the neighbor behind startNode
    // so segment [prevNeighbor, startNode] straddles the car smoothly!
    if (prependBehind && path.length >= 2) {
      const n0 = this.nodes[path[0].id];
      const n1 = path[1];
      let bestPrev = null;
      let bestProjDist = Infinity;
      for (const edge of n0.neighbors) {
        if (edge.id === n1.id) continue;
        const cand = this.nodes[edge.id];
        const dx = n0.x - cand.x;
        const dz = n0.z - cand.z;
        const lenSq = dx * dx + dz * dz;
        if (lenSq < 1e-6) continue;
        const t = ((startPos.x - cand.x) * dx + (startPos.z - cand.z) * dz) / lenSq;
        if (t >= 0.0 && t <= 1.0) {
          const px = cand.x + t * dx;
          const pz = cand.z + t * dz;
          const d = Math.hypot(startPos.x - px, startPos.z - pz);
          if (d < bestProjDist) {
            bestProjDist = d;
            bestPrev = cand;
          }
        }
      }
      if (bestPrev) {
        path.unshift({ id: bestPrev.id, x: bestPrev.x, y: bestPrev.y, z: bestPrev.z });
      }
    }

    return path;
  }

  /**
   * Projects carPos onto `this.roadNodesPath` so the active path starts at the exact
   * perpendicular point on the road centerline beside the car (never dragging a stale vertex!).
   */
  buildTrimmedPathFromCar(carPos) {
    if (!this.roadNodesPath || this.roadNodesPath.length === 0 || !this.activeWaypoint) {
      return { trimmed: [], minDist: Infinity };
    }

    const pts = this.roadNodesPath;
    if (pts.length === 1) {
      const roadOnly = [{ x: pts[0].x, y: pts[0].y, z: pts[0].z }];
      return {
        trimmed: [
          { x: pts[0].x, y: pts[0].y, z: pts[0].z },
          { x: this.activeWaypoint.x, y: this.activeWaypoint.y, z: this.activeWaypoint.z },
        ],
        roadTrimmed: roadOnly,
        minDist: Math.hypot(carPos.x - pts[0].x, carPos.z - pts[0].z),
      };
    }

    let bestSegIdx = 0;
    let bestProj = { x: pts[0].x, y: pts[0].y, z: pts[0].z };
    let bestDist = Infinity;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      let t = lenSq > 1e-6 ? ((carPos.x - a.x) * dx + (carPos.z - a.z) * dz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));

      const px = a.x + t * dx;
      const py = a.y + t * (b.y - a.y);
      const pz = a.z + t * dz;

      const dXZ = Math.hypot(carPos.x - px, carPos.z - pz);
      const dy = Number.isFinite(carPos.y) ? Math.abs(carPos.y - py) : 0;
      const score = dXZ + (dy > 3.8 ? dy * 3.5 : 0);

      if (score < bestDist) {
        bestDist = score;
        bestSegIdx = i;
        bestProj = { x: px, y: py, z: pz };
      }
    }

    const trimmed = [bestProj];
    for (let i = bestSegIdx + 1; i < pts.length; i++) {
      const p = pts[i];
      const prev = trimmed[trimmed.length - 1];
      if (Math.hypot(p.x - prev.x, p.z - prev.z) > 0.15) {
        trimmed.push({ x: p.x, y: p.y, z: p.z });
      }
    }

    const roadTrimmed = trimmed.slice();

    const wp = this.activeWaypoint;
    const last = trimmed[trimmed.length - 1];
    if (!last || Math.hypot(wp.x - last.x, wp.z - last.z) > 0.15) {
      trimmed.push({ x: wp.x, y: wp.y, z: wp.z });
    }

    return { trimmed, roadTrimmed, minDist: bestDist };
  }

  /**
   * Sets or updates active GPS waypoint
   */
  setWaypoint(wx, wz, name = 'WAYPOINT', type = 'custom') {
    if (!this.vehicle || !this.vehicle.rootGroup) return false;
    const carPos = this.vehicle.rootGroup.position;
    const targetNode = this.findClosestNode(wx, wz);
    const yVal = targetNode ? targetNode.y : 0.0;

    // Snap waypoint onto road node if within 32m so road POIs & map clicks sit cleanly on asphalt
    const distToRoad = targetNode ? Math.hypot(targetNode.x - wx, targetNode.z - wz) : Infinity;
    const snapX = targetNode && distToRoad < 32.0 ? targetNode.x : wx;
    const snapZ = targetNode && distToRoad < 32.0 ? targetNode.z : wz;

    this.activeWaypoint = {
      x: snapX,
      y: yVal,
      z: snapZ,
      name,
      type,
    };

    this.roadNodesPath = this.calculateAStarPath(carPos, this.activeWaypoint);
    this.lastSolveCarPos = { x: carPos.x, y: carPos.y, z: carPos.z };

    const { trimmed, roadTrimmed } = this.buildTrimmedPathFromCar(carPos);
    this.activePath = trimmed;
    this.roadChevronPath = roadTrimmed;

    let totalD = 0;
    for (let i = 0; i < this.activePath.length - 1; i++) {
      totalD += Math.hypot(
        this.activePath[i + 1].x - this.activePath[i].x,
        this.activePath[i + 1].z - this.activePath[i].z
      );
    }
    this.remainingDistance = totalD;
    this.lastRouteBroadcastTime = performance.now();
    this.lastSyncCarPos = { x: carPos.x, y: carPos.y, z: carPos.z };

    // Immediately update 3D chevrons and broadcast to World Map & Pause Menu
    this.updateChevrons();
    if (this.onRouteUpdated) {
      this.onRouteUpdated(this.activeWaypoint, this.activePath, this.remainingDistance);
    }

    return true;
  }

  /**
   * Clears the current waypoint and disables chevrons
   */
  clearWaypoint() {
    this.activeWaypoint = null;
    this.roadNodesPath = [];
    this.activePath = [];
    this.roadChevronPath = [];
    this.remainingDistance = 0;
    this.chevronsMesh.count = 0;
    this.chevronsMesh.instanceMatrix.needsUpdate = true;

    if (this.onRouteUpdated) {
      this.onRouteUpdated(null, [], 0);
    }
  }

  /**
   * Creates the 3D Chevron Arrow InstancedMesh (Forza cyan road markers)
   */
  init3DChevrons() {
    const shape = new THREE.Shape();
    shape.moveTo(0.0, 0.75);     // Sharp leading arrow tip
    shape.lineTo(0.65, -0.35);   // Right outer wing corner
    shape.lineTo(0.42, -0.65);   // Right inner trailing tail
    shape.lineTo(0.0, -0.08);    // Inner chevron crook notch
    shape.lineTo(-0.42, -0.65);  // Left inner trailing tail
    shape.lineTo(-0.65, -0.35);  // Left outer wing corner
    shape.closePath();

    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });

    this.chevronsMesh = new THREE.InstancedMesh(geom, mat, this.maxChevrons);
    this.chevronsMesh.count = 0;
    this.chevronsMesh.renderOrder = 30;
    this.chevronsMesh.frustumCulled = false;
    this.scene.add(this.chevronsMesh);

    this.dummyObj = new THREE.Object3D();
    this.dummyObj.rotation.order = 'YXZ';
  }

  /**
   * Places 3D chevrons at fixed arc-length stations anchored to the destination
   * so chevrons stay locked to the road surface as you drive over them!
   */
  updateChevrons() {
    const chevronPath = this.roadChevronPath && this.roadChevronPath.length >= 2 ? this.roadChevronPath : this.activePath;
    if (!this.activeWaypoint || chevronPath.length < 2) {
      if (this.chevronsMesh.count > 0) {
        this.chevronsMesh.count = 0;
        this.chevronsMesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    let totalLen = 0.0;
    for (let i = 0; i < chevronPath.length - 1; i++) {
      totalLen += Math.hypot(
        chevronPath[i + 1].x - chevronPath[i].x,
        chevronPath[i + 1].z - chevronPath[i].z
      );
    }
    if (totalLen < 4.5) {
      this.chevronsMesh.count = 0;
      this.chevronsMesh.instanceMatrix.needsUpdate = true;
      return;
    }

    // Anchor first chevron station at a fixed multiple of `this.chevronSpacing` from the destination
    // so stations remain stationary in world space as `totalLen` decreases!
    const minLeadDist = 4.2;
    const maxDistToGoal = totalLen - minLeadDist;
    const firstK = Math.floor(maxDistToGoal / this.chevronSpacing);
    if (firstK < 1) {
      this.chevronsMesh.count = 0;
      this.chevronsMesh.instanceMatrix.needsUpdate = true;
      return;
    }

    let nextTargetDist = totalLen - firstK * this.chevronSpacing;
    let visibleCount = 0;
    let accumulatedDist = 0.0;

    for (let i = 0; i < chevronPath.length - 1 && visibleCount < this.maxChevrons; i++) {
      const p1 = chevronPath[i];
      const p2 = chevronPath[i + 1];
      const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      if (segLen < 0.05) continue;

      const dx = (p2.x - p1.x) / segLen;
      const dy = (p2.y - p1.y) / segLen;
      const dz = (p2.z - p1.z) / segLen;
      const headingAngle = Math.atan2(dx, dz);
      const pitch = -Math.atan2(dy, Math.hypot(dx, dz));

      while (
        accumulatedDist + segLen >= nextTargetDist &&
        nextTargetDist <= totalLen - 2.0 &&
        visibleCount < this.maxChevrons
      ) {
        const distIntoSeg = nextTargetDist - accumulatedDist;
        const alpha = Math.max(0.0, Math.min(1.0, distIntoSeg / segLen));

        const posX = p1.x + (p2.x - p1.x) * alpha;
        const posY = p1.y + (p2.y - p1.y) * alpha + 0.08;
        const posZ = p1.z + (p2.z - p1.z) * alpha;

        this.dummyObj.position.set(posX, posY, posZ);
        this.dummyObj.rotation.set(pitch, headingAngle, 0);
        this.dummyObj.scale.set(1.0, 1.0, 1.0);
        this.dummyObj.updateMatrix();

        this.chevronsMesh.setMatrixAt(visibleCount, this.dummyObj.matrix);
        visibleCount++;
        nextTargetDist += this.chevronSpacing;
      }

      accumulatedDist += segLen;
    }

    this.chevronsMesh.count = visibleCount;
    this.chevronsMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Called every animation frame to continuously update the route from the car's live position,
   * trim completed segments, re-route immediately if you turn onto a new road, and sync the World Map.
   */
  setRaceOverridePath(pathNodes) {
    if (Array.isArray(pathNodes) && pathNodes.length >= 2) {
      this.raceOverridePath = pathNodes;
      this.activePath = pathNodes;
      this.roadChevronPath = pathNodes;
      this.updateChevrons();
    } else {
      this.raceOverridePath = null;
      if (!this.activeWaypoint) {
        this.activePath = [];
        this.roadChevronPath = [];
        if (this.chevronsMesh) {
          this.chevronsMesh.count = 0;
          this.chevronsMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  update(carPos) {
    if (this.raceOverridePath && this.raceOverridePath.length >= 2) {
      return;
    }
    if (!this.activeWaypoint || !carPos) {
      if (this.chevronsMesh.count > 0) {
        this.chevronsMesh.count = 0;
        this.chevronsMesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }

    // 1. Check Waypoint Arrival
    const distToTarget = Math.hypot(this.activeWaypoint.x - carPos.x, this.activeWaypoint.z - carPos.z);
    if (distToTarget < 14.0) {
      this.clearWaypoint();
      return;
    }

    // 2. Only run initial A* when path is empty, or re-solve when drifting > 8.5m off-route
    //    (periodic 35m check also catches opposite-direction U-turns cleanly without per-meter overhead)
    const movedSinceSolve = Math.hypot(
      carPos.x - this.lastSolveCarPos.x,
      carPos.z - this.lastSolveCarPos.z
    );

    if (!this.roadNodesPath.length) {
      const freshNodes = this.calculateAStarPath(carPos, this.activeWaypoint);
      if (freshNodes.length > 0) {
        this.roadNodesPath = freshNodes;
        this.lastSolveCarPos = { x: carPos.x, y: carPos.y, z: carPos.z };
      }
    }

    // 3. Project carPos onto the road centerline path and trim everything behind the car
    let { trimmed, roadTrimmed, minDist } = this.buildTrimmedPathFromCar(carPos);

    // If the car turned off-route (> 8.5m) or moved > 35m without re-checking, re-solve fast O(E log V) A*
    // Throttle off-route re-solves to >= 450ms so driving off-road never triggers 60Hz A* searches!
    const nowMs = performance.now();
    if (
      (minDist > 8.5 && nowMs - this.lastSolveTimeMs >= 450) ||
      (movedSinceSolve >= 35.0 && movedSinceSolve > 0.5)
    ) {
      this.lastSolveTimeMs = nowMs;
      const freshNodes = this.calculateAStarPath(carPos, this.activeWaypoint);
      if (freshNodes.length > 0) {
        this.roadNodesPath = freshNodes;
        this.lastSolveCarPos = { x: carPos.x, y: carPos.y, z: carPos.z };
        const res = this.buildTrimmedPathFromCar(carPos);
        trimmed = res.trimmed;
        roadTrimmed = res.roadTrimmed;
      }
    }

    this.activePath = trimmed;
    this.roadChevronPath = roadTrimmed;

    // 4. Calculate remaining distance along active path
    let remDist = distToTarget;
    if (this.activePath.length > 1) {
      let dSum = 0;
      for (let i = 0; i < this.activePath.length - 1; i++) {
        dSum += Math.hypot(
          this.activePath[i + 1].x - this.activePath[i].x,
          this.activePath[i + 1].z - this.activePath[i].z
        );
      }
      remDist = dSum;
    }
    this.remainingDistance = remDist;

    // 5. Update 3D road chevrons every frame
    this.updateChevrons();

    // 6. Broadcast updated path to World Map & Pause Menu Mini-Map continuously while moving
    const now = performance.now();
    const movedSinceSync = Math.hypot(
      carPos.x - this.lastSyncCarPos.x,
      carPos.z - this.lastSyncCarPos.z
    );
    if (movedSinceSync >= 0.15 || now - this.lastRouteBroadcastTime > 60) {
      this.lastRouteBroadcastTime = now;
      this.lastSyncCarPos = { x: carPos.x, y: carPos.y, z: carPos.z };
      if (this.onRouteUpdated) {
        this.onRouteUpdated(this.activeWaypoint, this.activePath, this.remainingDistance);
      }
    }
  }
}

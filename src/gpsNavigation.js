import * as THREE from 'three';

/**
 * Forza Horizon 5 Style GPS Navigation & 3D Road Chevron System
 * ==============================================================
 * Features:
 *  - Graph-based A* pathfinding across the entire 4.0 km road network
 *  - Automatic route calculation from player vehicle to any landmark or custom waypoint
 *  - 3D road chevron arrows (`>>>`) projected onto the asphalt ahead of the car
 *  - Real-time route progression & automatic waypoint arrival detection
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
    this.activePath = [];       // Array of 3D node points [{ x, y, z }, ...]
    this.remainingDistance = 0; // in meters
    this.onRouteUpdated = null; // Callback for UI / Map sync
    this.lastRouteBroadcastTime = 0;

    // 3D Chevron Road Mesh System
    this.maxChevrons = 60;
    this.chevronSpacing = 3.2; // meters between chevrons
    this.init3DChevrons();
  }

  /**
   * Builds the connected graph from map_routes.json
   */
  initGraph(routesData) {
    if (!routesData || !routesData.routes) return;
    this.nodes = [];
    const routes = routesData.routes.filter((r) => r.id !== 'overpass_bridge');

    // 1. Create Nodes
    for (const route of routes) {
      const startIndex = this.nodes.length;
      const pts = route.points;
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

      // Link sequential points within route
      for (let i = 0; i < pts.length - 1; i++) {
        const n1 = this.nodes[startIndex + i];
        const n2 = this.nodes[startIndex + i + 1];
        const d = Math.hypot(n2.x - n1.x, n2.z - n1.z);
        n1.neighbors.push({ id: n2.id, dist: d });
        n2.neighbors.push({ id: n1.id, dist: d });
      }

      // Close loop for highway
      if (route.type === 'highway') {
        const nFirst = this.nodes[startIndex];
        const nLast = this.nodes[startIndex + pts.length - 1];
        const d = Math.hypot(nLast.x - nFirst.x, nLast.z - nFirst.z);
        nFirst.neighbors.push({ id: nLast.id, dist: d });
        nLast.neighbors.push({ id: nFirst.id, dist: d });
      }
    }

    // 2. Link Junction Points across different routes (fillet intersections)
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const n1 = this.nodes[i];
        const n2 = this.nodes[j];
        if (n1.routeId !== n2.routeId) {
          const d2 = Math.hypot(n1.x - n2.x, n1.z - n2.z);
          // Same elevation and within 5.0m radius
          if (d2 < 5.0 && Math.abs(n1.y - n2.y) < 3.8) {
            n1.neighbors.push({ id: n2.id, dist: d2 });
            n2.neighbors.push({ id: n1.id, dist: d2 });
          }
        }
      }
    }

    this.isGraphReady = true;
  }

  /**
   * Finds the closest node on the road network to (wx, wz)
   */
  findClosestNode(wx, wz) {
    if (!this.nodes.length) return null;
    let bestNode = null;
    let bestDist = Infinity;
    for (const node of this.nodes) {
      const d = Math.hypot(node.x - wx, node.z - wz);
      if (d < bestDist) {
        bestDist = d;
        bestNode = node;
      }
    }
    return bestNode;
  }

  /**
   * Calculates the shortest driving path using A* search
   */
  calculateAStarPath(startPos, targetPos) {
    if (!this.isGraphReady || !this.nodes.length) return [];
    const startNode = this.findClosestNode(startPos.x, startPos.z);
    const goalNode = this.findClosestNode(targetPos.x, targetPos.z);
    if (!startNode || !goalNode) return [];

    const distMap = new Float32Array(this.nodes.length).fill(Infinity);
    const prevMap = new Int32Array(this.nodes.length).fill(-1);
    const visited = new Uint8Array(this.nodes.length);

    distMap[startNode.id] = 0;
    // Priority queue simple array
    const openSet = [startNode.id];

    while (openSet.length > 0) {
      // Find node with minimum fScore
      let minIdx = 0;
      let minF = Infinity;
      for (let i = 0; i < openSet.length; i++) {
        const u = openSet[i];
        const h = Math.hypot(this.nodes[u].x - goalNode.x, this.nodes[u].z - goalNode.z);
        const f = distMap[u] + h;
        if (f < minF) {
          minF = f;
          minIdx = i;
        }
      }

      const curr = openSet.splice(minIdx, 1)[0];
      if (curr === goalNode.id) break;
      visited[curr] = 1;

      for (const edge of this.nodes[curr].neighbors) {
        if (visited[edge.id]) continue;
        const newDist = distMap[curr] + edge.dist;
        if (newDist < distMap[edge.id]) {
          distMap[edge.id] = newDist;
          prevMap[edge.id] = curr;
          if (!openSet.includes(edge.id)) {
            openSet.push(edge.id);
          }
        }
      }
    }

    if (distMap[goalNode.id] === Infinity) return [];

    // Reconstruct Path
    const path = [];
    let curr = goalNode.id;
    while (curr !== -1) {
      const n = this.nodes[curr];
      path.push({ x: n.x, y: n.y, z: n.z });
      curr = prevMap[curr];
    }
    path.reverse();

    return path;
  }

  /**
   * Sets or updates active GPS waypoint
   */
  setWaypoint(wx, wz, name = 'WAYPOINT', type = 'custom') {
    if (!this.vehicle || !this.vehicle.rootGroup) return false;
    const carPos = this.vehicle.rootGroup.position;
    const targetNode = this.findClosestNode(wx, wz);
    const yVal = targetNode ? targetNode.y : 0.0;

    this.activeWaypoint = {
      x: wx,
      y: yVal,
      z: wz,
      name,
      type,
    };

    const path = this.calculateAStarPath(carPos, { x: wx, z: wz });
    if (path.length > 0) {
      // Connect smoothly from the car's exact position to the destination
      path.unshift({ x: carPos.x, y: carPos.y, z: carPos.z });
      path.push({ x: wx, y: yVal, z: wz });
    }
    this.activePath = path;

    // Calculate total path distance
    let totalD = 0;
    for (let i = 0; i < path.length - 1; i++) {
      totalD += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].z - path[i].z);
    }
    this.remainingDistance = totalD;
    this.lastRouteBroadcastTime = performance.now();

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
    this.activePath = [];
    this.remainingDistance = 0;
    this.chevronsMesh.count = 0;

    if (this.onRouteUpdated) {
      this.onRouteUpdated(null, [], 0);
    }
  }

  /**
   * Creates the 3D Chevron Arrow InstancedMesh (Forza cyan road markers)
   */
  init3DChevrons() {
    // Sharp, aerodynamic Forza Chevron Arrow (pointing forward along +Z)
    const shape = new THREE.Shape();
    shape.moveTo(0.0, 0.75);     // Sharp leading arrow tip
    shape.lineTo(0.65, -0.35);   // Right outer wing corner
    shape.lineTo(0.42, -0.65);   // Right inner trailing tail
    shape.lineTo(0.0, -0.08);    // Inner chevron crook notch
    shape.lineTo(-0.42, -0.65);  // Left inner trailing tail
    shape.lineTo(-0.65, -0.35);  // Left outer wing corner
    shape.closePath();

    const geom = new THREE.ShapeGeometry(shape);
    // Rotate +90 deg around X so tip points forward along +Z when flat on XZ plane
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
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
   * Called every animation frame to update remaining distance, progress along route,
   * dynamically re-route, and project the 3D chevron arrows onto the road surface ahead.
   */
  update(carPos) {
    if (!this.activeWaypoint || !this.activePath.length || !carPos) {
      if (this.chevronsMesh.count > 0) this.chevronsMesh.count = 0;
      return;
    }

    // 1. Check Waypoint Arrival
    const distToTarget = Math.hypot(this.activeWaypoint.x - carPos.x, this.activeWaypoint.z - carPos.z);
    if (distToTarget < 14.0) {
      this.clearWaypoint();
      return;
    }

    // 2. Find Closest Point along Active Path to the Car
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < this.activePath.length; i++) {
      const p = this.activePath[i];
      const d = Math.hypot(p.x - carPos.x, p.z - carPos.z);
      if (d < closestDist) {
        closestDist = d;
        closestIdx = i;
      }
    }

    let routeNeedsSync = false;

    // Dynamic Re-Routing: If car deviated from calculated path (> 18m), recalculate route from current position!
    if (closestDist > 18.0) {
      const newPath = this.calculateAStarPath(carPos, this.activeWaypoint);
      if (newPath.length > 0) {
        newPath.unshift({ x: carPos.x, y: carPos.y, z: carPos.z });
        newPath.push({ x: this.activeWaypoint.x, y: this.activeWaypoint.y, z: this.activeWaypoint.z });
        this.activePath = newPath;
        closestIdx = 0;
        routeNeedsSync = true;
      }
    } else {
      // Dynamic Progression: Trim path points behind the car so the route shrinks as you drive
      if (closestIdx > 0) {
        this.activePath = this.activePath.slice(closestIdx);
        this.activePath[0] = { x: carPos.x, y: carPos.y, z: carPos.z };
        closestIdx = 0;
        routeNeedsSync = true;
      } else if (this.activePath.length > 0) {
        // Keep the leading vertex locked to the car's exact position
        this.activePath[0] = { x: carPos.x, y: carPos.y, z: carPos.z };
      }
    }

    // Calculate remaining distance along active path
    let remDist = distToTarget;
    if (this.activePath.length > 1) {
      let dSum = 0;
      for (let i = 0; i < this.activePath.length - 1; i++) {
        dSum += Math.hypot(this.activePath[i + 1].x - this.activePath[i].x, this.activePath[i + 1].z - this.activePath[i].z);
      }
      remDist = dSum;
    }
    this.remainingDistance = remDist;

    // Notify listeners (world map blue ribbon, top bar HUD, driving HUD)
    const now = performance.now();
    if (routeNeedsSync || (now - this.lastRouteBroadcastTime > 100)) {
      this.lastRouteBroadcastTime = now;
      if (this.onRouteUpdated) {
        this.onRouteUpdated(this.activeWaypoint, this.activePath, this.remainingDistance);
      }
    }

    // 3. Project 3D Chevron Arrows along the road ahead of the car
    let visibleCount = 0;
    const startOffsetDist = 5.0; // Start 5m ahead of car bumper
    let currentDist = 0;

    for (let i = closestIdx; i < this.activePath.length - 1 && visibleCount < this.maxChevrons; i++) {
      const p1 = this.activePath[i];
      const p2 = this.activePath[i + 1];
      const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      if (segLen < 0.1) continue;

      const dx = (p2.x - p1.x) / segLen;
      const dy = (p2.y - p1.y) / segLen;
      const dz = (p2.z - p1.z) / segLen;
      const headingAngle = Math.atan2(dx, dz);
      const pitch = -Math.atan2(dy, Math.hypot(dx, dz));

      // Place chevrons along segment
      for (let s = 0; s < segLen && visibleCount < this.maxChevrons; s += this.chevronSpacing) {
        currentDist += this.chevronSpacing;
        if (currentDist < startOffsetDist) continue;

        const alpha = s / segLen;
        const posX = p1.x + (p2.x - p1.x) * alpha;
        const posY = p1.y + (p2.y - p1.y) * alpha + 0.06; // 6cm above asphalt
        const posZ = p1.z + (p2.z - p1.z) * alpha;

        this.dummyObj.position.set(posX, posY, posZ);
        this.dummyObj.rotation.set(pitch, headingAngle, 0);
        this.dummyObj.scale.set(1.0, 1.0, 1.0);
        this.dummyObj.updateMatrix();

        this.chevronsMesh.setMatrixAt(visibleCount, this.dummyObj.matrix);
        visibleCount++;
      }
    }

    this.chevronsMesh.count = visibleCount;
    this.chevronsMesh.instanceMatrix.needsUpdate = true;
  }
}

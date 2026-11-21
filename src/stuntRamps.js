import * as THREE from 'three';

/**
 * Generates a crisp procedural asphalt/concrete + motorsport amber chevron texture
 * for stunt ramp decks so they are unmistakable at 100+ MPH.
 */
function createRampDeckTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // Dark brushed concrete / steel deck base
  ctx.fillStyle = '#262b34';
  ctx.fillRect(0, 0, 256, 512);

  // Subtle plank/panel seams
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.lineWidth = 3;
  for (let y = 0; y < 512; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  // Motorsport amber side stripes
  ctx.fillStyle = '#e5a93c';
  ctx.fillRect(8, 0, 10, 512);
  ctx.fillRect(238, 0, 10, 512);

  // Bold forward-pointing chevron arrows along the ramp deck
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let cy = 440; cy >= 70; cy -= 110) {
    ctx.beginPath();
    ctx.moveTo(54, cy);
    ctx.lineTo(128, cy - 44);
    ctx.lineTo(202, cy);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

/**
 * Builds a single smooth curved stunt ramp mesh (quadratic profile y = H * t^2 so dy/dz = 0 at entry)
 * and registers a solid Rapier fixed trimesh collider with collision group 0x0001.
 */
function buildSingleRamp(RAPIER, world, scene, deckMat, sideMat, flagMat, pos, yaw, opts = {}) {
  const width = opts.width || 7.6;
  const length = opts.length || 18.0;
  const height = opts.height || 4.0;
  const segs = 20;
  const halfW = width * 0.5;

  const positions = [];
  const uvs = [];
  const indices = [];

  // Top curved deck vertices (0 .. segs, 2 verts per row: left & right)
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = t * length;
    const y = height * t * t;
    positions.push(-halfW, y, z);
    uvs.push(0, t);
    positions.push(halfW, y, z);
    uvs.push(1, t);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  // Bottom / back / side skirts so the ramp looks solid from all angles
  const baseStart = positions.length / 3;
  // Base left & right floor row (embedded -1.6m so sloped roadside terrain never leaves gaps)
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const z = t * length;
    positions.push(-halfW, -1.6, z);
    uvs.push(0, t);
    positions.push(halfW, -1.6, z);
    uvs.push(1, t);
  }

  // Left & right side walls
  for (let i = 0; i < segs; i++) {
    const tL0 = i * 2;
    const tL1 = (i + 1) * 2;
    const bL0 = baseStart + i * 2;
    const bL1 = baseStart + (i + 1) * 2;
    indices.push(tL0, bL0, tL1, tL1, bL0, bL1);

    const tR0 = i * 2 + 1;
    const tR1 = (i + 1) * 2 + 1;
    const bR0 = baseStart + i * 2 + 1;
    const bR1 = baseStart + (i + 1) * 2 + 1;
    indices.push(tR0, tR1, bR0, tR1, bR1, bR0);
  }

  // Back vertical face at t = 1.0
  const topBackL = segs * 2;
  const topBackR = segs * 2 + 1;
  const botBackL = baseStart + segs * 2;
  const botBackR = baseStart + segs * 2 + 1;
  indices.push(topBackL, botBackL, topBackR, topBackR, botBackL, botBackR);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Separate material groups: top deck (first segs*6 indices) vs side/back structure
  const deckIndexCount = segs * 6;
  geo.clearGroups();
  geo.addGroup(0, deckIndexCount, 0);
  geo.addGroup(deckIndexCount, indices.length - deckIndexCount, 1);

  const rampMesh = new THREE.Mesh(geo, [deckMat, sideMat]);
  rampMesh.position.copy(pos);
  rampMesh.rotation.y = yaw;
  rampMesh.castShadow = true;
  rampMesh.receiveShadow = true;
  scene.add(rampMesh);

  // Two subtle motorsport amber flag markers at the launch lip so ramps are easy to spot at speed
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6);
  const bannerGeo = new THREE.PlaneGeometry(0.55, 1.35);
  for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(poleGeo, sideMat);
    pole.position.set(side * (halfW - 0.15), height + 1.1, length - 0.25);
    rampMesh.add(pole);

    const banner = new THREE.Mesh(bannerGeo, flagMat);
    banner.position.set(side * (halfW - 0.15), height + 1.45, length - 0.25);
    rampMesh.add(banner);
  }

  // Build world-space Rapier trimesh collider for the curved deck + sides
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const worldVerts = new Float32Array(positions.length);
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i], positions[i + 1], positions[i + 2]).applyQuaternion(q).add(pos);
    worldVerts[i] = v.x;
    worldVerts[i + 1] = v.y;
    worldVerts[i + 2] = v.z;
  }

  const rigidBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const trimeshDesc = RAPIER.ColliderDesc.trimesh(worldVerts, new Uint32Array(indices))
    .setFriction(0.65)
    .setRestitution(0.0)
    .setCollisionGroups((0x0001 << 16) | 0xFFFF);
  world.createCollider(trimeshDesc, rigidBody);

  return rampMesh;
}

/**
 * Places smooth curved stunt ramps across high-speed straightaways, coastal runs,
 * island causeways, and mountain/desert highways using live Rapier terrain raycasts.
 */
export function createStuntRamps(RAPIER, world, scene, routesData) {
  if (!RAPIER || !world || !scene || !routesData || !routesData.routes) return [];

  const routeMap = new Map();
  for (const r of routesData.routes) {
    routeMap.set(r.id, r);
  }

  const deckTex = createRampDeckTexture();
  const deckMat = new THREE.MeshStandardMaterial({
    map: deckTex,
    roughness: 0.72,
    metalness: 0.18,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x1b2029,
    roughness: 0.8,
    metalness: 0.25,
  });
  const flagMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xd97706,
    emissiveIntensity: 0.45,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });

  // Unique Forza-style mainland stunt ramp placements:
  // - Roundabout centers (blast straight into the roundabout to launch over it)
  // - End-of-straight T-junction launchers (sit just past the T-junction facing incoming traffic)
  // - Open roadside & biome straightaways (strictly on solid mainland terrain, never over water/islands)
  const placements = [
    // 1. Roundabout Center Jumps
    {
      name: 'Town Roundabout Jump',
      kind: 'point',
      x: -185,
      z: 45,
      yaw: Math.atan2(-1, 0.72), // Aligned with Town East Ave incoming vector
      width: 8.4,
      length: 18.0,
      height: 4.0,
    },
    {
      name: 'Desert Roundabout Jump',
      kind: 'point',
      x: -1055,
      z: 245,
      yaw: Math.atan2(-1, 0.15), // Aligned with Mesa Rotary Link
      width: 8.4,
      length: 18.0,
      height: 4.2,
    },
    {
      name: 'Harbor Roundabout Jump',
      kind: 'point',
      x: 230,
      z: 900,
      yaw: Math.atan2(-1, 0.0), // Aligned with Harbor Quay East
      width: 8.4,
      length: 18.0,
      height: 4.0,
    },

    // 2. End-of-Straight T-Junction Launchers (just past the cross-road facing incoming straight)
    {
      name: 'Meadow Cross T-Jump',
      kind: 'route_end',
      routeId: 'meadow_cross',
      end: 'end',
      overshoot: 14.0,
      width: 8.0,
      length: 18.0,
      height: 4.2,
    },
    {
      name: 'Harbor Causeway T-Jump',
      kind: 'route_end',
      routeId: 'island_causeway',
      end: 'start',
      overshoot: 16.0,
      width: 8.2,
      length: 18.5,
      height: 4.3,
    },
    {
      name: 'Canyon Gorge Jump',
      kind: 'route_side',
      routeId: 'canyon_cut',
      t: 0.50,
      lateralOffset: 11.5,
      width: 7.4,
      length: 17.5,
      height: 3.9,
    },

    // 3. Mainland High-Speed Roadside & Biome Jumps
    { name: 'East Expressway Ramp', kind: 'route_side', routeId: 'hwy', t: 0.52, lateralOffset: 15.0, width: 7.6, length: 19.0, height: 4.2 },
    { name: 'Glacier Horizon Ramp', kind: 'route_side', routeId: 'glacier_horizon_hwy', t: 0.38, lateralOffset: 15.0, width: 7.4, length: 18.0, height: 3.9 },
    { name: 'Autumn Timber Ramp', kind: 'route_side', routeId: 'autumn_timber_hwy', t: 0.49, lateralOffset: 15.0, width: 7.6, length: 18.5, height: 4.1 },
    { name: 'Outer Badlands Ramp', kind: 'route_side', routeId: 'outer_badlands_hwy', t: 0.50, lateralOffset: 15.0, width: 7.6, length: 18.5, height: 4.1 },
  ];

  const created = [];
  const rayMask = (0xFFFF << 16) | 0x0001;
  const sampleGroundY = (wx, wz, refY = 40.0) => {
    const startY = Math.max(refY + 25.0, 90.0);
    const hit = world.castRay(
      new RAPIER.Ray({ x: wx, y: startY, z: wz }, { x: 0, y: -1, z: 0 }),
      140.0,
      true,
      undefined,
      rayMask
    );
    if (!hit || !Number.isFinite(hit.timeOfImpact)) return null;
    return startY - hit.timeOfImpact;
  };

  for (const spec of placements) {
    let rx = 0;
    let rz = 0;
    let refY = 10.0;
    let yaw = 0;

    if (spec.kind === 'point') {
      yaw = spec.yaw;
      const fwdX = Math.sin(yaw);
      const fwdZ = Math.cos(yaw);
      // Center the ramp over (spec.x, spec.z)
      rx = spec.x - fwdX * (spec.length * 0.5);
      rz = spec.z - fwdZ * (spec.length * 0.5);
    } else if (spec.kind === 'route_end') {
      const route = routeMap.get(spec.routeId);
      if (!route || !route.points || route.points.length < 4) continue;
      const pts = route.points;
      const isStart = spec.end === 'start';
      const pEnd = isStart ? pts[0] : pts[pts.length - 1];
      const pPrev = isStart ? pts[3] : pts[pts.length - 4];
      const ex = pEnd[0];
      const ez = pEnd.length > 2 ? pEnd[2] : pEnd[1];
      refY = pEnd.length > 2 ? pEnd[1] : 10.0;
      const px = pPrev[0];
      const pz = pPrev.length > 2 ? pPrev[2] : pPrev[1];
      const dx = ex - px;
      const dz = ez - pz;
      const len = Math.hypot(dx, dz) || 1;
      const fwdX = dx / len;
      const fwdZ = dz / len;
      yaw = Math.atan2(fwdX, fwdZ);
      rx = ex + fwdX * spec.overshoot;
      rz = ez + fwdZ * spec.overshoot;
    } else {
      const route = routeMap.get(spec.routeId);
      if (!route || !route.points || route.points.length < 4) continue;
      const pts = route.points;
      const idx = Math.max(1, Math.min(pts.length - 3, Math.floor(pts.length * spec.t)));
      const p0 = pts[idx];
      const p1 = pts[idx + 1];
      const x0 = p0[0];
      refY = p0.length > 2 ? p0[1] : 10.0;
      const z0 = p0.length > 2 ? p0[2] : p0[1];
      const x1 = p1[0];
      const z1 = p1.length > 2 ? p1[2] : p1[1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const len = Math.hypot(dx, dz) || 1;
      const fwdX = dx / len;
      const fwdZ = dz / len;
      const rightX = -fwdZ;
      const rightZ = fwdX;
      rx = x0 + rightX * spec.lateralOffset;
      rz = z0 + rightZ * spec.lateralOffset;
      yaw = Math.atan2(fwdX, fwdZ);
    }

    // Validate solid mainland terrain under entry, center, and lip (never spawn floating or over water)
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const yEntry = sampleGroundY(rx, rz, refY);
    const yMid = sampleGroundY(rx + fwdX * (spec.length * 0.5), rz + fwdZ * (spec.length * 0.5), refY);
    const yLip = sampleGroundY(rx + fwdX * spec.length, rz + fwdZ * spec.length, refY);
    if (yEntry === null || yMid === null || yLip === null) continue;
    if (yEntry < 0.8 || yMid < 0.8 || yLip < 0.8) continue; // Never over water
    if (Math.abs(yLip - yEntry) > 2.4) continue; // Never overhanging a cliff/bridge drop

    const centerX = rx + fwdX * (spec.length * 0.5);
    const centerZ = rz + fwdZ * (spec.length * 0.5);

    // Enforce >= 220m minimum spacing between ramps so two ramps never crowd the same area
    const MIN_SPACING_SQ = 220.0 * 220.0;
    let tooClose = false;
    for (const other of created) {
      const dx = centerX - other.x;
      const dz = centerZ - other.z;
      if (dx * dx + dz * dz < MIN_SPACING_SQ) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const baseY = Math.min(yEntry, yMid);
    const ramp = buildSingleRamp(
      RAPIER,
      world,
      scene,
      deckMat,
      sideMat,
      flagMat,
      new THREE.Vector3(rx, baseY - 0.04, rz),
      yaw,
      spec
    );
    created.push({
      mesh: ramp,
      name: spec.name,
      x: centerX,
      y: yMid,
      z: centerZ,
    });
  }

  return created;
}

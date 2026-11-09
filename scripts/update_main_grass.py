import sys

new_grass_func = '''function createStaticGrassField(terrainMesh, roadCorridors, obstacles, scene, sun) {
  if (!terrainMesh) return null;

  const bladeCount = 14;
  const maxInstances = 70000;

  // 1. Stylized 14-blade organic curved grass cluster geometry (42 triangles per cluster)
  const bladeGeo = new THREE.BufferGeometry();
  const bladePositions = [];
  const bladeNormals = [];
  const bladeUVs = [];
  const bladeIndices = [];
  const bladeIsFlower = [];

  for (let b = 0; b < bladeCount; b++) {
    const isFlower = (b === 13);
    const angle = (b / bladeCount) * Math.PI * 2.0 + (b * 1.618);
    const distFromCenter = b === 0 ? 0.04 : 0.12 + (b / bladeCount) * 0.44;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const cx = cosA * distFromCenter;
    const cz = sinA * distFromCenter;

    const bladeAngle = angle + (b % 2 === 0 ? 0.22 : -0.22);
    const cosB = Math.cos(bladeAngle);
    const sinB = Math.sin(bladeAngle);
    const perpX = -sinB;
    const perpZ = cosB;

    const baseWidth = isFlower ? 0.07 : (0.13 + (b % 3) * 0.025);
    const height = isFlower ? 1.15 : (0.88 + (b % 4) * 0.12);
    const lean = 0.14 + (b % 3) * 0.055;

    const baseIdx = b * 5;

    // 0, 1: Root vertices (anchored to ground)
    bladePositions.push(
      cx - cosB * baseWidth * 0.5, 0.0, cz - sinB * baseWidth * 0.5,
      cx + cosB * baseWidth * 0.5, 0.0, cz + sinB * baseWidth * 0.5,
      // 2, 3: Mid-height vertices (curving gracefully outward)
      cx - cosB * baseWidth * 0.32 + perpX * lean * 0.5, height * 0.52, cz - sinB * baseWidth * 0.32 + perpZ * lean * 0.5,
      cx + cosB * baseWidth * 0.32 + perpX * lean * 0.5, height * 0.52, cz + sinB * baseWidth * 0.32 + perpZ * lean * 0.5,
      // 4: Blade tip vertex (sharp taper)
      cx + perpX * lean, height, cz + perpZ * lean
    );

    for (let k = 0; k < 5; k++) {
      bladeNormals.push(0.0, 1.0, 0.0);
      bladeIsFlower.push(isFlower ? 1.0 : 0.0);
    }

    bladeUVs.push(
      0.0, 0.0,
      1.0, 0.0,
      0.15, 0.52,
      0.85, 0.52,
      0.5, 1.0
    );

    bladeIndices.push(
      baseIdx, baseIdx + 1, baseIdx + 2,
      baseIdx + 1, baseIdx + 3, baseIdx + 2,
      baseIdx + 2, baseIdx + 3, baseIdx + 4
    );
  }

  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(bladePositions, 3));
  bladeGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bladeNormals, 3));
  bladeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bladeUVs, 2));
  bladeGeo.setAttribute('aIsFlower', new THREE.Float32BufferAttribute(bladeIsFlower, 1));
  bladeGeo.setIndex(bladeIndices);

  // 2. Spatial Hash Grids for rapid O(1) road and obstacle clearance checks
  const roadCellSize = 12.0;
  const roadGrid = new Map();
  for (const r of roadCorridors) {
    const rx = r[0];
    const rz = -r[1];
    const rw = r[3];
    const gx = Math.floor(rx / roadCellSize);
    const gz = Math.floor(rz / roadCellSize);
    const key = `${gx},${gz}`;
    if (!roadGrid.has(key)) roadGrid.set(key, []);
    roadGrid.get(key).push({ x: rx, z: rz, w: rw });
  }

  function getRoadClearance(px, pz) {
    const gx = Math.floor(px / roadCellSize);
    const gz = Math.floor(pz / roadCellSize);
    let minClearance = 999.0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const pts = roadGrid.get(`${gx + dx},${gz + dz}`);
        if (!pts) continue;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const dCenter = Math.hypot(px - p.x, pz - p.z);
          const dEdge = dCenter - p.w;
          if (dEdge < minClearance) minClearance = dEdge;
        }
      }
    }
    return minClearance;
  }

  const obsCellSize = 14.0;
  const obsGrid = new Map();
  for (const obs of obstacles) {
    const ox = obs.x;
    const oz = -obs.y;
    const r = obs.r;
    const type = obs.type;
    const gx = Math.floor(ox / obsCellSize);
    const gz = Math.floor(oz / obsCellSize);
    const key = `${gx},${gz}`;
    if (!obsGrid.has(key)) obsGrid.set(key, []);
    obsGrid.get(key).push({ x: ox, z: oz, r, type });
  }

  function isInsideObstacle(px, pz) {
    const gx = Math.floor(px / obsCellSize);
    const gz = Math.floor(pz / obsCellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = obsGrid.get(`${gx + dx},${gz + dz}`);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const obs = list[i];
          const d = Math.hypot(px - obs.x, pz - obs.z);
          const threshold = obs.type === 'rock' ? obs.r * 1.02 : obs.r * 0.75;
          if (d < threshold) return true;
        }
      }
    }
    return false;
  }

  // 3. Sample static world positions across Circuit_Terrain geometry
  const posAttr = terrainMesh.geometry.attributes.position;
  const indexAttr = terrainMesh.geometry.index;
  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;

  let seed = 42817;
  function rand() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280.0;
  }

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const norm = new THREE.Vector3();

  const acceptedPos = [];

  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3 + 0) : t * 3 + 0;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

    vA.fromBufferAttribute(posAttr, i0);
    vB.fromBufferAttribute(posAttr, i1);
    vC.fromBufferAttribute(posAttr, i2);

    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    norm.crossVectors(edge1, edge2);
    const triArea = norm.length() * 0.5;
    norm.normalize();

    // Only slopes <= 40 degrees (normal.y >= 0.74) and above water (avgY >= -2.2)
    const avgY = (vA.y + vB.y + vC.y) / 3.0;
    if (norm.y < 0.74 || avgY < -2.2) continue;

    const midX = (vA.x + vB.x + vC.x) / 3.0;
    const midZ = (vA.z + vB.z + vC.z) / 3.0;
    const distFromCenter = Math.hypot(midX, midZ);

    // Target density: higher near roads and driving areas, tapering naturally on outer mountain edges
    let density = distFromCenter < 220 ? 0.65 : (distFromCenter < 340 ? 0.35 : 0.15);
    let numCandidates = Math.round(triArea * density);
    if (numCandidates < 1 && rand() < (triArea * density)) numCandidates = 1;

    for (let c = 0; c < numCandidates; c++) {
      if (acceptedPos.length >= maxInstances) break;

      const r1 = Math.sqrt(rand());
      const r2 = rand();
      const u = 1.0 - r1;
      const v = r1 * (1.0 - r2);
      const w = r1 * r2;

      const px = u * vA.x + v * vB.x + w * vC.x;
      const py = u * vA.y + v * vB.y + w * vC.y;
      const pz = u * vA.z + v * vB.z + w * vC.z;

      // 1) Road clearance: must be >= 0.32m from curb edge (NO CUTOUT MOAT!)
      const roadClr = getRoadClearance(px, pz);
      if (roadClr < 0.32) continue;

      // 2) Obstacle clearance: must NOT be inside any rock or bush!
      if (isInsideObstacle(px, pz)) continue;

      acceptedPos.push({
        x: px,
        y: py,
        z: pz,
        rot: rand() * Math.PI * 2.0,
        scale: 0.88 + rand() * 0.32,
      });
    }

    if (acceptedPos.length >= maxInstances) break;
  }

  const finalCount = acceptedPos.length;
  console.log(`Placed ${finalCount} static world grass clusters (${finalCount * bladeCount} blades) with zero sliding, zero popping, and exact obstacle clearance.`);

  const grassPalette = [
    new THREE.Color(0x3a7e24), // Rich emerald
    new THREE.Color(0x488f28), // Vibrant spring meadow
    new THREE.Color(0x56a230), // Sunny lime green
    new THREE.Color(0x4d962a), // Lush clover green
    new THREE.Color(0x62ac36), // Sun-drenched chartreuse
    new THREE.Color(0x34721e), // Deep valley olive
  ];

  const colors = new Float32Array(finalCount * 3);
  const flowerTypes = new Float32Array(finalCount);

  // 4. GPU Wind Wave & Stylized Half-Lambert Lighting Shaders
  const vertexShader = `
    #include <common>
    #include <fog_pars_vertex>

    attribute vec3 aInstanceColor;
    attribute float aFlowerType;
    attribute float aIsFlower;

    varying vec3 vColor;
    varying float vTipFactor;
    varying float vIsFlower;
    varying float vFlowerType;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPos;

    uniform float uTime;

    void main() {
      vColor = aInstanceColor;
      vTipFactor = uv.y;
      vIsFlower = aIsFlower;
      vFlowerType = aFlowerType;

      // 1. Transform vertex by instanced matrix to world space
      vec4 worldPosition = instanceMatrix * vec4(position, 1.0);

      // 2. Multi-harmonic fluid wind sway across world space
      vec2 windDir = normalize(vec2(1.0, 0.65));
      float wPhase = uTime * 2.8 + dot(worldPosition.xz, windDir) * 0.11;
      float gustPhase = uTime * 4.2 - dot(worldPosition.xz, vec2(-0.7, 0.9)) * 0.16;
      float highFreq = sin(uTime * 6.5 + dot(worldPosition.xz, vec2(0.5, 0.5)) * 0.35) * 0.12;
      float sway = (sin(wPhase) * 0.70 + cos(gustPhase) * 0.25 + highFreq) * 0.32;

      // Parabolic bend: root (uv.y == 0.0) stays 100% attached to soil, tip bends with wind
      float bend = pow(uv.y, 1.55);
      vec3 windOffset = vec3(windDir.x * sway * bend, -sway * sway * bend * 0.10, windDir.y * sway * bend);

      worldPosition.xyz += windOffset;
      vWorldPos = worldPosition.xyz;
      vWorldNormal = (instanceMatrix * vec4(normal, 0.0)).xyz;

      vec4 mvPosition = viewMatrix * worldPosition;
      gl_Position = projectionMatrix * mvPosition;

      #include <fog_vertex>
    }
  `;

  const fragmentShader = `
    #include <common>
    #include <fog_pars_fragment>

    varying vec3 vColor;
    varying float vTipFactor;
    varying float vIsFlower;
    varying float vFlowerType;
    varying vec3 vWorldNormal;
    varying vec3 vWorldPos;

    uniform vec3 uSunPosition;
    uniform vec3 uSunColor;
    uniform vec3 uHemiSky;
    uniform vec3 uHemiGround;

    void main() {
      vec3 baseColor = vColor;

      if (vIsFlower > 0.5) {
        // Wildflower blossom coloration (matching reference images)
        if (vTipFactor > 0.82) {
          if (vFlowerType < 0.5) baseColor = vec3(0.96, 0.22, 0.28); // Poppy Red
          else if (vFlowerType < 1.5) baseColor = vec3(1.0, 0.84, 0.15); // Buttercup Yellow
          else if (vFlowerType < 2.5) baseColor = vec3(1.0, 1.0, 0.98); // Daisy White
          else if (vFlowerType < 3.5) baseColor = vec3(0.68, 0.45, 0.96); // Iris Lavender
          else baseColor = vec3(0.25, 0.72, 0.98); // Bluebell Sky
        }
      } else {
        // Rich vertical color gradient: deep forest soil green at root to bright sunlit lime at tip
        vec3 rootColor = baseColor * 0.65;
        vec3 tipColor = baseColor * 1.35;
        baseColor = mix(rootColor, tipColor, pow(vTipFactor, 0.85));
      }

      // Directional sunlight with Half-Lambert wrap (soft anime / Forza / Ghibli lighting)
      vec3 sunDir = normalize(uSunPosition);
      float wrapLight = max(0.0, dot(vec3(0.0, 1.0, 0.0), sunDir)) * 0.45 + 0.55;
      vec3 ambient = mix(uHemiGround, uHemiSky, vTipFactor * 0.6 + 0.4);

      // Translucency / sub-surface scattering glow when backlit by the sun
      float backLight = max(0.0, dot(-sunDir, normalize(cameraPosition - vWorldPos))) * 0.35 * vTipFactor;

      vec3 finalColor = baseColor * (uSunColor * wrapLight + ambient * 0.45) + (uSunColor * backLight);

      gl_FragColor = vec4(finalColor, 1.0);

      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;

  const grassMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0.0 },
      uSunPosition: { value: new THREE.Vector3().copy(sun) },
      uSunColor: { value: new THREE.Color(0xfff6e3) },
      uHemiSky: { value: new THREE.Color(0x8ec3f8) },
      uHemiGround: { value: new THREE.Color(0x485838) },
    },
    side: THREE.DoubleSide,
    fog: true,
  });

  const instancedMesh = new THREE.InstancedMesh(bladeGeo, grassMat, finalCount);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < finalCount; i++) {
    const p = acceptedPos[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.set(p.scale, p.scale, p.scale);
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);

    const gCol = grassPalette[Math.floor(rand() * grassPalette.length)];
    colors[i * 3 + 0] = gCol.r;
    colors[i * 3 + 1] = gCol.g;
    colors[i * 3 + 2] = gCol.b;

    if (rand() < 0.28) {
      flowerTypes[i] = Math.floor(rand() * 5.0);
    } else {
      flowerTypes[i] = -1.0;
    }
  }

  bladeGeo.setAttribute('aInstanceColor', new THREE.InstancedBufferAttribute(colors, 3));
  bladeGeo.setAttribute('aFlowerType', new THREE.InstancedBufferAttribute(flowerTypes, 1));
  instancedMesh.instanceMatrix.needsUpdate = true;
  instancedMesh.frustumCulled = false;
  instancedMesh.castShadow = false;
  instancedMesh.receiveShadow = false;

  scene.add(instancedMesh);
  return { instancedMesh, grassMat };
}
'''

new_build_ground = '''async function buildTestGround(scene, world, maxAnisotropy = 8, sun) {
  const groundSize = 1600;

  // Deep safety catch floor at Y = -45m (far below the -11m Suspension Bridge Canyon)
  const safetyBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -45.0, 0));
  const safetyCollider = RAPIER.ColliderDesc.cuboid(groundSize * 0.5, 0.5, groundSize * 0.5)
    .setFriction(0.95)
    .setRestitution(0.0);
  world.createCollider(safetyCollider, safetyBody);

  const [obstacles, roadCorridors] = await Promise.all([
    fetch('/assets/nature_obstacles.json?v=26').then((r) => r.json()).catch(() => []),
    fetch('/assets/road_corridors.json?v=26').then((r) => r.json()).catch(() => []),
  ]);

  return new Promise((resolve) => {
    const circuitLoader = new GLTFLoader();
    circuitLoader.load(
      '/assets/circuit_track.glb?v=26',
      (gltf) => {
        const trackRoot = gltf.scene;
        let roadMesh = null;
        let terrainMesh = null;

        trackRoot.traverse((child) => {
          if (child.isMesh) {
            const isRoad = child.name === 'Circuit_Road';
            const isTerrain = child.name === 'Circuit_Terrain';
            const isMarkings = child.name === 'Circuit_Markings';
            const isTrees = child.name === 'Circuit_Trees';
            const isRocks = child.name === 'Circuit_Rocks';
            const isVegetation = child.name === 'Circuit_Vegetation';
            const isProps = child.name.includes('Lantern') || child.name.includes('Props') || child.name.includes('Tower');

            if (isRoad) roadMesh = child;
            if (isTerrain) terrainMesh = child;

            child.receiveShadow = true;
            child.castShadow = isProps || isTrees || isRocks;

            if (child.material) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              for (const m of mats) {
                m.opacity = 1.0;
                m.transparent = false;
                m.depthWrite = true;
                if (isMarkings) {
                  m.roughness = 0.38;
                  m.metalness = 0.0;
                  if (m.color) m.color.setRGB(1.0, 1.0, 1.0);
                } else if (isRoad) {
                  m.roughness = 0.76;
                  m.metalness = 0.02;
                } else if (isTerrain) {
                  m.roughness = 0.88;
                  m.metalness = 0.0;
                } else if (isRocks) {
                  m.roughness = 0.92;
                  m.metalness = 0.0;
                } else {
                  m.roughness = 0.82;
                  m.metalness = 0.0;
                }

                if (m.map) {
                  m.map.anisotropy = Math.min(maxAnisotropy, 8);
                  m.map.generateMipmaps = true;
                  if (isTerrain) {
                    m.map.magFilter = THREE.LinearFilter;
                    m.map.minFilter = THREE.LinearMipmapLinearFilter;
                  } else {
                    m.map.magFilter = THREE.NearestFilter;
                    m.map.minFilter = THREE.LinearMipmapLinearFilter;
                  }
                  m.map.needsUpdate = true;
                }
                m.needsUpdate = true;
              }
            }

            // Attach exact Rapier 3D Trimesh colliders to structural roadbed, terrain, and boulders (Circuit_Rocks)
            if (isRoad || isTerrain || isRocks) {
              child.updateWorldMatrix(true, false);
              const geo = child.geometry.clone();
              geo.applyMatrix4(child.matrixWorld);
              const pAttr = geo.attributes.position;
              const vertices = new Float32Array(pAttr.count * 3);
              for (let i = 0; i < pAttr.count; i++) {
                vertices[i * 3 + 0] = pAttr.getX(i);
                vertices[i * 3 + 1] = pAttr.getY(i);
                vertices[i * 3 + 2] = pAttr.getZ(i);
              }
              let indices;
              if (geo.index) {
                indices = new Uint32Array(geo.index.array);
              } else {
                indices = new Uint32Array(pAttr.count);
                for (let i = 0; i < pAttr.count; i++) indices[i] = i;
              }
              const staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
              const trimeshDesc = RAPIER.ColliderDesc.trimesh(vertices, indices)
                .setFriction(isRoad ? 1.0 : (isRocks ? 0.85 : 0.9))
                .setRestitution(0.0);
              world.createCollider(trimeshDesc, staticBody);
            }
          }
        });
        scene.add(trackRoot);

        // Spawn permanent static world-space grass field across terrain triangles
        const grassField = createStaticGrassField(terrainMesh, roadCorridors, obstacles, scene, sun);

        resolve({ grassField });
      },
      undefined,
      (err) => {
        console.warn('Could not load circuit_track.glb:', err);
        resolve({ grassField: null });
      }
    );
  });
}
'''

with open('src/main.js', 'r') as f:
    text = f.read()

# Replace grass function
start_grass = text.find('function createFlowingGrassField(scene, sun) {')
end_grass = text.find('async function buildTestGround(scene, world, maxAnisotropy = 8, sun) {')
assert start_grass != -1 and end_grass != -1, "Grass function bounds not found"
text = text[:start_grass] + new_grass_func + '\n' + text[end_grass:]

# Replace buildTestGround function
start_bg = text.find('async function buildTestGround(scene, world, maxAnisotropy = 8, sun) {')
end_bg = text.find('const gltfCache = new Map();')
assert start_bg != -1 and end_bg != -1, "buildTestGround bounds not found"
text = text[:start_bg] + new_build_ground + '\n' + text[end_bg:]

# In render loop, remove uPlayerPos update from grass
old_loop = '''    // 3. Flow the wind wave through the grass instances and stream around active car / freecam
    if (grassField && grassField.grassMat) {
      const focusPos = freeCam.active ? freeCam.pos : chassisWorldPos;
      grassField.grassMat.uniforms.uPlayerPos.value.set(focusPos.x, focusPos.y, focusPos.z);
      grassField.grassMat.uniforms.uTime.value = now * 0.001;
    }'''

new_loop = '''    // 3. Flow the wind wave through the permanent static grass instances
    if (grassField && grassField.grassMat) {
      grassField.grassMat.uniforms.uTime.value = now * 0.001;
    }'''

assert old_loop in text, "old_loop not found"
text = text.replace(old_loop, new_loop)

with open('src/main.js', 'w') as f:
    f.write(text)

print('SUCCESSFULLY APPLIED STATIC GRASS TO src/main.js!')

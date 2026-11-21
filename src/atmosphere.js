import * as THREE from 'three';
import { PIXEL_THEME_ENABLED, PIXEL_LIGHTING_UNIFORMS } from './pixelTheme.js';
import { setArchTimeOfDayLighting } from './pixelAssets.js';

const TIME_OF_DAY_PRESETS = {
  noon: {
    elevation: 34,
    azimuth: 212,
    nightFactor: 0.0,
    sunsetFactor: 0.0,
    cloudShadow: 1.0,
    sunColor: null, // uses pure biome daylight
    sunIntScale: 1.0,
    hemiSky: null,
    hemiGround: null,
    hemiIntScale: 1.0,
    fogTint: null,
    zenithTint: null,
    midSkyTint: null,
  },
  sunset: {
    elevation: 11.0,
    azimuth: 248,
    nightFactor: 0.45,
    sunsetFactor: 1.0,
    cloudShadow: 0.50,
    sunColor: new THREE.Color(0xffaa66),
    sunIntScale: 0.96,
    hemiSky: new THREE.Color(0xe2b29a),
    hemiGround: new THREE.Color(0x664d42),
    hemiIntScale: 1.18,
    fogTint: new THREE.Color(0xe69c74),
    zenithTint: new THREE.Color(0x2d2c5e),
    midSkyTint: new THREE.Color(0xc96560),
  },
  night: {
    elevation: 44,
    azimuth: 142,
    nightFactor: 1.0,
    sunsetFactor: 0.0,
    cloudShadow: 0.14,
    sunColor: new THREE.Color(0x9ab8e6),
    sunIntScale: 0.44,
    hemiSky: new THREE.Color(0x465a7c),
    hemiGround: new THREE.Color(0x262e3e),
    hemiIntScale: 0.92,
    fogTint: new THREE.Color(0x162138),
    zenithTint: new THREE.Color(0x060a18),
    midSkyTint: new THREE.Color(0x101c38),
  },
};

const smoothstep = (e0, e1, x) => {
  const t = Math.max(0.0, Math.min(1.0, (x - e0) / (e1 - e0)));
  return t * t * (3.0 - 2.0 * t);
};

// Biome atmospheric presets (Forza Horizon / BoTW inspired lighting & weather feel)
const BIOME_PRESETS = {
  valley: {
    fogColor: new THREE.Color(0x9cc8e8),
    fogNear: 170,
    fogFar: 1120,
    sunColor: new THREE.Color(0xfff6e3),
    sunIntensity: 2.75,
    hemiSky: new THREE.Color(0xc8dcf0),
    hemiGround: new THREE.Color(0x464e3e),
    hemiIntensity: 1.05,
    zenithTint: new THREE.Color(0x105cd6),
    midSkyTint: new THREE.Color(0x2e94eb),
    particleA: new THREE.Color(0x9be876),
    particleB: new THREE.Color(0xfff1a8),
    particleSize: 2.9,
    particleVelY: -0.85,
    particleDrift: 2.4,
    particleOpacity: 0.62,
    dustColor: new THREE.Color(0xc8bfa8),
  },
  autumn: {
    fogColor: new THREE.Color(0xd4b68c),
    fogNear: 155,
    fogFar: 940,
    sunColor: new THREE.Color(0xffe1b0),
    sunIntensity: 2.95,
    hemiSky: new THREE.Color(0xd2dce6),
    hemiGround: new THREE.Color(0x5e4a30),
    hemiIntensity: 1.05,
    zenithTint: new THREE.Color(0x1c63c4),
    midSkyTint: new THREE.Color(0x529cd9),
    particleA: new THREE.Color(0xf59b23),
    particleB: new THREE.Color(0xe04819),
    particleSize: 3.6,
    particleVelY: -1.15,
    particleDrift: 3.1,
    particleOpacity: 0.78,
    dustColor: new THREE.Color(0xc79b5c),
  },
  desert: {
    fogColor: new THREE.Color(0xd9a882),
    fogNear: 140,
    fogFar: 860,
    sunColor: new THREE.Color(0xffe7c2),
    sunIntensity: 3.05,
    hemiSky: new THREE.Color(0xd8d6d0),
    hemiGround: new THREE.Color(0x6e4732),
    hemiIntensity: 1.06,
    zenithTint: new THREE.Color(0x246bc2),
    midSkyTint: new THREE.Color(0x66a3d4),
    particleA: new THREE.Color(0xf0b57d),
    particleB: new THREE.Color(0xd48555),
    particleSize: 2.6,
    particleVelY: -0.45,
    particleDrift: 4.2,
    particleOpacity: 0.52,
    dustColor: new THREE.Color(0xc97647),
  },
  volcano: {
    fogColor: new THREE.Color(0x6c5e5c),
    fogNear: 95,
    fogFar: 640,
    sunColor: new THREE.Color(0xffc99e),
    sunIntensity: 2.35,
    hemiSky: new THREE.Color(0x7c747a),
    hemiGround: new THREE.Color(0x3a2620),
    hemiIntensity: 1.25,
    zenithTint: new THREE.Color(0x293342),
    midSkyTint: new THREE.Color(0x524c50),
    particleA: new THREE.Color(0xff6b1a),
    particleB: new THREE.Color(0xffb838),
    particleSize: 3.2,
    particleVelY: -0.65,
    particleDrift: 2.8,
    particleOpacity: 0.76,
    dustColor: new THREE.Color(0x4d4745),
  },
  cold: {
    fogColor: new THREE.Color(0xc2dced),
    fogNear: 120,
    fogFar: 740,
    sunColor: new THREE.Color(0xf0f7ff),
    sunIntensity: 2.65,
    hemiSky: new THREE.Color(0xd0e2f2),
    hemiGround: new THREE.Color(0x5c6870),
    hemiIntensity: 1.12,
    zenithTint: new THREE.Color(0x3574b8),
    midSkyTint: new THREE.Color(0x7bb4de),
    particleA: new THREE.Color(0xffffff),
    particleB: new THREE.Color(0xd8f0ff),
    particleSize: 3.4,
    particleVelY: -2.15,
    particleDrift: 2.6,
    particleOpacity: 0.80,
    dustColor: new THREE.Color(0xe6f2f8),
  },
  coast: {
    fogColor: new THREE.Color(0x94d2f2),
    fogNear: 195,
    fogFar: 1240,
    sunColor: new THREE.Color(0xfff8eb),
    sunIntensity: 2.85,
    hemiSky: new THREE.Color(0xcce0f0),
    hemiGround: new THREE.Color(0x4c5e54),
    hemiIntensity: 1.08,
    zenithTint: new THREE.Color(0x0c62db),
    midSkyTint: new THREE.Color(0x2ea6f0),
    particleA: new THREE.Color(0xbaf593),
    particleB: new THREE.Color(0xfff6d6),
    particleSize: 2.8,
    particleVelY: -0.75,
    particleDrift: 2.9,
    particleOpacity: 0.56,
    dustColor: new THREE.Color(0xdcc9a3),
  },
};

/**
 * Evaluates smooth biome atmosphere weights matching the terrain generator.
 */
function evalBiomeWeights(wx, wz) {
  const wy = -wz;
  const wyBioW = wy + 34.0 * Math.sin(wx * 0.011 + 0.5);
  const wxBioE = wx + 36.0 * Math.cos(wy * 0.010 - 0.4);
  const wyBioN = wy + 32.0 * Math.sin(wx * 0.010 + 1.1);

  // Wider gradual biome falloffs matching terrain shader so sky/fog/lighting shift smoothly
  const dVolc = Math.hypot((wxBioE - 1140.0) / 1.18, (wyBioW - 75.0) / 1.12);
  const wVolcano = 1.0 - smoothstep(260.0, 620.0, dVolc);

  const canyonNorthFar = 330.0 + 330.0 * (1.0 - smoothstep(-1200.0, -760.0, wxBioE));
  const wDesert =
    (1.0 - smoothstep(-400.0, -35.0, wxBioE)) *
    smoothstep(-980.0, -640.0, wyBioW) *
    (1.0 - smoothstep(canyonNorthFar - 40.0, canyonNorthFar + 220.0, wyBioW)) *
    (1.0 - wVolcano);

  const inNorthGlacier =
    smoothstep(640.0, 1020.0, wyBioN) *
    (1.0 - smoothstep(100.0, 440.0, wxBioE)) *
    smoothstep(-1420.0, -980.0, wxBioE);
  const inTouge =
    smoothstep(70.0, 340.0, wyBioN) *
    (1.0 - smoothstep(760.0, 1100.0, wyBioN)) *
    smoothstep(-660.0, -360.0, wxBioE) *
    (1.0 - smoothstep(50.0, 320.0, wxBioE));
  const wCold = Math.max(inNorthGlacier, inTouge) * (1.0 - wDesert) * (1.0 - wVolcano);

  const wAutumn =
    smoothstep(45.0, 360.0, wxBioE) *
    smoothstep(20.0, 315.0, wyBioN) *
    (1.0 - wVolcano) *
    (1.0 - wCold * 0.85);

  const wCoast = (1.0 - smoothstep(-660.0, -410.0, wy)) * (1.0 - wDesert * 0.88) * (1.0 - wVolcano);

  const sumSpecial = wVolcano + wDesert + wCold + wAutumn + wCoast;
  const wValley = Math.max(0.0, 1.0 - sumSpecial);
  const total = sumSpecial + wValley || 1.0;

  return {
    valley: wValley / total,
    autumn: wAutumn / total,
    desert: wDesert / total,
    volcano: wVolcano / total,
    cold: wCold / total,
    coast: wCoast / total,
  };
}

export class AtmosphereSystem {
  constructor(scene, { skyMat, dirLight, hemiLight, sunVec = null }) {
    this.scene = scene;
    this.skyMat = skyMat;
    this.dirLight = dirLight;
    this.hemiLight = hemiLight;
    this.sunVec = sunVec;

    this.timeOfDay = 'dynamic';
    this._dynamicCycleT = 0.08; // [0, 1) continuous day-night cycle clock (starts at bright midday)
    this._dynamicCycleDurationSec = 180.0; // 3-minute full day-night cycle
    this._dynScratchColor = new THREE.Color();
    this.curElevation = 34;
    this.curAzimuth = 212;
    this.curNightFactor = 0.0;
    this.curSunsetFactor = 0.0;
    this.curCloudShadow = 1.0;

    // Smoothed atmospheric state
    this.curFogColor = BIOME_PRESETS.valley.fogColor.clone();
    this.curFogNear = BIOME_PRESETS.valley.fogNear;
    this.curFogFar = BIOME_PRESETS.valley.fogFar;
    this.curSunColor = BIOME_PRESETS.valley.sunColor.clone();
    this.curSunIntensity = BIOME_PRESETS.valley.sunIntensity;
    this.curHemiSky = BIOME_PRESETS.valley.hemiSky.clone();
    this.curHemiGround = BIOME_PRESETS.valley.hemiGround.clone();
    this.curHemiIntensity = BIOME_PRESETS.valley.hemiIntensity;
    this.curZenith = BIOME_PRESETS.valley.zenithTint.clone();
    this.curMidSky = BIOME_PRESETS.valley.midSkyTint.clone();
    this.curDustColor = BIOME_PRESETS.valley.dustColor.clone();

    this.targetFogColor = new THREE.Color();
    this.targetSunColor = new THREE.Color();
    this.targetHemiSky = new THREE.Color();
    this.targetHemiGround = new THREE.Color();
    this.targetZenith = new THREE.Color();
    this.targetMidSky = new THREE.Color();
    this.targetParticleA = new THREE.Color();
    this.targetParticleB = new THREE.Color();
    this.targetDustColor = new THREE.Color();

    this._initAmbientParticles(scene);
    this._initWindStreaks(scene);
    this._initWheelDustSystem(scene);
    this._dustSpawnAcc = 0;
    this._slipstreamAcc = 0;
    this._offroadAcc = 0;
    this._airborneTime = 0;
    this._windTime = 0;
    this._smoothSpeedFactor = 0;
  }

  setTimeOfDay(mode) {
    if (mode === 'dynamic') {
      if (this.timeOfDay !== 'dynamic') {
        // Seed cycle from current preset so switching to Dynamic has zero jarring jump
        if (this.timeOfDay === 'sunset') this._dynamicCycleT = 0.48;
        else if (this.timeOfDay === 'night') this._dynamicCycleT = 0.72;
        else this._dynamicCycleT = 0.14;
      }
      this.timeOfDay = 'dynamic';
    } else if (TIME_OF_DAY_PRESETS[mode]) {
      this.timeOfDay = mode;
    }
  }

  getTimeOfDay() {
    return this.timeOfDay;
  }

  _initAmbientParticles(scene) {
    const count = PIXEL_THEME_ENABLED ? 240 : 680;
    const boxW = 88.0;
    const boxH = 12.0;
    const boxD = 88.0;

    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 3);
    const mixVals = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      seeds[i * 3 + 0] = (Math.random() - 0.5) * boxW;
      seeds[i * 3 + 1] = Math.random() * boxH;
      seeds[i * 3 + 2] = (Math.random() - 0.5) * boxD;
      mixVals[i] = Math.random();
      scales[i] = 0.75 + Math.random() * 0.85;
    }

    // Position is driven in shader from aSeed + uCameraPos modulo box
    geo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aMix', new THREE.BufferAttribute(mixVals, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    this.ambientUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uBoxSize: { value: new THREE.Vector3(boxW, boxH, boxD) },
      uVelY: { value: -0.85 },
      uDrift: { value: 2.4 },
      uSize: { value: 2.9 },
      uColorA: { value: BIOME_PRESETS.valley.particleA.clone() },
      uColorB: { value: BIOME_PRESETS.valley.particleB.clone() },
      uOpacity: { value: 0.62 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.ambientUniforms,
      vertexShader: /* glsl */ `
        attribute float aMix;
        attribute float aScale;

        uniform float uTime;
        uniform vec3 uCamPos;
        uniform vec3 uBoxSize;
        uniform float uVelY;
        uniform float uDrift;
        uniform float uSize;
        uniform float uPixelRatio;

        varying float vMix;
        varying float vEdgeFade;
        varying float vSpin;

        void main() {
          vMix = aMix;
          float phase = aMix * 6.28318;
          vSpin = uTime * (1.8 + aScale * 1.4) + phase;
          // Wind-swept horizontal glide + gentle downward flutter (NEVER rising out of the ground!)
          vec3 driftOffset = vec3(
            sin(uTime * 0.85 + phase) * uDrift * 1.35 + uTime * uDrift * 1.45,
            uTime * uVelY + sin(uTime * 1.7 + phase) * 0.45,
            cos(uTime * 0.75 + phase * 1.3) * uDrift * 1.15 + uTime * uDrift * 0.75
          );
          vec3 rel = mod(position + driftOffset - uCamPos + uBoxSize * 0.5, uBoxSize) - uBoxSize * 0.5;
          // Keep canopy leaves/petals strictly airborne above road level (y offset +1.6m .. +13.6m)
          rel.y = mod(position.y + driftOffset.y - uCamPos.y, uBoxSize.y) + 1.4;
          vec3 worldPos = uCamPos + rel;

          // Fade out smoothly near box boundaries to prevent popping
          vec3 normDist = abs(vec3(rel.x, rel.y - (uBoxSize.y * 0.5 + 1.4), rel.z)) / (uBoxSize * 0.5);
          float edgeX = 1.0 - smoothstep(0.70, 1.0, normDist.x);
          float edgeY = 1.0 - smoothstep(0.72, 1.0, normDist.y);
          float edgeZ = 1.0 - smoothstep(0.70, 1.0, normDist.z);
          float nearCam = smoothstep(3.5, 9.5, length(rel));
          vEdgeFade = edgeX * edgeY * edgeZ * nearCam;

          vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
          gl_PointSize = clamp((uSize * aScale * 64.0) / max(1.5, -mvPos.z), 2.5, 7.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uOpacity;

        varying float vMix;
        varying float vEdgeFade;
        varying float vSpin;

        void main() {
          if (vEdgeFade < 0.20) discard;
          // Rotating 2-tone pixel-art tumbling leaf / blossom petal silhouette!
          vec2 p = (floor(gl_PointCoord * 5.0) + 0.5) / 5.0 - vec2(0.5);
          float cs = cos(vSpin), sn = sin(vSpin);
          vec2 rp = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
          // Elongated leaf diamond mask
          if (abs(rp.x) * 1.45 + abs(rp.y) * 2.2 > 0.58) discard;
          vec3 baseCol = mix(uColorA, uColorB, vMix);
          vec3 leafCol = (rp.y < 0.0) ? baseCol * 1.15 : baseCol * 0.82;
          gl_FragColor = vec4(leafCol, min(0.88, uOpacity * 1.15) * vEdgeFade);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      fog: false,
    });

    this.ambientPoints = new THREE.Points(geo, mat);
    this.ambientPoints.frustumCulled = false;
    this.ambientPoints.renderOrder = 25;
    scene.add(this.ambientPoints);
  }

  /**
   * 3D Animated Wind Gust Streaks (Breath of the Wild / Wind Waker / Forza style):
   * Sleek curved 3D wind-current ribbons that sweep through the air around the car
   * and intensify with vehicle speed!
   */
  _initWindStreaks(scene) {
    const ribbonCount = 22;
    const segsU = 22;
    const positions = [];
    const uvs = [];
    const seeds = [];
    const indices = [];

    let vOffset = 0;
    for (let r = 0; r < ribbonCount; r++) {
      const rx = (Math.random() - 0.5) * 86.0;
      const ry = 2.0 + Math.random() * 11.5;
      const rz = (Math.random() - 0.5) * 86.0;
      const phase = Math.random();
      const len = 11.0 + Math.random() * 9.0;
      const halfW = 0.09 + Math.random() * 0.06;

      for (let i = 0; i <= segsU; i++) {
        const u = i / segsU;
        for (const v of [0, 1]) {
          positions.push(rx + (u - 0.5) * len, ry + (v - 0.5) * halfW * 2.0, rz);
          uvs.push(u, v);
          seeds.push(rx, ry, rz, phase);
        }
      }
      for (let i = 0; i < segsU; i++) {
        const a = vOffset + i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
      vOffset += (segsU + 1) * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setIndex(indices);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('aRibbonSeed', new THREE.Float32BufferAttribute(seeds, 4));

    this.windUniforms = {
      uWindTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uSpeedFactor: { value: 0 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.windUniforms,
      vertexShader: /* glsl */ `
        attribute vec4 aRibbonSeed;
        uniform float uWindTime;
        uniform vec3 uCamPos;
        uniform float uSpeedFactor;
        varying vec2 vUv;
        varying float vVis;
        varying float vPhase;

        void main() {
          vUv = uv;
          float phase = aRibbonSeed.w;
          vPhase = phase;
          vec3 box = vec3(88.0, 14.0, 88.0);
          // Smoothly integrated uWindTime (NEVER multiply raw uTime by uSpeedFactor!)
          vec3 windFlow = vec3(uWindTime * 5.2, sin(uWindTime * 0.9 + phase * 6.28) * 0.75, uWindTime * 2.2);

          vec3 anchor = mod(aRibbonSeed.xyz + windFlow - uCamPos + box * 0.5, box) - box * 0.5;
          anchor.y = mod(aRibbonSeed.y + windFlow.y, 11.5) + 1.8;

          vec3 localOffset = position - aRibbonSeed.xyz;
          // Graceful 3D S-curve curl along the wind gust ribbon
          float wave = sin(uv.x * 5.2 - uWindTime * 2.6 + phase * 6.28318);
          float loopCurl = cos(uv.x * 3.14159 - uWindTime * 1.9 + phase * 6.28318);
          localOffset.y += wave * 0.50;
          localOffset.z += loopCurl * 1.05;

          vec3 worldPos = uCamPos + anchor + localOffset;
          vec3 normDist = abs(vec3(anchor.x, anchor.y - 7.5, anchor.z)) / (box * 0.5);
          float boxFade = (1.0 - smoothstep(0.68, 0.98, normDist.x))
                        * (1.0 - smoothstep(0.68, 0.98, normDist.z))
                        * smoothstep(5.0, 12.0, length(anchor));
          vVis = boxFade;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uWindTime;
        uniform float uSpeedFactor;
        varying vec2 vUv;
        varying float vVis;
        varying float vPhase;

        void main() {
          if (vVis < 0.05) discard;
          // Traveling gust pulse using smoothly integrated uWindTime (ZERO jumping when tapping W/S!)
          float cycle = fract(uWindTime * 0.34 + vPhase);
          // Only show ~42% of ribbons at any given moment so gusts feel natural & airy
          if (cycle > 0.48) discard;
          float head = cycle / 0.48; // 0..1 traveling from u=0 to u=1
          float distAlong = vUv.x - head;
          // Tapered comet-like wind streak tail
          if (distAlong > 0.04 || distAlong < -0.44) discard;
          float lengthMask = smoothstep(-0.44, -0.06, distAlong) * (1.0 - smoothstep(-0.02, 0.04, distAlong));
          float pxSeg = step(0.18, fract(vUv.x * 18.0));
          float alpha = lengthMask * (0.24 + uSpeedFactor * 0.16) * vVis * mix(0.75, 1.0, pxSeg);
          if (alpha < 0.06) discard;
          gl_FragColor = vec4(0.95, 0.98, 1.0, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.windMesh = new THREE.Mesh(geo, mat);
    this.windMesh.frustumCulled = false;
    this.windMesh.renderOrder = 24;
    scene.add(this.windMesh);
  }

  _initWheelDustSystem(scene) {
    const maxPuffs = 340;
    this.dustMax = maxPuffs;
    this.dustCursor = 0;

    this.dustPos = new Float32Array(maxPuffs * 3);
    this.dustVel = new Float32Array(maxPuffs * 3);
    this.dustLife = new Float32Array(maxPuffs); // 0..1 (<=0 means inactive)
    this.dustCol = new Float32Array(maxPuffs * 3);
    this.dustSize = new Float32Array(maxPuffs);
    // Particle type: 0 = puffy tire smoke/dust, 1 = crisp off-road leaf/grass/wingtip vapor, 2 = glowing exhaust backfire & landing spark!
    this.dustType = new Float32Array(maxPuffs);

    for (let i = 0; i < maxPuffs; i++) {
      this.dustLife[i] = 0.0;
    }

    const geo = new THREE.BufferGeometry();
    this.dustPosAttr = new THREE.BufferAttribute(this.dustPos, 3);
    this.dustLifeAttr = new THREE.BufferAttribute(this.dustLife, 1);
    this.dustColAttr = new THREE.BufferAttribute(this.dustCol, 3);
    this.dustSizeAttr = new THREE.BufferAttribute(this.dustSize, 1);
    this.dustTypeAttr = new THREE.BufferAttribute(this.dustType, 1);

    geo.setAttribute('position', this.dustPosAttr);
    geo.setAttribute('aLife', this.dustLifeAttr);
    geo.setAttribute('aColor', this.dustColAttr);
    geo.setAttribute('aSize', this.dustSizeAttr);
    geo.setAttribute('aType', this.dustTypeAttr);

    this.dustUniforms = {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aType;

        uniform float uPixelRatio;

        varying float vLife;
        varying vec3 vColor;
        varying float vType;

        void main() {
          vLife = aLife;
          vColor = aColor;
          vType = aType;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          float expand = (aType > 0.5) ? (0.75 + aLife * 0.45) : (1.0 + (1.0 - aLife) * 2.4);
          gl_PointSize = aLife > 0.001
            ? clamp((aSize * expand * 115.0) / max(1.5, -mvPos.z), 0.0, 28.0)
            : 0.0;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying vec3 vColor;
        varying float vType;

        void main() {
          if (vLife <= 0.001) discard;
          // Type 2: Glowing Exhaust Backfire Pop & Curb/Landing Spark!
          if (vType > 1.5) {
            vec2 q = (floor(gl_PointCoord * 5.0) + 0.5) / 5.0 - vec2(0.5);
            float manhattan = abs(q.x) + abs(q.y);
            if (manhattan > 0.52) discard;
            vec3 sparkCol = mix(vColor, vec3(1.35, 1.25, 0.85), step(manhattan, 0.22));
            gl_FragColor = vec4(sparkCol, clamp(vLife * 1.15, 0.0, 0.96));
            return;
          }
          // Type 1: Crisp Off-Road Leaf / Grass Clipping / Wingtip Slipstream Vapor!
          if (vType > 0.5) {
            vec2 q = (floor(gl_PointCoord * 6.0) + 0.5) / 6.0 - vec2(0.5);
            float spin = vLife * 7.5;
            float cs = cos(spin), sn = sin(spin);
            vec2 rq = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
            if (abs(rq.x) * 1.3 + abs(rq.y) * 2.1 > 0.55) discard;
            vec3 leafCol = (rq.y < 0.0) ? vColor * 1.18 : vColor * 0.80;
            gl_FragColor = vec4(leafCol, clamp(vLife * 0.92, 0.0, 0.88));
            return;
          }
          // Type 0: Crisp 8x8 quantized pixel-art cartoon tire dust puff!
          vec2 q = (floor(gl_PointCoord * 8.0) + 0.5) / 8.0 - vec2(0.5);
          float d = length(q) * 2.0;
          if (d > 0.92) discard;
          vec3 puffCol = mix(vColor * 0.78, vColor * 1.18, step(q.y, 0.05));
          float alpha = step(0.12, vLife) * clamp(vLife * 0.55, 0.0, 0.52);
          gl_FragColor = vec4(puffCol, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      fog: false,
    });

    this.dustPoints = new THREE.Points(geo, mat);
    this.dustPoints.frustumCulled = false;
    this.dustPoints.renderOrder = 18;
    scene.add(this.dustPoints);
  }

  _spawnDustPuff(x, y, z, vx, vy, vz, size, tintColor, pType = 0.0) {
    const idx = this.dustCursor;
    this.dustCursor = (this.dustCursor + 1) % this.dustMax;
    this.dustPos[idx * 3 + 0] = x;
    this.dustPos[idx * 3 + 1] = y;
    this.dustPos[idx * 3 + 2] = z;
    this.dustVel[idx * 3 + 0] = vx;
    this.dustVel[idx * 3 + 1] = vy;
    this.dustVel[idx * 3 + 2] = vz;
    this.dustCol[idx * 3 + 0] = tintColor.r;
    this.dustCol[idx * 3 + 1] = tintColor.g;
    this.dustCol[idx * 3 + 2] = tintColor.b;
    this.dustSize[idx] = size;
    this.dustType[idx] = pType;
    this.dustLife[idx] = 1.0;
  }

  /**
   * Snappy twin-pipe exhaust backfire flame & spark pop on high-RPM upshifts!
   */
  triggerGearShiftPop(carPos, carForward, carRight) {
    if (!carPos || !carForward || !carRight) return;
    const flameOrange = new THREE.Color(0xff6b1a);
    const flameGold = new THREE.Color(0xffcf48);
    for (const side of [-0.42, 0.42]) {
      const ex = carPos.x - carForward.x * 2.15 + carRight.x * side;
      const ey = carPos.y + 0.28;
      const ez = carPos.z - carForward.z * 2.15 + carRight.z * side;
      for (let k = 0; k < 5; k++) {
        const vx = -carForward.x * (3.5 + Math.random() * 4.5) + (Math.random() - 0.5) * 1.4;
        const vy = 0.35 + Math.random() * 1.2;
        const vz = -carForward.z * (3.5 + Math.random() * 4.5) + (Math.random() - 0.5) * 1.4;
        const col = (k % 2 === 0) ? flameGold : flameOrange;
        this._spawnDustPuff(ex, ey, ez, vx, vy, vz, 0.24 + Math.random() * 0.18, col, 2.0);
      }
    }
  }

  update(dt, elapsedSec, cameraPos, carPos, carForward, carRight, speedKmh, freeCamActive, wheels) {
    const samplePos = freeCamActive ? cameraPos : carPos;
    const w = evalBiomeWeights(samplePos.x, samplePos.z);

    // 1. Blend target biome atmosphere
    this.targetFogColor.setRGB(0, 0, 0);
    this.targetSunColor.setRGB(0, 0, 0);
    this.targetHemiSky.setRGB(0, 0, 0);
    this.targetHemiGround.setRGB(0, 0, 0);
    this.targetZenith.setRGB(0, 0, 0);
    this.targetMidSky.setRGB(0, 0, 0);
    this.targetParticleA.setRGB(0, 0, 0);
    this.targetParticleB.setRGB(0, 0, 0);
    this.targetDustColor.setRGB(0, 0, 0);

    let tFogNear = 0;
    let tFogFar = 0;
    let tSunInt = 0;
    let tHemiInt = 0;
    let tPartSize = 0;
    let tPartVelY = 0;
    let tPartDrift = 0;
    let tPartOp = 0;

    const addWeightedColor = (dst, src, weight) => {
      dst.r += src.r * weight;
      dst.g += src.g * weight;
      dst.b += src.b * weight;
    };

    for (const [key, weight] of Object.entries(w)) {
      if (weight <= 0.0001) continue;
      const p = BIOME_PRESETS[key];
      addWeightedColor(this.targetFogColor, p.fogColor, weight);
      addWeightedColor(this.targetSunColor, p.sunColor, weight);
      addWeightedColor(this.targetHemiSky, p.hemiSky, weight);
      addWeightedColor(this.targetHemiGround, p.hemiGround, weight);
      addWeightedColor(this.targetZenith, p.zenithTint, weight);
      addWeightedColor(this.targetMidSky, p.midSkyTint, weight);
      addWeightedColor(this.targetParticleA, p.particleA, weight);
      addWeightedColor(this.targetParticleB, p.particleB, weight);
      addWeightedColor(this.targetDustColor, p.dustColor, weight);

      tFogNear += p.fogNear * weight;
      tFogFar += p.fogFar * weight;
      tSunInt += p.sunIntensity * weight;
      tHemiInt += p.hemiIntensity * weight;
      tPartSize += p.particleSize * weight;
      tPartVelY += p.particleVelY * weight;
      tPartDrift += p.particleDrift * weight;
      tPartOp += p.particleOpacity * weight;
    }

    // Apply Time-of-Day override blending (Noon / Sunset / Night / Dynamic cycle)
    const todAlpha = 1.0 - Math.exp(-3.2 * dt);
    if (this.timeOfDay === 'dynamic') {
      this._dynamicCycleT = (this._dynamicCycleT + dt / this._dynamicCycleDurationSec) % 1.0;
      const t = this._dynamicCycleT;
      const P_NOON = TIME_OF_DAY_PRESETS.noon;
      const P_SUNSET = TIME_OF_DAY_PRESETS.sunset;
      const P_NIGHT = TIME_OF_DAY_PRESETS.night;

      // Smoothly compute weights for Noon, Sunset/Sunrise, and Night across [0, 1)
      let wSunset = 0.0;
      let wNight = 0.0;
      let targetElev = 34.0;
      let targetAzim = 212.0;

      if (t < 0.35) {
        // Daytime: gentle sun drift across midday sky
        const u = t / 0.35;
        targetElev = 26.0 + Math.sin(u * Math.PI) * 14.0;
        targetAzim = 175.0 + u * 52.0;
      } else if (t < 0.52) {
        // Noon -> Sunset
        const u = smoothstep(0.35, 0.52, t);
        wSunset = u;
        targetElev = THREE.MathUtils.lerp(26.0, P_SUNSET.elevation, u);
        targetAzim = THREE.MathUtils.lerp(227.0, P_SUNSET.azimuth, u);
      } else if (t < 0.65) {
        // Sunset -> Night
        const u = smoothstep(0.52, 0.65, t);
        wSunset = 1.0 - u;
        wNight = u;
        targetElev = THREE.MathUtils.lerp(P_SUNSET.elevation, P_NIGHT.elevation, u);
        targetAzim = THREE.MathUtils.lerp(P_SUNSET.azimuth, P_NIGHT.azimuth, u);
      } else if (t < 0.84) {
        // Night: slow moon drift
        const u = (t - 0.65) / 0.19;
        wNight = 1.0;
        targetElev = 38.0 + Math.sin(u * Math.PI) * 10.0;
        targetAzim = 142.0 - u * 26.0;
      } else if (t < 0.93) {
        // Night -> Sunrise
        const u = smoothstep(0.84, 0.93, t);
        wNight = 1.0 - u;
        wSunset = u;
        targetElev = THREE.MathUtils.lerp(38.0, P_SUNSET.elevation, u);
        targetAzim = THREE.MathUtils.lerp(116.0, 110.0, u);
      } else {
        // Sunrise -> Noon
        const u = smoothstep(0.93, 1.0, t);
        wSunset = 1.0 - u;
        targetElev = THREE.MathUtils.lerp(P_SUNSET.elevation, 26.0, u);
        targetAzim = THREE.MathUtils.lerp(110.0, 175.0, u);
      }

      const wNoon = Math.max(0.0, 1.0 - wSunset - wNight);
      const targetNightF = wSunset * P_SUNSET.nightFactor + wNight * P_NIGHT.nightFactor;
      const targetSunsetF = wSunset * P_SUNSET.sunsetFactor;
      const targetCloudSh = wNoon * P_NOON.cloudShadow + wSunset * P_SUNSET.cloudShadow + wNight * P_NIGHT.cloudShadow;

      this.curElevation += (targetElev - this.curElevation) * todAlpha;
      this.curAzimuth += (targetAzim - this.curAzimuth) * todAlpha;
      this.curNightFactor += (targetNightF - this.curNightFactor) * todAlpha;
      this.curSunsetFactor += (targetSunsetF - this.curSunsetFactor) * todAlpha;
      this.curCloudShadow += (targetCloudSh - this.curCloudShadow) * todAlpha;

      const blendTint = (dst, sunsetCol, nightCol, sunsetStrength, nightStrength) => {
        if (wSunset > 0.001) dst.lerp(sunsetCol, wSunset * sunsetStrength);
        if (wNight > 0.001) dst.lerp(nightCol, wNight * nightStrength);
      };
      blendTint(this.targetFogColor, P_SUNSET.fogTint, P_NIGHT.fogTint, 0.78, 0.92);
      blendTint(this.targetSunColor, P_SUNSET.sunColor, P_NIGHT.sunColor, 0.90, 0.90);
      blendTint(this.targetHemiSky, P_SUNSET.hemiSky, P_NIGHT.hemiSky, 0.88, 0.88);
      blendTint(this.targetHemiGround, P_SUNSET.hemiGround, P_NIGHT.hemiGround, 0.88, 0.88);
      blendTint(this.targetZenith, P_SUNSET.zenithTint, P_NIGHT.zenithTint, 0.94, 0.94);
      blendTint(this.targetMidSky, P_SUNSET.midSkyTint, P_NIGHT.midSkyTint, 0.92, 0.92);

      tSunInt *= (wNoon * P_NOON.sunIntScale + wSunset * P_SUNSET.sunIntScale + wNight * P_NIGHT.sunIntScale);
      tHemiInt *= (wNoon * P_NOON.hemiIntScale + wSunset * P_SUNSET.hemiIntScale + wNight * P_NIGHT.hemiIntScale);
    } else {
      const tod = TIME_OF_DAY_PRESETS[this.timeOfDay] || TIME_OF_DAY_PRESETS.noon;
      this.curElevation += (tod.elevation - this.curElevation) * todAlpha;
      this.curAzimuth += (tod.azimuth - this.curAzimuth) * todAlpha;
      this.curNightFactor += (tod.nightFactor - this.curNightFactor) * todAlpha;
      this.curSunsetFactor += (tod.sunsetFactor - this.curSunsetFactor) * todAlpha;
      this.curCloudShadow += (tod.cloudShadow - this.curCloudShadow) * todAlpha;

      if (tod.fogTint) this.targetFogColor.lerp(tod.fogTint, this.timeOfDay === 'night' ? 0.92 : 0.78);
      if (tod.sunColor) this.targetSunColor.lerp(tod.sunColor, 0.90);
      if (tod.hemiSky) this.targetHemiSky.lerp(tod.hemiSky, 0.88);
      if (tod.hemiGround) this.targetHemiGround.lerp(tod.hemiGround, 0.88);
      if (tod.zenithTint) this.targetZenith.lerp(tod.zenithTint, 0.94);
      if (tod.midSkyTint) this.targetMidSky.lerp(tod.midSkyTint, 0.92);
      tSunInt *= tod.sunIntScale;
      tHemiInt *= tod.hemiIntScale;
    }

    if (this.sunVec) {
      const phi = THREE.MathUtils.degToRad(90 - this.curElevation);
      const theta = THREE.MathUtils.degToRad(this.curAzimuth);
      this.sunVec.setFromSphericalCoords(1, phi, theta);
      if (this.skyMat && this.skyMat.uniforms && this.skyMat.uniforms.uSunPosition) {
        this.skyMat.uniforms.uSunPosition.value.copy(this.sunVec);
      }
    }

    // Update shared pixel lighting uniforms (moving cloud shadows + skybox + glowing night windows)
    PIXEL_LIGHTING_UNIFORMS.uCloudTime.value = elapsedSec;
    PIXEL_LIGHTING_UNIFORMS.uCloudShadowStrength.value = this.curCloudShadow;
    PIXEL_LIGHTING_UNIFORMS.uNightFactor.value = this.curNightFactor;
    PIXEL_LIGHTING_UNIFORMS.uSunsetFactor.value = this.curSunsetFactor;
    setArchTimeOfDayLighting(this.curNightFactor);

    // Gradual temporal smoothing (~2.5-3.5s) so crossing biome borders feels natural, never snappy!
    const alpha = 1.0 - Math.exp(-0.85 * dt);
    this.curFogColor.lerp(this.targetFogColor, alpha);
    this.curFogNear += (tFogNear - this.curFogNear) * alpha;
    this.curFogFar += (tFogFar - this.curFogFar) * alpha;
    this.curSunColor.lerp(this.targetSunColor, alpha);
    this.curSunIntensity += (tSunInt - this.curSunIntensity) * alpha;
    this.curHemiSky.lerp(this.targetHemiSky, alpha);
    this.curHemiGround.lerp(this.targetHemiGround, alpha);
    this.curHemiIntensity += (tHemiInt - this.curHemiIntensity) * alpha;
    this.curZenith.lerp(this.targetZenith, alpha);
    this.curMidSky.lerp(this.targetMidSky, alpha);
    this.curDustColor.lerp(this.targetDustColor, alpha);

    // Apply to Scene Fog & Background
    if (this.scene.fog) {
      this.scene.fog.color.copy(this.curFogColor);
      this.scene.fog.near = this.curFogNear;
      this.scene.fog.far = this.curFogFar;
    }
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(this.curFogColor);
    }

    // Apply to Lights
    if (this.dirLight) {
      this.dirLight.color.copy(this.curSunColor);
      this.dirLight.intensity = this.curSunIntensity;
    }
    if (this.hemiLight) {
      this.hemiLight.color.copy(this.curHemiSky);
      this.hemiLight.groundColor.copy(this.curHemiGround);
      this.hemiLight.intensity = this.curHemiIntensity;
    }

    // Apply to Sky Dome uniforms
    if (this.skyMat && this.skyMat.uniforms) {
      if (this.skyMat.uniforms.uHorizonColor) {
        this.skyMat.uniforms.uHorizonColor.value.copy(this.curFogColor);
      }
      if (this.skyMat.uniforms.uZenithColor) {
        this.skyMat.uniforms.uZenithColor.value.copy(this.curZenith);
      }
      if (this.skyMat.uniforms.uMidSkyColor) {
        this.skyMat.uniforms.uMidSkyColor.value.copy(this.curMidSky);
      }
    }

    // 2. Update GPU Canopy Leaves/Petals & 3D Animated Wind Gust Ribbons
    this.ambientUniforms.uTime.value = elapsedSec;
    this.ambientUniforms.uCamPos.value.copy(cameraPos);
    this.ambientUniforms.uColorA.value.lerp(this.targetParticleA, alpha);
    this.ambientUniforms.uColorB.value.lerp(this.targetParticleB, alpha);
    this.ambientUniforms.uSize.value += (tPartSize - this.ambientUniforms.uSize.value) * alpha;
    this.ambientUniforms.uVelY.value += (tPartVelY - this.ambientUniforms.uVelY.value) * alpha;
    this.ambientUniforms.uDrift.value += (tPartDrift - this.ambientUniforms.uDrift.value) * alpha;
    this.ambientUniforms.uOpacity.value += (tPartOp - this.ambientUniforms.uOpacity.value) * alpha;

    if (this.windUniforms) {
      const targetSpd = Math.min(1.0, Math.max(0.0, (speedKmh || 0) / 185.0));
      this._smoothSpeedFactor += (targetSpd - this._smoothSpeedFactor) * (1.0 - Math.exp(-3.0 * dt));
      this._windTime += dt * (1.0 + this._smoothSpeedFactor * 0.45);
      this.windUniforms.uWindTime.value = this._windTime;
      this.windUniforms.uCamPos.value.copy(cameraPos);
      this.windUniforms.uSpeedFactor.value = this._smoothSpeedFactor;
    }

    // 3. Reactive Vehicle Gameplay Juice:
    //    (a) Jump-Landing 360° Suspension Compression Dust Ring + Spark Shower
    //    (b) High-Speed Wingtip & Mirror Aerodynamic Slipstream Vapor Trails
    //    (c) Biome-Matched Tire Wake Leaf/Grass/Sand/Snow/Ember Kick-Up
    //    (d) Drift Tire Smoke Plumes
    if (!freeCamActive && Array.isArray(wheels)) {
      let groundedCount = 0;
      let maxSkid = 0;
      for (const wh of wheels) {
        if (wh.grounded) {
          groundedCount++;
          if (wh.skidIntensity > maxSkid) maxSkid = wh.skidIntensity;
        }
      }

      // (a) Hard-Landing Shockwave Burst when touching down after a jump!
      if (groundedCount === 0) {
        this._airborneTime += dt;
      } else {
        if (this._airborneTime > 0.16) {
          const impact = Math.min(1.0, (this._airborneTime - 0.14) * 1.8);
          const puffCol = new THREE.Color(0xeceff4).lerp(this.curDustColor, 0.45);
          const sparkCol = new THREE.Color(0xffb838);
          for (const wh of wheels) {
            if (!wh.grounded) continue;
            const hp = wh.hitPoint;
            for (let k = 0; k < 4; k++) {
              const ang = (k / 4) * Math.PI * 2 + Math.random() * 0.6;
              const outSpd = (2.4 + Math.random() * 3.0) * (0.6 + impact * 0.6);
              this._spawnDustPuff(
                hp.x, hp.y + 0.12, hp.z,
                Math.cos(ang) * outSpd, 0.55 + Math.random() * 0.85, Math.sin(ang) * outSpd,
                0.55 + impact * 0.45, puffCol, 0.0
              );
            }
            if (impact > 0.35) {
              for (let s = 0; s < 2; s++) {
                this._spawnDustPuff(
                  hp.x, hp.y + 0.15, hp.z,
                  (Math.random() - 0.5) * 5.5, 1.4 + Math.random() * 2.2, (Math.random() - 0.5) * 5.5,
                  0.22, sparkCol, 2.0
                );
              }
            }
          }
        }
        this._airborneTime = 0;
      }

      // (b) Biome-Matched Tire Wake Leaf / Petal / Ember / Snow Kick-Up while driving fast (> 32 MPH / 52 km/h)
      if (groundedCount > 0 && speedKmh > 52.0 && carForward) {
        const wakeRate = Math.min(24.0, (speedKmh - 52.0) * 0.22);
        this._offroadAcc += dt * wakeRate;
        const isVolc = w.volcano > 0.45;
        const wakeType = isVolc ? 2.0 : 1.0;
        const wakeCol = this.ambientUniforms.uColorA.value.clone().lerp(this.ambientUniforms.uColorB.value, Math.random());
        while (this._offroadAcc >= 1.0) {
          this._offroadAcc -= 1.0;
          const wh = wheels[2 + Math.floor(Math.random() * 2)] || wheels[0];
          if (wh && wh.grounded) {
            const hp = wh.hitPoint;
            const vx = -carForward.x * (1.4 + Math.random() * 1.8) + (Math.random() - 0.5) * 1.8;
            const vy = 0.95 + Math.random() * 1.45;
            const vz = -carForward.z * (1.4 + Math.random() * 1.8) + (Math.random() - 0.5) * 1.8;
            this._spawnDustPuff(hp.x, hp.y + 0.12, hp.z, vx, vy, vz, 0.24 + Math.random() * 0.14, wakeCol, wakeType);
          }
        }
      }

      // (d) Drift / Sliding Tire Smoke & Spark Plumes
      if (speedKmh > 18.0 && maxSkid > 0.14) {
        const rate = Math.min(46.0, maxSkid * 48.0);
        this._dustSpawnAcc += dt * rate;
        const smokeCol = new THREE.Color(0xe6e9ed).lerp(this.curDustColor, 0.25);
        while (this._dustSpawnAcc >= 1.0) {
          this._dustSpawnAcc -= 1.0;
          for (const wh of wheels) {
            if (!wh.grounded || wh.skidIntensity < 0.14) continue;
            const hp = wh.hitPoint;
            const sx = hp.x + (Math.random() - 0.5) * 0.16;
            const sy = hp.y + 0.08 + Math.random() * 0.06;
            const sz = hp.z + (Math.random() - 0.5) * 0.16;
            const vx = -carForward.x * 0.8 + (Math.random() - 0.5) * 0.9;
            const vy = 0.45 + Math.random() * 0.65;
            const vz = -carForward.z * 0.8 + (Math.random() - 0.5) * 0.9;
            this._spawnDustPuff(sx, sy, sz, vx, vy, vz, 0.45 + wh.skidIntensity * 0.55, smokeCol, 0.0);
          }
        }
      }
    }

    let anyActiveDust = false;
    const decay = dt * 1.65;
    for (let i = 0; i < this.dustMax; i++) {
      if (this.dustLife[i] > 0.0) {
        anyActiveDust = true;
        // Sparks (type 2) decay snappier than smoke puffs
        const rateMul = this.dustType[i] > 1.5 ? 2.1 : (this.dustType[i] > 0.5 ? 1.35 : 1.0);
        this.dustLife[i] = Math.max(0.0, this.dustLife[i] - decay * rateMul);
        this.dustPos[i * 3 + 0] += this.dustVel[i * 3 + 0] * dt;
        this.dustPos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
        this.dustPos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
        this.dustVel[i * 3 + 0] *= 0.96;
        this.dustVel[i * 3 + 1] *= 0.97;
        this.dustVel[i * 3 + 2] *= 0.96;
      }
    }
    if (anyActiveDust) {
      this.dustPosAttr.needsUpdate = true;
      this.dustLifeAttr.needsUpdate = true;
      this.dustColAttr.needsUpdate = true;
      this.dustSizeAttr.needsUpdate = true;
      this.dustTypeAttr.needsUpdate = true;
    }
  }
}

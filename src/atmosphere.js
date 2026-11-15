import * as THREE from 'three';

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
    hemiSky: new THREE.Color(0x8ec3f8),
    hemiGround: new THREE.Color(0x485838),
    hemiIntensity: 1.35,
    zenithTint: new THREE.Color(0x105cd6),
    midSkyTint: new THREE.Color(0x2e94eb),
    particleA: new THREE.Color(0xfff4c2),
    particleB: new THREE.Color(0xdaf7b0),
    particleSize: 2.4,
    particleVelY: 0.35,
    particleDrift: 1.1,
    particleOpacity: 0.42,
    dustColor: new THREE.Color(0xc8bfa8),
  },
  autumn: {
    fogColor: new THREE.Color(0xd4b68c),
    fogNear: 155,
    fogFar: 940,
    sunColor: new THREE.Color(0xffe1b0),
    sunIntensity: 2.95,
    hemiSky: new THREE.Color(0xa6c4e0),
    hemiGround: new THREE.Color(0x6b4b24),
    hemiIntensity: 1.38,
    zenithTint: new THREE.Color(0x1c63c4),
    midSkyTint: new THREE.Color(0x529cd9),
    particleA: new THREE.Color(0xf59b23),
    particleB: new THREE.Color(0xe65c1c),
    particleSize: 3.4,
    particleVelY: -0.75,
    particleDrift: 2.2,
    particleOpacity: 0.68,
    dustColor: new THREE.Color(0xc79b5c),
  },
  desert: {
    fogColor: new THREE.Color(0xd9a882),
    fogNear: 140,
    fogFar: 860,
    sunColor: new THREE.Color(0xffe7c2),
    sunIntensity: 3.05,
    hemiSky: new THREE.Color(0xb8c8d8),
    hemiGround: new THREE.Color(0x7d4628),
    hemiIntensity: 1.40,
    zenithTint: new THREE.Color(0x246bc2),
    midSkyTint: new THREE.Color(0x66a3d4),
    particleA: new THREE.Color(0xf0b57d),
    particleB: new THREE.Color(0xd48555),
    particleSize: 2.8,
    particleVelY: 0.12,
    particleDrift: 2.8,
    particleOpacity: 0.48,
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
    particleB: new THREE.Color(0x4a4547),
    particleSize: 3.6,
    particleVelY: 2.35,
    particleDrift: 1.9,
    particleOpacity: 0.78,
    dustColor: new THREE.Color(0x4d4745),
  },
  cold: {
    fogColor: new THREE.Color(0xc2dced),
    fogNear: 120,
    fogFar: 740,
    sunColor: new THREE.Color(0xf0f7ff),
    sunIntensity: 2.65,
    hemiSky: new THREE.Color(0xbce0ff),
    hemiGround: new THREE.Color(0x5d6e7a),
    hemiIntensity: 1.45,
    zenithTint: new THREE.Color(0x3574b8),
    midSkyTint: new THREE.Color(0x7bb4de),
    particleA: new THREE.Color(0xffffff),
    particleB: new THREE.Color(0xd8f0ff),
    particleSize: 3.3,
    particleVelY: -2.15,
    particleDrift: 2.4,
    particleOpacity: 0.76,
    dustColor: new THREE.Color(0xe6f2f8),
  },
  coast: {
    fogColor: new THREE.Color(0x94d2f2),
    fogNear: 195,
    fogFar: 1240,
    sunColor: new THREE.Color(0xfff8eb),
    sunIntensity: 2.85,
    hemiSky: new THREE.Color(0x90d0ff),
    hemiGround: new THREE.Color(0x4a6858),
    hemiIntensity: 1.42,
    zenithTint: new THREE.Color(0x0c62db),
    midSkyTint: new THREE.Color(0x2ea6f0),
    particleA: new THREE.Color(0xe8fbff),
    particleB: new THREE.Color(0xfff6d6),
    particleSize: 2.2,
    particleVelY: 0.42,
    particleDrift: 1.6,
    particleOpacity: 0.36,
    dustColor: new THREE.Color(0xdcc9a3),
  },
};

/**
 * Evaluates smooth biome atmosphere weights matching the terrain generator.
 */
function evalBiomeWeights(wx, wz) {
  const wy = -wz;
  const wyBioW = wy + 26.0 * Math.sin(wx * 0.014 + 0.5);
  const wxBioE = wx + 28.0 * Math.cos(wy * 0.013 - 0.4);
  const wyBioN = wy + 26.0 * Math.sin(wx * 0.012 + 1.1);

  const dVolc = Math.hypot((wxBioE - 1140.0) / 1.18, (wyBioW - 75.0) / 1.12);
  const wVolcano = 1.0 - smoothstep(320.0, 560.0, dVolc);

  const canyonNorthFar = 330.0 + 330.0 * (1.0 - smoothstep(-1150.0, -800.0, wxBioE));
  const wDesert =
    (1.0 - smoothstep(-340.0, -85.0, wxBioE)) *
    smoothstep(-940.0, -680.0, wyBioW) *
    (1.0 - smoothstep(canyonNorthFar, canyonNorthFar + 160.0, wyBioW)) *
    (1.0 - wVolcano);

  const inNorthGlacier =
    smoothstep(700.0, 960.0, wyBioN) *
    (1.0 - smoothstep(140.0, 380.0, wxBioE)) *
    smoothstep(-1380.0, -1020.0, wxBioE);
  const inTouge =
    smoothstep(110.0, 290.0, wyBioN) *
    (1.0 - smoothstep(800.0, 1060.0, wyBioN)) *
    smoothstep(-620.0, -400.0, wxBioE) *
    (1.0 - smoothstep(90.0, 280.0, wxBioE));
  const wCold = Math.max(inNorthGlacier, inTouge) * (1.0 - wDesert) * (1.0 - wVolcano);

  const wAutumn =
    smoothstep(85.0, 320.0, wxBioE) *
    smoothstep(55.0, 275.0, wyBioN) *
    (1.0 - wVolcano) *
    (1.0 - wCold * 0.85);

  const wCoast = (1.0 - smoothstep(-620.0, -470.0, wy)) * (1.0 - wDesert * 0.9) * (1.0 - wVolcano);

  const sumSpecial = Math.min(1.0, wVolcano + wDesert + wCold + wAutumn + wCoast);
  const wValley = Math.max(0.0, 1.0 - sumSpecial);
  const total = wValley + wAutumn + wDesert + wVolcano + wCold + wCoast || 1.0;

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
  constructor(scene, { skyMat, dirLight, hemiLight }) {
    this.scene = scene;
    this.skyMat = skyMat;
    this.dirLight = dirLight;
    this.hemiLight = hemiLight;

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
    this._initWheelDustSystem(scene);
    this._dustSpawnAcc = 0;
  }

  _initAmbientParticles(scene) {
    const count = 680;
    const boxW = 92.0;
    const boxH = 30.0;
    const boxD = 92.0;

    const geo = new THREE.BufferGeometry();
    const seeds = new Float32Array(count * 3);
    const mixVals = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      seeds[i * 3 + 0] = (Math.random() - 0.5) * boxW;
      seeds[i * 3 + 1] = Math.random() * boxH;
      seeds[i * 3 + 2] = (Math.random() - 0.5) * boxD;
      mixVals[i] = Math.random();
      scales[i] = 0.65 + Math.random() * 0.85;
    }

    // Position is driven in shader from aSeed + uCameraPos modulo box
    geo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aMix', new THREE.BufferAttribute(mixVals, 1));
    geo.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));

    this.ambientUniforms = {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uBoxSize: { value: new THREE.Vector3(boxW, boxH, boxD) },
      uVelY: { value: 0.35 },
      uDrift: { value: 1.1 },
      uSize: { value: 2.4 },
      uColorA: { value: BIOME_PRESETS.valley.particleA.clone() },
      uColorB: { value: BIOME_PRESETS.valley.particleB.clone() },
      uOpacity: { value: 0.42 },
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

        void main() {
          vMix = aMix;
          float phase = aMix * 6.28318;
          vec3 driftOffset = vec3(
            sin(uTime * 0.65 + phase) * uDrift + uTime * uDrift * 0.45,
            uTime * uVelY,
            cos(uTime * 0.55 + phase * 1.3) * uDrift + uTime * uDrift * 0.25
          );
          vec3 rel = mod(position + driftOffset - uCamPos + uBoxSize * 0.5, uBoxSize) - uBoxSize * 0.5;
          vec3 worldPos = uCamPos + rel;

          // Fade out smoothly near box boundaries to prevent popping
          vec3 normDist = abs(rel) / (uBoxSize * 0.5);
          float edgeX = 1.0 - smoothstep(0.70, 1.0, normDist.x);
          float edgeY = 1.0 - smoothstep(0.70, 1.0, normDist.y);
          float edgeZ = 1.0 - smoothstep(0.70, 1.0, normDist.z);
          float nearCam = smoothstep(3.0, 9.0, length(rel));
          vEdgeFade = edgeX * edgeY * edgeZ * nearCam;

          vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
          gl_PointSize = clamp((uSize * aScale * 140.0 * uPixelRatio) / max(1.0, -mvPos.z), 1.5, 16.0);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uOpacity;

        varying float vMix;
        varying float vEdgeFade;

        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float soft = pow(1.0 - d, 1.8);
          vec3 col = mix(uColorA, uColorB, vMix);
          gl_FragColor = vec4(col, soft * uOpacity * vEdgeFade);
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

  _initWheelDustSystem(scene) {
    const maxPuffs = 150;
    this.dustMax = maxPuffs;
    this.dustCursor = 0;

    this.dustPos = new Float32Array(maxPuffs * 3);
    this.dustVel = new Float32Array(maxPuffs * 3);
    this.dustLife = new Float32Array(maxPuffs); // 0..1 (<=0 means inactive)
    this.dustCol = new Float32Array(maxPuffs * 3);
    this.dustSize = new Float32Array(maxPuffs);

    for (let i = 0; i < maxPuffs; i++) {
      this.dustLife[i] = 0.0;
    }

    const geo = new THREE.BufferGeometry();
    this.dustPosAttr = new THREE.BufferAttribute(this.dustPos, 3);
    this.dustLifeAttr = new THREE.BufferAttribute(this.dustLife, 1);
    this.dustColAttr = new THREE.BufferAttribute(this.dustCol, 3);
    this.dustSizeAttr = new THREE.BufferAttribute(this.dustSize, 1);

    geo.setAttribute('position', this.dustPosAttr);
    geo.setAttribute('aLife', this.dustLifeAttr);
    geo.setAttribute('aColor', this.dustColAttr);
    geo.setAttribute('aSize', this.dustSizeAttr);

    this.dustUniforms = {
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.5) },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      vertexShader: /* glsl */ `
        attribute float aLife;
        attribute vec3 aColor;
        attribute float aSize;

        uniform float uPixelRatio;

        varying float vLife;
        varying vec3 vColor;

        void main() {
          vLife = aLife;
          vColor = aColor;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          float expand = 1.0 + (1.0 - aLife) * 2.4;
          gl_PointSize = aLife > 0.001
            ? clamp((aSize * expand * 240.0 * uPixelRatio) / max(1.5, -mvPos.z), 0.0, 88.0)
            : 0.0;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying vec3 vColor;

        void main() {
          if (vLife <= 0.001) discard;
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c) * 2.0;
          if (d > 1.0) discard;
          float soft = pow(1.0 - d, 2.4);
          float alpha = soft * vLife * 0.20;
          gl_FragColor = vec4(vColor, alpha);
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

  _spawnDustPuff(x, y, z, vx, vy, vz, size, tintColor) {
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
    this.dustLife[idx] = 1.0;
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

    const alpha = 1.0 - Math.exp(-1.9 * dt);
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

    // 2. Update GPU Ambient Biome Particles
    this.ambientUniforms.uTime.value = elapsedSec;
    this.ambientUniforms.uCamPos.value.copy(cameraPos);
    this.ambientUniforms.uColorA.value.lerp(this.targetParticleA, alpha);
    this.ambientUniforms.uColorB.value.lerp(this.targetParticleB, alpha);
    this.ambientUniforms.uSize.value += (tPartSize - this.ambientUniforms.uSize.value) * alpha;
    this.ambientUniforms.uVelY.value += (tPartVelY - this.ambientUniforms.uVelY.value) * alpha;
    this.ambientUniforms.uDrift.value += (tPartDrift - this.ambientUniforms.uDrift.value) * alpha;
    this.ambientUniforms.uOpacity.value += (tPartOp - this.ambientUniforms.uOpacity.value) * alpha;

    // 3. Emit wispy tire smoke directly from sliding/drifting wheel contact patches
    if (!freeCamActive && Array.isArray(wheels) && speedKmh > 18.0) {
      let maxSkid = 0;
      for (const wh of wheels) {
        if (wh.grounded && wh.skidIntensity > maxSkid) maxSkid = wh.skidIntensity;
      }
      if (maxSkid > 0.14) {
        const rate = Math.min(42.0, maxSkid * 46.0);
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
            this._spawnDustPuff(sx, sy, sz, vx, vy, vz, 0.45 + wh.skidIntensity * 0.55, smokeCol);
          }
        }
      }
    }

    let anyActiveDust = false;
    const decay = dt * 1.55;
    for (let i = 0; i < this.dustMax; i++) {
      if (this.dustLife[i] > 0.0) {
        anyActiveDust = true;
        this.dustLife[i] = Math.max(0.0, this.dustLife[i] - decay);
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
    }
  }
}

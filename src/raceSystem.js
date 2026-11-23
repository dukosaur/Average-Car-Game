import * as THREE from 'three';
import { RaycastVehicleController } from './vehicleController.js';
import { assetUrl } from './assetUrl.js';
import { applyPaintToCarRoot, generateRandomCarPaint, getSavedCarPaint, disposeCarPaintTextures } from './carPaintSystem.js';

/**
 * Generates a crisp 64x64 (32x32 2x nearest-neighbor) Pixel-Art Tilted Checkered
 * Race Flag data URL — bold 4x4 checker squares, clean tilted pole, crisp dark
 * pixel outline, zero surrounding box!
 */
let cachedFlagDataUrl = null;
export function createPixelRaceFlagDataUrl() {
  if (cachedFlagDataUrl) return cachedFlagDataUrl;

  const W = 32;
  const H = 32;
  const raw = document.createElement('canvas');
  raw.width = W;
  raw.height = H;
  const ctx = raw.getContext('2d');

  // Helper to paint an integer pixel
  const grid = new Map();
  const put = (x, y, hex) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 1 || ix >= W - 1 || iy < 1 || iy >= H - 1) return;
    grid.set(`${ix}_${iy}`, hex);
  };

  // Draw the flag in clean upright coordinates first, then rotate slightly (-16 deg)
  // onto the 32x32 pixel grid so the checkers stay crisp, regular, and unmistakably readable!
  const angle = -16 * (Math.PI / 180);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const cx = 14.5;
  const cy = 15.5;

  const sampleUpright = (ux, uy) => {
    // 1. Flagpole: x in [5..7], y in [4..28]
    if (ux >= 5.0 && ux < 7.2 && uy >= 4.0 && uy < 28.5) {
      if (uy < 6.4) {
        return ux < 6.1 ? '#fff1a8' : '#e5a93c'; // Bright golden finial tip
      }
      return ux < 6.0 ? '#f3c86d' : '#a87220'; // Crisp metallic-gold pole
    }

    // 2. Waving Checkered Flag Cloth: 4 columns x 3 rows of bold 4.2px checker squares!
    //    Cloth spans ux in [7.2 .. 25.0], base uy in [5.5 .. 18.5] with a clean sine wave
    if (ux >= 7.2 && ux <= 25.2) {
      const localX = ux - 7.2;
      const wave = Math.sin(localX * 0.34) * 1.15;
      const topY = 5.4 + wave;
      const botY = 18.6 + wave;
      if (uy >= topY && uy <= botY) {
        const colIdx = Math.floor(localX / 4.5);
        const rowIdx = Math.floor((uy - topY) / 4.4);
        const isWhite = ((colIdx + rowIdx) % 2) === 0;
        // Subtle vertical wave fold shading so the cloth feels alive
        const inShadowFold = (localX >= 7.2 && localX <= 11.2);
        if (isWhite) {
          return inShadowFold ? '#dce4ef' : '#ffffff';
        }
        return inShadowFold ? '#1a202c' : '#0f131b';
      }
    }
    return null;
  };

  // Rasterize rotated sprite into 32x32 pixel grid
  for (let py = 2; py < H - 2; py++) {
    for (let px = 2; px < W - 2; px++) {
      const dx = px - cx;
      const dy = py - cy;
      // Inverse rotation to sample upright flag cleanly
      const ux = cx + dx * cosA + dy * sinA;
      const uy = cy - dx * sinA + dy * cosA;
      const col = sampleUpright(ux, uy);
      if (col) put(px, py, col);
    }
  }

  // Stamp crisp 1px dark pixel-art outline around the entire silhouette (4-connected + corners)
  const outlineKeys = new Set();
  for (const key of grid.keys()) {
    const [sx, sy] = key.split('_').map(Number);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nk = `${sx + dx}_${sy + dy}`;
        if (!grid.has(nk)) outlineKeys.add(nk);
      }
    }
  }

  // Draw outline first, then crisp interior pixels
  ctx.fillStyle = '#090c12';
  for (const key of outlineKeys) {
    const [ox, oy] = key.split('_').map(Number);
    if (ox >= 0 && ox < W && oy >= 0 && oy < H) {
      ctx.fillRect(ox, oy, 1, 1);
    }
  }
  for (const [key, hex] of grid.entries()) {
    const [ix, iy] = key.split('_').map(Number);
    ctx.fillStyle = hex;
    ctx.fillRect(ix, iy, 1, 1);
  }

  // Upscale 2x with nearest-neighbor for razor-sharp pixel art
  const out = document.createElement('canvas');
  out.width = W * 2;
  out.height = H * 2;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(raw, 0, 0, W * 2, H * 2);

  cachedFlagDataUrl = out.toDataURL('image/png');
  return cachedFlagDataUrl;
}

const RIVAL_DRIVER_NAMES = [
  'K. TAKAHASHI',
  'M. ROSSI',
  'L. VANCE',
  'S. LINDQVIST',
  'A. MOREAU',
  'D. MORALES',
  'R. HOFFMAN',
];

const RIVAL_PAINT_TINTS = [
  null,     // Keep authentic factory garage livery for Rival #1
  0x2b7de9, // Motorsport Cobalt
  0xf5b82e, // Solar Gold
];

const AI_RACE_COLLISION_GROUPS = (0x0004 << 16) | (0xFFFF & ~0x0002);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

const RACE_BEST_TIMES_KEY = 'carGame_raceBestTimes_v1';

export function loadRaceBestTimes() {
  try {
    const raw = localStorage.getItem(RACE_BEST_TIMES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function saveRaceBestTime(raceId, timeSec) {
  if (!raceId || !Number.isFinite(timeSec) || timeSec <= 0) return false;
  const all = loadRaceBestTimes();
  const prev = all[raceId];
  if (!Number.isFinite(prev) || timeSec < prev) {
    all[raceId] = Number(timeSec.toFixed(3));
    try {
      localStorage.setItem(RACE_BEST_TIMES_KEY, JSON.stringify(all));
    } catch (_) {}
    return true;
  }
  return false;
}

function formatRaceTime(sec) {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  const whole = Math.floor(rem);
  const hund = Math.floor((rem - whole) * 100);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hund).padStart(2, '0')}`;
}

function ordinalSuffix(n) {
  if (n === 1) return '1ST';
  if (n === 2) return '2ND';
  if (n === 3) return '3RD';
  return `${n}TH`;
}

export class RaceSystem {
  constructor({
    RAPIER,
    world,
    scene,
    camera,
    vehicle,
    input,
    worldMap,
    gpsNav,
    trafficSystem,
    carRoster,
    getActiveCarIndex,
    createAICarParts,
    terrainSampler,
  }) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.camera = camera || null;
    this.vehicle = vehicle;
    this.nameplatesContainer = document.getElementById('remote-nameplates-layer');
    this._projVec = new THREE.Vector3();
    this.input = input;
    this.worldMap = worldMap;
    this.gpsNav = gpsNav;
    this.trafficSystem = trafficSystem;
    this.carRoster = carRoster || [];
    this.getActiveCarIndex = getActiveCarIndex || (() => 0);
    this.createAICarParts = createAICarParts;
    this.terrainSampler = terrainSampler;

    this.flagIconUrl = createPixelRaceFlagDataUrl();
    this.races = [];
    this.startZones = []; // 3D start zone groups & trigger metadata

    // Dwell & Pre-Race Modal State
    this.hoveredZoneRace = null;
    this.zoneDwellSec = 0;
    this.zoneDwellRequiredSec = 1.75;
    this.dismissedRaceId = null;
    this.isEntryModalOpen = false;
    this.selectedEntryRace = null;

    // Active Race State ('IDLE' | 'COUNTDOWN' | 'RACING' | 'FINISHED')
    this.state = 'IDLE';
    this.activeRace = null;
    this.countdownSec = 0;
    this.raceElapsedSec = 0;
    this.currentLapStartSec = 0;
    this.bestLapSec = Infinity;

    // Player checkpoint tracking
    this.playerLap = 0;
    this.playerNextCp = 1;
    this.playerLastClearedCp = 0;
    this.playerPrevPos = new THREE.Vector3();
    this.playerTotalProgressM = 0;
    this.playerSplineIdx = 0;
    this.playerMaxSplineIdxThisLap = 0;
    this.missedCheckpointWarn = false;
    this.playerRank = 1;

    // High-res racing spline & AI Rivals
    this.spline = [];
    this.splineTotalLength = 1;
    this.isCircuit = true;
    this.totalLaps = 3;
    this.rivals = []; // [{ id, driverName, carSpec, vehicle, brakeUniform, clonedMaterials, ... }]

    // 3D Active Race Checkpoint Gate Pair (Current Gate + Preview Next Gate)
    this.activeGateGroup = null;
    this.previewGateGroup = null;
    this._init3DCheckpointGates();

    // Bind DOM UI
    this._bindUI();
  }

  async init() {
    try {
      const res = await fetch(assetUrl('/assets/races.json?v=3'));
      const data = await res.json();
      const loaded = Array.isArray(data?.races) ? data.races : [];
      this.races = loaded.map((r) => this._prepareRaceDefinition(r));
    } catch (err) {
      console.warn('Could not load /assets/races.json:', err);
      this.races = [];
    }

    // Build 3D Freeroam Start Zones at all 5 race start locations
    this._build3DStartZones();

    // Register tilted pixel-art race flag pins on the World Map
    if (this.worldMap && typeof this.worldMap.setRaceEvents === 'function') {
      this.worldMap.setRaceEvents(this.races, this.flagIconUrl);
    }
  }

  _raycastRoadY(wx, wz, fallbackY = 0) {
    if (this.RAPIER && this.world) {
      const ray = new this.RAPIER.Ray({ x: wx, y: fallbackY + 18.0, z: wz }, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRay(ray, 42.0, true, undefined, (0xFFFF << 16) | 0x0001);
      if (hit && Number.isFinite(hit.timeOfImpact)) {
        return fallbackY + 18.0 - hit.timeOfImpact;
      }
    }
    if (this.terrainSampler) {
      const s = this.terrainSampler.sample(wx, wz);
      if (s && Number.isFinite(s.y)) return s.y;
    }
    return fallbackY;
  }

  /**
   * Ensures every race has corner-aware anti-skip checkpoints and ground-clamped elevations.
   */
  _prepareRaceDefinition(rawRace) {
    const race = { ...rawRace };
    const isCircuit = race.type === 'circuit';
    const pts = (race.path || []).map((p) => {
      const x = Array.isArray(p) ? p[0] : p.x;
      const rawY = Array.isArray(p) ? p[1] : (p.y ?? 0);
      const z = Array.isArray(p) ? p[2] : p.z;
      return { x, y: rawY, z };
    });

    if (pts.length < 2) return race;

    // Compute cumulative distance & smooth unit tangents
    const n = pts.length;
    const cum = [0];
    const tangents = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
      }
      const pPrev = pts[Math.max(0, i - 1)];
      const pNext = pts[Math.min(n - 1, i + 1)];
      const dx = pNext.x - pPrev.x;
      const dz = pNext.z - pPrev.z;
      const len = Math.hypot(dx, dz) || 1;
      tangents.push({ x: dx / len, z: dz / len });
    }
    const totalDist = cum[n - 1] || 1;
    race.distanceMeters = Math.round(totalDist);
    race.distanceMiles = Number((totalDist * 0.000621371).toFixed(2));

    // Rebuild corner-aware anti-skip checkpoints if not already baked
    if (!race._antiSkipBaked || !Array.isArray(race.checkpoints) || race.checkpoints.length < 25) {
      const cps = [];
      const pushCp = (idx) => {
        const p = pts[idx];
        const t = tangents[idx];
        cps.push({
          x: Number(p.x.toFixed(2)),
          y: Number(p.y.toFixed(2)),
          z: Number(p.z.toFixed(2)),
          fwdX: Number(t.x.toFixed(4)),
          fwdZ: Number(t.z.toFixed(4)),
          width: 15.0,
        });
      };
      pushCp(0);
      let lastDist = 0;
      let lastTan = tangents[0];
      for (let i = 1; i < n - 1; i++) {
        const dSince = cum[i] - lastDist;
        const dRemain = totalDist - cum[i];
        if (dRemain < (isCircuit ? 48.0 : 38.0)) continue;
        const dot = clamp(tangents[i].x * lastTan.x + tangents[i].z * lastTan.z, -1, 1);
        const angleDeg = Math.acos(dot) * (180 / Math.PI);
        if (dSince >= 95.0 || (dSince >= 42.0 && angleDeg >= 24.0)) {
          pushCp(i);
          lastDist = cum[i];
          lastTan = tangents[i];
        }
      }
      if (!isCircuit) pushCp(n - 1);
      race.checkpoints = cps;
      race._antiSkipBaked = true;
    }

    // Snap checkpoint Y values to exact Rapier road surface collider
    if (Array.isArray(race.checkpoints)) {
      for (const cp of race.checkpoints) {
        cp.y = Number(this._raycastRoadY(cp.x, cp.z, cp.y ?? 0).toFixed(2));
      }
    }

    return race;
  }

  _build3DStartZones() {
    for (const z of this.startZones) {
      if (z.group && z.group.parent) z.group.parent.remove(z.group);
    }
    this.startZones = [];

    // Shared checkered banner texture & pixel flag texture
    const flagTex = new THREE.TextureLoader().load(this.flagIconUrl);
    flagTex.magFilter = THREE.NearestFilter;
    flagTex.minFilter = THREE.NearestFilter;
    flagTex.colorSpace = THREE.SRGBColorSpace;

    const checkerCanvas = document.createElement('canvas');
    checkerCanvas.width = 64;
    checkerCanvas.height = 16;
    const cctx = checkerCanvas.getContext('2d');
    for (let y = 0; y < 16; y += 4) {
      for (let x = 0; x < 64; x += 4) {
        const isGold = ((x / 4 + y / 4) % 2) === 0;
        cctx.fillStyle = isGold ? '#ffd54f' : '#121722';
        cctx.fillRect(x, y, 4, 4);
      }
    }
    const checkerTex = new THREE.CanvasTexture(checkerCanvas);
    checkerTex.magFilter = THREE.NearestFilter;
    checkerTex.minFilter = THREE.NearestFilter;
    checkerTex.wrapS = THREE.RepeatWrapping;
    checkerTex.wrapT = THREE.RepeatWrapping;
    checkerTex.repeat.set(3, 1);

    const ringGeo = new THREE.RingGeometry(4.8, 5.55, 32);
    ringGeo.rotateX(-Math.PI * 0.5);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const innerDiscGeo = new THREE.CircleGeometry(4.8, 32);
    innerDiscGeo.rotateX(-Math.PI * 0.5);
    const innerDiscMat = new THREE.MeshBasicMaterial({
      color: 0xffd54f,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const flagPlaneGeo = new THREE.PlaneGeometry(2.6, 2.6);
    const flagPlaneMat = new THREE.MeshBasicMaterial({
      map: flagTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    // Dedicated Finish Line Gantry (hidden in freeroam; only shown near the end of an active race)
    if (this.finishGantryGroup && this.finishGantryGroup.parent) {
      this.finishGantryGroup.parent.remove(this.finishGantryGroup);
    }
    const pillarGeo = new THREE.BoxGeometry(0.65, 6.4, 0.65);
    const beamGeo = new THREE.BoxGeometry(15.2, 1.05, 0.85);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x181e29, roughness: 0.6, metalness: 0.3 });
    const bannerMat = new THREE.MeshBasicMaterial({ map: checkerTex });

    const finishGantry = new THREE.Group();
    finishGantry.visible = false;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, darkMat);
      pillar.position.set(side * 7.25, 2.6, 0);
      finishGantry.add(pillar);
    }
    const beam = new THREE.Mesh(beamGeo, bannerMat);
    beam.position.set(0, 5.65, 0);
    finishGantry.add(beam);

    const finishFlag = new THREE.Mesh(flagPlaneGeo, flagPlaneMat);
    finishFlag.position.set(0, 7.65, 0);
    finishFlag.renderOrder = 5;
    finishGantry.add(finishFlag);

    this.scene.add(finishGantry);
    this.finishGantryGroup = finishGantry;
    this.finishGantryFlag = finishFlag;

    // Freeroam Start Zones: glowing ground circle + floating bobbing flag (no gantry poles)
    for (const race of this.races) {
      if (!race.checkpoints || !race.checkpoints.length) continue;
      const cp0 = race.checkpoints[0];
      const yaw = Math.atan2(cp0.fwdX, cp0.fwdZ);

      const group = new THREE.Group();
      group.position.set(cp0.x, cp0.y, cp0.z);
      group.rotation.y = yaw;

      // Glowing Ground Drive-In Zone Ring & Soft Fill Disc
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.set(0, 0.08, 0);
      ringMesh.renderOrder = 3;
      group.add(ringMesh);

      const discMesh = new THREE.Mesh(innerDiscGeo, innerDiscMat);
      discMesh.position.set(0, 0.07, 0);
      discMesh.renderOrder = 2;
      group.add(discMesh);

      // Floating Bobbing Pixel Race Flag above the Circle Center
      const flagBillboard = new THREE.Mesh(flagPlaneGeo, flagPlaneMat);
      flagBillboard.position.set(0, 3.85, 0);
      flagBillboard.renderOrder = 5;
      group.add(flagBillboard);

      this.scene.add(group);
      this.startZones.push({
        race,
        group,
        ringMesh,
        flagBillboard,
        x: cp0.x,
        y: cp0.y,
        z: cp0.z,
      });
    }
  }

  _init3DCheckpointGates() {
    const buildGatePair = (colorHex, opacityScale = 1.0) => {
      const group = new THREE.Group();
      group.visible = false;

      // Twin tall glowing roadside checkpoint pylons (placed at ±7.4m so cars drive cleanly between them)
      const pylonGeo = new THREE.CylinderGeometry(0.28, 0.42, 7.5, 10);
      const pylonMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.88 * opacityScale,
      });

      const haloGeo = new THREE.CylinderGeometry(0.65, 0.95, 7.2, 10, 1, true);
      const haloMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.24 * opacityScale,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      for (const side of [-1, 1]) {
        const pylon = new THREE.Mesh(pylonGeo, pylonMat);
        pylon.position.set(side * 7.35, 3.5, 0);
        group.add(pylon);

        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.set(side * 7.35, 3.5, 0);
        halo.renderOrder = 4;
        group.add(halo);
      }

      // Ground gate strip across the road
      const stripGeo = new THREE.PlaneGeometry(14.2, 1.35);
      stripGeo.rotateX(-Math.PI * 0.5);
      const stripMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.52 * opacityScale,
        depthWrite: false,
      });
      const strip = new THREE.Mesh(stripGeo, stripMat);
      strip.position.set(0, 0.08, 0);
      strip.renderOrder = 3;
      group.add(strip);

      // Overhead floating direction arrow chevron
      const arrowShape = new THREE.Shape();
      arrowShape.moveTo(0, 1.15);
      arrowShape.lineTo(1.45, -0.55);
      arrowShape.lineTo(0.65, -0.55);
      arrowShape.lineTo(0, 0.25);
      arrowShape.lineTo(-0.65, -0.55);
      arrowShape.lineTo(-1.45, -0.55);
      arrowShape.closePath();
      const arrowGeo = new THREE.ShapeGeometry(arrowShape);
      const arrowMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.92 * opacityScale,
      });
      const arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
      arrowMesh.position.set(0, 5.4, 0);
      group.add(arrowMesh);

      this.scene.add(group);
      return { group, arrowMesh };
    };

    this.activeGate = buildGatePair(0x22c55e, 1.0);  // Emerald-gold active target gate
    this.previewGate = buildGatePair(0xe5a93c, 0.55); // Warm amber next-gate preview
  }

  _bindUI() {
    this.dwellBannerEl = document.getElementById('race-dwell-banner');
    this.dwellTitleEl = document.getElementById('race-dwell-title');
    this.dwellFillEl = document.getElementById('race-dwell-fill');

    this.entryModalEl = document.getElementById('race-entry-modal');
    this.entryTypeEl = document.getElementById('race-entry-type');
    this.entryTitleEl = document.getElementById('race-entry-title');
    this.entryMetaEl = document.getElementById('race-entry-meta');
    this.entryStartRaceBtnEl = document.getElementById('race-entry-start-btn');
    this.entryTimeTrialBtnEl = document.getElementById('race-entry-tt-btn');
    this.entryCloseBtnEl = document.getElementById('race-entry-close-btn');

    this.hudEl = document.getElementById('race-active-hud');
    this.hudTrackNameEl = document.getElementById('race-hud-track-name');
    this.hudPosWrapEl = document.getElementById('race-hud-pos-wrap');
    this.hudPosEl = document.getElementById('race-hud-pos');
    this.hudTotalEl = document.getElementById('race-hud-total');
    this.hudLapEl = document.getElementById('race-hud-lap');
    this.hudCpEl = document.getElementById('race-hud-cp');
    this.hudProgFillEl = document.getElementById('race-hud-prog-fill');
    this.hudTimeEl = document.getElementById('race-hud-time');
    this.hudQuitBtnEl = document.getElementById('race-hud-quit-btn');

    this.countdownEl = document.getElementById('race-countdown-banner');
    this.countdownTextEl = document.getElementById('race-countdown-text');
    this.missedCpBannerEl = document.getElementById('race-missed-cp-banner');

    this.resultsModalEl = document.getElementById('race-results-modal');
    this.resultsBadgeEl = document.getElementById('race-results-badge');
    this.resultsTitleEl = document.getElementById('race-results-title');
    this.resultsSubEl = document.getElementById('race-results-sub');
    this.resultsListEl = document.getElementById('race-results-standings');
    this.resultsRetryBtnEl = document.getElementById('race-results-retry-btn');
    this.resultsFreeroamBtnEl = document.getElementById('race-results-freeroam-btn');

    if (this.entryStartRaceBtnEl) {
      this.entryStartRaceBtnEl.addEventListener('click', () => {
        if (this.selectedEntryRace) {
          const r = this.selectedEntryRace;
          this.closeEntryModal(false);
          this.startRace(r);
        }
      });
    }

    if (this.entryCloseBtnEl) {
      this.entryCloseBtnEl.addEventListener('click', () => this.closeEntryModal(true));
    }

    if (this.hudQuitBtnEl) {
      this.hudQuitBtnEl.addEventListener('click', () => this.stopRaceToFreeroam());
    }

    if (this.resultsRetryBtnEl) {
      this.resultsRetryBtnEl.addEventListener('click', () => {
        const r = this.activeRace;
        this._hideResultsModal();
        if (r) this.startRace(r);
      });
    }

    if (this.resultsFreeroamBtnEl) {
      this.resultsFreeroamBtnEl.addEventListener('click', () => {
        this._hideResultsModal();
        this.stopRaceToFreeroam();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (this.isEntryModalOpen) {
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeEntryModal(true);
        } else if (e.code === 'Enter') {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (this.selectedEntryRace) {
            const r = this.selectedEntryRace;
            this.closeEntryModal(false);
            this.startRace(r);
          }
        }
      } else if (this.state === 'FINISHED' && this.resultsModalEl && !this.resultsModalEl.classList.contains('hidden')) {
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          this._hideResultsModal();
          this.stopRaceToFreeroam();
        }
      }
    }, true);
  }

  openEntryModal(race) {
    if (!race || !this.entryModalEl) return;
    this.isEntryModalOpen = true;
    this.selectedEntryRace = race;
    this.zoneDwellSec = 0;
    if (this.dwellBannerEl) this.dwellBannerEl.classList.add('hidden');

    const isCircuit = race.type === 'circuit';
    if (this.entryTypeEl) {
      this.entryTypeEl.textContent = isCircuit ? 'HORIZON CIRCUIT EVENT' : 'HORIZON SPRINT EVENT';
    }
    if (this.entryTitleEl) {
      this.entryTitleEl.textContent = race.name.toUpperCase();
    }
    if (this.entryMetaEl) {
      const lapsTxt = isCircuit ? `${race.laps || 3} LAPS` : 'POINT-TO-POINT';
      const activeCar = this.carRoster[this.getActiveCarIndex()] || this.carRoster[0];
      const carLabel = activeCar ? activeCar.name : 'GARAGE CLASS';
      this.entryMetaEl.textContent = `${lapsTxt} • ${race.distanceMiles} MI • ${race.checkpoints.length} CHECKPOINTS • ${carLabel} CLASS`;
    }

    // Bring car to a smooth stop while menu is open
    if (this.input) {
      this.input.forward = false;
      this.input.backward = false;
      this.input.left = false;
      this.input.right = false;
      this.input.handbrake = true;
    }

    this.entryModalEl.classList.remove('hidden');
  }

  closeEntryModal(markDismissed = true) {
    this.isEntryModalOpen = false;
    if (markDismissed && this.selectedEntryRace) {
      this.dismissedRaceId = this.selectedEntryRace.id;
    }
    this.selectedEntryRace = null;
    if (this.entryModalEl) this.entryModalEl.classList.add('hidden');
    if (this.input) this.input.handbrake = false;
  }

  _hideResultsModal() {
    if (this.resultsModalEl) this.resultsModalEl.classList.add('hidden');
  }

  /**
   * Builds a high-resolution corner-smoothed racing spline with a backward-propagated
   * braking speed profile so AI rivals brake smoothly before corners and apex like pros.
   */
  _buildRacingSpline(race, targetTopSpeedMs) {
    const rawPts = (race.path || []).map((p) => ({
      x: Array.isArray(p) ? p[0] : p.x,
      y: Array.isArray(p) ? p[1] : (p.y ?? 0),
      z: Array.isArray(p) ? p[2] : p.z,
    }));
    const isCircuit = race.type === 'circuit';

    // Remove duplicate end point on closed circuit before smoothing
    let work = [...rawPts];
    if (isCircuit && work.length > 3) {
      const first = work[0];
      const last = work[work.length - 1];
      if (Math.hypot(first.x - last.x, first.z - last.z) < 3.0) {
        work.pop();
      }
    }

    // 2-pass gentle Laplacian corner-smoothing (cuts jitter while staying strictly on road asphalt!)
    const n = work.length;
    for (let pass = 0; pass < 2; pass++) {
      const next = [];
      for (let i = 0; i < n; i++) {
        if (!isCircuit && (i === 0 || i === n - 1)) {
          next.push({ ...work[i] });
          continue;
        }
        const prevPt = work[(i - 1 + n) % n];
        const currPt = work[i];
        const nextPt = work[(i + 1) % n];
        next.push({
          x: currPt.x * 0.62 + (prevPt.x + nextPt.x) * 0.19,
          y: currPt.y,
          z: currPt.z * 0.62 + (prevPt.z + nextPt.z) * 0.19,
        });
      }
      work = next;
    }

    // Compute arc length, unit tangents, right vectors, and local curvature
    const spline = [];
    let cumDist = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        cumDist += Math.hypot(work[i].x - work[i - 1].x, work[i].z - work[i - 1].z);
      }
      const pPrev = isCircuit ? work[(i - 1 + n) % n] : work[Math.max(0, i - 1)];
      const pNext = isCircuit ? work[(i + 1) % n] : work[Math.min(n - 1, i + 1)];
      const dx = pNext.x - pPrev.x;
      const dz = pNext.z - pPrev.z;
      const len = Math.hypot(dx, dz) || 1;
      const fwdX = dx / len;
      const fwdZ = dz / len;
      // Right vector in Three.js XZ plane (where +Y is up): right = (-fwdZ, fwdX)
      const rightX = -fwdZ;
      const rightZ = fwdX;

      spline.push({
        idx: i,
        x: work[i].x,
        y: work[i].y,
        z: work[i].z,
        cumDist,
        fwdX,
        fwdZ,
        rightX,
        rightZ,
        curvature: 0,
        signedTurn: 0,
        vMax: targetTopSpeedMs,
      });
    }

    const closingSeg = isCircuit && n > 1
      ? Math.hypot(work[0].x - work[n - 1].x, work[0].z - work[n - 1].z)
      : 0;
    this.splineTotalLength = Math.max(1, cumDist + closingSeg);

    // Evaluate curvature over a ~28m window around each node
    const windowSteps = 2;
    const maxLatAccel = 20.5; // m/s^2 realistic competitive cornering
    for (let i = 0; i < n; i++) {
      const iA = isCircuit ? (i - windowSteps + n) % n : Math.max(0, i - windowSteps);
      const iB = isCircuit ? (i + windowSteps) % n : Math.min(n - 1, i + windowSteps);
      const tA = spline[iA];
      const tB = spline[iB];
      const dot = clamp(tA.fwdX * tB.fwdX + tA.fwdZ * tB.fwdZ, -1, 1);
      const cross = tA.fwdX * tB.fwdZ - tA.fwdZ * tB.fwdX;
      const dTheta = Math.acos(dot);
      let dArc = Math.abs(tB.cumDist - tA.cumDist);
      if (isCircuit && iB < iA) {
        dArc = this.splineTotalLength - tA.cumDist + tB.cumDist;
      }
      const kappa = dTheta / Math.max(8.0, dArc);
      spline[i].curvature = kappa;
      spline[i].signedTurn = Math.sign(cross);
      const cornerV = Math.sqrt(maxLatAccel / Math.max(kappa, 0.0004));
      spline[i].vMax = clamp(cornerV, 17.5, targetTopSpeedMs);
    }

    // Backward braking-envelope propagation (realistic race braking)
    const maxBrakeDecel = 16.5; // m/s^2
    const passes = isCircuit ? 2 : 1;
    for (let p = 0; p < passes; p++) {
      for (let i = n - 1; i >= 0; i--) {
        const nextIdx = isCircuit ? (i + 1) % n : Math.min(n - 1, i + 1);
        if (!isCircuit && i === n - 1) continue;
        const curr = spline[i];
        const nxt = spline[nextIdx];
        const ds = Math.max(1.0, Math.hypot(nxt.x - curr.x, nxt.z - curr.z));
        const allowedEntryV = Math.sqrt(nxt.vMax * nxt.vMax + 2.0 * maxBrakeDecel * ds);
        if (allowedEntryV < curr.vMax) {
          curr.vMax = allowedEntryV;
        }
      }
    }

    this.spline = spline;
  }

  async startRace(race) {
    if (!race || !race.checkpoints || race.checkpoints.length < 2) return;

    // Clean up any existing race first
    this._cleanupRivals();

    this.activeRace = race;
    this.isCircuit = race.type === 'circuit';
    this.totalLaps = this.isCircuit ? (race.laps || 3) : 1;
    this.state = 'COUNTDOWN';
    this.countdownSec = 3.4;
    this.raceElapsedSec = 0;
    this.currentLapStartSec = 0;
    this.bestLapSec = Infinity;

    this.playerLap = 0;
    this.playerProgressLap = 0;
    this.playerNextCp = 1;
    this.playerLastClearedCp = 0;
    this.playerSplineIdx = 0;
    this.playerMaxSplineIdxThisLap = 0;
    this.playerTotalProgressM = -35.0;
    this.missedCheckpointWarn = false;
    this.playerRank = 8;

    // Hide freeroam start zones & suspend ambient highway traffic during the race
    for (const z of this.startZones) {
      if (z.group) z.group.visible = false;
    }
    if (this.trafficSystem && typeof this.trafficSystem.setSuspendedForRace === 'function') {
      this.trafficSystem.setSuspendedForRace(true);
    }
    if (this.worldMap && typeof this.worldMap.clearGpsWaypoint === 'function') {
      this.worldMap.clearGpsWaypoint();
    }

    // Match AI car selection & performance class to the player's currently equipped garage car
    const playerCarIdx = this.getActiveCarIndex();
    const playerSpec = this.carRoster[playerCarIdx] || this.carRoster[0];
    const playerTopSpeedMs = playerSpec?.stats?.maxForwardSpeed || 52.0;
    const playerEngineForce = playerSpec?.stats?.maxEngineForce || 9800;
    const playerRating = playerSpec?.stats?.speedRating || 82;

    this._buildRacingSpline(race, playerTopSpeedMs * 1.0);

    // Pick 7 garage rival specs cycling through closest speedRating cars to the player's class
    const candidateSpecs = [...this.carRoster].sort(
      (a, b) => Math.abs((a.stats?.speedRating || 80) - playerRating) - Math.abs((b.stats?.speedRating || 80) - playerRating)
    );
    const numRivals = 7;
    const rivalSpecs = [];
    for (let i = 0; i < numRivals; i++) {
      rivalSpecs.push(candidateSpecs[i % Math.max(1, candidateSpecs.length)] || playerSpec);
    }

    // Staggered 2x4 Starting Grid (8 cars total: 7 AI rivals P1..P7 + Player P8)
    // Walks backward along the actual road spline so rear grid cars ALWAYS sit squarely on asphalt!
    const cp0 = race.checkpoints[0];
    const sampleRoadY = (wx, wz, fallbackY) => this._raycastRoadY(wx, wz, fallbackY);

    const sampleGridSlot = (backMeters, latOffset) => {
      const sp = this.spline;
      const sn = sp.length;
      if (this.isCircuit && sn >= 2) {
        let idx = 0;
        let rem = backMeters;
        let guard = 0;
        while (rem > 0 && guard < sn) {
          const prevIdx = (idx - 1 + sn) % sn;
          const a = sp[prevIdx];
          const b = sp[idx];
          const segLen = Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z));
          if (rem <= segLen) {
            const fracFromB = rem / segLen;
            const cx = b.x + (a.x - b.x) * fracFromB;
            const cz = b.z + (a.z - b.z) * fracFromB;
            const cy = b.y + (a.y - b.y) * fracFromB;
            const fx = a.fwdX;
            const fz = a.fwdZ;
            const rx = -fz;
            const rz = fx;
            return {
              x: cx + rx * latOffset,
              y: cy,
              z: cz + rz * latOffset,
              yaw: Math.atan2(fx, fz),
              splineIdx: prevIdx,
            };
          }
          rem -= segLen;
          idx = prevIdx;
          guard++;
        }
      }
      // Sprint fallback: extrapolate cleanly behind Checkpoint 0
      const fx = cp0.fwdX;
      const fz = cp0.fwdZ;
      const rx = -fz;
      const rz = fx;
      return {
        x: cp0.x - fx * backMeters + rx * latOffset,
        y: cp0.y,
        z: cp0.z - fz * backMeters + rz * latOffset,
        yaw: Math.atan2(fx, fz),
        splineIdx: 0,
      };
    };

    const gridSlots = [
      { back: 5.5,  lat: -2.15 }, // P1
      { back: 9.5,  lat:  2.15 }, // P2
      { back: 14.0, lat: -2.15 }, // P3
      { back: 18.0, lat:  2.15 }, // P4
      { back: 22.5, lat: -2.15 }, // P5
      { back: 26.5, lat:  2.15 }, // P6
      { back: 31.0, lat: -2.15 }, // P7
      { back: 35.0, lat:  2.15 }, // P8 (Player)
    ];

    // Place Player Car in P8 on the starting grid
    const pSlot = gridSlots[numRivals];
    const pGrid = sampleGridSlot(pSlot.back, pSlot.lat);
    const py = sampleRoadY(pGrid.x, pGrid.z, pGrid.y) + (this.vehicle.chassisLocalOffset?.y || 0.55) + 0.25;
    this.vehicle.reset(new THREE.Vector3(pGrid.x, py, pGrid.z), pGrid.yaw, 0);
    this.playerPrevPos.set(pGrid.x, py, pGrid.z);
    this.playerSplineIdx = pGrid.splineIdx;
    this.playerTotalProgressM = -pSlot.back;

    // Spawn the 7 Garage AI Rivals in P1..P7 with unique randomized paint colors (never copying player's paint!)
    const basePaces = [0.988, 0.978, 0.968, 0.958, 0.948, 0.938, 0.926];
    const prefLanes = [-1.85, 1.85, -0.75, 0.75, -1.55, 1.55, 0.0];
    const usedPrimaryColors = new Set();
    const playerSavedPaint = playerSpec ? getSavedCarPaint(playerSpec.id) : null;
    if (playerSavedPaint && playerSavedPaint.primary) {
      usedPrimaryColors.add(playerSavedPaint.primary.toLowerCase());
    }

    for (let i = 0; i < numRivals; i++) {
      const rSpec = rivalSpecs[i];
      const slot = gridSlots[i];
      const rGrid = sampleGridSlot(slot.back, slot.lat);
      const brakeUniform = { value: 1.0 };
      const { parts, clonedMaterials, bounds } = await this.createAICarParts(rSpec.url, brakeUniform, null);

      // If race was cancelled while awaiting GLB clone, abort cleanly
      if (this.state === 'IDLE') return;

      const rivalVehicle = new RaycastVehicleController(this.RAPIER, this.world, parts, {
        rootName: `RaceRival_${rSpec.id}_${i}`,
        carBounds: bounds,
        mass: rSpec.stats?.mass || 1400,
        maxEngineForce: playerEngineForce * (0.992 - i * 0.010),
        maxForwardSpeed: playerTopSpeedMs * (0.988 - i * 0.010),
        maxReverseForce: 5200,
        maxBrakeForce: 17500,
        handbrakeForce: 6500,
        maxSteerAngle: 0.60,
        highSpeedSteerFactor: 0.0080,
        steerSpeed: 14.5,
        frontLateralGrip: 3.75,
        rearLateralGrip: 3.65,
        yawAssistTorque: 4000,
        downforceCoeff: 0.55,
        isTraffic: true,
        collisionGroups: AI_RACE_COLLISION_GROUPS,
      });

      // Apply unique randomized paint (body + contrasting stripes on 2-color cars)
      const rivalPaint = generateRandomCarPaint(rSpec.id, usedPrimaryColors);
      if (rivalPaint.primary) usedPrimaryColors.add(rivalPaint.primary.toLowerCase());
      applyPaintToCarRoot(rivalVehicle.rootGroup, rSpec.id, rivalPaint);

      const ry = sampleRoadY(rGrid.x, rGrid.z, rGrid.y) + rivalVehicle.chassisLocalOffset.y + 0.16;
      rivalVehicle.reset(new THREE.Vector3(rGrid.x, ry, rGrid.z), rGrid.yaw, 0);
      this.scene.add(rivalVehicle.rootGroup);

      const driverName = RIVAL_DRIVER_NAMES[i % RIVAL_DRIVER_NAMES.length];
      let nameplateEl = null;
      if (this.nameplatesContainer) {
        nameplateEl = document.createElement('div');
        nameplateEl.className = 'remote-nameplate';
        nameplateEl.style.display = 'none';
        const pill = document.createElement('div');
        pill.className = 'remote-nameplate-pill';
        pill.textContent = driverName;
        const arrow = document.createElement('div');
        arrow.className = 'remote-nameplate-arrow';
        nameplateEl.appendChild(pill);
        nameplateEl.appendChild(arrow);
        this.nameplatesContainer.appendChild(nameplateEl);
      }

      this.rivals.push({
        id: i + 1,
        driverName,
        nameplateEl,
        carName: rSpec.name,
        carSpec: rSpec,
        vehicle: rivalVehicle,
        brakeUniform,
        clonedMaterials,
        basePace: basePaces[i],
        preferredLane: prefLanes[i],
        smoothLaneOffset: slot.lat,
        smoothSteer: 0,
        splineIdx: rGrid.splineIdx,
        maxSplineIdxThisLap: 0,
        lap: 0,
        nextCp: 1,
        totalProgressM: -slot.back,
        stuckTimer: 0,
        finished: false,
        finishTimeSec: null,
        input: {
          forward: false,
          backward: false,
          left: false,
          right: false,
          handbrake: true,
          steerAnalog: 0,
          throttleAnalog: 0,
          brakeAnalog: 1.0,
        },
      });
    }

    // Position the Finish Line Gantry at the finish gate (hidden until the end of the race)
    if (this.finishGantryGroup) {
      const finishCp = this.isCircuit
        ? race.checkpoints[0]
        : race.checkpoints[race.checkpoints.length - 1];
      if (finishCp) {
        this.finishGantryGroup.position.set(finishCp.x, finishCp.y, finishCp.z);
        this.finishGantryGroup.rotation.y = Math.atan2(finishCp.fwdX, finishCp.fwdZ);
      }
      this.finishGantryGroup.visible = false;
    }

    // Position 3D Checkpoint Gate Pair at Checkpoint 1 & Checkpoint 2
    this._sync3DCheckpointGatePositions();

    // Show Active Race HUD & Countdown Banner
    if (this.hudEl) this.hudEl.classList.remove('hidden');
    if (this.hudTrackNameEl) this.hudTrackNameEl.textContent = race.name.toUpperCase();
    if (this.countdownEl) this.countdownEl.classList.remove('hidden');
    if (this.missedCpBannerEl) this.missedCpBannerEl.classList.add('hidden');
  }

  stopRaceToFreeroam() {
    this.state = 'IDLE';
    this.activeRace = null;
    this._cleanupRivals();

    if (this.activeGate && this.activeGate.group) this.activeGate.group.visible = false;
    if (this.previewGate && this.previewGate.group) this.previewGate.group.visible = false;
    if (this.finishGantryGroup) this.finishGantryGroup.visible = false;
    if (this.hudEl) this.hudEl.classList.add('hidden');
    if (this.countdownEl) this.countdownEl.classList.add('hidden');
    if (this.missedCpBannerEl) this.missedCpBannerEl.classList.add('hidden');
    this._hideResultsModal();

    // Restore 3D Freeroam Start Zones & ambient traffic
    for (const z of this.startZones) {
      if (z.group) z.group.visible = true;
    }
    if (this.trafficSystem && typeof this.trafficSystem.setSuspendedForRace === 'function') {
      this.trafficSystem.setSuspendedForRace(false);
    }
    if (this.gpsNav && typeof this.gpsNav.setRaceOverridePath === 'function') {
      this.gpsNav.setRaceOverridePath(null);
    }
  }

  _cleanupRivals() {
    for (const r of this.rivals) {
      if (r.vehicle && r.vehicle.rigidBody && this.world) {
        try {
          this.world.removeRigidBody(r.vehicle.rigidBody);
        } catch (_) {}
      }
      if (r.vehicle && r.vehicle.rootGroup) {
        disposeCarPaintTextures(r.vehicle.rootGroup);
        if (r.vehicle.rootGroup.parent) {
          r.vehicle.rootGroup.parent.remove(r.vehicle.rootGroup);
        }
      }
      if (r.nameplateEl && r.nameplateEl.parentNode) {
        r.nameplateEl.parentNode.removeChild(r.nameplateEl);
      }
      if (r.clonedMaterials) {
        for (const m of r.clonedMaterials) m.dispose();
      }
    }
    this.rivals = [];
  }

  _getCheckpointByIndex(cpIdx) {
    if (!this.activeRace || !this.activeRace.checkpoints) return null;
    const cps = this.activeRace.checkpoints;
    return cps[(cpIdx + cps.length) % cps.length];
  }

  _sync3DCheckpointGatePositions() {
    if (this.state !== 'COUNTDOWN' && this.state !== 'RACING') return;
    const cps = this.activeRace?.checkpoints;
    if (!cps || !cps.length) return;

    const cpCur = cps[this.playerNextCp % cps.length];
    if (cpCur && this.activeGate) {
      this.activeGate.group.visible = true;
      this.activeGate.group.position.set(cpCur.x, cpCur.y, cpCur.z);
      this.activeGate.group.rotation.y = Math.atan2(cpCur.fwdX, cpCur.fwdZ);
    }

    // Determine preview checkpoint after current
    let hasPreview = true;
    let previewIdx = (this.playerNextCp + 1) % cps.length;
    if (!this.isCircuit && this.playerNextCp >= cps.length - 1) {
      hasPreview = false;
    } else if (this.isCircuit && this.playerLap >= this.totalLaps - 1 && this.playerNextCp === 0) {
      hasPreview = false;
    }

    if (hasPreview && this.previewGate) {
      const cpNext = cps[previewIdx];
      this.previewGate.group.visible = true;
      this.previewGate.group.position.set(cpNext.x, cpNext.y, cpNext.z);
      this.previewGate.group.rotation.y = Math.atan2(cpNext.fwdX, cpNext.fwdZ);
    } else if (this.previewGate) {
      this.previewGate.group.visible = false;
    }

    // Only reveal the 3D Finish Line Gantry when approaching the end of the race
    if (this.finishGantryGroup) {
      const approachingFinish = this.isCircuit
        ? (this.playerLap >= this.totalLaps - 1 && (this.playerNextCp === 0 || this.playerNextCp >= cps.length - 3))
        : (this.playerNextCp >= cps.length - 3);
      this.finishGantryGroup.visible = approachingFinish;
    }
  }

  /**
   * Resets the player car onto their last cleared checkpoint facing the track direction
   * when pressing [R] during an active race. Returns true if handled by RaceSystem.
   */
  handlePlayerReset() {
    if (this.state !== 'RACING' && this.state !== 'COUNTDOWN') return false;
    if (this.state === 'COUNTDOWN') return true; // Ignore R during 3-2-1 countdown

    const cp = this._getCheckpointByIndex(this.playerLastClearedCp);
    if (!cp || !this.vehicle) return false;
    const yaw = Math.atan2(cp.fwdX, cp.fwdZ);
    this.vehicle.reset(new THREE.Vector3(cp.x, cp.y + 1.15, cp.z), yaw, 0);
    this.playerPrevPos.set(cp.x, cp.y + 1.15, cp.z);
    this.missedCheckpointWarn = false;
    if (this.missedCpBannerEl) this.missedCpBannerEl.classList.add('hidden');
    return true;
  }

  /**
   * Millimeter-accurate continuous spline segment projection for race placement tracking.
   * Used identically by BOTH the player and all AI rivals so positions never jitter or desync on lap wraps.
   */
  _trackContinuousSplineProgress(posX, posZ, prevIdx, prevMaxIdx, prevLap, searchBack = 6, searchFwd = 24) {
    const spline = this.spline;
    const n = spline.length;
    if (n < 2) {
      return { bestIdx: prevIdx, maxIdx: prevMaxIdx, lap: prevLap, totalProgressM: 0, bestD2: 0 };
    }

    let bestIdx = prevIdx;
    let bestT = 0;
    let bestSegLen = 0;
    let bestD2 = Infinity;

    for (let offset = -searchBack; offset <= searchFwd; offset++) {
      let candIdx = prevIdx + offset;
      if (this.isCircuit) {
        candIdx = ((candIdx % n) + n) % n;
      } else {
        if (candIdx < 0 || candIdx >= n - 1) continue;
      }
      const nextIdx = this.isCircuit ? (candIdx + 1) % n : candIdx + 1;
      const a = spline[candIdx];
      const b = spline[nextIdx];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const abLenSq = abx * abx + abz * abz;
      const t = abLenSq > 1e-6
        ? clamp(((posX - a.x) * abx + (posZ - a.z) * abz) / abLenSq, 0, 1)
        : 0;
      const qx = a.x + t * abx;
      const qz = a.z + t * abz;
      const dx = posX - qx;
      const dz = posZ - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = candIdx;
        bestT = t;
        bestSegLen = Math.sqrt(abLenSq);
      }
    }

    let lap = prevLap;
    let maxIdx = prevMaxIdx;
    if (this.isCircuit && prevMaxIdx > n * 0.65 && bestIdx < n * 0.25) {
      lap++;
      maxIdx = bestIdx;
    }

    const behindStart = this.isCircuit && lap === 0 && maxIdx < n * 0.25 && bestIdx > n * 0.70;
    if (!behindStart && bestIdx > maxIdx) {
      maxIdx = bestIdx;
    }

    const rawLapDist = spline[bestIdx].cumDist + bestT * bestSegLen;
    const lapDist = behindStart ? (rawLapDist - this.splineTotalLength) : rawLapDist;
    const totalProgressM = lap * this.splineTotalLength + lapDist;

    return { bestIdx, maxIdx, lap, totalProgressM, bestD2 };
  }

  /**
   * Physics sub-step update for AI Rivals & Countdown hold.
   */
  updatePhysicsStep(subDt) {
    if (this.state !== 'COUNTDOWN' && this.state !== 'RACING' && this.state !== 'FINISHED') return;

    // During 3-2-1 countdown, hold player & AI cars stationary on the starting grid
    if (this.state === 'COUNTDOWN') {
      if (this.input) {
        this.input.forward = false;
        this.input.backward = false;
        this.input.handbrake = true;
      }
      for (const r of this.rivals) {
        r.input.throttleAnalog = 0;
        r.input.brakeAnalog = 1.0;
        r.input.handbrake = true;
        r.input.steerAnalog = 0;
        r.vehicle.updatePhysicsStep(subDt, r.input);
      }
      return;
    }

    // Active Racing Physics Step for each Pro-Cornering Garage Rival
    const playerBody = this.vehicle?.rigidBody;
    const playerPos = playerBody ? playerBody.translation() : null;
    const spline = this.spline;
    const n = spline.length;
    if (n < 2) return;

    for (let rIdx = 0; rIdx < this.rivals.length; rIdx++) {
      const rival = this.rivals[rIdx];
      const rv = rival.vehicle;
      const body = rv?.rigidBody;
      if (!body) continue;

      const pos = body.translation();
      const rot = body.rotation();

      // 1. Advance continuous spline projection around rival's current position
      const prog = this._trackContinuousSplineProgress(
        pos.x,
        pos.z,
        rival.splineIdx,
        rival.maxSplineIdxThisLap,
        rival.lap,
        6,
        24
      );
      const bestIdx = prog.bestIdx;
      const bestD2 = prog.bestD2;
      rival.splineIdx = bestIdx;
      rival.maxSplineIdxThisLap = prog.maxIdx;
      rival.lap = prog.lap;
      rival.totalProgressM = prog.totalProgressM;

      if (this.isCircuit && rival.lap >= this.totalLaps && !rival.finished) {
        rival.finished = true;
        rival.finishTimeSec = this.raceElapsedSec;
        this._resultsDirty = true;
      } else if (!this.isCircuit && bestIdx >= n - 2 && !rival.finished) {
        rival.finished = true;
        rival.finishTimeSec = this.raceElapsedSec;
        this._resultsDirty = true;
      }
      const curNode = spline[bestIdx];

      // 2. Compute clean racing line + true road-relative player & rival avoidance (no pileups!)
      const lookCurveIdx = this.isCircuit ? (bestIdx + 4) % n : Math.min(n - 1, bestIdx + 4);
      const upcomingNode = spline[lookCurveIdx];
      let targetLane = rival.preferredLane;
      if (upcomingNode.curvature > 0.012) {
        // Gently bias each rival's own lane toward the inside apex (keeps multi-car packs side-by-side)
        targetLane = clamp(rival.preferredLane - upcomingNode.signedTurn * 0.65, -2.55, 2.55);
      }

      const myRoadLat = (pos.x - curNode.x) * curNode.rightX + (pos.z - curNode.z) * curNode.rightZ;
      let frontYield = 1.0;

      // Safe Player Avoidance: never crowd or punt the player off the road!
      if (playerPos) {
        const dxP = playerPos.x - pos.x;
        const dzP = playerPos.z - pos.z;
        if (dxP * dxP + dzP * dzP < 289.0) { // < 17m
          const longP = dxP * curNode.fwdX + dzP * curNode.fwdZ;
          const playerRoadLat = (playerPos.x - curNode.x) * curNode.rightX + (playerPos.z - curNode.z) * curNode.rightZ;
          if (longP > -4.5 && longP < 14.5 && Math.abs(playerRoadLat - targetLane) < 2.6) {
            // Pick the wider open side around the player
            targetLane = playerRoadLat >= 0 ? -2.35 : 2.35;
          }
          if (longP > 0.5 && longP < 11.0 && Math.abs(playerRoadLat - myRoadLat) < 2.35) {
            frontYield = Math.min(frontYield, clamp((longP - 3.2) / 7.8, 0.25, 1.0));
          }
        }
      }

      // Rival-to-rival clean passing & rear-end prevention
      for (let oIdx = 0; oIdx < this.rivals.length; oIdx++) {
        if (oIdx === rIdx) continue;
        const otherBody = this.rivals[oIdx].vehicle?.rigidBody;
        if (!otherBody) continue;
        const oPos = otherBody.translation();
        const dxO = oPos.x - pos.x;
        const dzO = oPos.z - pos.z;
        if (dxO * dxO + dzO * dzO < 225.0) { // < 15m
          const longO = dxO * curNode.fwdX + dzO * curNode.fwdZ;
          const otherRoadLat = (oPos.x - curNode.x) * curNode.rightX + (oPos.z - curNode.z) * curNode.rightZ;
          if (longO > -4.5 && longO < 12.5 && Math.abs(otherRoadLat - targetLane) < 2.45) {
            targetLane = otherRoadLat >= 0 ? clamp(otherRoadLat - 2.6, -2.75, 2.75) : clamp(otherRoadLat + 2.6, -2.75, 2.75);
          }
          if (longO > 0.5 && longO < 10.5 && Math.abs(otherRoadLat - myRoadLat) < 2.25) {
            frontYield = Math.min(frontYield, clamp((longO - 3.0) / 7.5, 0.30, 1.0));
          }
        }
      }

      targetLane = clamp(targetLane, -2.75, 2.75);
      rival.smoothLaneOffset += (targetLane - rival.smoothLaneOffset) * (1.0 - Math.exp(-4.2 * subDt));

      // 3. Dual-Lookahead Pure-Pursuit Steering Target
      const speedAbs = Math.abs(rv.forwardSpeed);
      const lookDist = clamp(12.5 + speedAbs * 0.46, 12.5, 36.0);
      let lookIdx = bestIdx;
      let accD = 0;
      for (let step = 0; step < 18; step++) {
        const nxtIdx = this.isCircuit ? (lookIdx + 1) % n : Math.min(n - 1, lookIdx + 1);
        const a = spline[lookIdx];
        const b = spline[nxtIdx];
        accD += Math.hypot(b.x - a.x, b.z - a.z);
        lookIdx = nxtIdx;
        if (accD >= lookDist) break;
      }
      const lookNode = spline[lookIdx];
      const aimX = lookNode.x + lookNode.rightX * rival.smoothLaneOffset;
      const aimZ = lookNode.z + lookNode.rightZ * rival.smoothLaneOffset;

      // Compute vehicle forward (+Z) & left (+X) vectors from Rapier quaternion
      const qx = rot.x, qy = rot.y, qz = rot.z, qw = rot.w;
      const carFwdX = 2 * (qx * qz + qw * qy);
      const carFwdZ = 1 - 2 * (qx * qx + qy * qy);
      const carLeftX = 1 - 2 * (qy * qy + qz * qz);
      const carLeftZ = 2 * (qx * qz - qw * qy);

      const toAimX = aimX - pos.x;
      const toAimZ = aimZ - pos.z;
      const toAimLen = Math.hypot(toAimX, toAimZ) || 1;
      const localLeft = toAimX * carLeftX + toAimZ * carLeftZ;
      const localFwd = toAimX * carFwdX + toAimZ * carFwdZ;

      // Exact Pure-Pursuit bicycle model (positive steerAnalog = LEFT in RaycastVehicleController)
      const wheelbase = 2.65;
      const ld = Math.max(6.5, toAimLen);
      const alpha = Math.atan2(localLeft, localFwd);
      let steerRad = Math.atan2(2.0 * wheelbase * Math.sin(alpha), ld);
      if (localFwd < -0.1) {
        steerRad = (alpha >= 0 ? 1 : -1) * rv.params.maxSteerAngle;
      }

      const speedFactor = 1 / (1 + speedAbs * rv.params.highSpeedSteerFactor);
      const effMaxSteer = Math.max(0.18, rv.params.maxSteerAngle * speedFactor);
      const rawSteer = clamp(steerRad / effMaxSteer, -1.0, 1.0);
      const steerLerp = 1.0 - Math.exp(-16.0 * subDt);
      rival.smoothSteer += (rawSteer - rival.smoothSteer) * steerLerp;

      // 4. Honest Racing Pace (never exceeds car's real top speed; only gently eases if far ahead)
      const progressDelta = rival.totalProgressM - this.playerTotalProgressM;
      let rubberband = 1.0;
      if (progressDelta > 45.0) {
        rubberband = clamp(1.0 - (progressDelta - 45.0) * 0.0014, 0.93, 1.0);
      }

      // Look ahead 1-2 nodes for braking speed envelope
      const brakePreviewIdx = this.isCircuit ? (bestIdx + 2) % n : Math.min(n - 1, bestIdx + 2);
      const vEnvelope = Math.min(curNode.vMax, spline[brakePreviewIdx].vMax);
      const desiredSpeed = vEnvelope * rival.basePace * rubberband * frontYield;

      const speedErr = desiredSpeed - rv.forwardSpeed;
      const inp = rival.input;
      inp.handbrake = false;
      inp.steerAnalog = rival.smoothSteer;

      if (speedErr > 0.15) {
        // Decisive full-throttle acceleration on straights & fast corner exits
        const cornerThrottleCap = 1.0 - Math.abs(rival.smoothSteer) * 0.12;
        inp.throttleAnalog = clamp(0.55 + speedErr * 0.55, 0.55, cornerThrottleCap);
        inp.brakeAnalog = 0;
        rival.brakeUniform.value += (0.0 - rival.brakeUniform.value) * 0.25;
      } else if (speedErr < -1.8) {
        // Sharp late braking into tight corners
        inp.throttleAnalog = 0;
        inp.brakeAnalog = clamp((-speedErr - 1.8) * 0.34, 0.16, 0.95);
        rival.brakeUniform.value += (1.0 - rival.brakeUniform.value) * 0.35;
      } else {
        inp.throttleAnalog = 0.65;
        inp.brakeAnalog = 0;
        rival.brakeUniform.value += (0.0 - rival.brakeUniform.value) * 0.25;
      }

      // 5. Anti-stuck & off-track recovery if an AI rival ever gets wedged or knocked far off-track
      const offTrack = bestD2 > 484.0; // > 22m from road centerline
      if ((speedAbs < 2.2 || offTrack) && this.raceElapsedSec > 2.5 && !rival.finished) {
        rival.stuckTimer += subDt;
        if (rival.stuckTimer > 1.85) {
          rival.stuckTimer = 0;
          const recNode = spline[bestIdx];
          const recYaw = Math.atan2(recNode.fwdX, recNode.fwdZ);
          const recX = recNode.x + recNode.rightX * rival.preferredLane;
          const recZ = recNode.z + recNode.rightZ * rival.preferredLane;
          const recY = this._raycastRoadY(recX, recZ, recNode.y) + rv.chassisLocalOffset.y + 0.25;
          rv.reset(new THREE.Vector3(recX, recY, recZ), recYaw, 0);
          rv.rigidBody.setLinvel({ x: recNode.fwdX * 16.0, y: 0, z: recNode.fwdZ * 16.0 }, true);
        }
      } else {
        rival.stuckTimer = Math.max(0, rival.stuckTimer - subDt * 2.0);
      }

      rv.updatePhysicsStep(subDt, inp);
    }
  }

  /**
   * Gentle overlap resolution between race rivals and player car.
   */
  postPhysicsStep() {
    if (this.state !== 'RACING' || !this.vehicle?.rigidBody) return;
    const allBodies = [this.vehicle.rigidBody, ...this.rivals.map((r) => r.vehicle?.rigidBody).filter(Boolean)];
    for (let i = 0; i < allBodies.length; i++) {
      for (let j = i + 1; j < allBodies.length; j++) {
        const bA = allBodies[i];
        const bB = allBodies[j];
        const pA = bA.translation();
        const pB = bB.translation();
        const dx = pA.x - pB.x;
        const dz = pA.z - pB.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.01 && dist < 1.72) {
          const nx = dx / dist;
          const nz = dz / dist;
          const push = Math.min(0.16, (1.75 - dist) * 0.30);
          bA.setTranslation({ x: pA.x + nx * push, y: pA.y, z: pA.z + nz * push }, true);
          bB.setTranslation({ x: pB.x - nx * push, y: pB.y, z: pB.z - nz * push }, true);
        }
      }
    }
  }

  _updateRivalNameplate(rival, hideAll = false) {
    const el = rival?.nameplateEl;
    if (!el) return;
    if (hideAll || !this.camera || !rival.vehicle?.rootGroup) {
      el.style.display = 'none';
      return;
    }

    const pos = rival.vehicle.rootGroup.position;
    this._projVec.set(pos.x, pos.y + 1.95, pos.z);
    const dist = this.camera.position.distanceTo(this._projVec);
    if (dist > 200) {
      el.style.display = 'none';
      return;
    }

    this._projVec.project(this.camera);
    if (this._projVec.z > 1 || this._projVec.z < -1) {
      el.style.display = 'none';
      return;
    }

    const sx = (this._projVec.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-this._projVec.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < -120 || sx > window.innerWidth + 120 || sy < -60 || sy > window.innerHeight + 60) {
      el.style.display = 'none';
      return;
    }

    const opacity = dist > 150 ? clamp(1 - (dist - 150) / 50, 0, 1) : 1;
    const scale = clamp(1.08 - dist * 0.0022, 0.72, 1.0);
    el.style.display = 'block';
    el.style.opacity = opacity.toFixed(2);
    el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
  }

  /**
   * Frame update: animates 3D start zone beacons, checks start-zone dwell in freeroam,
   * runs 3-2-1-GO countdown, enforces sequential anti-skip checkpoints, and updates Race HUD.
   */
  updateFrame(dt, isPaused = false, isTitleScreenOpen = false) {
    const nowSec = performance.now() * 0.001;

    // 1. Animate 3D Freeroam Start Zone Rings & Bobbing Pixel Race Flags
    if (this.state === 'IDLE') {
      for (let i = 0; i < this.startZones.length; i++) {
        const z = this.startZones[i];
        if (!z.group || !z.group.visible) continue;
        if (z.flagBillboard) {
          z.flagBillboard.position.y = 3.85 + Math.sin(nowSec * 2.4 + i) * 0.25;
          z.flagBillboard.rotation.y = Math.sin(nowSec * 1.4 + i) * 0.25;
        }
        if (z.ringMesh) {
          const pulse = 1.0 + Math.sin(nowSec * 3.2 + i) * 0.04;
          z.ringMesh.scale.set(pulse, pulse, 1);
        }
      }

      // Check if player car is inside any Race Start Zone circle (matches 5.55m visual ring)
      if (isPaused || isTitleScreenOpen || this.isEntryModalOpen || !this.vehicle?.rigidBody) {
        if (this.dwellBannerEl && !this.isEntryModalOpen) {
          this.dwellBannerEl.classList.add('hidden');
        }
        return;
      }

      const p = this.vehicle.rigidBody.translation();
      let insideZone = null;
      for (const z of this.startZones) {
        const d = Math.hypot(p.x - z.x, p.z - z.z);
        if (d < 5.8 && Math.abs(p.y - z.y) < 4.5) {
          insideZone = z.race;
          break;
        }
      }

      // Re-arm dismissed zone once player drives > 8.5m away from the circle
      if (this.dismissedRaceId) {
        const dismissedZone = this.startZones.find((z) => z.race.id === this.dismissedRaceId);
        if (!dismissedZone || Math.hypot(p.x - dismissedZone.x, p.z - dismissedZone.z) > 8.5) {
          this.dismissedRaceId = null;
        }
      }

      if (insideZone && insideZone.id !== this.dismissedRaceId && this.vehicle.speedKmh < 55) {
        if (this.hoveredZoneRace !== insideZone) {
          this.hoveredZoneRace = insideZone;
          this.zoneDwellSec = 0;
        }
        this.zoneDwellSec += dt;
        const pct = clamp((this.zoneDwellSec / this.zoneDwellRequiredSec) * 100, 0, 100);
        if (this.dwellBannerEl) this.dwellBannerEl.classList.remove('hidden');
        if (this.dwellTitleEl) {
          this.dwellTitleEl.textContent = `ENTERING ${insideZone.name.toUpperCase()}...`;
        }
        if (this.dwellFillEl) {
          this.dwellFillEl.style.width = `${pct.toFixed(1)}%`;
        }
        if (this.zoneDwellSec >= this.zoneDwellRequiredSec) {
          this.openEntryModal(insideZone);
        }
      } else {
        this.hoveredZoneRace = null;
        this.zoneDwellSec = 0;
        if (this.dwellBannerEl) this.dwellBannerEl.classList.add('hidden');
      }
      return;
    }

    // Sync AI Rival visuals & floating multiplayer-style nameplates every frame
    for (const r of this.rivals) {
      if (r.vehicle) r.vehicle.syncVisuals();
      this._updateRivalNameplate(r, isPaused || isTitleScreenOpen);
    }

    // Animate active checkpoint gate floating chevron arrow & finish gantry flag
    if (this.activeGate?.arrowMesh) {
      this.activeGate.arrowMesh.position.y = 5.4 + Math.sin(nowSec * 4.2) * 0.25;
    }
    if (this.finishGantryGroup?.visible && this.finishGantryFlag) {
      this.finishGantryFlag.position.y = 7.65 + Math.sin(nowSec * 2.4) * 0.25;
      this.finishGantryFlag.rotation.y = Math.sin(nowSec * 1.4) * 0.25;
    }

    if (isPaused) return;

    // 2. Handle 3-2-1-GO Countdown
    if (this.state === 'COUNTDOWN') {
      this.countdownSec -= dt;
      if (this.countdownTextEl) {
        const c = Math.ceil(this.countdownSec - 0.4);
        this.countdownTextEl.textContent = c > 0 ? String(c) : 'GO!';
        this.countdownTextEl.classList.toggle('go', c <= 0);
      }
      if (this.countdownSec <= 0.4) {
        this.state = 'RACING';
        if (this.input) this.input.handbrake = false;
        setTimeout(() => {
          if (this.countdownEl) this.countdownEl.classList.add('hidden');
        }, 650);
      }
      this._updateHudTelemetry();
      return;
    }

    if (this.state === 'FINISHED') {
      const anyRacing = this.rivals.some((r) => !r.finished);
      if (anyRacing) {
        this.raceElapsedSec += dt;
        this._resultsRefreshAccum = (this._resultsRefreshAccum || 0) + dt;
        if (this._resultsDirty || this._resultsRefreshAccum >= 0.25) {
          this._resultsDirty = false;
          this._resultsRefreshAccum = 0;
          this._renderResultsStandings();
        }
      } else if (this._resultsDirty) {
        this._resultsDirty = false;
        this._renderResultsStandings();
      }
      return;
    }

    if (this.state !== 'RACING') return;

    this.raceElapsedSec += dt;

    // 3. Player Spline Progress & Sequential Anti-Skip Checkpoint Detection
    const pBody = this.vehicle?.rigidBody;
    if (!pBody || !this.activeRace) return;
    const pNow = pBody.translation();

    // Update player's continuous spline progress (exact same segment-projection math as AI rivals!)
    if (this.spline.length > 1) {
      const n = this.spline.length;
      const prog = this._trackContinuousSplineProgress(
        pNow.x,
        pNow.z,
        this.playerSplineIdx,
        this.playerMaxSplineIdxThisLap,
        this.playerProgressLap,
        8,
        26
      );
      const bestIdx = prog.bestIdx;
      this.playerSplineIdx = bestIdx;
      this.playerMaxSplineIdxThisLap = prog.maxIdx;
      this.playerProgressLap = prog.lap;
      this.playerTotalProgressM = prog.totalProgressM;

      // Feed upcoming ~320m of race spline into GPS 3D road chevrons & HUD circular mini-map
      if (this.gpsNav && typeof this.gpsNav.setRaceOverridePath === 'function') {
        const upcoming = [];
        const steps = Math.min(34, n);
        for (let k = 0; k < steps; k++) {
          let sIdx = bestIdx + k;
          if (this.isCircuit) {
            sIdx = (sIdx % n + n) % n;
          } else if (sIdx >= n) {
            break;
          }
          const sp = this.spline[sIdx];
          upcoming.push({ x: sp.x, y: sp.y, z: sp.z });
        }
        this.gpsNav.setRaceOverridePath(upcoming);
      }
    }

    // Sequential Anti-Skip Checkpoint Crossing Test
    const cps = this.activeRace.checkpoints;
    const targetCp = cps[this.playerNextCp % cps.length];
    if (targetCp) {
      const dx = pNow.x - targetCp.x;
      const dz = pNow.z - targetCp.z;
      const distToGate = Math.hypot(dx, dz);
      const longDist = dx * targetCp.fwdX + dz * targetCp.fwdZ;
      const latDist = Math.abs(-dx * targetCp.fwdZ + dz * targetCp.fwdX);
      const halfW = (targetCp.width || 15.0) * 0.5 + 3.2;

      // Also check if segment [playerPrevPos -> pNow] crossed the gate plane within halfW
      const prevDx = this.playerPrevPos.x - targetCp.x;
      const prevDz = this.playerPrevPos.z - targetCp.z;
      const prevLong = prevDx * targetCp.fwdX + prevDz * targetCp.fwdZ;
      const crossedPlane = prevLong <= 2.0 && longDist >= -1.5 && latDist <= halfW;
      const insideGate = distToGate <= 13.8 && latDist <= halfW;

      if (crossedPlane || insideGate) {
        this._advancePlayerCheckpoint();
      } else if (longDist > 26.0 && distToGate > 18.0) {
        // Player drove past the checkpoint plane outside the gate width (attempted shortcut!)
        this.missedCheckpointWarn = true;
        if (this.missedCpBannerEl) this.missedCpBannerEl.classList.remove('hidden');
      } else if (longDist < 12.0 && this.missedCheckpointWarn) {
        this.missedCheckpointWarn = false;
        if (this.missedCpBannerEl) this.missedCpBannerEl.classList.add('hidden');
      }
    }

    this.playerPrevPos.set(pNow.x, pNow.y, pNow.z);
    this._updateHudTelemetry();
  }

  _advancePlayerCheckpoint() {
    const cps = this.activeRace.checkpoints;
    const totalCps = cps.length;

    this.missedCheckpointWarn = false;
    if (this.missedCpBannerEl) this.missedCpBannerEl.classList.add('hidden');
    this.playerLastClearedCp = this.playerNextCp % totalCps;

    if (this.isCircuit) {
      // Circuit mode: Gate 0 is the Start/Finish line at the end of each lap
      if (this.playerNextCp === 0) {
        const lapTime = this.raceElapsedSec - this.currentLapStartSec;
        if (lapTime > 3.0 && lapTime < this.bestLapSec) {
          this.bestLapSec = lapTime;
        }
        this.currentLapStartSec = this.raceElapsedSec;
        this.playerLap++;
        if (this.playerLap >= this.totalLaps) {
          this._finishRace();
          return;
        }
        this.playerNextCp = 1;
      } else {
        this.playerNextCp++;
        if (this.playerNextCp >= totalCps) {
          this.playerNextCp = 0; // Next gate is Start/Finish line!
        }
      }
    } else {
      // Sprint mode: finishes when clearing the final checkpoint (totalCps - 1)
      if (this.playerNextCp >= totalCps - 1) {
        this.bestLapSec = this.raceElapsedSec;
        this._finishRace();
        return;
      }
      this.playerNextCp++;
    }

    this._sync3DCheckpointGatePositions();
  }

  _updateHudTelemetry() {
    if (!this.activeRace) return;
    const cps = this.activeRace.checkpoints;
    const totalCps = cps.length;

    // Compute live rank (1..4) by comparing totalProgressM
    let rank = 1;
    for (const r of this.rivals) {
      if (r.totalProgressM > this.playerTotalProgressM) rank++;
    }
    this.playerRank = rank;

    if (this.hudPosEl) {
      this.hudPosEl.textContent = ordinalSuffix(rank);
    }
    if (this.hudTotalEl) {
      this.hudTotalEl.textContent = `/${this.rivals.length + 1}`;
    }
    if (this.hudPosWrapEl) {
      this.hudPosWrapEl.classList.remove('pos-1', 'pos-2', 'pos-3', 'pos-4');
      this.hudPosWrapEl.classList.add(`pos-${Math.min(4, Math.max(1, rank))}`);
    }
    const clearedInLap = this.playerNextCp === 0 ? totalCps : Math.max(0, this.playerNextCp - 1);
    const lapPct = clamp((clearedInLap / Math.max(1, totalCps)) * 100, 0, 100);
    if (this.hudLapEl) {
      if (this.isCircuit) {
        const dispLap = Math.min(this.totalLaps, this.playerLap + 1);
        this.hudLapEl.textContent = `LAP ${dispLap} / ${this.totalLaps}`;
      } else {
        this.hudLapEl.textContent = `${Math.round(lapPct)}% SPRINT`;
      }
    }
    if (this.hudCpEl) {
      const dispGate = this.playerNextCp === 0 ? totalCps : this.playerNextCp;
      this.hudCpEl.textContent = `GATE ${dispGate} / ${totalCps}`;
    }
    if (this.hudProgFillEl) {
      this.hudProgFillEl.style.width = `${lapPct.toFixed(1)}%`;
    }
    if (this.hudTimeEl) {
      this.hudTimeEl.textContent = formatRaceTime(this.raceElapsedSec);
    }
  }

  _finishRace() {
    this.state = 'FINISHED';
    this.playerFinishTimeSec = this.raceElapsedSec;
    this._resultsDirty = false;
    this._resultsRefreshAccum = 0;

    // Record best full-race completion time (localStorage for now; DB-ready by race.id)
    if (this.activeRace && this.activeRace.id) {
      this._isNewBestTime = saveRaceBestTime(this.activeRace.id, this.playerFinishTimeSec);
      if (this.worldMap && typeof this.worldMap.refreshRaceBestTimes === 'function') {
        this.worldMap.refreshRaceBestTimes();
      }
    } else {
      this._isNewBestTime = false;
    }

    if (this.activeGate?.group) this.activeGate.group.visible = false;
    if (this.previewGate?.group) this.previewGate.group.visible = false;
    if (this.missedCpBannerEl) this.missedCpBannerEl.classList.add('hidden');
    if (this.gpsNav && typeof this.gpsNav.setRaceOverridePath === 'function') {
      this.gpsNav.setRaceOverridePath(null);
    }

    this._renderResultsStandings();

    if (this.resultsModalEl) {
      this.resultsModalEl.classList.remove('hidden');
    }
  }

  _renderResultsStandings() {
    if (!this.activeRace) return;
    const playerCar = this.carRoster[this.getActiveCarIndex()] || this.carRoster[0];
    const playerName = (localStorage.getItem('carGame_playerName') || 'YOU').toUpperCase();

    const entries = [
      {
        isPlayer: true,
        finished: true,
        driverName: playerName,
        carName: playerCar ? playerCar.name : 'GARAGE GT',
        progress: this.totalLaps * this.splineTotalLength + 50,
        timeSec: this.playerFinishTimeSec,
      },
    ];

    for (const r of this.rivals) {
      entries.push({
        isPlayer: false,
        finished: Boolean(r.finished && Number.isFinite(r.finishTimeSec)),
        driverName: r.driverName,
        carName: r.carName,
        progress: r.totalProgressM,
        timeSec: r.finished && Number.isFinite(r.finishTimeSec) ? r.finishTimeSec : null,
      });
    }

    // Finished cars first (sorted by actual finish time), then still-racing cars (sorted by live track progress)
    entries.sort((a, b) => {
      if (a.finished && b.finished) return a.timeSec - b.timeSec;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });

    const playerPlacement = entries.findIndex((e) => e.isPlayer) + 1;

    if (this.resultsBadgeEl) {
      this.resultsBadgeEl.textContent = `${ordinalSuffix(playerPlacement)} PLACE`;
    }
    if (this.resultsTitleEl) {
      this.resultsTitleEl.textContent = playerPlacement === 1
        ? 'VICTORY!'
        : (playerPlacement <= 3 ? 'PODIUM FINISH' : 'RACE COMPLETE');
    }
    if (this.resultsSubEl) {
      const bestTxt = Number.isFinite(this.bestLapSec) ? ` • BEST LAP ${formatRaceTime(this.bestLapSec)}` : '';
      this.resultsSubEl.textContent = `${this.activeRace.name.toUpperCase()} • TIME ${formatRaceTime(this.playerFinishTimeSec)}${bestTxt}`;
    }

    if (this.resultsListEl) {
      this.resultsListEl.innerHTML = '';
      entries.forEach((e, idx) => {
        const row = document.createElement('div');
        row.className = 'race-res-row' + (e.isPlayer ? ' player' : '') + (e.finished ? '' : ' racing');
        const timeLabel = e.finished ? formatRaceTime(e.timeSec) : 'RACING...';
        row.innerHTML = `
          <span class="race-res-pos">${ordinalSuffix(idx + 1)}</span>
          <div class="race-res-driver">
            <span class="race-res-name">${e.driverName}</span>
            <span class="race-res-car">${e.carName}</span>
          </div>
          <span class="race-res-time${e.finished ? '' : ' race-res-time-pending'}">${timeLabel}</span>
        `;
        this.resultsListEl.appendChild(row);
      });
    }
  }
}

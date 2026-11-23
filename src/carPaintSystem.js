import * as THREE from 'three';

const STORAGE_KEY = 'carGame_customPaints_v1';

/**
 * Exact 512x512 atlas paint rectangles per garage car.
 * Each 32px-tall strip uses 3 vertical shading bands (top 8px highlight 1.0x, middle 16px midtone 0.78x, bottom 8px shadow 0.58x),
 * keeping windows, tires, chrome rims, headlights, taillights, and dark trim 100% untouched.
 */
export const CAR_PAINT_ZONES = {
  supra: [
    { key: 'primary', label: 'BODY', defaultHex: '#f4f4f4', rects: [[29, 192, 19, 32]] },
    { key: 'secondary', label: 'STRIPES', defaultHex: '#c81010', rects: [[16, 192, 13, 32]] },
  ],
  veneno: [
    { key: 'primary', label: 'BODY', defaultHex: '#ffd31b', rects: [[208, 288, 16, 32]] },
  ],
  mustang: [
    { key: 'primary', label: 'BODY', defaultHex: '#f4f4f4', rects: [[96, 192, 9, 32], [108, 192, 20, 32]] },
    { key: 'secondary', label: 'STRIPES', defaultHex: '#173aa9', rects: [[105, 192, 3, 32]] },
  ],
  fordgt: [
    { key: 'primary', label: 'BODY', defaultHex: '#242424', rects: [[448, 128, 10, 32], [461, 128, 19, 32]] },
    { key: 'secondary', label: 'STRIPES', defaultHex: '#f4f4f4', rects: [[458, 128, 3, 32]] },
  ],
  amg: [
    { key: 'primary', label: 'BODY', defaultHex: '#ff7122', rects: [[160, 192, 16, 32]] },
  ],
  rs6: [
    { key: 'primary', label: 'BODY', defaultHex: '#ffd31b', rects: [[160, 288, 16, 32]] },
  ],
  coupe: [
    { key: 'primary', label: 'BODY', defaultHex: '#2141a9', rects: [[496, 224, 16, 32]] },
  ],
  golf: [
    { key: 'primary', label: 'BODY', defaultHex: '#f4f4f4', rects: [[48, 224, 16, 32]] },
  ],
};

export const PAINT_SWATCHES = [
  { name: 'PEARL WHITE', hex: '#f4f6f8' },
  { name: 'CHALK GREY', hex: '#a8b2be' },
  { name: 'GUNMETAL', hex: '#4b5563' },
  { name: 'OBSIDIAN', hex: '#1c2028' },
  { name: 'COOL YELLOW', hex: '#ffd54f' },
  { name: 'SOLAR GOLD', hex: '#f59e0b' },
  { name: 'TANGERINE', hex: '#ff6b2b' },
  { name: 'RACING RED', hex: '#e11d2e' },
  { name: 'CRIMSON', hex: '#881337' },
  { name: 'HOT MAGENTA', hex: '#ec4899' },
  { name: 'VIOLET', hex: '#8b5cf6' },
  { name: 'DEEP INDIGO', hex: '#312e81' },
  { name: 'COBALT BLUE', hex: '#2563eb' },
  { name: 'SKY BLUE', hex: '#38bdf8' },
  { name: 'TEAL', hex: '#14b8a6' },
  { name: 'EMERALD', hex: '#16a34a' },
  { name: 'ACID LIME', hex: '#84cc16' },
  { name: 'DESERT SAND', hex: '#d6b485' },
];

function loadAllSavedPaints() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveAllPaints(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (_) {}
}

export function getCarPaintZones(carId) {
  return CAR_PAINT_ZONES[carId] || CAR_PAINT_ZONES.supra;
}

export function getSavedCarPaint(carId) {
  const zones = getCarPaintZones(carId);
  const all = loadAllSavedPaints();
  const saved = (all && all[carId]) || {};
  const result = {};
  for (const z of zones) {
    result[z.key] = typeof saved[z.key] === 'string' ? saved[z.key] : z.defaultHex;
  }
  return result;
}

export function setSavedCarPaint(carId, zoneKey, hex) {
  const all = loadAllSavedPaints();
  if (!all[carId] || typeof all[carId] !== 'object') {
    all[carId] = {};
  }
  all[carId][zoneKey] = hex;
  saveAllPaints(all);
  return getSavedCarPaint(carId);
}

export function resetSavedCarPaint(carId) {
  const all = loadAllSavedPaints();
  delete all[carId];
  saveAllPaints(all);
  return getSavedCarPaint(carId);
}

export function hexToRgb(hex) {
  const clean = String(hex || '#ffffff').replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const n = parseInt(full, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

export function rgbToHex(r, g, b) {
  const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clampByte(r), clampByte(g), clampByte(b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}

export function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function hexToHsv(hex) {
  const { r: r255, g: g255, b: b255 } = hexToRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function shadeHex(hex, mult) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex(r * mult, g * mult, b * mult);
}

export function generateRandomCarPaint(carId, usedPrimaryHexes = new Set()) {
  const zones = getCarPaintZones(carId);
  const pool = PAINT_SWATCHES.filter((s) => !usedPrimaryHexes.has(s.hex.toLowerCase()));
  const primaryPool = pool.length > 0 ? pool : PAINT_SWATCHES;
  const primaryPick = primaryPool[Math.floor(Math.random() * primaryPool.length)];
  const result = {};
  result[zones[0].key] = primaryPick.hex;

  if (zones.length > 1) {
    // Pick a contrasting secondary/stripe color (different from primary)
    const secPool = PAINT_SWATCHES.filter((s) => s.hex.toLowerCase() !== primaryPick.hex.toLowerCase());
    const secPick = secPool[Math.floor(Math.random() * secPool.length)] || PAINT_SWATCHES[0];
    for (let i = 1; i < zones.length; i++) {
      result[zones[i].key] = secPick.hex;
    }
  }
  return result;
}

// Module-level WeakMaps keep canvas/ctx/owner references OUT of mat.userData so Three.js mat.clone() never crashes!
const PAINT_ATLAS_MAP = new WeakMap(); // THREE.Material -> { canvas, ctx, srcImg, tex, w, h, owner }
const ORIGINAL_IMG_MAP = new WeakMap(); // THREE.Texture -> original factory Image/ImageBitmap

export function disposeCarPaintTextures(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      const atlas = m && PAINT_ATLAS_MAP.get(m);
      if (atlas && atlas.tex) {
        atlas.tex.dispose();
        PAINT_ATLAS_MAP.delete(m);
        m.dispose();
      }
    }
  });
}

/**
 * Repaints a car Object3D's body atlas texture in-place with zero lag.
 * Clones the texture onto an offscreen 512x512 canvas per car root so shared assets / player / AI rivals never mutate each other.
 */
export function applyPaintToCarRoot(root, carId, paintMap = null) {
  if (!root || !carId) return;
  const zones = getCarPaintZones(carId);
  const colors = paintMap || getSavedCarPaint(carId);

  const visitedMats = new Set();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const isArr = Array.isArray(obj.material);
    const mats = isArr ? obj.material : [obj.material];

    for (let i = 0; i < mats.length; i++) {
      let mat = mats[i];
      if (!mat || !mat.map || !mat.map.image) continue;
      // Only repaint the main palette atlas material (Material_0), not emissive/light textures
      if (mat.name && mat.name.includes('Material_1')) continue;

      let atlas = PAINT_ATLAS_MAP.get(mat);
      if (!atlas || atlas.owner !== root) {
        // Retrieve the untouched factory atlas image (even if mat was cloned from a painted car!)
        const srcImg = (atlas && atlas.srcImg) || ORIGINAL_IMG_MAP.get(mat.map) || mat.map.image;
        const cloned = mat.clone();
        const w = srcImg.width || 512;
        const h = srcImg.height || 512;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(srcImg, 0, 0, w, h);

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = mat.map.flipY;
        tex.wrapS = mat.map.wrapS;
        tex.wrapT = mat.map.wrapT;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;

        ORIGINAL_IMG_MAP.set(tex, srcImg);
        cloned.map = tex;
        cloned.needsUpdate = true;

        atlas = { canvas, ctx, srcImg, tex, w, h, owner: root };
        PAINT_ATLAS_MAP.set(cloned, atlas);

        if (isArr) {
          obj.material[i] = cloned;
        } else {
          obj.material = cloned;
        }
        mat = cloned;
      }

      if (visitedMats.has(mat)) continue;
      visitedMats.add(mat);

      const { ctx, srcImg, tex, w, h } = atlas;
      const sx = w / 512;
      const sy = h / 512;

      // Restore original atlas base first, then paint each zone cleanly
      ctx.drawImage(srcImg, 0, 0, w, h);

      for (const zone of zones) {
        const hex = colors[zone.key];
        if (!hex) continue;
        // Skip repaint if exactly stock so factory look is 100% preserved
        if (hex.toLowerCase() === zone.defaultHex.toLowerCase()) continue;

        const cTop = shadeHex(hex, 1.0);
        const cMid = shadeHex(hex, 0.78);
        const cBot = shadeHex(hex, 0.58);

        for (const [rx, ry, rw, rh] of zone.rects) {
          const x = Math.floor(rx * sx);
          const y = Math.floor(ry * sy);
          const bw = Math.ceil(rw * sx);
          const hTop = Math.ceil(8 * sy);
          const hMid = Math.ceil(16 * sy);
          const hBot = Math.ceil((rh - 24) * sy);

          ctx.fillStyle = cTop;
          ctx.fillRect(x, y, bw, hTop);
          ctx.fillStyle = cMid;
          ctx.fillRect(x, y + hTop, bw, hMid);
          ctx.fillStyle = cBot;
          ctx.fillRect(x, y + hTop + hMid, bw, hBot);
        }
      }

      tex.needsUpdate = true;
    }
  });
}

import * as THREE from 'three';

/**
 * ============================================================================
 * POKEBONK / HD-2D PIXEL-3D THEME PROTOTYPE (V3 — MASTER CRITIC POLISH)
 * ----------------------------------------------------------------------------
 * Key upgrades:
 *   1. Studio-grade pixel-art sprites (pruneOrphans() prevents stray-pixel
 *      black outline blobs; thick 2-3px grass blades; 5-pixel hibiscus flowers;
 *      branched tree trunks; lava-veined volcanic dead trees; clean palms &
 *      willows with ZERO detached-pixel artifacts).
 *   2. Exact Terrain Grounding (zero double-sinking! Trees, bushes, rocks &
 *      living props sit flush on exact terrain surface — never floating and
 *      never buried underground).
 *   3. PokeBonk-grade cliffs & terrain (vertical columnar basalt grooves,
 *      jagged overhanging green grass lips along cliff ledges, clean organic
 *      emerald turf, glowing volcano veins, Bayer-dithered transitions).
 *   4. Crisp PokeBonk Image #5 sky & luminous white/sky-blue clouds.
 *   5. Hybrid 1.25x World + 1.4x Foreground Car pixel-snap pipeline so the
 *      world stays sharp like 1x while the car pops with 1.4x pixel charm!
 * ============================================================================
 */

export const PIXEL_THEME_ENABLED = true;

const PIXEL_BILLBOARD_KEYS = new Set([
  'pine1', 'pine2',
  'birch1', 'common1', 'common2', 'willow1',
  'birch_autumn', 'autumn1', 'pine_autumn', 'autumn2',
  'volcano_pine1', 'volcano_pine2', 'volcano_bush',
  'palm1', 'palm2',
  'desert_red_tree1', 'desert_red_tree2', 'cactus1', 'desert_bush',
  'pine_snow1', 'pine_snow2',
  'bush1', 'bush_berry', 'plant1', 'woodlog',
]);

const SLOPE_HUGGING_BILLBOARD_KEYS = new Set([
  'bush1', 'bush_berry', 'volcano_bush', 'desert_bush', 'plant1', 'woodlog',
]);

const PIXEL_ROCK_KEYS = new Set([
  'rock1', 'rock2', 'rock3', 'rock_moss1', 'rock_moss2', 'rock_snow1',
]);

export function isPixelBillboardKey(key) {
  return PIXEL_BILLBOARD_KEYS.has(key);
}

export function isSlopeHuggingBillboardKey(key) {
  return SLOPE_HUGGING_BILLBOARD_KEYS.has(key);
}

export function isPixelRockKey(key) {
  return PIXEL_ROCK_KEYS.has(key);
}

// ============================================================================
// 0. BIOME EVALUATOR
// ============================================================================

function smoothstepJs(e0, e1, x) {
  const t = Math.max(0.0, Math.min(1.0, (x - e0) / (e1 - e0)));
  return t * t * (3.0 - 2.0 * t);
}

export function getBiomeIdAt(wx, wyHeight, wz) {
  const wy = -wz;
  const wyBioW = wy + 26.0 * Math.sin(wx * 0.014 + 0.5);
  const wxBioE = wx + 28.0 * Math.cos(wy * 0.013 - 0.4);
  const wyBioN = wy + 26.0 * Math.sin(wx * 0.012 + 1.1);

  const dVolc = Math.hypot((wxBioE - 1140.0) / 1.18, (wyBioW - 75.0) / 1.12);
  const tVolcano = 1.0 - smoothstepJs(320.0, 560.0, dVolc);
  if (tVolcano > 0.45) return 3;

  const canyonNorthFar = 330.0 + 330.0 * (1.0 - smoothstepJs(-1150.0, -800.0, wxBioE));
  const tDesert =
    (1.0 - smoothstepJs(-340.0, -85.0, wxBioE)) *
    smoothstepJs(-940.0, -680.0, wyBioW) *
    (1.0 - smoothstepJs(canyonNorthFar, canyonNorthFar + 160.0, wyBioW));
  if (tDesert > 0.42) return 2;

  const inNorthGlacier =
    smoothstepJs(700.0, 960.0, wyBioN) *
    (1.0 - smoothstepJs(140.0, 380.0, wxBioE)) *
    smoothstepJs(-1380.0, -1020.0, wxBioE);
  const inTouge =
    smoothstepJs(110.0, 290.0, wyBioN) *
    (1.0 - smoothstepJs(800.0, 1060.0, wyBioN)) *
    smoothstepJs(-620.0, -400.0, wxBioE) *
    (1.0 - smoothstepJs(90.0, 280.0, wxBioE));
  const tCold = Math.max(inNorthGlacier, inTouge) * (1.0 - tDesert) * (1.0 - tVolcano);
  if (tCold > 0.42) return 4;

  const tAutumn = smoothstepJs(85.0, 320.0, wxBioE) * smoothstepJs(55.0, 275.0, wyBioN);
  if (tAutumn > 0.42) return 1;

  const tCoast = (1.0 - smoothstepJs(-565.0, -455.0, wy)) * (1.0 - tDesert * 0.85) * (1.0 - tVolcano);
  if (tCoast > 0.42) return 5;

  return 0;
}

// ============================================================================
// 1. EXACT TERRAIN SURFACE HEIGHT & SLOPE NORMAL SAMPLER
// ============================================================================

export function createTerrainSurfaceSampler(terrainMesh) {
  if (!terrainMesh || !terrainMesh.geometry) return null;

  terrainMesh.updateWorldMatrix(true, false);
  const posAttr = terrainMesh.geometry.attributes.position;
  const indexAttr = terrainMesh.geometry.index;
  const mat = terrainMesh.matrixWorld;

  const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
  const tris = new Float32Array(triCount * 12);
  const CELL = 14.0;
  const grid = new Map();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const norm = new THREE.Vector3();

  for (let t = 0; t < triCount; t++) {
    const i0 = indexAttr ? indexAttr.getX(t * 3 + 0) : t * 3 + 0;
    const i1 = indexAttr ? indexAttr.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = indexAttr ? indexAttr.getX(t * 3 + 2) : t * 3 + 2;

    vA.fromBufferAttribute(posAttr, i0).applyMatrix4(mat);
    vB.fromBufferAttribute(posAttr, i1).applyMatrix4(mat);
    vC.fromBufferAttribute(posAttr, i2).applyMatrix4(mat);

    e1.subVectors(vB, vA);
    e2.subVectors(vC, vA);
    norm.crossVectors(e1, e2);
    const len = norm.length();
    if (len < 1e-6) continue;
    norm.divideScalar(len);
    if (norm.y < 0) norm.negate();

    const off = t * 12;
    tris[off + 0] = vA.x; tris[off + 1] = vA.y; tris[off + 2] = vA.z;
    tris[off + 3] = vB.x; tris[off + 4] = vB.y; tris[off + 5] = vB.z;
    tris[off + 6] = vC.x; tris[off + 7] = vC.y; tris[off + 8] = vC.z;
    tris[off + 9] = norm.x; tris[off + 10] = norm.y; tris[off + 11] = norm.z;

    const minX = Math.floor(Math.min(vA.x, vB.x, vC.x) / CELL);
    const maxX = Math.floor(Math.max(vA.x, vB.x, vC.x) / CELL);
    const minZ = Math.floor(Math.min(vA.z, vB.z, vC.z) / CELL);
    const maxZ = Math.floor(Math.max(vA.z, vB.z, vC.z) / CELL);

    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const key = `${cx}_${cz}`;
        let bucket = grid.get(key);
        if (!bucket) {
          bucket = [];
          grid.set(key, bucket);
        }
        bucket.push(t);
      }
    }
  }

  function sample(x, z, hintY = null) {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const bucket = grid.get(`${cx}_${cz}`);
    if (!bucket) return null;

    let best = null;
    let bestErr = Infinity;

    for (let k = 0; k < bucket.length; k++) {
      const off = bucket[k] * 12;
      const ax = tris[off + 0], ay = tris[off + 1], az = tris[off + 2];
      const bx = tris[off + 3], by = tris[off + 4], bz = tris[off + 5];
      const cxp = tris[off + 6], cyp = tris[off + 7], czp = tris[off + 8];

      const v0x = cxp - ax, v0z = czp - az;
      const v1x = bx - ax, v1z = bz - az;
      const v2x = x - ax, v2z = z - az;

      const dot00 = v0x * v0x + v0z * v0z;
      const dot01 = v0x * v1x + v0z * v1z;
      const dot02 = v0x * v2x + v0z * v2z;
      const dot11 = v1x * v1x + v1z * v1z;
      const dot12 = v1x * v2x + v1z * v2z;

      const denom = dot00 * dot11 - dot01 * dot01;
      if (Math.abs(denom) < 1e-7) continue;
      const invDenom = 1.0 / denom;
      const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
      const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
      if (u >= -0.02 && v >= -0.02 && u + v <= 1.02) {
        const w = 1.0 - u - v;
        const y = w * ay + v * by + u * cyp;
        const err = hintY !== null ? Math.abs(y - hintY) : -y;
        if (err < bestErr) {
          bestErr = err;
          best = {
            y,
            nx: tris[off + 9],
            ny: tris[off + 10],
            nz: tris[off + 11],
          };
        }
      }
    }
    return best;
  }

  return { sample };
}

// ============================================================================
// 2. DETERMINISTIC PIXEL-ART CANVAS ENGINE (CLEAN SILHOUETTES, ZERO ORPHANS!)
// ============================================================================

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class PixelCanvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  set(x, y, hex, a = 255) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return;
    const [r, g, b] = typeof hex === 'string' ? hexToRgb(hex) : hex;
    const idx = (iy * this.w + ix) * 4;
    this.data[idx] = r;
    this.data[idx + 1] = g;
    this.data[idx + 2] = b;
    this.data[idx + 3] = a;
  }

  /**
   * Seamlessly wraps pixel writes modulo (w, h) so tiled ground textures have ZERO seams!
   */
  setWrap(x, y, hex, a = 255) {
    const ix = ((Math.round(x) % this.w) + this.w) % this.w;
    const iy = ((Math.round(y) % this.h) + this.h) % this.h;
    const [r, g, b] = typeof hex === 'string' ? hexToRgb(hex) : hex;
    const idx = (iy * this.w + ix) * 4;
    this.data[idx] = r;
    this.data[idx + 1] = g;
    this.data[idx + 2] = b;
    this.data[idx + 3] = a;
  }

  fillEllipseWrap(cx, cy, rx, ry, hex) {
    const rgb = typeof hex === 'string' ? hexToRgb(hex) : hex;
    const minX = Math.floor(cx - rx - 1);
    const maxX = Math.ceil(cx + rx + 1);
    const minY = Math.floor(cy - ry - 1);
    const maxY = Math.ceil(cy + ry + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1.0) {
          this.setWrap(x, y, rgb);
        }
      }
    }
  }

  clear(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.w || iy < 0 || iy >= this.h) return;
    this.data[(iy * this.w + ix) * 4 + 3] = 0;
  }

  getAlpha(x, y) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  fillRect(x, y, w, h, hex) {
    const rgb = typeof hex === 'string' ? hexToRgb(hex) : hex;
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    for (let py = y0; py < y0 + h; py++) {
      for (let px = x0; px < x0 + w; px++) {
        this.set(px, py, rgb);
      }
    }
  }

  fillEllipse(cx, cy, rx, ry, hex) {
    const rgb = typeof hex === 'string' ? hexToRgb(hex) : hex;
    const minX = Math.floor(cx - rx - 1);
    const maxX = Math.ceil(cx + rx + 1);
    const minY = Math.floor(cy - ry - 1);
    const maxY = Math.ceil(cy + ry + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        if (nx * nx + ny * ny <= 1.0) {
          this.set(x, y, rgb);
        }
      }
    }
  }

  /**
   * Draws a thick tapered stroke (used for curved tree branches, palm fronds, grass blades)
   * ensuring 2-3px minimum thickness so outlines frame crisp shapes with ZERO detached dots.
   */
  drawThickCurve(x0, y0, cx, cy, x1, y1, rStart, rEnd, colorFn, steps = 28) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const omt = 1.0 - t;
      const x = omt * omt * x0 + 2 * omt * t * cx + t * t * x1;
      const y = omt * omt * y0 + 2 * omt * t * cy + t * t * y1;
      const r = rStart + (rEnd - rStart) * t;
      const col = typeof colorFn === 'function' ? colorFn(t, x, y) : colorFn;
      if (r <= 0.75) {
        this.set(x, y, col);
      } else {
        this.fillEllipse(x, y, r, r, col);
      }
    }
  }

  /**
   * Draws a clean, hand-crafted PokeBonk leaf cluster with sunlit top crown,
   * rich midtones, crisp lower-crevice dark edge, and ZERO orphan stray pixels.
   */
  drawLeafCluster(cx, cy, rx, ry, pal, seed = 1) {
    const cHi = hexToRgb(pal.hi);
    const cMidHi = hexToRgb(pal.midHi);
    const cMid = hexToRgb(pal.mid);
    const cDark = hexToRgb(pal.dark);
    const cDeep = hexToRgb(pal.deep || pal.dark);

    const minX = Math.floor(cx - rx - 2);
    const maxX = Math.ceil(cx + rx + 2);
    const minY = Math.floor(cy - ry - 2);
    const maxY = Math.ceil(cy + ry + 2);

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const ang = Math.atan2(ny, nx);
        // Smooth low-frequency organic foliage lobes (NEVER creates stray detached 1px dots!)
        const lobe = 1.0 + 0.08 * Math.sin(ang * 5.0 + seed) + 0.05 * Math.cos(ang * 3.0 - seed * 0.7);
        const dist = Math.hypot(nx, ny) / lobe;
        if (dist > 1.0) continue;

        // Crisp PokeBonk directional sunlight (upper-left sun)
        const dither = (((x & 1) ^ (y & 1)) ? 0.075 : -0.075);
        const shade = (-nx * 0.42 - ny * 0.82) + dither;

        let col = cMid;
        if (shade > 0.52 && ny < 0.05) col = cHi;
        else if (shade > 0.16) col = cMidHi;
        else if (shade > -0.22) col = cMid;
        else if (shade > -0.58) col = cDark;
        else col = cDeep;

        // Crisp dark internal crevice rim along bottom underside of each cluster!
        if (ny > 0.56 && dist > 0.78) col = cDeep;
        this.set(x, y, col);
      }
    }
  }

  /**
   * Draws a sturdy tapered pixel bark trunk with flared roots anchored cleanly at yBottom.
   */
  drawTrunk(xBottom, yBottom, xTop, yTop, wBottom, wTop, barkPal, isBirch = false) {
    const cLight = hexToRgb(barkPal.light);
    const cMid = hexToRgb(barkPal.mid);
    const cDark = hexToRgb(barkPal.dark);
    const cStripe = hexToRgb('#1e222b');

    const steps = Math.max(Math.abs(yBottom - yTop), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = Math.round(yBottom + (yTop - yBottom) * t);
      const bend = Math.sin(t * Math.PI) * ((xTop - xBottom) * 0.28);
      const cx = xBottom + (xTop - xBottom) * t + bend;
      const rootFlare = t < 0.20 ? Math.pow(1.0 - t / 0.20, 1.5) * 3.0 : 0.0;
      const halfW = (wBottom + (wTop - wBottom) * t) * 0.5 + rootFlare;
      const x0 = Math.floor(cx - halfW);
      const x1 = Math.ceil(cx + halfW);

      for (let x = x0; x <= x1; x++) {
        const u = (x - x0) / Math.max(1, x1 - x0);
        let col = cMid;
        if (u < 0.30) col = cLight;
        else if (u > 0.70) col = cDark;

        if (isBirch && ((y % 4 === 0 && u > 0.15 && u < 0.56) || (y % 7 === 2 && u > 0.45 && u < 0.84))) {
          col = cStripe;
        } else if (!isBirch && (x === Math.round(cx) && y % 3 === 0)) {
          col = cDark;
        }
        this.set(x, y, col);
      }
    }
  }

  /**
   * Draws crisp 5-pixel flowers (4 vibrant petals + bright center).
   * Pass requireOpaque=false when placing blooms on tips/stems that extend into sky!
   */
  drawCrispFlowers(positions, petalHex, centerHex, darkPetalHex = null, requireOpaque = true) {
    const cP = hexToRgb(petalHex);
    const cC = hexToRgb(centerHex);
    const cD = darkPetalHex ? hexToRgb(darkPetalHex) : cP;
    for (const [fx, fy] of positions) {
      if (requireOpaque && this.getAlpha(fx, fy) === 0) continue;
      this.set(fx, fy, cC);
      this.set(fx - 1, fy, cP);
      this.set(fx + 1, fy, cP);
      this.set(fx, fy - 1, cP);
      this.set(fx, fy + 1, cD);
    }
  }

  /**
   * Draws lush bold PokeBonk Image #5 hibiscus / fruit blossoms (5x5 cross-star with
   * sunlit petals, shaded underside, and glowing golden stamen center).
   */
  drawBoldHibiscus(positions, petalHex, hiHex, centerHex, darkHex) {
    const cP = hexToRgb(petalHex);
    const cH = hexToRgb(hiHex);
    const cC = hexToRgb(centerHex);
    const cD = hexToRgb(darkHex);
    for (const [fx, fy] of positions) {
      if (this.getAlpha(fx, fy) === 0) continue;
      // 4 chunky 2px petals around a bright center
      this.set(fx, fy - 2, cH);
      this.set(fx - 1, fy - 1, cH); this.set(fx, fy - 1, cP); this.set(fx + 1, fy - 1, cP);
      this.set(fx - 2, fy, cP);     this.set(fx - 1, fy, cP); this.set(fx, fy, cC); this.set(fx + 1, fy, cP); this.set(fx + 2, fy, cD);
      this.set(fx - 1, fy + 1, cP); this.set(fx, fy + 1, cD); this.set(fx + 1, fy + 1, cD);
      this.set(fx, fy + 2, cD);
    }
  }

  /**
   * Removes isolated 1-pixel stray islands (< 2 opaque 4-neighbors) BEFORE outlining
   * so NO sprite ever gets ugly detached black ink blobs!
   */
  pruneOrphans() {
    const copy = new Uint8ClampedArray(this.data);
    const isOp = (x, y) => {
      if (x < 0 || x >= this.w || y < 0 || y >= this.h) return false;
      return copy[(y * this.w + x) * 4 + 3] > 128;
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!isOp(x, y)) continue;
        const n = (isOp(x - 1, y) ? 1 : 0) + (isOp(x + 1, y) ? 1 : 0) + (isOp(x, y - 1) ? 1 : 0) + (isOp(x, y + 1) ? 1 : 0);
        if (n === 0) this.clear(x, y);
      }
    }
  }

  applyOutline(outlineHex = '#0d1118') {
    this.pruneOrphans();
    const outRgb = hexToRgb(outlineHex);
    const copy = new Uint8ClampedArray(this.data);
    const isOpaque = (x, y) => {
      if (x < 0 || x >= this.w || y < 0 || y >= this.h) return false;
      return copy[(y * this.w + x) * 4 + 3] > 128;
    };

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (isOpaque(x, y)) continue;
        if (
          isOpaque(x - 1, y) ||
          isOpaque(x + 1, y) ||
          isOpaque(x, y - 1) ||
          isOpaque(x, y + 1)
        ) {
          this.set(x, y, outRgb, 255);
        }
      }
    }
  }

  toTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(this.data, this.w, this.h), 0, 0);

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }
}

// ============================================================================
// 3. STUDIO-GRADE POKEBONK SPRITE GENERATORS (EVERY SINGLE BIOME AUDITED!)
// ============================================================================

const PALETTES = {
  lushGreen:     { hi: '#d4fc4e', midHi: '#7ae028', mid: '#2db024', dark: '#156b1e', deep: '#0b3815' },
  deepEmerald:   { hi: '#aef23f', midHi: '#52c429', mid: '#1f8a24', dark: '#10541c', deep: '#082e12' },
  pineGreen:     { hi: '#8ae03a', midHi: '#3ead2d', mid: '#1c7828', dark: '#0f4a20', deep: '#082914' },
  birchLime:     { hi: '#e6fc5b', midHi: '#97e635', mid: '#4ab828', dark: '#21781e', deep: '#104514' },
  autumnGold:    { hi: '#ffef5c', midHi: '#ffb726', mid: '#e67817', dark: '#a63f10', deep: '#611d0a' },
  autumnCrimson: { hi: '#ffb838', midHi: '#f56222', mid: '#cc2929', dark: '#8a1420', deep: '#4d0914' },
  volcanoLush:   { hi: '#b8f53b', midHi: '#54cc23', mid: '#1f871e', dark: '#115218', deep: '#092e10' },
  snowPine:      { hi: '#f2fbff', midHi: '#b8e0f5', mid: '#2c7d78', dark: '#194d54', deep: '#0d2c36' },
  desertRed:     { hi: '#ffc252', midHi: '#e37734', mid: '#b34625', dark: '#782819', deep: '#47140d' },
  desertAcacia:  { hi: '#e0e85a', midHi: '#9eb536', mid: '#648028', dark: '#3c521a', deep: '#21300e' },
  palmFrond:     { hi: '#d4f745', midHi: '#74d926', mid: '#2ba322', dark: '#156619', deep: '#0b3811' },
  cactus:        { hi: '#9ef24b', midHi: '#54c431', mid: '#2a912a', dark: '#165e21', deep: '#0c3816' },
  barkWarm:      { light: '#b0723c', mid: '#7d4722', dark: '#4a2611' },
  barkDark:      { light: '#7d5034', mid: '#54311e', dark: '#2e180f' },
  barkBirch:     { light: '#f4f6f0', mid: '#d8dcd2', dark: '#a7afa2' },
  barkPalm:      { light: '#cc9654', mid: '#9c6834', dark: '#633e1b' },
};

function buildBroadTreeCanvas(pal, barkPal, opts = {}) {
  const pc = new PixelCanvas(56, 72);
  const lean = opts.lean || 0;
  const seed = opts.seed || 11;
  const isBirch = Boolean(opts.isBirch);

  // Trunk base sits flush at y = 70 (1px outline at y = 71 = exact bottom edge!)
  pc.drawTrunk(28, 70, 28 + lean, 35, opts.trunkW || 7, opts.trunkTopW || 4, barkPal, isBirch);
  // Visible V-shaped branching boughs like PokeBonk Image #5!
  pc.drawThickCurve(28 + lean, 44, 24 + lean, 38, 17 + lean, 33, 2.2, 1.3, barkPal.mid, 14);
  pc.drawThickCurve(28 + lean, 42, 32 + lean, 36, 38 + lean, 31, 2.1, 1.3, barkPal.dark, 14);

  const clusters = opts.flatTop
    ? [
        [28 + lean - 15, 25, 10, 6],
        [28 + lean + 15, 26, 10, 6],
        [28 + lean - 7, 20, 12, 6.5],
        [28 + lean + 8, 21, 11, 6.5],
        [28 + lean, 16, 13, 6.5],
      ]
    : opts.tall
      ? [
          [28 + lean - 12, 39, 9.5, 8],
          [28 + lean + 12, 38, 9.5, 8],
          [28 + lean, 35, 13, 9.5],
          [28 + lean - 10, 25, 11, 8.5],
          [28 + lean + 10, 26, 10.5, 8.5],
          [28 + lean, 16, 12, 9],
          [28 + lean - 2, 10, 8, 6],
        ]
      : [
          [28 + lean - 14, 38, 10.5, 8.5],
          [28 + lean + 13, 37, 10.5, 8.5],
          [28 + lean, 36, 14, 9.5],
          [28 + lean - 11, 25, 11.5, 8.5],
          [28 + lean + 11, 24, 11, 8.5],
          [28 + lean - 1, 16, 12.5, 9],
        ];

  clusters.forEach(([cx, cy, rx, ry], idx) => {
    pc.drawLeafCluster(cx, cy, rx, ry, pal, seed + idx * 17);
  });

  if (opts.boldFlowers && opts.flowerPositions && opts.flowerHex) {
    pc.drawBoldHibiscus(opts.flowerPositions, opts.flowerHex, opts.flowerHi || '#ff7755', opts.flowerCenter || '#ffee55', opts.flowerDark || '#a81414');
  } else if (opts.flowerPositions && opts.flowerHex) {
    pc.drawCrispFlowers(opts.flowerPositions, opts.flowerHex, opts.flowerCenter || '#ffee55', opts.flowerDark || null);
  }

  pc.applyOutline('#0d1118');
  return pc;
}

function buildPineTreeCanvas(pal, barkPal, opts = {}) {
  const pc = new PixelCanvas(56, 72);
  const seed = opts.seed || 31;
  const snowy = Boolean(opts.snowy);

  pc.drawTrunk(28, 70, 28, 24, 7, 3.5, barkPal, false);

  // Layered conifer boughs with drooping angled pine tips + textured clustered fullness!
  const rows = [
    { y: 51, spread: 16, rx: 9.0, ry: 5.5 },
    { y: 40, spread: 13, rx: 8.2, ry: 5.2 },
    { y: 29, spread: 9.5, rx: 7.2, ry: 4.8 },
    { y: 19, spread: 5.5, rx: 6.0, ry: 4.5 },
    { y: 10, spread: 0,  rx: 4.5, ry: 5.2 },
  ];

  const snowPal = { hi: '#ffffff', midHi: '#e3f4ff', mid: '#a8d6f0', dark: '#5991b8', deep: '#2a5678' };

  rows.forEach((row, ri) => {
    // Sharp drooping outer evergreen bough tips so it reads unmistakably as a pine tree!
    if (row.spread > 0) {
      pc.drawThickCurve(28 - row.spread * 0.4, row.y - 2, 28 - row.spread * 0.95, row.y + 1, 28 - row.spread - 5, row.y + 6, 3.0, 1.0, (t) => (t < 0.45 ? pal.midHi : pal.dark), 14);
      pc.drawThickCurve(28 + row.spread * 0.4, row.y - 2, 28 + row.spread * 0.95, row.y + 1, 28 + row.spread + 5, row.y + 6, 3.0, 1.0, (t) => (t < 0.45 ? pal.mid : pal.deep), 14);
      pc.drawLeafCluster(28 - row.spread * 0.72, row.y + 1, row.rx * 0.85, row.ry, pal, seed + ri * 13);
      pc.drawLeafCluster(28 + row.spread * 0.72, row.y + 1, row.rx * 0.85, row.ry, pal, seed + ri * 13 + 7);
    }
    pc.drawLeafCluster(28, row.y, row.rx, row.ry + 0.5, pal, seed + ri * 23);

    if (snowy) {
      if (row.spread > 0) {
        pc.drawThickCurve(28 - row.spread * 0.4, row.y - 3, 28 - row.spread * 0.9, row.y - 1, 28 - row.spread - 4, row.y + 3, 2.2, 0.9, '#ffffff', 12);
        pc.drawThickCurve(28 + row.spread * 0.4, row.y - 3, 28 + row.spread * 0.9, row.y - 1, 28 + row.spread + 4, row.y + 3, 2.2, 0.9, '#d8f0ff', 12);
        pc.drawLeafCluster(28 - row.spread * 0.65, row.y - 1.5, row.rx * 0.75, row.ry * 0.50, snowPal, seed + ri * 31);
        pc.drawLeafCluster(28 + row.spread * 0.65, row.y - 1.5, row.rx * 0.75, row.ry * 0.50, snowPal, seed + ri * 31 + 5);
      }
      pc.drawLeafCluster(28, row.y - 2.2, row.rx * 0.82, row.ry * 0.50, snowPal, seed + ri * 41);
    }
  });

  pc.applyOutline('#0d1118');
  return pc;
}

/**
 * Iconic PokeBonk Image #1 charred obsidian volcano tree with glowing magma cracks!
 */
function buildVolcanoDeadTreeCanvas() {
  const pc = new PixelCanvas(56, 72);
  const darkBark = '#24222c';
  const hiBark = '#423e4f';
  const lavaOuter = '#ff4d1a';
  const lavaCore = '#ffdd44';

  // Main gnarled obsidian trunk + glowing lava fissure up center
  pc.drawThickCurve(28, 70, 26, 48, 29, 24, 5.2, 2.2, (t, x) => (x < 27 ? hiBark : darkBark), 34);
  pc.drawThickCurve(22, 70, 24, 65, 27, 60, 2.8, 1.8, hiBark, 10);
  pc.drawThickCurve(34, 70, 32, 65, 29, 60, 2.8, 1.8, darkBark, 10);

  // Gnarled twisted bare branches reaching outward
  pc.drawThickCurve(27, 48, 18, 42, 10, 30, 2.6, 1.2, darkBark, 20);
  pc.drawThickCurve(17, 40, 14, 33, 15, 22, 1.8, 1.0, hiBark, 14);
  pc.drawThickCurve(29, 44, 38, 38, 45, 26, 2.5, 1.2, darkBark, 20);
  pc.drawThickCurve(38, 36, 41, 29, 39, 19, 1.7, 1.0, hiBark, 14);
  pc.drawThickCurve(29, 30, 24, 21, 18, 11, 2.2, 1.1, hiBark, 18);
  pc.drawThickCurve(29, 26, 33, 18, 36, 9,  2.0, 1.0, darkBark, 18);
  pc.drawThickCurve(28, 25, 27, 16, 28, 7,  1.8, 1.0, hiBark, 16);

  // Glowing molten magma vein winding up the trunk and roots!
  pc.drawThickCurve(28, 69, 26, 52, 29, 31, 1.4, 0.8, lavaOuter, 26);
  pc.drawThickCurve(28, 68, 26, 53, 29, 35, 0.6, 0.4, lavaCore, 24);
  pc.drawThickCurve(27, 48, 21, 43, 16, 37, 0.9, 0.5, lavaOuter, 12);
  pc.drawThickCurve(29, 44, 35, 39, 40, 33, 0.9, 0.5, lavaOuter, 12);

  pc.applyOutline('#0a0a0f');
  return pc;
}

/**
 * PokeBonk Image #5 style bold tropical palm tree:
 * widened 72x72 canvas so ZERO palm fronds ever get clipped at edges!
 */
function buildPalmTreeCanvas(leanDir = 1) {
  const pc = new PixelCanvas(72, 72);
  const pal = PALETTES.palmFrond;
  const bark = PALETTES.barkPalm;
  const cLight = hexToRgb(bark.light);
  const cMid = hexToRgb(bark.mid);
  const cDark = hexToRgb(bark.dark);

  const cxTop = 36 + leanDir * 5.5;
  const cyTop = 22;

  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = Math.round(70 - t * (70 - cyTop));
    const curve = Math.sin(t * Math.PI * 0.72) * leanDir * 6.5;
    const cx = 36 + curve;
    const halfW = 3.8 - t * 1.1 + (t < 0.14 ? (1 - t / 0.14) * 1.8 : 0);
    const ring = (i % 5 === 0);
    for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
      const u = (x - (cx - halfW)) / Math.max(1, halfW * 2);
      let col = u < 0.35 ? cLight : (u > 0.72 ? cDark : cMid);
      if (ring) col = cDark;
      pc.set(x, y, col);
    }
  }

  const fronds = [
    { cx: cxTop - 13, cy: cyTop - 3,  x1: cxTop - 24, y1: cyTop + 13 },
    { cx: cxTop - 12, cy: cyTop - 11, x1: cxTop - 23, y1: cyTop - 1  },
    { cx: cxTop - 5,  cy: cyTop - 15, x1: cxTop - 14, y1: cyTop - 12 },
    { cx: cxTop + 5,  cy: cyTop - 15, x1: cxTop + 14, y1: cyTop - 11 },
    { cx: cxTop + 12, cy: cyTop - 10, x1: cxTop + 23, y1: cyTop + 0  },
    { cx: cxTop + 13, cy: cyTop - 3,  x1: cxTop + 24, y1: cyTop + 13 },
  ];

  for (const f of fronds) {
    pc.drawThickCurve(cxTop, cyTop + 1, f.cx, f.cy + 2, f.x1, f.y1 + 2, 3.0, 1.2, (t) => (t > 0.55 ? pal.dark : pal.mid), 26);
    pc.drawThickCurve(cxTop, cyTop, f.cx, f.cy, f.x1, f.y1, 2.5, 0.95, (t) => (t < 0.45 ? pal.hi : pal.midHi), 26);
  }

  pc.fillEllipse(cxTop - 3.2, cyTop + 4, 2.7, 2.7, '#8c5328');
  pc.fillEllipse(cxTop + 3.0, cyTop + 4, 2.7, 2.7, '#6e3d1c');
  pc.fillEllipse(cxTop,       cyTop + 5.5, 2.7, 2.7, '#7d4721');
  pc.set(cxTop - 4, cyTop + 3, '#c78a4c');
  pc.set(cxTop - 1, cyTop + 4, '#b87a3e');
  pc.set(cxTop + 2, cyTop + 3, '#a86b38');

  pc.applyOutline('#0d1118');
  return pc;
}

/**
 * Lush cascading weeping willow with soft organic overlapping draping foliage lobes!
 */
function buildWillowCanvas(seed = 71) {
  const pc = new PixelCanvas(60, 72);
  const pal = PALETTES.birchLime;
  pc.drawTrunk(30, 70, 30, 30, 8, 4.5, PALETTES.barkWarm);

  // Back shadowed weeping foliage drape
  const backDrapes = [
    [13, 38, 6.5, 13], [21, 41, 6.5, 14], [39, 41, 6.5, 14], [47, 38, 6.5, 13],
  ];
  backDrapes.forEach(([cx, cy, rx, ry], i) => {
    pc.drawLeafCluster(cx, cy, rx, ry, PALETTES.deepEmerald, seed + 40 + i * 11);
  });

  // Front sunlit sweeping cascading willow tresses
  const frontDrapes = [
    [15, 33, 6.5, 11], [23, 35, 7.0, 12], [37, 35, 7.0, 12], [45, 33, 6.5, 11],
  ];
  frontDrapes.forEach(([cx, cy, rx, ry], i) => {
    pc.drawLeafCluster(cx, cy, rx, ry, pal, seed + 80 + i * 13);
  });

  // Sunlit rounded crown on top
  pc.drawLeafCluster(30, 21, 18, 11, pal, seed);
  pc.drawLeafCluster(16, 26, 11, 9, pal, seed + 13);
  pc.drawLeafCluster(44, 26, 11, 9, pal, seed + 29);

  pc.applyOutline('#0d1118');
  return pc;
}

function buildCactusCanvas() {
  const pc = new PixelCanvas(44, 62);
  const pal = PALETTES.cactus;
  const cHi = hexToRgb(pal.hi);
  const cMidHi = hexToRgb(pal.midHi);
  const cMid = hexToRgb(pal.mid);
  const cDark = hexToRgb(pal.dark);

  const drawStem = (cx, yTop, yBot, halfW) => {
    for (let y = yTop; y <= yBot; y++) {
      const cap = (y - yTop) < 2 ? 1 : 0;
      for (let x = cx - halfW + cap; x <= cx + halfW - cap; x++) {
        const dx = x - cx;
        let col = cMid;
        if (dx <= -halfW + 1) col = cHi;
        else if (dx === 0) col = cMidHi;
        else if (dx >= halfW - 1) col = cDark;
        pc.set(x, y, col);
      }
    }
  };

  drawStem(22, 11, 60, 4);
  pc.fillRect(10, 34, 10, 5, pal.mid);
  pc.fillRect(10, 34, 10, 2, pal.midHi);
  drawStem(10, 20, 38, 3);
  pc.fillRect(24, 29, 10, 5, pal.mid);
  pc.fillRect(24, 29, 10, 2, pal.midHi);
  drawStem(34, 17, 33, 3);

  // Crisp pink/yellow desert flowers on top (requireOpaque=false so they always sit proudly on tips!)
  pc.drawCrispFlowers([[22, 10], [10, 19], [34, 16]], '#ff4d94', '#ffe066', '#cc296b', false);

  pc.applyOutline('#0d1118');
  return pc;
}

function buildBushCanvas(pal, opts = {}) {
  const pc = new PixelCanvas(46, 40);
  const seed = opts.seed || 97;
  // Wide grounded silhouette reaching y = 38 (outline at 39 = exact bottom!)
  const puffs = [
    [13, 30, 10, 8],
    [33, 30, 10, 8],
    [23, 29, 14, 9],
    [16, 21, 9.5, 7.5],
    [30, 22, 9.5, 7.5],
    [23, 16, 10, 7.5],
  ];
  puffs.forEach(([cx, cy, rx, ry], i) => {
    pc.drawLeafCluster(cx, cy, rx, ry, pal, seed + i * 19);
  });

  if (opts.flowerPositions && opts.flowerHex) {
    pc.drawCrispFlowers(opts.flowerPositions, opts.flowerHex, opts.flowerCenter || '#ffee55', opts.flowerDark || null);
  }
  pc.applyOutline('#0d1118');
  return pc;
}

/**
 * Thick 2-3px lush PokeBonk fern / grass shrub (matching Image #5 bottom-right grass!)
 * NO black-outline thin-line soup!
 */
function buildPlantFernCanvas(isDesert = false) {
  const pc = new PixelCanvas(44, 38);
  const pal = isDesert
    ? { hi: '#e6d86e', midHi: '#a6ba46', mid: '#6e8532', dark: '#42541e' }
    : PALETTES.lushGreen;

  // Solid grassy base mound
  pc.fillEllipse(22, 33, 10, 4, pal.dark);

  // Thick sweeping 2.5px blades fanning cleanly outward!
  const blades = [
    [14, 33, 8,  23, 5,  16],
    [17, 33, 13, 20, 11, 10],
    [21, 33, 20, 18, 21, 7],
    [25, 33, 28, 19, 31, 10],
    [29, 33, 34, 23, 38, 16],
  ];
  for (const [x0, y0, cx, cy, x1, y1] of blades) {
    pc.drawThickCurve(x0, y0, cx, cy, x1, y1, 2.4, 1.1, (t) => (t > 0.65 ? pal.hi : (t > 0.30 ? pal.midHi : pal.mid)), 16);
  }

  if (!isDesert) {
    pc.drawCrispFlowers([[14, 24], [28, 23], [21, 26]], '#ff2e2e', '#ffee55', '#b81a1a');
  } else {
    pc.drawCrispFlowers([[22, 22]], '#ff5c9e', '#ffe066', '#c42b6b');
  }

  pc.applyOutline('#0d1118');
  return pc;
}

function buildWoodlogCanvas() {
  const pc = new PixelCanvas(48, 32);
  const bark = PALETTES.barkWarm;
  for (let x = 7; x <= 40; x++) {
    for (let y = 18; y <= 29; y++) {
      const col = y <= 20 ? bark.light : (y >= 27 ? bark.dark : bark.mid);
      pc.set(x, y, (x + y) % 5 === 0 ? bark.dark : col);
    }
  }
  pc.fillEllipse(8, 23.5, 3.2, 5.2, '#ebd09a');
  pc.fillEllipse(8, 23.5, 1.5, 2.5, '#b8864f');
  pc.drawLeafCluster(24, 17, 8, 3.5, PALETTES.lushGreen, 123);
  pc.drawLeafCluster(16, 18, 5, 2.8, PALETTES.lushGreen, 129);
  pc.fillRect(31, 15, 3, 3, '#f5ebd6');
  pc.fillEllipse(32.5, 13.5, 3.5, 2.2, '#f02e2e');
  pc.set(32, 13, '#ffffff');
  pc.applyOutline('#0d1118');
  return pc;
}

export function buildAllNatureSpriteCanvases() {
  return {
    common1: buildBroadTreeCanvas(PALETTES.lushGreen, PALETTES.barkWarm, {
      lean: 2, seed: 11, boldFlowers: true,
      flowerPositions: [[19, 27], [36, 24], [28, 17], [24, 37], [38, 35]],
      flowerHex: '#ff2b2b', flowerHi: '#ff7052', flowerCenter: '#ffee55', flowerDark: '#b31414',
    }),
    common2: buildBroadTreeCanvas(PALETTES.deepEmerald, PALETTES.barkWarm, {
      lean: -2, tall: true, seed: 23, boldFlowers: true,
      flowerPositions: [[20, 27], [34, 24], [27, 16], [33, 36]],
      flowerHex: '#ffaa1d', flowerHi: '#ffe066', flowerCenter: '#ffffff', flowerDark: '#cc660d',
    }),
    birch1:  buildBroadTreeCanvas(PALETTES.birchLime, PALETTES.barkBirch, {
      lean: 1, tall: true, trunkW: 5, trunkTopW: 3, isBirch: true, seed: 37,
    }),
    willow1: buildWillowCanvas(71),

    pine1: buildPineTreeCanvas(PALETTES.pineGreen, PALETTES.barkDark, { seed: 41 }),
    pine2: buildPineTreeCanvas(PALETTES.deepEmerald, PALETTES.barkWarm, { seed: 53 }),

    autumn1:      buildBroadTreeCanvas(PALETTES.autumnGold, PALETTES.barkWarm, { lean: 2, seed: 61 }),
    autumn2:      buildBroadTreeCanvas(PALETTES.autumnCrimson, PALETTES.barkDark, { lean: -2, tall: true, seed: 67 }),
    birch_autumn: buildBroadTreeCanvas(PALETTES.autumnGold, PALETTES.barkBirch, { lean: 1, tall: true, trunkW: 5, trunkTopW: 3, isBirch: true, seed: 73 }),
    pine_autumn:  buildPineTreeCanvas(PALETTES.autumnCrimson, PALETTES.barkDark, { seed: 79 }),

    volcano_pine1: buildBroadTreeCanvas(PALETTES.volcanoLush, PALETTES.barkDark, {
      lean: 2, seed: 89, boldFlowers: true,
      flowerPositions: [[19, 25], [36, 23], [27, 15], [21, 36], [37, 35], [29, 29]],
      flowerHex: '#ff2222', flowerHi: '#ff6e4a', flowerCenter: '#ffea44', flowerDark: '#a81010',
    }),
    volcano_pine2: buildVolcanoDeadTreeCanvas(),
    volcano_bush:  buildBushCanvas(PALETTES.volcanoLush, {
      seed: 101,
      flowerPositions: [[15, 26], [23, 20], [31, 26], [24, 30]],
      flowerHex: '#ff2424', flowerCenter: '#ffee44', flowerDark: '#b81414',
    }),

    palm1: buildPalmTreeCanvas(1),
    palm2: buildPalmTreeCanvas(-1),

    desert_red_tree1: buildBroadTreeCanvas(PALETTES.desertRed, PALETTES.barkDark, { lean: 3, flatTop: true, seed: 127 }),
    desert_red_tree2: buildBroadTreeCanvas(PALETTES.desertAcacia, PALETTES.barkDark, { lean: -2, flatTop: true, seed: 131 }),
    cactus1:          buildCactusCanvas(),
    desert_bush:      buildPlantFernCanvas(true),

    pine_snow1: buildPineTreeCanvas(PALETTES.snowPine, PALETTES.barkDark, { seed: 149, snowy: true }),
    pine_snow2: buildPineTreeCanvas(PALETTES.snowPine, PALETTES.barkDark, { seed: 157, snowy: true }),

    bush1: buildBushCanvas(PALETTES.lushGreen, {
      seed: 163,
      flowerPositions: [[16, 25], [25, 20], [31, 27]],
      flowerHex: '#3ba6ff', flowerCenter: '#ccf0ff', flowerDark: '#1c6ec4',
    }),
    bush_berry: buildBushCanvas(PALETTES.deepEmerald, {
      seed: 173,
      flowerPositions: [[15, 26], [23, 19], [31, 25], [22, 29]],
      flowerHex: '#ff2b38', flowerCenter: '#ffbb99', flowerDark: '#b51424',
    }),
    plant1:  buildPlantFernCanvas(false),
    woodlog: buildWoodlogCanvas(),
  };
}

let cachedSpriteTextures = null;

export function getPixelNatureTexture(key) {
  if (!cachedSpriteTextures) {
    const canvases = buildAllNatureSpriteCanvases();
    cachedSpriteTextures = {};
    for (const [k, pc] of Object.entries(canvases)) {
      cachedSpriteTextures[k] = pc.toTexture();
    }
  }
  return cachedSpriteTextures[key] || cachedSpriteTextures.common1;
}

// ============================================================================
// 4. SLOPE-HUGGING CYLINDRICAL BILLBOARD GEOMETRY (EXACT GROUNDED ANCHOR!)
// ============================================================================

export function createPixelBillboardPart(key, measuredWidth, measuredHeight, sun) {
  const tex = getPixelNatureTexture(key);
  const aspect = tex.image.width / Math.max(1, tex.image.height);
  const hugsSlope = isSlopeHuggingBillboardKey(key);

  let height = Math.max(0.8, measuredHeight || 4.0);
  if (key.includes('bush') || key === 'plant1') height = Math.max(height, 1.4);
  if (key === 'woodlog') height = Math.max(height * 1.1, 1.15);
  let width = height * aspect;
  if (measuredWidth && measuredWidth > 0.5) {
    width = THREE.MathUtils.clamp(width, measuredWidth * 0.72, measuredWidth * 1.48);
  }

  const hw = width * 0.5;
  // Exact grounded bottom yBot = 0.0 (NO double-sinking! Slope embed happens cleanly once in placement!)
  const yBot = 0.0;
  const yTop = height;

  const sw = hw * 0.78;
  const sd = hw * 0.52;

  const positions = new Float32Array([
    -hw, yBot, 0,
     hw, yBot, 0,
     hw, yTop, 0,
    -hw, yTop, 0,
    -sw, 0.0, -sd,
     sw, 0.0, -sd,
     sw, 0.0,  sd,
    -sw, 0.0,  sd,
  ]);

  const uvs = new Float32Array([
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
  ]);

  const isShadow = new Float32Array([0, 0, 0, 0, 1, 1, 1, 1]);
  const indices = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('aIsShadow', new THREE.BufferAttribute(isShadow, 1));
  geometry.setIndex(indices);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uMap: { value: tex },
      uTime: { value: 0.0 },
      uSunPosition: { value: sun ? sun.clone() : new THREE.Vector3(0.4, 0.7, 0.5) },
      uTint: { value: new THREE.Color(0xffffff) },
      uSlopeTilt: { value: hugsSlope ? 0.55 : 0.0 },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>

      attribute float aIsShadow;
      attribute vec3 aTerrainNormal;

      uniform float uTime;
      uniform float uSlopeTilt;

      varying vec2 vUv;
      varying float vIsShadow;
      varying float vVar;

      void main() {
        vIsShadow = aIsShadow;

        vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float instScale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
        vec3 tNorm = length(aTerrainNormal) > 0.1 ? normalize(aTerrainNormal) : vec3(0.0, 1.0, 0.0);

        float h = fract(sin(dot(instPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vVar = h;
        float flipX = h > 0.5 ? 1.0 : -1.0;

        vec3 worldPos;
        if (aIsShadow < 0.5) {
          vUv = vec2(flipX < 0.0 ? (1.0 - uv.x) : uv.x, uv.y);

          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 flatRight = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0));
          vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);

          vec3 baseUp = normalize(mix(vec3(0.0, 1.0, 0.0), tNorm, uSlopeTilt));
          vec3 billUp = normalize(mix(baseUp, camUp, 0.08));
          vec3 billRight = normalize(flatRight - billUp * dot(flatRight, billUp));

          float sway = floor(sin(uTime * 1.9 + instPos.x * 0.14 + instPos.z * 0.11) * 2.5) * 0.022 * uv.y * uv.y;
          worldPos = instPos
            + billRight * ((position.x + sway) * instScale)
            + billUp * (position.y * instScale);
        } else {
          vUv = uv;
          vec3 refX = abs(tNorm.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
          vec3 tangX = normalize(cross(tNorm, refX));
          vec3 tangZ = normalize(cross(tangX, tNorm));
          worldPos = instPos
            + tangX * (position.x * instScale)
            + tangZ * (position.z * instScale)
            + tNorm * 0.07;
        }

        vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>

      uniform sampler2D uMap;
      uniform vec3 uTint;

      varying vec2 vUv;
      varying float vIsShadow;
      varying float vVar;

      void main() {
        if (vIsShadow > 0.5) {
          vec2 p = vUv * 2.0 - 1.0;
          if (dot(p, p) > 1.0) discard;
          ivec2 fc = ivec2(gl_FragCoord.xy);
          if (((fc.x + fc.y) & 1) == 0) discard;
          gl_FragColor = vec4(0.03, 0.075, 0.05, 1.0);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          return;
        }

        vec4 texel = texture2D(uMap, vUv);
        if (texel.a < 0.5) discard;

        float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        float isInk = 1.0 - smoothstep(0.03, 0.10, luma);
        float brightVar = mix(0.93, 1.10, vVar);
        vec3 col = texel.rgb * uTint * mix(brightVar, 1.0, isInk);

        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    fog: true,
  });

  return { geometry, material, localMatrix: null, isPixelBillboard: true, measuredWidth: width, measuredHeight: height };
}

// ============================================================================
// 5. 8-TILE BIOME-AWARE PIXEL GRASS & FLOWER ATLAS (THICK BRIGHT BLADES!)
// ============================================================================

export function buildPixelGrassTileCanvases() {
  // 8 crisp 28x28 tiles with THICK 2-3px bright sunlit blades (like PokeBonk Image #5!)
  const S = 28;
  const tiles = [];

  const drawTuft = (pc, pal, blades) => {
    pc.fillEllipse(14, 25, 6.5, 2.5, pal.dark);
    for (const [x0, y0, cx, cy, x1, y1] of blades) {
      pc.drawThickCurve(x0, y0, cx, cy, x1, y1, 1.8, 0.85, (t) => (t > 0.65 ? pal.hi : (t > 0.30 ? pal.midHi : pal.mid)), 12);
    }
  };

  // 0: Meadow bright lush tuft (Image #5 foreground style!)
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, PALETTES.lushGreen, [
      [10, 25, 6,  18, 4,  12],
      [13, 25, 11, 15, 10, 8],
      [15, 25, 16, 15, 18, 9],
      [18, 25, 21, 18, 24, 13],
    ]);
    pc.applyOutline('#0e1419');
    tiles.push(pc);
  }

  // 1: Meadow bushy fern clump
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, PALETTES.deepEmerald, [
      [9,  25, 5,  20, 3,  15],
      [12, 25, 9,  16, 7,  9],
      [14, 25, 14, 14, 14, 6],
      [16, 25, 19, 16, 21, 9],
      [19, 25, 23, 20, 25, 15],
    ]);
    pc.applyOutline('#0e1419');
    tiles.push(pc);
  }

  // 2: Meadow vibrant red & yellow wildflowers (requireOpaque=false so flowers ALWAYS pop!)
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, PALETTES.lushGreen, [
      [10, 25, 7,  20, 5,  15],
      [14, 25, 14, 17, 14, 11],
      [18, 25, 21, 20, 23, 15],
    ]);
    pc.drawCrispFlowers([[7, 15], [14, 11]], '#ff2b2b', '#ffee55', '#b81414', false);
    pc.drawCrispFlowers([[21, 15]], '#ffdd33', '#ffffff', '#e6991a', false);
    pc.applyOutline('#0e1419');
    tiles.push(pc);
  }

  // 3: Autumn golden wheat & crimson fallen leaves
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, PALETTES.autumnGold, [
      [10, 25, 6,  18, 4,  12],
      [14, 25, 13, 15, 12, 8],
      [18, 25, 21, 17, 23, 12],
    ]);
    pc.drawCrispFlowers([[8, 20], [20, 19]], '#e82e24', '#ffaa22', '#991818', false);
    pc.applyOutline('#1a100c');
    tiles.push(pc);
  }

  // 4: Desert spiky blue-green agave & blooming barrel cactus
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, { hi: '#b5cc58', midHi: '#7e9938', mid: '#516924', dark: '#304015' }, [
      [9, 25, 5, 21, 3, 17],
      [19, 25, 23, 21, 25, 17],
    ]);
    pc.fillEllipse(14, 19, 5.5, 6.0, '#3aa335');
    pc.fillEllipse(12, 18, 2.2, 4.5, '#7ee042');
    pc.fillEllipse(16, 20, 2.2, 4.5, '#1b6324');
    pc.drawCrispFlowers([[14, 12]], '#ff4d94', '#ffe066', '#c42b6b', false);
    pc.applyOutline('#17120e');
    tiles.push(pc);
  }

  // 5: Volcano dark bluish-slate volcanic fern & glowing scarlet hibiscus (like Image #2!)
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, { hi: '#a3cfba', midHi: '#5e917d', mid: '#32544a', dark: '#1c2e2b' }, [
      [10, 25, 6, 18, 4, 12],
      [14, 25, 14, 15, 14, 8],
      [18, 25, 22, 18, 24, 12],
    ]);
    pc.drawCrispFlowers([[9, 16], [19, 15]], '#ff2424', '#ffea44', '#b81414', false);
    pc.applyOutline('#0d0e14');
    tiles.push(pc);
  }

  // 6: Snow frosted winter tuft & icy crystal flowers
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, { hi: '#ffffff', midHi: '#b8ecff', mid: '#5ca3bf', dark: '#2d5c73' }, [
      [10, 25, 6, 18, 5, 12],
      [14, 25, 14, 15, 14, 9],
      [18, 25, 22, 18, 23, 12],
    ]);
    pc.drawCrispFlowers([[14, 12]], '#6ee7ff', '#ffffff', '#2998c4', false);
    pc.applyOutline('#101d29');
    tiles.push(pc);
  }

  // 7: Coast breezy golden sea-oats & tropical coral flowers
  {
    const pc = new PixelCanvas(S, S);
    drawTuft(pc, { hi: '#fff08a', midHi: '#c8d64b', mid: '#5ca332', dark: '#2e6620' }, [
      [10, 25, 6, 16, 4, 9],
      [14, 25, 13, 14, 14, 6],
      [18, 25, 22, 16, 24, 10],
    ]);
    pc.drawCrispFlowers([[18, 17], [9, 18]], '#ff5c8a', '#fff078', '#c92a5e', false);
    pc.applyOutline('#121814');
    tiles.push(pc);
  }

  return tiles;
}

export function createPixelGrassAtlasTexture() {
  const tiles = buildPixelGrassTileCanvases();
  const S = tiles[0].w;
  const canvas = document.createElement('canvas');
  canvas.width = S * tiles.length;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  tiles.forEach((pc, idx) => {
    ctx.putImageData(new ImageData(pc.data, S, S), idx * S, 0);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function createPixelGrassGeometry() {
  const w = 0.88;
  const h = 0.82;
  const hw = w * 0.5;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -hw, -0.02, 0,
     hw, -0.02, 0,
     hw,  h,    0,
    -hw,  h,    0,
  ]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  return geo;
}

export function createPixelGrassMaterial(sun) {
  const atlasTex = createPixelGrassAtlasTexture();
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uAtlas: { value: atlasTex },
      uTime: { value: 0.0 },
      uCameraPos: { value: new THREE.Vector3() },
      uFadeStart: { value: 84.0 },
      uFadeEnd: { value: 140.0 },
      uSunPosition: { value: new THREE.Vector3().copy(sun) },
      uSunColor: { value: new THREE.Color(0xfff6e3) },
      uHemiSky: { value: new THREE.Color(0x8ec3f8) },
      uHemiGround: { value: new THREE.Color(0x485838) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>

      attribute vec3 aInstanceColor;
      attribute float aFlowerType;
      attribute float aBiomeId;

      uniform float uTime;
      uniform vec3 uCameraPos;
      uniform float uFadeStart;
      uniform float uFadeEnd;

      varying vec2 vUv;
      varying vec3 vTint;
      varying float vNativeColor;

      void main() {
        vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float instScale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));

        float dist = distance(instPos, uCameraPos);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dist);

        float h = fract(sin(dot(instPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float tileIdx = 0.0;
        vNativeColor = 1.0;

        if (aBiomeId > 4.5) tileIdx = 7.0;
        else if (aBiomeId > 3.5) tileIdx = 6.0;
        else if (aBiomeId > 2.5) tileIdx = 5.0;
        else if (aBiomeId > 1.5) tileIdx = 4.0;
        else if (aBiomeId > 0.5) tileIdx = 3.0;
        else {
          if (aFlowerType >= 0.0) tileIdx = 2.0;
          else {
            tileIdx = h > 0.5 ? 1.0 : 0.0;
            vNativeColor = 0.55;
          }
        }

        float flipX = fract(h * 17.3) > 0.5 ? 1.0 : 0.0;
        float uLocal = mix(uv.x, 1.0 - uv.x, flipX);
        vUv = vec2((tileIdx + uLocal) / 8.0, uv.y);
        vTint = aInstanceColor;

        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 flatRight = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0));
        vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 billUp = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, 0.14));

        float sway = floor(sin(uTime * 2.4 + instPos.x * 0.35 + instPos.z * 0.28) * 2.0) * 0.025 * uv.y;
        float s = instScale * fade;
        vec3 worldPos = instPos + flatRight * ((position.x + sway) * s) + billUp * (position.y * s);

        vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>

      uniform sampler2D uAtlas;

      varying vec2 vUv;
      varying vec3 vTint;
      varying float vNativeColor;

      void main() {
        vec4 texel = texture2D(uAtlas, vUv);
        if (texel.a < 0.5) discard;

        float luma = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        float isInk = 1.0 - smoothstep(0.03, 0.10, luma);
        vec3 biomeLift = clamp(vTint * 2.35 + vec3(0.16), vec3(0.65), vec3(1.22));
        vec3 col = mix(texel.rgb * biomeLift, texel.rgb * 1.05, max(isInk, vNativeColor));

        gl_FragColor = vec4(col, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    fog: true,
  });
}

// ============================================================================
// 6. HAND-CRAFTED 12-TILE SEAMLESS PIXEL-ART GROUND ATLAS (256x192, 4x3 GRID)
// ============================================================================

/**
 * Generates 12 richly detailed seamless 64x64 pixel-art ground tiles (ZERO edge seams!):
 *   Row 0: 0=Lush Pixel Grass, 1=Sunlit Clover & Wildflowers, 2=Earth/Pebbles/Moss, 3=Beach Sand & Shells
 *   Row 1: 4=Autumn Golden Turf, 5=Fallen Maple Leaf Carpet, 6=Desert Wind Dunes, 7=Cracked Desert Clay
 *   Row 2: 8=Volcanic Scoria/Ash, 9=Molten Lava-Veined Basalt, 10=Sculpted Snow Drifts, 11=Frosted Glacier Slate
 */
export function buildPixelGroundAtlasCanvases() {
  const S = 64;
  const tiles = [];

  // Periodic multi-octave value noise (exact seamless wrap mod S!)
  const makeTileNoise = (seed) => {
    const rng = makeRng(seed);
    const grid = new Float32Array(S * S);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    const sampleFreq = (x, y, freq) => {
      const fx = (x / S) * freq;
      const fy = (y / S) * freq;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const ux = tx * tx * (3 - 2 * tx);
      const uy = ty * ty * (3 - 2 * ty);
      const get = (gx, gy) => {
        const wx = ((gx % freq) + freq) % freq;
        const wy = ((gy % freq) + freq) % freq;
        return grid[wy * S + wx];
      };
      const a = get(ix, iy), b = get(ix + 1, iy);
      const c = get(ix, iy + 1), d = get(ix + 1, iy + 1);
      return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
    };
    return (x, y) => sampleFreq(x, y, 4) * 0.50 + sampleFreq(x, y, 8) * 0.30 + sampleFreq(x, y, 16) * 0.20;
  };

  // Helper: Voronoi crack distance (exact seamless wrap mod S!) for basalt plates & cracked desert clay
  const makeVoronoiCracks = (seed, count) => {
    const rng = makeRng(seed);
    const pts = [];
    for (let i = 0; i < count; i++) pts.push([rng() * S, rng() * S, rng()]);
    return (x, y) => {
      let d1 = 999, d2 = 999, cellId = 0;
      for (let i = 0; i < pts.length; i++) {
        let dx = Math.abs(x - pts[i][0]);
        let dy = Math.abs(y - pts[i][1]);
        if (dx > S * 0.5) dx = S - dx;
        if (dy > S * 0.5) dy = S - dy;
        const d = Math.hypot(dx, dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          cellId = pts[i][2];
        } else if (d < d2) {
          d2 = d;
        }
      }
      return { edgeDist: d2 - d1, cellId };
    };
  };

  // Helper: draw tiny seamless hand-pixelled grass tuft stroke
  const drawMiniBladeTuft = (pc, x, y, cDark, cMid, cHi, dir = 1) => {
    pc.setWrap(x, y + 1, cDark);
    pc.setWrap(x + 1, y + 1, cDark);
    pc.setWrap(x, y, cMid);
    pc.setWrap(x + 1, y, cMid);
    pc.setWrap(x - dir, y - 1, cMid);
    pc.setWrap(x + dir, y - 1, cHi);
    pc.setWrap(x + dir * 2, y - 2, cHi);
  };

  // Helper: draw seamless tiny rounded pixel pebble
  const drawPebble = (pc, cx, cy, rx, ry, cHi, cMid, cDark) => {
    pc.fillEllipseWrap(cx, cy + 1, rx, ry, cDark);
    pc.fillEllipseWrap(cx, cy, rx, ry, cMid);
    pc.setWrap(cx - Math.max(0, rx - 1), cy - Math.max(0, ry - 1), cHi);
  };

  // --- TILE 0: Lush Hand-Painted Pixel Grass Turf (balanced natural emerald, not neon!) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(101);
    const rng = makeRng(102);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n(x, y) + ((((x & 1) ^ (y & 1)) ? 0.035 : -0.035));
        const col = v > 0.64 ? '#399e32' : (v > 0.45 ? '#2d8a2a' : (v > 0.28 ? '#237324' : '#1b5c1e'));
        pc.set(x, y, col);
      }
    }
    for (let i = 0; i < 95; i++) {
      const gx = Math.floor(rng() * S);
      const gy = Math.floor(rng() * S);
      const bright = rng() > 0.48;
      drawMiniBladeTuft(
        pc, gx, gy,
        '#154d19',
        bright ? '#43a834' : '#277d26',
        bright ? '#76c744' : '#53b038',
        rng() > 0.5 ? 1 : -1
      );
    }
    for (let i = 0; i < 12; i++) {
      drawPebble(pc, Math.floor(rng() * S), Math.floor(rng() * S), 1.4, 1.0, '#6a8258', '#425938', '#173b1a');
    }
    tiles.push(pc);
  }

  // --- TILE 1: Sunlit Clover, Moss & Micro-Wildflower Meadow (warm natural meadow green) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(111);
    const rng = makeRng(112);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n(x, y) + ((((x & 1) ^ (y & 1)) ? 0.035 : -0.035));
        const col = v > 0.62 ? '#4db038' : (v > 0.42 ? '#3a992f' : (v > 0.25 ? '#2c8228' : '#216922'));
        pc.set(x, y, col);
      }
    }
    for (let i = 0; i < 72; i++) {
      const gx = Math.floor(rng() * S);
      const gy = Math.floor(rng() * S);
      drawMiniBladeTuft(pc, gx, gy, '#1d6120', '#48a834', '#86cf4a', rng() > 0.5 ? 1 : -1);
    }
    for (let i = 0; i < 18; i++) {
      const fx = Math.floor(rng() * S);
      const fy = Math.floor(rng() * S);
      const r = rng();
      const petal = r < 0.48 ? '#f5eed4' : (r < 0.80 ? '#f0cf4a' : '#e05348');
      const center = r < 0.48 ? '#e6be45' : '#fff8e0';
      pc.setWrap(fx, fy + 1, '#19541c');
      pc.setWrap(fx - 1, fy, petal);
      pc.setWrap(fx + 1, fy, petal);
      pc.setWrap(fx, fy - 1, petal);
      pc.setWrap(fx, fy, center);
    }
    tiles.push(pc);
  }

  // --- TILE 2: Rich Earth, Pebbles, Roots & Mossy Dirt Clearing ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(121);
    const rng = makeRng(122);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n(x, y) + ((((x & 1) ^ (y & 1)) ? 0.05 : -0.05));
        const col = v > 0.68 ? '#91673e' : (v > 0.48 ? '#78502e' : (v > 0.28 ? '#5e3c21' : '#422816'));
        pc.set(x, y, col);
      }
    }
    // Organic soil clods & warm grit
    for (let i = 0; i < 65; i++) {
      const dx = Math.floor(rng() * S), dy = Math.floor(rng() * S);
      pc.setWrap(dx, dy, rng() > 0.5 ? '#a3774b' : '#362011');
      pc.setWrap(dx + 1, dy, '#4d301a');
    }
    // Multi-tone rounded pixel pebbles & stepping stones!
    for (let i = 0; i < 26; i++) {
      const px = Math.floor(rng() * S), py = Math.floor(rng() * S);
      const big = rng() > 0.72;
      drawPebble(
        pc, px, py,
        big ? 2.6 : 1.5, big ? 1.8 : 1.1,
        big ? '#b8b0a2' : '#a88c6c',
        big ? '#857d73' : '#7a634b',
        '#2e1c10'
      );
    }
    // Stray moss tufts peeking along dirt clearings
    for (let i = 0; i < 16; i++) {
      drawMiniBladeTuft(pc, Math.floor(rng() * S), Math.floor(rng() * S), '#185419', '#2e8c22', '#64c42b', 1);
    }
    tiles.push(pc);
  }

  // --- TILE 3: Soft Golden Beach Sand & Tiny Seashells (organic grain, subtle gentle ripples) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(131);
    const rng = makeRng(132);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wave = Math.sin((y * 1.0 + x * 1.0) * (Math.PI * 2 / S) + n(x, y) * 3.8);
        const v = wave * 0.14 + n(x, y) * 0.86 + ((((x & 1) ^ (y & 1)) ? 0.03 : -0.03));
        const col = v > 0.64 ? '#ebd7a2' : (v > 0.44 ? '#dec48a' : (v > 0.25 ? '#cdb076' : '#ba9c63'));
        pc.set(x, y, col);
      }
    }
    for (let i = 0; i < 20; i++) {
      const sx = Math.floor(rng() * S), sy = Math.floor(rng() * S);
      if (rng() > 0.5) {
        drawPebble(pc, sx, sy, 1.5, 1.1, '#f5ebd0', '#bfa988', '#8c7246');
      } else {
        pc.setWrap(sx, sy + 1, '#9e8250');
        pc.setWrap(sx, sy, '#ebb0be');
        pc.setWrap(sx + 1, sy, '#f7ecee');
        pc.setWrap(sx, sy - 1, '#fcf8f2');
      }
    }
    tiles.push(pc);
  }

  // --- TILE 4: Autumn Golden Turf & Woodland Loam (cozy warm ochre, not neon) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(141);
    const rng = makeRng(142);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n(x, y) + ((((x & 1) ^ (y & 1)) ? 0.035 : -0.035));
        const col = v > 0.64 ? '#bd8f38' : (v > 0.44 ? '#a3752b' : (v > 0.26 ? '#855b22' : '#634118'));
        pc.set(x, y, col);
      }
    }
    for (let i = 0; i < 75; i++) {
      drawMiniBladeTuft(pc, Math.floor(rng() * S), Math.floor(rng() * S), '#573715', '#ab7c2c', '#d9ae4e', rng() > 0.5 ? 1 : -1);
    }
    tiles.push(pc);
  }

  // --- TILE 5: Dense Fallen Pixel Leaf Carpet (cozy rich autumn palette!) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(151);
    const rng = makeRng(152);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const v = n(x, y);
        pc.set(x, y, v > 0.5 ? '#523420' : '#3b2416');
      }
    }
    const leafColors = [
      ['#e0b34c', '#c4832b', '#7a4018'],
      ['#db7b3b', '#b84f25', '#6e2816'],
      ['#c9463c', '#992826', '#541417'],
      ['#bf8f36', '#8f5e20', '#523212'],
    ];
    for (let i = 0; i < 160; i++) {
      const lx = Math.floor(rng() * S), ly = Math.floor(rng() * S);
      const [cHi, cMid, cDark] = leafColors[Math.floor(rng() * leafColors.length)];
      pc.setWrap(lx, ly + 1, cDark);
      pc.setWrap(lx + 1, ly + 1, cDark);
      pc.setWrap(lx, ly, cMid);
      pc.setWrap(lx + 1, ly, cMid);
      pc.setWrap(lx + 2, ly, cDark);
      pc.setWrap(lx + (rng() > 0.5 ? 0 : 1), ly - 1, cHi);
    }
    tiles.push(pc);
  }

  // --- TILE 6: Natural Sun-Baked Red-Ochre Desert Sand & Grit (ZERO loud zebra stripes!) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(161);
    const rng = makeRng(162);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // Organic mottled dusty desert sand with only a whisper of soft wind contour
        const gentleWind = Math.sin((y * 1.0 + x * 1.0) * (Math.PI * 2 / S) + n(x, y) * 4.5);
        const v = n(x, y) * 0.85 + gentleWind * 0.15 + ((((x & 1) ^ (y & 1)) ? 0.03 : -0.03));
        const col = v > 0.66 ? '#cf8c5b' : (v > 0.46 ? '#bf7b4b' : (v > 0.26 ? '#ad693d' : '#965731'));
        pc.set(x, y, col);
      }
    }
    // Natural dusty sand grain, tiny dry desert grit & scattered sandstone pebbles
    for (let i = 0; i < 65; i++) {
      const gx = Math.floor(rng() * S), gy = Math.floor(rng() * S);
      pc.setWrap(gx, gy, rng() > 0.5 ? '#d99c6c' : '#854a28');
    }
    for (let i = 0; i < 28; i++) {
      drawPebble(pc, Math.floor(rng() * S), Math.floor(rng() * S), rng() > 0.72 ? 2.1 : 1.3, 1.1, '#deb083', '#a3653e', '#69391e');
    }
    tiles.push(pc);
  }

  // --- TILE 7: Softened Cracked Sun-Baked Desert Clay & Sandstone Pebbles ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(171);
    const vor = makeVoronoiCracks(172, 16);
    const rng = makeRng(173);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const { edgeDist, cellId } = vor(x, y);
        const v = n(x, y);
        if (edgeDist < 0.95) {
          pc.set(x, y, '#6e371f'); // Subtle natural dry mud fissure (not harsh black!)
        } else if (edgeDist < 1.85) {
          pc.set(x, y, '#944f2e');
        } else {
          const tone = v * 0.65 + cellId * 0.35;
          pc.set(x, y, tone > 0.64 ? '#cc8252' : (tone > 0.38 ? '#b86f42' : '#a35d35'));
        }
      }
    }
    for (let i = 0; i < 22; i++) {
      drawPebble(pc, Math.floor(rng() * S), Math.floor(rng() * S), 1.6, 1.2, '#e0ba90', '#b07b50', '#69371e');
    }
    tiles.push(pc);
  }

  // --- TILE 8: Volcanic Basalt Scoria, Ash & Cinder Crust (PokeBonk Crater Floor!) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(181);
    const vor = makeVoronoiCracks(182, 18);
    const rng = makeRng(183);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const { edgeDist, cellId } = vor(x, y);
        const v = n(x, y);
        if (edgeDist < 1.1) {
          pc.set(x, y, '#141117'); // Deep obsidian rock fracture!
        } else {
          const t = v * 0.65 + cellId * 0.35;
          // Rich dark charcoal basalt + warm scorched iron-umber crust (exact new screenshot mood!)
          const col = t > 0.72 ? '#594a44' : (t > 0.52 ? '#42383a' : (t > 0.32 ? '#2e292e' : '#1f1c22'));
          pc.set(x, y, col);
        }
      }
    }
    // Scattered volcanic scoria stones, warm rust ash specks & ember flecks
    for (let i = 0; i < 38; i++) {
      const px = Math.floor(rng() * S), py = Math.floor(rng() * S);
      drawPebble(pc, px, py, rng() > 0.7 ? 2.2 : 1.3, 1.2, '#736560', '#3d363b', '#120f14');
    }
    for (let i = 0; i < 14; i++) {
      const ex = Math.floor(rng() * S), ey = Math.floor(rng() * S);
      pc.setWrap(ex, ey, '#d94814');
      pc.setWrap(ex + 1, ey, '#ff8c24');
    }
    tiles.push(pc);
  }

  // --- TILE 9: Molten Lava-Veined Crater Floor (moody basalt + glowing ember seams, not loud!) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(191);
    const vor = makeVoronoiCracks(192, 12);
    const rng = makeRng(193);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const { edgeDist, cellId } = vor(x, y);
        const v = n(x, y);
        if (edgeDist < 0.72) {
          pc.set(x, y, v > 0.45 ? '#f5b83d' : '#e06319');
        } else if (edgeDist < 1.55) {
          pc.set(x, y, v > 0.45 ? '#ad3012' : '#6e1b12');
        } else if (edgeDist < 2.6) {
          pc.set(x, y, '#2e1d1c');
        } else {
          const t = v * 0.6 + cellId * 0.4;
          pc.set(x, y, t > 0.58 ? '#383238' : (t > 0.34 ? '#272329' : '#1b1820'));
        }
      }
    }
    for (let i = 0; i < 20; i++) {
      drawPebble(pc, Math.floor(rng() * S), Math.floor(rng() * S), 1.5, 1.1, '#544b50', '#2b262e', '#100d14');
    }
    tiles.push(pc);
  }

  // --- TILE 10: Soft Sculpted Pixel Snow Drifts (natural snow grain, ZERO loud stripes!) ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(201);
    const rng = makeRng(202);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const drift = Math.sin((y * 1.0 + x * 1.0) * (Math.PI * 2 / S) + n(x, y) * 4.0);
        const v = n(x, y) * 0.84 + drift * 0.16 + ((((x & 1) ^ (y & 1)) ? 0.025 : -0.025));
        const col = v > 0.64 ? '#f5fbff' : (v > 0.42 ? '#e1f0fa' : (v > 0.24 ? '#cae1f2' : '#b2cfe6'));
        pc.set(x, y, col);
      }
    }
    for (let i = 0; i < 22; i++) {
      const sx = Math.floor(rng() * S), sy = Math.floor(rng() * S);
      pc.setWrap(sx, sy, '#ffffff');
      pc.setWrap(sx + 1, sy, '#d6f0fc');
    }
    tiles.push(pc);
  }

  // --- TILE 11: Frosted Glacier Slate, Cracked Ice & Alpine Moss ---
  {
    const pc = new PixelCanvas(S, S);
    const n = makeTileNoise(211);
    const vor = makeVoronoiCracks(212, 16);
    const rng = makeRng(213);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const { edgeDist, cellId } = vor(x, y);
        const v = n(x, y);
        if (edgeDist < 1.25) {
          pc.set(x, y, '#d9f6ff'); // Snow/ice filled glacier crack!
        } else if (edgeDist < 2.2) {
          pc.set(x, y, '#79c2de');
        } else {
          const t = v * 0.6 + cellId * 0.4;
          pc.set(x, y, t > 0.62 ? '#6e8ba1' : (t > 0.36 ? '#4e6980' : '#354b61'));
        }
      }
    }
    // Frost-dusted alpine moss specks & glacier pebbles
    for (let i = 0; i < 18; i++) {
      drawMiniBladeTuft(pc, Math.floor(rng() * S), Math.floor(rng() * S), '#1d4745', '#2e6e68', '#8ad9d2', 1);
    }
    tiles.push(pc);
  }

  return tiles;
}

let cachedGroundAtlasTex = null;

export function createPixelGroundAtlasTexture() {
  if (cachedGroundAtlasTex) return cachedGroundAtlasTex;
  const tiles = buildPixelGroundAtlasCanvases();
  const S = 64, COLS = 4, ROWS = 3;
  const canvas = document.createElement('canvas');
  canvas.width = COLS * S;
  canvas.height = ROWS * S;
  const ctx = canvas.getContext('2d');
  tiles.forEach((pc, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    ctx.putImageData(new ImageData(pc.data, S, S), col * S, row * S);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cachedGroundAtlasTex = tex;
  return tex;
}

// ============================================================================
// 7. POKEBONK TERRAIN (12-TILE MULTI-SURFACE + ANTI-REPETITION + CLIFFS!)
// ============================================================================

const PIXEL_HASH_GLSL = /* glsl */ `
  float pxHash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float pxValueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = pxHash21(i);
    float b = pxHash21(i + vec2(1.0, 0.0));
    float c = pxHash21(i + vec2(0.0, 1.0));
    float d = pxHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float pxFbm(vec2 p) {
    return pxValueNoise(p) * 0.56 + pxValueNoise(p * 2.07 + vec2(17.3, 9.1)) * 0.29 + pxValueNoise(p * 4.19 + vec2(5.7, 23.4)) * 0.15;
  }
  vec3 pxBoostSat(vec3 c, float s) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    return max(vec3(0.0), mix(vec3(l), c, s));
  }
  float pxBayer2(vec2 fragCoord) {
    ivec2 c = ivec2(mod(floor(fragCoord), 2.0));
    int idx = c.x + c.y * 2;
    if (idx == 0) return -0.35;
    if (idx == 1) return  0.15;
    if (idx == 2) return  0.35;
    return -0.15;
  }
`;

const TOON_LIGHT_SNIPPET_GLSL = /* glsl */ `
  #include <lights_fragment_end>
  {
    float dLuma = max(0.0001, dot(reflectedLight.directDiffuse, vec3(0.299, 0.587, 0.114)));
    float band = (dLuma < 0.14) ? 0.09 : ((dLuma < 0.42) ? 0.37 : ((dLuma < 0.78) ? 0.74 : 1.08));
    reflectedLight.directDiffuse *= mix(1.0, band / dLuma, 0.74);
    float sLuma = dot(reflectedLight.directSpecular, vec3(0.299, 0.587, 0.114));
    reflectedLight.directSpecular *= smoothstep(0.16, 0.24, sLuma) * 1.18;
  }
`;

export function patchTerrainMaterialForPixelTheme(m) {
  m.roughness = 0.96;
  m.metalness = 0.0;
  if (m.map) {
    m.map.magFilter = THREE.NearestFilter;
    m.map.minFilter = THREE.NearestFilter;
    m.map.generateMipmaps = false;
    m.map.needsUpdate = true;
  }
  const groundAtlasTex = createPixelGroundAtlasTexture();

  m.customProgramCacheKey = () => 'pixel_theme_terrain_v4_atlas';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundAtlas = { value: groundAtlasTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPxWorldPos;\nvarying vec3 vPxWorldNorm;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vPxWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vPxWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform sampler2D uGroundAtlas;
         varying vec3 vPxWorldPos;
         varying vec3 vPxWorldNorm;
         ${PIXEL_HASH_GLSL}

         // Bleed-free exact-texel-center sampler for the 4x3 64x64 pixel ground atlas!
         // Note: Canvas row 0 is at v=1.0 in WebGL (flipY=true), so rowIdx 0 -> rowY = 2.0.
         vec3 sampleGroundTile(vec2 worldXZ, float tileMeters, float colIdx, float rowIdx, float rotQuarter) {
           vec2 uv = fract(worldXZ / tileMeters);
           // Anti-repetition macro 90-degree orientation variation
           if (rotQuarter > 2.5) uv = vec2(1.0 - uv.y, uv.x);
           else if (rotQuarter > 1.5) uv = vec2(1.0 - uv.x, 1.0 - uv.y);
           else if (rotQuarter > 0.5) uv = vec2(uv.y, 1.0 - uv.x);
           // Snap strictly to texel center inside 64x64 tile (ZERO atlas bleed!)
           vec2 snapped = (floor(uv * 64.0) + 0.5) / 64.0;
           float webglRow = 2.0 - rowIdx;
           vec2 atlasUv = vec2((colIdx + snapped.x) / 4.0, (webglRow + snapped.y) / 3.0);
           return texture2D(uGroundAtlas, atlasUv).rgb;
         }`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         // 1. Evaluate exact world-space biome weights matching the map & atmosphere!
         float wx = vPxWorldPos.x;
         float wy = -vPxWorldPos.z;
         float wzH = vPxWorldPos.y;
         float wyBioW = wy + 26.0 * sin(wx * 0.014 + 0.5);
         float wxBioE = wx + 28.0 * cos(wy * 0.013 - 0.4);
         float wyBioN = wy + 26.0 * sin(wx * 0.012 + 1.1);

         float dVolc = length(vec2((wxBioE - 1140.0) / 1.18, (wyBioW - 75.0) / 1.12));
         float wVolcano = 1.0 - smoothstep(320.0, 560.0, dVolc);

         float canyonNorthFar = 330.0 + 330.0 * (1.0 - smoothstep(-1150.0, -800.0, wxBioE));
         float wDesert = (1.0 - smoothstep(-340.0, -85.0, wxBioE))
           * smoothstep(-940.0, -680.0, wyBioW)
           * (1.0 - smoothstep(canyonNorthFar, canyonNorthFar + 160.0, wyBioW))
           * (1.0 - wVolcano);

         float inNorthGlacier = smoothstep(700.0, 960.0, wyBioN)
           * (1.0 - smoothstep(140.0, 380.0, wxBioE))
           * smoothstep(-1380.0, -1020.0, wxBioE);
         float inTouge = smoothstep(110.0, 290.0, wyBioN)
           * (1.0 - smoothstep(800.0, 1060.0, wyBioN))
           * smoothstep(-620.0, -400.0, wxBioE)
           * (1.0 - smoothstep(90.0, 280.0, wxBioE));
         float wSnow = max(inNorthGlacier, inTouge) * (1.0 - wDesert) * (1.0 - wVolcano);

         float wAutumn = smoothstep(85.0, 320.0, wxBioE) * smoothstep(55.0, 275.0, wyBioN)
           * (1.0 - wVolcano) * (1.0 - wSnow * 0.85);
         float wCoast = (1.0 - smoothstep(-580.0, -455.0, wy)) * (1.0 - wDesert * 0.88) * (1.0 - wVolcano);

         // 2. Domain-warped organic multi-scale noise fields + pixel Bayer dither (ZERO repetitive grid!)
         vec2 wp = vPxWorldPos.xz;
         float warpX = pxFbm(wp * 0.022 + vec2(3.1, 7.4));
         float warpZ = pxFbm(wp * 0.022 + vec2(19.7, 2.3));
         vec2 warpedP = wp + vec2(warpX - 0.5, warpZ - 0.5) * 18.0;

         float macroPatch = pxFbm(warpedP * 0.032);       // Broad ~32m natural clearings / sub-zones
         float midVein    = pxFbm(warpedP * 0.088 + 4.1); // Winding ~12m soil/clover/magma/ice veins
         // Organic jagged pixel-edge dither (eliminates mechanical 2x2 brown checkerboard stripes!)
         float edgeJitter = (pxHash21(floor(wp * 5.2)) - 0.5) * 0.055 + pxBayer2(floor(wp * 6.5)) * 0.025;

         // Anti-repetition macro tile rotation (breaks any repeating pattern across 1km highways!)
         vec2 macroCell = floor(warpedP / 16.0);
         float rotQ = floor(pxHash21(macroCell) * 4.0);
         float tileMeters = 5.4; // Crisp ~8.4cm hand-painted pixel-art texels!

         // Pick dominant biome with crisp organic pixel-art edge transitions!
         float bioDither = edgeJitter * 0.75;
         float mA = macroPatch + edgeJitter;
         float mB = midVein + edgeJitter;

         vec3 groundCol;
         float isVolcanoZone = 0.0;
         float isGreenZone = 0.0;
         float isDesertZone = 0.0;
         float isSnowZone = 0.0;

         if (wVolcano + bioDither > 0.48) {
           isVolcanoZone = 1.0;
           // Volcano Crater: Scoria Ash + Occasional Glowing Magma Veins + Scorched Clay
           if (mB > 0.72) {
             groundCol = sampleGroundTile(wp, tileMeters * 0.92, 1.0, 2.0, rotQ);
           } else if (mA < 0.34) {
             groundCol = sampleGroundTile(wp, tileMeters, 3.0, 1.0, rotQ) * vec3(0.56, 0.44, 0.40);
           } else {
             groundCol = sampleGroundTile(wp, tileMeters, 0.0, 2.0, rotQ);
           }
         } else if (wDesert + bioDither > 0.46) {
           isDesertZone = 1.0;
           // Desert Mesa: Natural Sun-Baked Sand + Soft Cracked Clay + Red Gravel Beds (with rotQ!)
           if (mB > 0.62) {
             groundCol = sampleGroundTile(wp, tileMeters, 3.0, 1.0, rotQ);
           } else if (mA < 0.28) {
             groundCol = sampleGroundTile(wp, tileMeters * 0.9, 2.0, 0.0, rotQ) * vec3(1.18, 0.90, 0.72);
           } else {
             groundCol = sampleGroundTile(wp, tileMeters * 1.1, 2.0, 1.0, rotQ);
           }
         } else if (wSnow + bioDither > 0.46) {
           isSnowZone = 1.0;
           // Alpine Snow & Glacier: Soft Snow Drifts + Frosted Glacier Slate + Dark Alpine Rock
           if (mB > 0.60 || wzH < 18.0 && mA < 0.46) {
             groundCol = sampleGroundTile(wp, tileMeters, 3.0, 2.0, rotQ);
           } else if (mA < 0.24) {
             groundCol = sampleGroundTile(wp, tileMeters, 0.0, 2.0, rotQ) * vec3(0.95, 1.08, 1.24);
           } else {
             groundCol = sampleGroundTile(wp, tileMeters * 1.1, 2.0, 2.0, rotQ);
           }
         } else if (wAutumn + bioDither > 0.46) {
           // Autumn Forest: Cozy Golden Turf + Fallen Leaf Carpet + Woodland Earth/Pebbles
           if (mA > 0.50 || mB > 0.64) {
             groundCol = sampleGroundTile(wp, tileMeters * 0.92, 1.0, 1.0, rotQ);
           } else if (mA < 0.28) {
             groundCol = sampleGroundTile(wp, tileMeters, 2.0, 0.0, rotQ);
           } else {
             groundCol = sampleGroundTile(wp, tileMeters, 0.0, 1.0, rotQ);
           }
         } else if (wCoast + bioDither > 0.44 || wzH < -0.25) {
           // Tropical Coast & Beach: Soft Golden Sand & Shells + Damp Pebble Shore + Coastal Dunes
           if (wzH > 2.4 && mA > 0.54) {
             isGreenZone = 1.0;
             groundCol = sampleGroundTile(wp, tileMeters, 1.0, 0.0, rotQ);
           } else if (mB > 0.68) {
             groundCol = sampleGroundTile(wp, tileMeters, 2.0, 0.0, rotQ) * vec3(1.18, 1.12, 0.94);
           } else {
             groundCol = sampleGroundTile(wp, tileMeters * 1.1, 3.0, 0.0, rotQ);
           }
         } else {
           isGreenZone = 1.0;
           // Lush Meadow / Valley: 3 interlocking hand-painted pixel grounds!
           //   - Lush Emerald Pixel Grass Turf (main)
           //   - Sunlit Clover & Micro-Wildflower Meadow clearings
           //   - Warm Woodland Earth, Pebbles & Mossy Dirt patches (breaks up green monotony!)
           if (mA < 0.27 && mB > 0.44) {
             groundCol = sampleGroundTile(wp, tileMeters * 0.95, 2.0, 0.0, rotQ); // Rich earth, pebbles & moss clearing!
           } else if (mA > 0.57 || mB > 0.68) {
             groundCol = sampleGroundTile(wp, tileMeters, 1.0, 0.0, rotQ); // Sunlit clover & wildflower meadow!
           } else {
             groundCol = sampleGroundTile(wp, tileMeters, 0.0, 0.0, rotQ); // Lush emerald hand-painted grass turf!
           }
         }

         // Subtle broad dappled sunlit patches + gentle terrain height relief (so hills & valleys feel 3D!)
         float cloudDapple = 0.90 + pxValueNoise(wp * 0.018) * 0.22;
         float elevRelief  = 0.96 + sin(wzH * 0.35) * 0.04;
         // Preserve original map road-edge darkening gently if map was baked dark near curbs/shadows
         float mapLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
         float subtleMapAO = clamp(0.84 + mapLuma * 0.35, 0.80, 1.08);
         groundCol *= cloudDapple * elevRelief * subtleMapAO;

         // 3. POKEBONK SIGNATURE CLIFFS: vertical columnar basalt grooves + horizontal terraces +
         //    jagged overhanging grass/snow lips + volcanic magma fissures on steep slopes!
         float upDot = clamp(abs(vPxWorldNorm.y), 0.0, 1.0);
         float slopeMask = smoothstep(0.88, 0.68, upDot);
         if (slopeMask > 0.01) {
           float tierH = 2.6;
           float yScaled = vPxWorldPos.y / tierH;
           float yStrata = floor(yScaled);
           float yFrac = fract(yScaled);

           float cliffU = (abs(vPxWorldNorm.x) > abs(vPxWorldNorm.z)) ? vPxWorldPos.z : vPxWorldPos.x;
           float colId = floor(cliffU * 0.85);
           float colFrac = fract(cliffU * 0.85);
           float colRand = pxHash21(vec2(colId, yStrata));
           float vertCrack = step(0.86, colFrac);

           vec2 cliffCell = floor(vec2(cliffU, vPxWorldPos.y) * 3.5);
           float nCliff = pxHash21(cliffCell);
           float horizSeam = step(0.90, yFrac);

           vec3 basaltDark = vec3(0.055, 0.068, 0.098);
           vec3 basaltHi   = vec3(0.185, 0.215, 0.275);
           vec3 desertRock = vec3(0.42, 0.17, 0.095);
           vec3 snowRock   = vec3(0.24, 0.32, 0.42);

           vec3 rockCol = mix(basaltDark, basaltHi, clamp(0.25 + colRand * 0.65, 0.0, 1.0));
           rockCol = mix(rockCol, desertRock * (0.72 + 0.40 * colRand), isDesertZone * 0.85);
           rockCol = mix(rockCol, snowRock * (0.78 + 0.30 * colRand), isSnowZone * 0.78);
           rockCol *= (0.86 + nCliff * 0.26);
           rockCol = mix(rockCol, vec3(0.018, 0.022, 0.036), max(vertCrack * 0.78, horizSeam * 0.86));

           // Glowing magma cracks inside volcanic cliffs (matching new PokeBonk Crater screenshot!)
           if (isVolcanoZone > 0.5 && (vertCrack > 0.5 || horizSeam > 0.5) && colRand > 0.58 && yFrac > 0.12 && yFrac < 0.82) {
             rockCol = mix(vec3(0.95, 0.34, 0.06), vec3(1.0, 0.82, 0.22), step(0.80, colRand));
           }

           // Jagged overhanging emerald grass lip along meadow/autumn cliff ledges (or white snow lip in snow!)
           float lipDepth = 0.13 + pxHash21(vec2(floor(cliffU * 2.6), yStrata + 9.0)) * 0.12;
           float isLip = step(1.0 - lipDepth, yFrac);
           if (isGreenZone > 0.5) {
             vec3 lipGrass = mix(vec3(0.16, 0.64, 0.14), vec3(0.48, 0.90, 0.18), step(1.0 - lipDepth * 0.45, yFrac));
             rockCol = mix(rockCol, lipGrass, isLip * 0.92);
           } else if (isSnowZone > 0.5) {
             rockCol = mix(rockCol, vec3(0.92, 0.97, 1.0), isLip * 0.90);
           }

           groundCol = mix(groundCol, rockCol, slopeMask);
         }

         diffuseColor.rgb = groundCol;`
      )
      .replace('#include <lights_fragment_end>', TOON_LIGHT_SNIPPET_GLSL);
  };
  m.needsUpdate = true;
}

export function patchRoadMaterialForPixelTheme(m) {
  m.roughness = 0.88;
  m.metalness = 0.02;
  if (m.map) {
    m.map.magFilter = THREE.NearestFilter;
    m.map.minFilter = THREE.NearestFilter;
    m.map.generateMipmaps = false;
    m.map.needsUpdate = true;
  }
  m.customProgramCacheKey = () => 'pixel_theme_road_v5';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPxRoadPos;\nvarying vec3 vPxRoadNorm;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vPxRoadPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vPxRoadNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPxRoadPos;\nvarying vec3 vPxRoadNorm;\n${PIXEL_HASH_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         if (abs(vPxRoadNorm.y) < 0.58) {
           // Vertical road side-skirt / bridge deck retaining wall:
           // Replace stretched top-down asphalt UVs with crisp world-space pixel stone-block masonry!
           float wallH = (abs(vPxRoadNorm.x) > abs(vPxRoadNorm.z)) ? vPxRoadPos.z : vPxRoadPos.x;
           vec2 wp = floor(vec2(wallH, vPxRoadPos.y) * 5.0);
           float rowIdx = floor(wp.y / 4.0);
           float localY = mod(wp.y, 4.0);
           float stagger = mod(rowIdx, 2.0) * 5.0;
           float colIdx = floor((wp.x + stagger) / 10.0);
           float localX = mod(wp.x + stagger, 10.0);

           float isMortar = (localY < 0.5 || localX < 0.5) ? 1.0 : 0.0;
           float isTopBevel = (localY >= 3.0 && isMortar < 0.5) ? 1.0 : 0.0;
           float isBotShade = (localY >= 1.0 && localY < 1.5 && isMortar < 0.5) ? 1.0 : 0.0;

           float blkRand = pxHash21(vec2(colIdx, rowIdx));
           float pxGrain = pxHash21(wp);

           // Cool weathered concrete-stone masonry matching the bridge piers & steel guardrails
           vec3 baseStone = mix(vec3(0.39, 0.44, 0.51), vec3(0.51, 0.56, 0.63), blkRand);
           baseStone *= (pxGrain > 0.80) ? 1.10 : ((pxGrain < 0.18) ? 0.88 : 1.0);
           baseStone = mix(baseStone, baseStone * 1.16, isTopBevel * 0.75);
           baseStone = mix(baseStone, baseStone * 0.84, isBotShade * 0.65);
           // Crisp dark pixel mortar lines between courses
           vec3 mortarCol = vec3(0.21, 0.24, 0.30);
           diffuseColor.rgb = mix(baseStone, mortarCol, isMortar);
         } else {
           // Detailed weathered pixel-art asphalt: aggregate grain, dark tar cracks & subtle repair patches!
           vec2 rFine = floor(vPxRoadPos.xz * 6.0);
           vec2 rMed  = floor(vPxRoadPos.xz * 1.4);
           vec2 rMacro = floor(vPxRoadPos.xz * 0.18);
           float rn = pxHash21(rFine);
           float rm = pxHash21(rMed);
           float rPatch = pxHash21(rMacro);
           float pxCheck = mod(rFine.x + rFine.y, 2.0) * 2.0 - 1.0;

           // Crisp aggregate pixel gravel
           float speck = (rn > 0.83) ? 1.22 : ((rn < 0.16) ? 0.78 : (1.0 + pxCheck * 0.036));
           // Occasional darker weathered asphalt repair patches so long highways have real character!
           float tarmacPatch = (rPatch > 0.74) ? 0.87 : ((rPatch < 0.20) ? 1.09 : 1.0);
           float midWear = 0.94 + rm * 0.12;

           // Subtle meandering pixel tar cracks across weathered stretches
           float crackWave = abs(fract(pxFbm(vPxRoadPos.xz * 0.24) * 3.5) - 0.5);
           float tarCrack = step(crackWave, 0.018) * step(0.52, pxValueNoise(vPxRoadPos.xz * 0.06));

           vec3 roadCol = diffuseColor.rgb * vec3(0.86, 0.92, 1.06) * speck * tarmacPatch * midWear;
           roadCol = mix(roadCol, roadCol * 0.42, tarCrack * 0.72);
           diffuseColor.rgb = roadCol;
         }`
      )
      .replace('#include <lights_fragment_end>', TOON_LIGHT_SNIPPET_GLSL);
  };
  m.needsUpdate = true;
}

export function patchRockMaterialForPixelTheme(m, rockKey = 'rock1') {
  m.roughness = 0.94;
  m.metalness = 0.0;
  const isMoss = rockKey.includes('moss');
  const isSnow = rockKey.includes('snow');

  m.customProgramCacheKey = () => `pixel_theme_rock_${isMoss ? 'moss' : (isSnow ? 'snow' : 'stone')}_v2`;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPxRockPos;\nvarying vec3 vPxRockNorm;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vPxRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vPxRockNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPxRockPos;\nvarying vec3 vPxRockNorm;\n${PIXEL_HASH_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         vec2 rCell = floor(vec2(vPxRockPos.x + vPxRockPos.z, vPxRockPos.y) * 5.2);
         float rn = pxHash21(rCell);
         float strata = mod(floor(vPxRockPos.y * 4.0), 2.0);
         // Deeper slate-basalt stone matching PokeBonk rocks instead of pale grey clay!
         vec3 stone = pxBoostSat(diffuseColor.rgb, 1.15) * vec3(0.62, 0.66, 0.74) * (0.76 + strata * 0.16 + rn * 0.24);
         float topCap = smoothstep(0.55, 0.78, vPxRockNorm.y + (rn - 0.5) * 0.25);
         ${isMoss ? 'stone = mix(stone, vec3(0.20, 0.62, 0.14) * (0.85 + rn * 0.3), topCap * 0.90);' : ''}
         ${isSnow ? 'stone = mix(stone, vec3(0.92, 0.97, 1.0), topCap * 0.94);' : ''}
         ${(!isMoss && !isSnow) ? 'stone = mix(stone, stone * 1.24, topCap * 0.55);' : ''}
         diffuseColor.rgb = stone;`
      )
      .replace('#include <lights_fragment_end>', TOON_LIGHT_SNIPPET_GLSL);
  };
  m.needsUpdate = true;
}

export function patchWorldPropMaterialForPixelTheme(m) {
  m.roughness = 0.88;
  m.metalness = 0.02;
  if (m.map) {
    m.map.magFilter = THREE.NearestFilter;
    m.map.minFilter = THREE.NearestFilter;
    m.map.generateMipmaps = false;
    m.map.needsUpdate = true;
  }
  m.customProgramCacheKey = () => 'pixel_theme_prop_v3';
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PIXEL_HASH_GLSL}`)
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = pxBoostSat(diffuseColor.rgb, 1.26);')
      .replace('#include <lights_fragment_end>', TOON_LIGHT_SNIPPET_GLSL);
  };
  m.needsUpdate = true;
}

/**
 * Patches 3D car materials with bold 3-band pixel cel shading + chunkier 1.5x Bayer
 * dithering so cars look unmistakably pixel-stylized (~1.4x look!) even when the
 * world renders at super-crisp 1.0x-1.25x!
 */
export function patchCarMaterialForPixelTheme(m, extraKey = '') {
  if (!m) return;
  m.roughness = Math.max(m.roughness ?? 0.5, 0.36);
  m.metalness = Math.min(m.metalness ?? 0.1, 0.14);
  m.needsUpdate = true;
}

export function createPixelWaterMaterial(sun) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsLib.fog,
      uTime: { value: 0.0 },
      uSunPosition: { value: new THREE.Vector3().copy(sun) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPosition.xyz;
        vec4 mvPosition = viewMatrix * worldPosition;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      ${PIXEL_HASH_GLSL}

      varying vec2 vUv;
      varying vec3 vWorldPos;
      uniform float uTime;

      void main() {
        float depthFactor = clamp(vUv.x, 0.0, 1.0);
        if (depthFactor < 0.025) discard;

        vec2 wp = floor(vWorldPos.xz * 1.8);
        float tStep = floor(uTime * 3.5);

        vec3 shallowCol = vec3(0.18, 0.72, 0.90);
        vec3 midCol     = vec3(0.09, 0.48, 0.80);
        vec3 deepCol    = vec3(0.05, 0.32, 0.64);
        vec3 waterCol   = (depthFactor < 0.24) ? shallowCol : ((depthFactor < 0.60) ? midCol : deepCol);

        float tileNoise = pxHash21(wp);
        if (tileNoise > 0.78) waterCol *= 1.12;
        else if (tileNoise < 0.22) waterCol *= 0.90;

        vec2 dashCell = vec2(floor((wp.x + tStep * 0.65) * 0.25), wp.y);
        float dashRng = pxHash21(dashCell);
        float inDashRow = step(0.91, dashRng);
        float dashPhase = fract((wp.x + tStep * 0.65) * 0.25);
        float waveDash = inDashRow * step(0.15, dashPhase) * step(dashPhase, 0.78);

        float shoreWave = sin(wp.x * 0.35 + wp.y * 0.25 + tStep * 0.6) * 0.04;
        float shoreFoam = step(depthFactor + shoreWave, 0.15);

        waterCol = mix(waterCol, vec3(0.86, 0.98, 1.0), max(waveDash * 0.78, shoreFoam * 0.90));

        gl_FragColor = vec4(waterCol, 0.95);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/**
 * Full 360° Animated Pixel-Art Skybox Dome:
 * - Multi-band Bayer-dithered azure-to-cerulean sky gradient with warm solar horizon glow
 * - Layer 1: 360° panoramic horizon cumulus cloud towers (drifting & billowing continuously)
 * - Layer 2: Perspective sky-canopy drifting cumulus cloud clusters with directional
 *   sunlit silver-linings, 3-band pixel cel-shading, and periwinkle shadow shelves
 * - Layer 3: High-altitude wispy pixel cirrus ribbons & subtle crepuscular sunbeams
 * - Zero localized 3D sphere meshes needed — covers the entire world evenly from every angle!
 */
export function createPixelSkyDome(scene, sun) {
  const skyGeo = new THREE.SphereGeometry(3100, 48, 32);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0.0 },
      uSunPosition: { value: new THREE.Vector3().copy(sun) },
      uHorizonColor: { value: new THREE.Color(0xbce8ff) },
      uMidSkyColor: { value: new THREE.Color(0x45a9fa) },
      uZenithColor: { value: new THREE.Color(0x1b6fe0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vWorldPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${PIXEL_HASH_GLSL}
      varying vec3 vWorldPosition;

      uniform float uTime;
      uniform vec3 uSunPosition;
      uniform vec3 uHorizonColor;
      uniform vec3 uMidSkyColor;
      uniform vec3 uZenithColor;

      // Multi-octave billowy cumulus density field with time-evolving lobes
      float skyCloudDensity(vec2 p, float t) {
        vec2 p1 = p + vec2(t * 0.032, t * 0.014);
        vec2 p2 = p * 2.15 + vec2(-t * 0.019, t * 0.024) + vec2(17.3, 9.1);
        vec2 p3 = p * 4.30 + vec2(t * 0.041, -t * 0.018) + vec2(31.7, 43.2);
        // Round puffy lobes via inverted ridge shaping
        float n1 = pxValueNoise(p1);
        float n2 = pxValueNoise(p2);
        float n3 = pxValueNoise(p3);
        float puff = 1.0 - abs(n1 * 2.0 - 1.0) * 0.55;
        return n1 * 0.54 + puff * 0.24 + n2 * 0.26 + n3 * 0.11 - 0.15;
      }

      void main() {
        vec3 viewDir = normalize(vWorldPosition);
        float y = clamp(viewDir.y, 0.0, 1.0);
        vec3 sunDir = normalize(uSunPosition);
        float sunDot = max(0.0, dot(viewDir, sunDir));

        // Crisp 2x2 Bayer pixel dither for authentic HD-2D sky bands & cloud shelves
        float bayer = pxBayer2(floor(gl_FragCoord.xy / 1.5)) * 0.038;
        float yBand = clamp(floor((y + bayer) * 14.0) / 14.0, 0.0, 1.0);

        // 1. Base Sky Gradient + Warm Solar Horizon Glow
        vec3 lowSky = mix(uHorizonColor, uMidSkyColor, 0.44);
        vec3 skyCol = mix(uHorizonColor, lowSky, smoothstep(0.0, 0.14, yBand));
        skyCol = mix(skyCol, uMidSkyColor, smoothstep(0.11, 0.38, yBand));
        skyCol = mix(skyCol, uZenithColor, smoothstep(0.35, 0.78, yBand));

        float sunHorizGlow = pow(max(0.0, dot(normalize(vec3(viewDir.x, 0.0, viewDir.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z)))), 3.0)
                           * (1.0 - smoothstep(0.0, 0.42, y));
        skyCol += vec3(0.16, 0.11, 0.05) * sunHorizGlow;

        if (viewDir.y > -0.02) {
          // 2. Radiant Atmospheric Solar Bloom + Pixel Starburst Lens Rays (NO flat bullseye circles!)
          vec3 sunRight = normalize(cross(vec3(0.0, 1.0, 0.0), sunDir));
          vec3 sunUp    = cross(sunDir, sunRight);
          // Quantize solar tangent plane to a crisp pixel grid for authentic HD-2D sun rays
          vec2 sunPlane = floor(vec2(dot(viewDir, sunRight), dot(viewDir, sunUp)) * 180.0) / 180.0;
          float sDist = length(sunPlane);

          // Soft Bayer-dithered atmospheric solar bloom (melts organically into the sky, zero hard rings!)
          float wideGlare = pow(sunDot, 10.0);
          float midBloom  = floor((pow(sunDot, 48.0) + bayer * 0.45) * 6.0) / 6.0;
          float coreGlow  = smoothstep(0.042, 0.004, sDist + bayer * 0.008);

          // Animated 4-point + diagonal pixel starburst shimmer rays
          float breathe = 0.92 + 0.14 * sin(uTime * 1.9);
          float rayH = exp(-abs(sunPlane.y) * 145.0) * exp(-abs(sunPlane.x) * 11.5 * breathe);
          float rayV = exp(-abs(sunPlane.x) * 145.0) * exp(-abs(sunPlane.y) * 13.5 * breathe);
          vec2 diagPlane = vec2(sunPlane.x + sunPlane.y, sunPlane.x - sunPlane.y) * 0.7071;
          float rayD = (exp(-abs(diagPlane.y) * 175.0) * exp(-abs(diagPlane.x) * 20.0)
                      + exp(-abs(diagPlane.x) * 175.0) * exp(-abs(diagPlane.y) * 20.0)) * 0.65;
          float starBurst = clamp(floor(((rayH + rayV + rayD) + bayer * 0.25) * 5.0) / 5.0, 0.0, 1.0)
                          * step(0.84, sunDot);

          // Subtle crepuscular god-ray shafts radiating downward toward the horizon
          float sunAngle = atan(viewDir.y - sunDir.y, dot(viewDir.xz - sunDir.xz, vec2(1.0, 0.7)));
          float rayWave = sin(sunAngle * 11.0 + uTime * 0.35) * 0.5 + 0.5;
          float godRay = smoothstep(0.74, 0.995, sunDot) * smoothstep(0.52, 0.86, rayWave) * (1.0 - smoothstep(0.0, 0.55, y));

          skyCol += vec3(0.24, 0.18, 0.09) * wideGlare * 0.65;
          skyCol += vec3(0.20, 0.17, 0.10) * godRay * 0.52;
          skyCol = mix(skyCol, vec3(1.12, 1.00, 0.76), midBloom * 0.68);
          skyCol += vec3(1.15, 1.02, 0.74) * starBurst * 0.78;
          skyCol = mix(skyCol, vec3(1.55, 1.48, 1.22), coreGlow);

          // 3. LAYER A — High-Altitude Wispy Pixel Cirrus Ribbons (y > 0.14)
          if (y > 0.10) {
            vec2 cirrusUv = viewDir.xz / (y + 0.26);
            vec2 qCirrus = floor(cirrusUv * 56.0) / 56.0;
            vec2 cWind = qCirrus * vec2(1.15, 2.35) + vec2(uTime * 0.028, -uTime * 0.012);
            float cWarp = pxValueNoise(cWind * 0.9 + vec2(uTime * 0.015, 0.0));
            float cirrusVal = pxValueNoise(cWind * 2.2 + vec2(cWarp * 1.4, -cWarp * 0.8));
            float cirrusMask = step(0.68, cirrusVal + bayer * 0.45) * smoothstep(0.12, 0.28, y) * (1.0 - smoothstep(0.72, 0.96, y));
            vec3 cirrusCol = mix(vec3(0.86, 0.94, 1.02), vec3(1.05, 1.02, 0.96), pow(sunDot, 2.0));
            skyCol = mix(skyCol, cirrusCol, cirrusMask * 0.38);
          }

          // 4. LAYER B — 360° Panoramic Horizon Cumulus Cloud Towers (y in [0.0, 0.34])
          if (y < 0.36) {
            float az = atan(viewDir.z, viewDir.x); // -PI..PI across all 360 degrees
            // Quantize azimuth & elevation to a crisp pixel-art horizon grid
            float qAz = floor((az / 6.2831853 + 0.5) * 420.0) / 420.0;
            float qEl = floor(y * 190.0) / 190.0;

            float drift1 = qAz * 18.0 + uTime * 0.016;
            float drift2 = qAz * 37.0 - uTime * 0.011;
            // Billowy multi-tower horizon skyline silhouette
            float hTower = pxValueNoise(vec2(drift1, 1.4 + uTime * 0.012)) * 0.13
                         + pxValueNoise(vec2(drift2, 5.8 - uTime * 0.015)) * 0.065
                         + 0.032;
            float distToTop = hTower - qEl;
            if (distToTop > 0.0 && qEl > 0.008) {
              // Internal puff structure inside the horizon cumulus bank
              float hInternal = pxValueNoise(vec2(drift2 * 1.35, qEl * 28.0 - uTime * 0.02)) * 0.045;
              float rimFactor = distToTop - hInternal * 0.45 + bayer * 0.018;

              vec3 hTopCol  = mix(vec3(1.04, 1.03, 1.00), vec3(1.12, 1.06, 0.94), pow(sunDot, 2.5));
              vec3 hMidCol  = vec3(0.90, 0.96, 1.02);
              vec3 hBaseCol = mix(uHorizonColor * 0.92, vec3(0.68, 0.84, 0.98), 0.72);

              // Stepped 3-band pixel cumulus shading (bright top crest -> crisp mid -> cool blue base shelf)
              vec3 hCloudCol = (rimFactor < 0.024)
                ? hTopCol
                : ((qEl > 0.065 + hInternal * 0.4) ? hMidCol : hBaseCol);

              float horizonFade = smoothstep(0.008, 0.038, y);
              skyCol = mix(skyCol, hCloudCol, horizonFade * 0.94);
            }
          }

          // 5. LAYER C — Mid-Altitude Perspective Drifting Cumulus Canopy (All Around the Sky!)
          if (y > 0.035) {
            // Curved dome projection so clouds naturally scale & foreshorten toward the horizon
            vec2 domeUv = viewDir.xz / (y + 0.24);
            // Quantize to crisp pixel-art cloud texels
            float pxRes = mix(52.0, 34.0, smoothstep(0.05, 0.65, y));
            vec2 qUv = floor(domeUv * pxRes) / pxRes;

            float dCenter = skyCloudDensity(qUv * 0.92, uTime);
            // Threshold for discrete, well-spaced billowy cumulus islands across the whole sky
            float threshold = 0.535;
            if (dCenter + bayer * 0.16 > threshold) {
              // Sample density offset toward the sun for true directional self-shadowing & silver lining!
              vec2 sunStep = normalize(sunDir.xz + vec2(0.0001)) * 0.095;
              float dTowardSun = skyCloudDensity((qUv + sunStep) * 0.92, uTime);

              // Positive lightDiff = sun-facing top/rim; negative = self-shadowed cloud belly
              float lightDiff = (dCenter - dTowardSun) * 3.2 + (y * 0.22) + bayer * 0.35;
              float edgeDepth = dCenter - threshold;

              vec3 cSunTop   = mix(vec3(1.06, 1.05, 1.02), vec3(1.16, 1.09, 0.94), pow(sunDot, 2.0));
              vec3 cMidBody  = vec3(0.92, 0.97, 1.03);
              vec3 cShadow   = vec3(0.71, 0.85, 0.98);
              vec3 cDeepBase = vec3(0.58, 0.76, 0.94);

              // Crisp 4-tone pixel-art cumulus palette: silver-lining rim + sunlit puff + mid shelf + cool base
              vec3 cloudCol = cMidBody;
              if (edgeDepth < 0.032 || lightDiff > 0.30) {
                cloudCol = cSunTop;
              } else if (lightDiff < 0.04 && edgeDepth > 0.095) {
                cloudCol = cDeepBase;
              } else if (lightDiff < 0.16) {
                cloudCol = cShadow;
              }

              // Smooth horizon perspective blend so distant clouds melt into the horizon mist
              float cloudVis = smoothstep(0.035, 0.14, y) * (1.0 - smoothstep(3.4, 5.2, length(domeUv)));
              skyCol = mix(skyCol, cloudCol, cloudVis);
            }
          }
        } else {
          skyCol = uHorizonColor;
        }

        gl_FragColor = vec4(skyCol, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.renderOrder = -1000;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);
  return { skyMesh, skyMat };
}

/**
 * Bright, luminous PokeBonk Image #5 pixel-art cumulus clouds (pure sunlit white tops +
 * crisp icy sky-blue shaded shelves, ZERO dull grey cloud shadows!)
 */
export function patchCloudsForPixelTheme(cloudMat) {
  if (!cloudMat) return;
  cloudMat.fragmentShader = /* glsl */ `
    #include <common>
    #include <fog_pars_fragment>
    ${PIXEL_HASH_GLSL}

    varying vec3 vNormal;
    varying vec3 vViewDir;
    uniform vec3 uSunPosition;

    void main() {
      vec3 sunDir = normalize(uSunPosition);
      float wrap = dot(vNormal, sunDir) * 0.5 + 0.5;
      float bayer = pxBayer2(floor(gl_FragCoord.xy / 1.5)) * 0.075;
      float w = wrap + bayer;

      vec3 cloudTop  = vec3(1.12, 1.12, 1.10);
      vec3 cloudMid  = vec3(0.92, 0.97, 1.04);
      vec3 cloudDeep = vec3(0.70, 0.85, 0.99);

      vec3 col = (w > 0.54) ? cloudTop : ((w > 0.30) ? cloudMid : cloudDeep);

      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `;
  cloudMat.needsUpdate = true;
}

// ============================================================================
// 7. LIVING WORLD SYSTEM (BIRDS, BUTTERFLIES, PROPS & LANDMARKS)
// ============================================================================

function createBirdSpriteAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 48;
  canvas.height = 20;
  const ctx = canvas.getContext('2d');

  // Frame 0: Wings Up
  {
    const pc = new PixelCanvas(24, 20);
    pc.fillRect(10, 10, 5, 3, '#f7fbff');
    pc.fillRect(14, 10, 2, 2, '#ffaa33');
    pc.drawThickCurve(10, 11, 6, 7, 3, 4, 1.2, 0.9, (t) => (t > 0.65 ? '#35455e' : '#eef5ff'), 10);
    pc.drawThickCurve(14, 11, 18, 7, 21, 4, 1.2, 0.9, (t) => (t > 0.65 ? '#35455e' : '#d6e4f5'), 10);
    pc.applyOutline('#101624');
    ctx.putImageData(new ImageData(pc.data, 24, 20), 0, 0);
  }
  // Frame 1: Wings Down
  {
    const pc = new PixelCanvas(24, 20);
    pc.fillRect(10, 8, 5, 3, '#f7fbff');
    pc.fillRect(14, 8, 2, 2, '#ffaa33');
    pc.drawThickCurve(10, 9, 6, 12, 3, 15, 1.2, 0.9, (t) => (t > 0.65 ? '#35455e' : '#eef5ff'), 10);
    pc.drawThickCurve(14, 9, 18, 12, 21, 15, 1.2, 0.9, (t) => (t > 0.65 ? '#35455e' : '#d6e4f5'), 10);
    pc.applyOutline('#101624');
    ctx.putImageData(new ImageData(pc.data, 24, 20), 24, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createButterflySpriteAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  {
    const pc = new PixelCanvas(16, 16);
    pc.fillRect(7, 5, 2, 7, '#1a1e29');
    pc.fillRect(2, 3, 5, 5, '#ffffff');
    pc.fillRect(3, 8, 4, 4, '#dfe8f5');
    pc.fillRect(9, 3, 5, 5, '#ffffff');
    pc.fillRect(9, 8, 4, 4, '#dfe8f5');
    pc.applyOutline('#10141c');
    ctx.putImageData(new ImageData(pc.data, 16, 16), 0, 0);
  }
  {
    const pc = new PixelCanvas(16, 16);
    pc.fillRect(7, 6, 2, 6, '#1a1e29');
    pc.fillRect(4, 2, 3, 6, '#ffffff');
    pc.fillRect(9, 2, 3, 6, '#dfe8f5');
    pc.applyOutline('#10141c');
    ctx.putImageData(new ImageData(pc.data, 16, 16), 16, 0);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildLivelyPropTileCanvases() {
  // All 8 32x32 tiles sit flush at y = 30 (1px outline at y = 31 = exact bottom edge!)
  const W = 32, H = 32;
  const tiles = [];

  // 0: Wooden rustic fence
  {
    const pc = new PixelCanvas(W, H);
    pc.fillRect(5, 14, 4, 17, '#8f5930');
    pc.fillRect(6, 14, 1, 17, '#ba7e4b');
    pc.fillRect(23, 14, 4, 17, '#8f5930');
    pc.fillRect(24, 14, 1, 17, '#ba7e4b');
    pc.fillRect(2, 17, 28, 3, '#a66b3c');
    pc.fillRect(2, 17, 28, 1, '#c98e59');
    pc.fillRect(2, 23, 28, 3, '#8c562e');
    pc.fillRect(2, 23, 28, 1, '#b07443');
    pc.applyOutline('#140e0a');
    tiles.push(pc);
  }

  // 1: Toadstool mushroom patch
  {
    const pc = new PixelCanvas(W, H);
    pc.fillRect(10, 21, 5, 10, '#f2e6cf');
    pc.fillRect(13, 21, 2, 10, '#cfc0a5');
    pc.fillEllipse(12.5, 19, 7, 4.5, '#e82525');
    pc.fillRect(9, 17, 2, 2, '#ffffff');
    pc.fillRect(15, 18, 2, 2, '#ffffff');
    pc.fillRect(21, 24, 3, 7, '#f2e6cf');
    pc.fillEllipse(22.5, 23, 4.5, 3, '#ff4d2e');
    pc.set(22, 22, '#ffffff');
    pc.applyOutline('#12141a');
    tiles.push(pc);
  }

  // 2: Lush overflowing roadside flower bed (bold colorful blossoms!)
  {
    const pc = new PixelCanvas(W, H);
    pc.drawLeafCluster(16, 26, 13, 5, PALETTES.lushGreen, 211);
    pc.drawCrispFlowers([[8, 22], [24, 23]], '#ff2b2b', '#ffee55', '#b81414', false);
    pc.drawCrispFlowers([[15, 19]], '#ffdd33', '#ffffff', '#e6991a', false);
    pc.drawCrispFlowers([[20, 24]], '#38b6ff', '#ffffff', '#1975c4', false);
    pc.drawCrispFlowers([[12, 25]], '#ff4d94', '#ffee66', '#c42b6b', false);
    pc.applyOutline('#0e1419');
    tiles.push(pc);
  }

  // 3: Cozy glowing campfire!
  {
    const pc = new PixelCanvas(W, H);
    pc.fillRect(7, 25, 18, 4, '#593318');
    pc.fillRect(10, 23, 12, 3, '#824b24');
    pc.fillEllipse(8, 29, 3, 2, '#616c7a');
    pc.fillEllipse(16, 29.5, 3.8, 2, '#4c5663');
    pc.fillEllipse(24, 29, 3, 2, '#616c7a');
    pc.fillEllipse(16, 20, 6, 7, '#ff4d1a');
    pc.fillEllipse(16, 21, 4.5, 5.5, '#ff991a');
    pc.fillEllipse(16, 22, 2.5, 3.5, '#fff066');
    pc.fillRect(15, 11, 2, 3, '#ff6a1a');
    pc.applyOutline('#170d0a');
    tiles.push(pc);
  }

  // 4: Racing festival pennant flag pole
  {
    const pc = new PixelCanvas(W, H);
    pc.fillRect(10, 4, 2, 27, '#d6dce6');
    pc.fillRect(10, 4, 1, 27, '#ffffff');
    pc.fillRect(9, 3, 4, 2, '#ffca28');
    for (let x = 0; x < 16; x++) {
      const h = Math.max(2, Math.round(9 - x * 0.45));
      const wave = Math.round(Math.sin(x * 0.5) * 1.2);
      const col = x % 6 < 3 ? '#ff2e44' : '#ffcf24';
      pc.fillRect(12 + x, 6 + wave, 1, h, col);
    }
    pc.applyOutline('#12151f');
    tiles.push(pc);
  }

  // 5: Cozy snow-biome snowman
  {
    const pc = new PixelCanvas(W, H);
    pc.fillEllipse(16, 25.5, 7, 5.5, '#e8f4fc');
    pc.fillEllipse(14, 24.5, 4, 3.5, '#ffffff');
    pc.fillEllipse(16, 17.5, 5.5, 4.5, '#e8f4fc');
    pc.fillEllipse(14, 16.5, 3, 2.5, '#ffffff');
    pc.fillEllipse(16, 10.5, 4, 3.5, '#ffffff');
    pc.fillRect(12, 13.5, 8, 2, '#e82538');
    pc.fillRect(18, 14.5, 2, 4, '#e82538');
    pc.fillRect(16, 10.5, 4, 1, '#ff7b1a');
    pc.set(15, 9, '#141824');
    pc.set(17, 9, '#141824');
    pc.fillRect(12, 5, 8, 2, '#242b38');
    pc.fillRect(13, 2, 6, 4, '#242b38');
    pc.applyOutline('#101826');
    tiles.push(pc);
  }

  // 6: Jagged angled golden crystal cluster bursting out of dark basalt rock! (PokeBonk Images #1 & #2!)
  {
    const pc = new PixelCanvas(W, H);
    // Dark basalt rock base
    pc.fillEllipse(16, 27, 10, 4, '#363d4d');
    pc.fillEllipse(14, 26, 6, 3, '#4c566b');
    // Left angled golden shard
    pc.drawThickCurve(12, 26, 8, 20, 5, 14, 2.8, 0.9, (t) => (t > 0.6 ? '#fff6a6' : (t > 0.25 ? '#ffd426' : '#d97b14')), 14);
    // Right angled golden shard
    pc.drawThickCurve(20, 26, 24, 20, 27, 15, 2.8, 0.9, (t) => (t > 0.6 ? '#ffea66' : (t > 0.25 ? '#f5b022' : '#c46410')), 14);
    // Tall central crystal spire
    pc.drawThickCurve(16, 26, 16, 17, 15, 6, 3.6, 0.9, (t, x) => (x < 15.5 ? '#ffffff' : (t > 0.5 ? '#ffe854' : '#e69417')), 18);
    pc.applyOutline('#121014');
    tiles.push(pc);
  }

  // 7: Coastal pixel sailboat
  {
    const pc = new PixelCanvas(W, H);
    pc.fillRect(5, 25, 22, 4, '#e03131');
    pc.fillRect(7, 29, 18, 2, '#991b1b');
    pc.fillRect(6, 25, 20, 1, '#ff8787');
    pc.fillRect(15, 6, 2, 19, '#7a4b24');
    for (let y = 7; y <= 23; y++) {
      const t = (y - 7) / 16;
      const w = Math.max(1, Math.round(t * 10));
      pc.fillRect(17, y, w, 1, '#ffffff');
      pc.fillRect(17 + Math.max(0, w - 2), y, 2, 1, '#d4e6f7');
    }
    for (let y = 12; y <= 23; y++) {
      const t = (y - 12) / 11;
      const w = Math.max(1, Math.round(t * 6));
      pc.fillRect(15 - w, y, w, 1, '#eef7ff');
    }
    pc.applyOutline('#101826');
    tiles.push(pc);
  }

  return tiles;
}

function createLivelyPropsAtlas() {
  const tiles = buildLivelyPropTileCanvases();
  const W = tiles[0].w, H = tiles[0].h;
  const canvas = document.createElement('canvas');
  canvas.width = W * tiles.length;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  tiles.forEach((pc, idx) => {
    ctx.putImageData(new ImageData(pc.data, W, H), idx * W, 0);
  });

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createPixelLivingWorld(scene, terrainSampler, roadCorridors, natureInstances) {
  const rng = makeRng(20261120);
  const animatedUniforms = [];

  const CELL = 12.0;
  const roadGrid = new Map();
  if (roadCorridors && roadCorridors.length) {
    for (let i = 0; i < roadCorridors.length; i++) {
      const r = roadCorridors[i];
      const rx = r[0], rz = -r[1], rw = r[3] || 7.5;
      const gx = Math.floor(rx / CELL), gz = Math.floor(rz / CELL);
      const key = `${gx}_${gz}`;
      if (!roadGrid.has(key)) roadGrid.set(key, []);
      roadGrid.get(key).push({ x: rx, z: rz, w: rw });
    }
  }
  const getMinRoadClearance = (x, z) => {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    let best = 999.0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const pts = roadGrid.get(`${gx + dx}_${gz + dz}`);
        if (!pts) continue;
        for (let i = 0; i < pts.length; i++) {
          const d = Math.hypot(x - pts[i].x, z - pts[i].z) - pts[i].w;
          if (d < best) best = d;
        }
      }
    }
    return best;
  };

  // --- 1. SOARING PIXEL BIRDS ---
  {
    const birdCount = 68;
    const birdTex = createBirdSpriteAtlas();
    const birdGeo = new THREE.PlaneGeometry(1.9, 1.4);
    const orbitCenters = new Float32Array(birdCount * 3);
    const orbitParams = new Float32Array(birdCount * 4);

    for (let i = 0; i < birdCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = 40 + rng() * 680;
      orbitCenters[i * 3 + 0] = Math.cos(a) * r;
      orbitCenters[i * 3 + 1] = 28 + rng() * 34;
      orbitCenters[i * 3 + 2] = Math.sin(a) * r;
      orbitParams[i * 4 + 0] = 18 + rng() * 44;
      orbitParams[i * 4 + 1] = (0.16 + rng() * 0.22) * (rng() > 0.5 ? 1 : -1);
      orbitParams[i * 4 + 2] = rng() * Math.PI * 2;
      orbitParams[i * 4 + 3] = 0.85 + rng() * 0.65;
    }
    birdGeo.setAttribute('aOrbitCenter', new THREE.InstancedBufferAttribute(orbitCenters, 3));
    birdGeo.setAttribute('aOrbitParam', new THREE.InstancedBufferAttribute(orbitParams, 4));

    const uTime = { value: 0.0 };
    animatedUniforms.push(uTime);
    const birdMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uMap: { value: birdTex }, uTime },
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 aOrbitCenter;
        attribute vec4 aOrbitParam;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          float ang = aOrbitParam.z + uTime * aOrbitParam.y;
          vec3 center = aOrbitCenter + vec3(
            cos(ang) * aOrbitParam.x,
            sin(ang * 2.0 + aOrbitParam.z) * 2.8,
            sin(ang) * aOrbitParam.x
          );
          float frame = floor(mod(uTime * 5.2 + aOrbitParam.z * 3.0, 2.0));
          vUv = vec2((frame + uv.x) * 0.5, uv.y);

          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 worldPos = center + camRight * (position.x * aOrbitParam.w) + camUp * (position.y * aOrbitParam.w);
          vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uMap;
        varying vec2 vUv;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.5) discard;
          gl_FragColor = vec4(t.rgb, 1.0);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
      fog: true,
    });
    const birdMesh = new THREE.InstancedMesh(birdGeo, birdMat, birdCount);
    birdMesh.frustumCulled = false;
    scene.add(birdMesh);
  }

  // --- 2. FLUTTERING PIXEL BUTTERFLIES ---
  {
    const bfCount = 260;
    const bfTex = createButterflySpriteAtlas();
    const bfGeo = new THREE.PlaneGeometry(0.46, 0.46);
    const bfPos = new Float32Array(bfCount * 3);
    const bfCol = new Float32Array(bfCount * 3);
    const bfSeed = new Float32Array(bfCount);

    const bfPalette = [
      new THREE.Color(0xffe040),
      new THREE.Color(0x52c8ff),
      new THREE.Color(0xff7847),
      new THREE.Color(0xffffff),
      new THREE.Color(0xff66aa),
    ];

    let placed = 0;
    for (let attempt = 0; attempt < 2200 && placed < bfCount; attempt++) {
      let x, z;
      if (roadCorridors && roadCorridors.length > 0 && attempt < 1600) {
        const rc = roadCorridors[Math.floor(rng() * roadCorridors.length)];
        const ang = rng() * Math.PI * 2;
        const dist = (rc[3] || 7.5) + 3.0 + rng() * 26.0;
        x = rc[0] + Math.cos(ang) * dist;
        z = -rc[1] + Math.sin(ang) * dist;
      } else {
        x = (rng() - 0.5) * 1400;
        z = (rng() - 0.5) * 1400;
      }
      if (getMinRoadClearance(x, z) < 2.2) continue;
      const surf = terrainSampler ? terrainSampler.sample(x, z) : null;
      if (!surf || surf.y < -1.5 || surf.ny < 0.72) continue;

      const bio = getBiomeIdAt(x, surf.y, z);
      const col = bio === 3
        ? new THREE.Color(0xff6a1a)
        : (bio === 4 ? new THREE.Color(0x9be8ff) : bfPalette[Math.floor(rng() * bfPalette.length)]);

      bfPos[placed * 3 + 0] = x;
      bfPos[placed * 3 + 1] = surf.y + 0.75 + rng() * 1.4;
      bfPos[placed * 3 + 2] = z;
      bfCol[placed * 3 + 0] = col.r;
      bfCol[placed * 3 + 1] = col.g;
      bfCol[placed * 3 + 2] = col.b;
      bfSeed[placed] = rng() * 100.0;
      placed++;
    }

    bfGeo.setAttribute('aBasePos', new THREE.InstancedBufferAttribute(bfPos, 3));
    bfGeo.setAttribute('aBfCol', new THREE.InstancedBufferAttribute(bfCol, 3));
    bfGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(bfSeed, 1));

    const uTime = { value: 0.0 };
    animatedUniforms.push(uTime);
    const bfMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsLib.fog, uMap: { value: bfTex }, uTime },
      vertexShader: /* glsl */ `
        #include <common>
        #include <fog_pars_vertex>
        attribute vec3 aBasePos;
        attribute vec3 aBfCol;
        attribute float aSeed;
        uniform float uTime;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vCol = aBfCol;
          float t = uTime * 1.6 + aSeed;
          vec3 center = aBasePos + vec3(
            sin(t * 0.9) * 2.1 + cos(t * 0.4) * 1.1,
            sin(t * 3.1) * 0.38,
            cos(t * 0.8) * 2.1
          );
          float frame = floor(mod(uTime * 10.0 + aSeed, 2.0));
          vUv = vec2((frame + uv.x) * 0.5, uv.y);

          vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 worldPos = center + camRight * position.x + camUp * position.y;
          vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vCol;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.5) discard;
          float luma = dot(t.rgb, vec3(0.299, 0.587, 0.114));
          float isInk = 1.0 - smoothstep(0.04, 0.12, luma);
          vec3 col = mix(t.rgb * vCol, t.rgb, isInk);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
      fog: true,
    });
    const bfMesh = new THREE.InstancedMesh(bfGeo, bfMat, placed);
    bfMesh.frustumCulled = false;
    scene.add(bfMesh);
  }

  // --- 3. LIVELY BIOME PROPS & LANDMARKS (EXACT SURFACE GROUNDING!) ---
  {
    const propItems = [];
    const targetProps = 600;
    for (let attempt = 0; attempt < 5800 && propItems.length < targetProps; attempt++) {
      let x, z;
      if (roadCorridors && roadCorridors.length > 0 && attempt < 4400) {
        const rc = roadCorridors[Math.floor(rng() * roadCorridors.length)];
        const ang = rng() * Math.PI * 2;
        const dist = (rc[3] || 7.5) + 4.0 + rng() * 34.0;
        x = rc[0] + Math.cos(ang) * dist;
        z = -rc[1] + Math.sin(ang) * dist;
      } else {
        x = (rng() - 0.5) * 1500;
        z = (rng() - 0.5) * 1500;
      }

      const roadClr = getMinRoadClearance(x, z);
      if (roadClr < 3.8) continue;

      const surf = terrainSampler ? terrainSampler.sample(x, z) : null;
      if (!surf || surf.y < -1.2 || surf.ny < 0.80) continue;

      const bio = getBiomeIdAt(x, surf.y, z);
      const rRoll = rng();
      let tileIdx = 2;
      let scale = 1.35 + rng() * 0.55;

      if (bio === 4) {
        if (rRoll < 0.45) { tileIdx = 5; scale = 1.75 + rng() * 0.45; }
        else if (rRoll < 0.72) { tileIdx = 0; scale = 1.9 + rng() * 0.35; }
        else if (rRoll < 0.88) { tileIdx = 3; scale = 1.5; }
        else { tileIdx = 4; scale = 2.4; }
      } else if (bio === 3) {
        if (rRoll < 0.68) { tileIdx = 6; scale = 1.9 + rng() * 1.0; }
        else { tileIdx = 3; scale = 1.55; }
      } else if (bio === 2) {
        if (rRoll < 0.65) { tileIdx = 0; scale = 2.0 + rng() * 0.45; }
        else if (rRoll < 0.85) { tileIdx = 3; scale = 1.5; }
        else { tileIdx = 4; scale = 2.3; }
      } else if (bio === 1) {
        if (rRoll < 0.35) { tileIdx = 1; scale = 1.2 + rng() * 0.4; }
        else if (rRoll < 0.60) { tileIdx = 0; scale = 1.95; }
        else if (rRoll < 0.82) { tileIdx = 3; scale = 1.5; }
        else { tileIdx = 4; scale = 2.4; }
      } else {
        if (rRoll < 0.38) { tileIdx = 2; scale = 1.55 + rng() * 0.6; }
        else if (rRoll < 0.60) { tileIdx = 1; scale = 1.15 + rng() * 0.4; }
        else if (rRoll < 0.78) { tileIdx = 0; scale = 2.0 + rng() * 0.35; }
        else if (rRoll < 0.90 && roadClr < 10.0) { tileIdx = 4; scale = 2.5 + rng() * 0.45; }
        else { tileIdx = 3; scale = 1.5; }
      }

      // Gentle exact seat (2-8cm) — NEVER buried underground, NEVER floating!
      const slopeSin = Math.sqrt(Math.max(0.0, 1.0 - surf.ny * surf.ny));
      const sinkY = 0.02 + slopeSin * 0.12 * scale;
      propItems.push({
        x, y: surf.y - sinkY, z,
        scale, tileIdx,
        nx: surf.nx, ny: surf.ny, nz: surf.nz,
        bob: 0.0,
      });
    }

    for (let s = 0; s < 16; s++) {
      const bx = -520 + s * 78 + (rng() - 0.5) * 35;
      const bz = 580 + rng() * 240;
      propItems.push({
        x: bx, y: -3.4, z: bz,
        scale: 5.5 + rng() * 2.5,
        tileIdx: 7,
        nx: 0, ny: 1, nz: 0,
        bob: 1.0,
      });
    }

    if (propItems.length > 0) {
      const atlasTex = createLivelyPropsAtlas();
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        -0.5, 0.0, 0.0,
         0.5, 0.0, 0.0,
         0.5, 1.0, 0.0,
        -0.5, 1.0, 0.0,
      ]), 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);

      const count = propItems.length;
      const tileAttr = new Float32Array(count);
      const normAttr = new Float32Array(count * 3);
      const bobAttr = new Float32Array(count);
      const dummy = new THREE.Object3D();

      const uTime = { value: 0.0 };
      animatedUniforms.push(uTime);
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...THREE.UniformsLib.fog, uMap: { value: atlasTex }, uTime },
        vertexShader: /* glsl */ `
          #include <common>
          #include <fog_pars_vertex>
          attribute float aTileIdx;
          attribute vec3 aSurfNorm;
          attribute float aBob;
          uniform float uTime;
          varying vec2 vUv;
          varying float vTile;
          void main() {
            vTile = aTileIdx;
            vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float instScale = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
            float h = fract(sin(dot(instPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
            float flipX = h > 0.5 ? 1.0 : 0.0;
            float uLoc = mix(uv.x, 1.0 - uv.x, flipX);
            vUv = vec2((aTileIdx + uLoc) / 8.0, uv.y);

            vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 flatRight = normalize(vec3(camRight.x, 0.0, camRight.z) + vec3(1e-5, 0.0, 0.0));
            vec3 tNorm = length(aSurfNorm) > 0.1 ? normalize(aSurfNorm) : vec3(0.0, 1.0, 0.0);
            vec3 upDir = normalize(mix(vec3(0.0, 1.0, 0.0), tNorm, 0.35));
            vec3 rightDir = normalize(flatRight - upDir * dot(flatRight, upDir));

            float bobY = aBob * sin(uTime * 1.8 + h * 6.28) * 0.22;
            float swayX = (aTileIdx > 2.5 && aTileIdx < 4.5)
              ? floor(sin(uTime * 5.0 + h * 12.0) * 2.0) * 0.025 * uv.y
              : 0.0;

            vec3 worldPos = instPos
              + vec3(0.0, bobY, 0.0)
              + rightDir * ((position.x + swayX) * instScale)
              + upDir * (position.y * instScale);

            vec4 mvPosition = viewMatrix * vec4(worldPos, 1.0);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }
        `,
        fragmentShader: /* glsl */ `
          #include <common>
          #include <fog_pars_fragment>
          uniform sampler2D uMap;
          varying vec2 vUv;
          varying float vTile;
          void main() {
            vec4 t = texture2D(uMap, vUv);
            if (t.a < 0.5) discard;
            float isGlow = (abs(vTile - 3.0) < 0.2 || abs(vTile - 6.0) < 0.2) ? 1.0 : 0.0;
            vec3 col = t.rgb * mix(1.0, 1.24, isGlow * step(0.45, t.r));
            gl_FragColor = vec4(col, 1.0);
            #include <fog_fragment>
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `,
        side: THREE.DoubleSide,
        fog: true,
      });

      const mesh = new THREE.InstancedMesh(geo, mat, count);
      for (let i = 0; i < count; i++) {
        const it = propItems[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(it.scale, it.scale, it.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        tileAttr[i] = it.tileIdx;
        normAttr[i * 3 + 0] = it.nx;
        normAttr[i * 3 + 1] = it.ny;
        normAttr[i * 3 + 2] = it.nz;
        bobAttr[i] = it.bob;
      }
      mesh.instanceMatrix.needsUpdate = true;
      geo.setAttribute('aTileIdx', new THREE.InstancedBufferAttribute(tileAttr, 1));
      geo.setAttribute('aSurfNorm', new THREE.InstancedBufferAttribute(normAttr, 3));
      geo.setAttribute('aBob', new THREE.InstancedBufferAttribute(bobAttr, 1));
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  return {
    update(timeSec) {
      for (let i = 0; i < animatedUniforms.length; i++) {
        animatedUniforms[i].value = timeSec;
      }
    },
  };
}

// ============================================================================
// 8. HYBRID PIXEL PIPELINE (1.25x CRISP WORLD + 1.45x STYLIZED FOREGROUND CAR!)
// ============================================================================

export class PixelRenderPipeline {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // Default 1.0x keeps the entire world ultra-crisp, while the blit shader
    // automatically gives close foreground car pixels a clean stylized 1.5x snap!
    this.pixelScale = 1.0;
    this.outlinesEnabled = true;

    this.rt = null;
    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.blitMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        uTexelSize: { value: new THREE.Vector2(1 / 1024, 1 / 576) },
        uCarTexelSize: { value: new THREE.Vector2(1 / 880, 1 / 495) },
        uCameraNear: { value: camera.near },
        uCameraFar: { value: camera.far },
        uOutlinesEnabled: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #include <packing>

        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uTexelSize;
        uniform vec2 uCarTexelSize;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform float uOutlinesEnabled;

        varying vec2 vUv;

        float getLinearDepth(vec2 uv) {
          float fragCoordZ = texture2D(tDepth, uv).x;
          float viewZ = perspectiveDepthToViewZ(fragCoordZ, uCameraNear, uCameraFar);
          return -viewZ;
        }

        void main() {
          vec2 uv = (floor(vUv / uTexelSize) + 0.5) * uTexelSize;
          float zC = getLinearDepth(uv);

          // Hybrid Car Pixelation: when world is crisp 1.0x-1.35x, snap close foreground
          // car pixels (< 8.8m) to a chunkier ~1.45x pixel grid with depth-guard (ZERO road bleed!)
          vec2 sampleUv = uv;
          if (zC < 8.8 && uCarTexelSize.x > uTexelSize.x * 1.04) {
            vec2 carUv = (floor(vUv / uCarTexelSize) + 0.5) * uCarTexelSize;
            float zCar = getLinearDepth(carUv);
            if (abs(zCar - zC) < 0.75) {
              sampleUv = carUv;
            }
          }

          vec3 col = texture2D(tDiffuse, sampleUv).rgb;

          if (uOutlinesEnabled > 0.5 && zC < 120.0) {
            vec2 stepSz = (zC < 8.8 && uCarTexelSize.x > uTexelSize.x * 1.04) ? uCarTexelSize : uTexelSize;
            float zL = getLinearDepth(sampleUv + vec2(-stepSz.x, 0.0));
            float zR = getLinearDepth(sampleUv + vec2( stepSz.x, 0.0));
            float zU = getLinearDepth(sampleUv + vec2(0.0,  stepSz.y));
            float zD = getLinearDepth(sampleUv + vec2(0.0, -stepSz.y));

            float closeBoost = 1.0 - smoothstep(9.0, 22.0, zC);
            float lapLo = mix(0.11, 0.045, closeBoost);
            float lapHi = mix(0.24, 0.120, closeBoost);
            float fgLo  = mix(0.075, 0.030, closeBoost);
            float fgHi  = mix(0.18, 0.090, closeBoost);

            float lapH = abs((zR - zC) - (zC - zL));
            float lapV = abs((zU - zC) - (zC - zD));
            float maxLap = max(lapH, lapV) / max(zC, 0.5);

            float fgJump = max(max(zL - zC, zR - zC), max(zU - zC, zD - zC)) / max(zC, 0.5);
            float distFade = 1.0 - smoothstep(60.0, 120.0, zC);

            float outline = smoothstep(lapLo, lapHi, maxLap) * smoothstep(fgLo, fgHi, fgJump) * distFade;

            if (closeBoost > 0.15) {
              vec3 cL = texture2D(tDiffuse, sampleUv + vec2(-stepSz.x, 0.0)).rgb;
              vec3 cR = texture2D(tDiffuse, sampleUv + vec2( stepSz.x, 0.0)).rgb;
              vec3 cU = texture2D(tDiffuse, sampleUv + vec2(0.0,  stepSz.y)).rgb;
              vec3 cD = texture2D(tDiffuse, sampleUv + vec2(0.0, -stepSz.y)).rgb;
              float cEdge = max(length(cR - cL), length(cU - cD));
              float zFlat = step(maxLap, 0.025);
              float carMask = smoothstep(8.8, 4.5, zC);
              outline = max(outline, smoothstep(0.50, 0.92, cEdge) * carMask * zFlat * 0.48);
            }

            vec3 inkColor = mix(vec3(0.012, 0.016, 0.028), col * 0.16, 0.24);
            col = mix(col, inkColor, outline * 0.92);
          }

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quadMesh = new THREE.Mesh(quadGeo, this.blitMat);
    this.quadScene.add(this.quadMesh);

    this.resize(window.innerWidth, window.innerHeight);
    // Prototype bar moved into Pause -> Settings; remove any stale bar if present
    if (typeof document !== 'undefined') {
      const prev = document.getElementById('pixel-proto-bar');
      if (prev) prev.remove();
    }
  }

  resize(width, height) {
    const w = Math.max(160, Math.round(width / this.pixelScale));
    const h = Math.max(90, Math.round(height / this.pixelScale));

    // Car always gets at least a ~1.5x stylized pixel grid even when world is 1.0x or 1.25x!
    const carScale = Math.max(this.pixelScale, 1.5);
    const carW = Math.max(160, Math.round(width / carScale));
    const carH = Math.max(90, Math.round(height / carScale));
    this.blitMat.uniforms.uCarTexelSize.value.set(1 / carW, 1 / carH);

    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    if (this.rt) {
      if (this.rt.depthTexture) this.rt.depthTexture.dispose();
      this.rt.dispose();
    }

    const depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    depthTexture.minFilter = THREE.NearestFilter;
    depthTexture.magFilter = THREE.NearestFilter;

    this.rt = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      generateMipmaps: false,
      depthBuffer: true,
      depthTexture,
    });

    this.blitMat.uniforms.tDiffuse.value = this.rt.texture;
    this.blitMat.uniforms.tDepth.value = depthTexture;
    this.blitMat.uniforms.uTexelSize.value.set(1 / w, 1 / h);
  }

  setPixelScale(scale) {
    this.pixelScale = scale;
    this.resize(window.innerWidth, window.innerHeight);
  }

  setOutlinesEnabled(enabled) {
    this.outlinesEnabled = Boolean(enabled);
    this.blitMat.uniforms.uOutlinesEnabled.value = this.outlinesEnabled ? 1.0 : 0.0;
  }

  render() {
    this.blitMat.uniforms.uCameraNear.value = this.camera.near;
    this.blitMat.uniforms.uCameraFar.value = this.camera.far;

    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  _mountPrototypeControls() {
    if (typeof document === 'undefined') return;
    const prev = document.getElementById('pixel-proto-bar');
    if (prev) prev.remove();

    const bar = document.createElement('div');
    bar.id = 'pixel-proto-bar';
    bar.style.cssText = [
      'position:fixed',
      'top:16px',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:45',
      'display:flex',
      'align-items:center',
      'gap:5px',
      'padding:5px 10px',
      'border-radius:999px',
      'background:rgba(14,18,26,0.80)',
      'border:1px solid rgba(255,255,255,0.18)',
      'box-shadow:0 6px 20px rgba(0,0,0,0.45)',
      'backdrop-filter:blur(10px)',
      '-webkit-backdrop-filter:blur(10px)',
      'font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif',
      'font-size:11px',
      'font-weight:700',
      'letter-spacing:0.04em',
      'color:#e6edf3',
      'pointer-events:auto',
    ].join(';');

    const label = document.createElement('span');
    label.textContent = 'PIXEL PROTO';
    label.style.cssText = 'color:#8be836;margin-right:4px;font-weight:800;';
    bar.appendChild(label);

    const presets = [
      { name: '1.0x', val: 1.0 },
      { name: '1.25x', val: 1.25 },
      { name: '1.4x', val: 1.4 },
      { name: '1.65x', val: 1.65 },
      { name: '2.0x', val: 2.0 },
    ];
    const btns = [];

    const makeBtn = (text, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.style.cssText = [
        'border:1px solid rgba(255,255,255,0.18)',
        'background:rgba(255,255,255,0.08)',
        'color:#e6edf3',
        'border-radius:999px',
        'padding:3px 8px',
        'font-size:10px',
        'font-weight:800',
        'cursor:pointer',
      ].join(';');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    const syncStyles = () => {
      btns.forEach(({ btn, val }) => {
        const active = Math.abs(this.pixelScale - val) < 0.04;
        btn.style.background = active ? '#52c429' : 'rgba(255,255,255,0.08)';
        btn.style.color = active ? '#0b140d' : '#e6edf3';
        btn.style.borderColor = active ? '#a4f542' : 'rgba(255,255,255,0.18)';
      });
      outlineBtn.textContent = this.outlinesEnabled ? 'INK: ON' : 'INK: OFF';
      outlineBtn.style.background = this.outlinesEnabled ? '#3b82f6' : 'rgba(255,255,255,0.08)';
      outlineBtn.style.borderColor = this.outlinesEnabled ? '#93c5fd' : 'rgba(255,255,255,0.18)';
    };

    for (const p of presets) {
      const btn = makeBtn(p.name, () => {
        this.setPixelScale(p.val);
        syncStyles();
      });
      btns.push({ btn, val: p.val });
      bar.appendChild(btn);
    }

    const outlineBtn = makeBtn('INK: ON', () => {
      this.setOutlinesEnabled(!this.outlinesEnabled);
      syncStyles();
    });
    bar.appendChild(outlineBtn);

    syncStyles();
    document.body.appendChild(bar);
  }
}

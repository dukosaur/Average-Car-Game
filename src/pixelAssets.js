import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  PixelCanvas,
  getBiomeIdAt,
  patchWorldPropMaterialForPixelTheme,
} from './pixelTheme.js';

/**
 * ============================================================================
 * POKEBONK / HD-2D PIXEL-3D ARCHITECTURE, BRIDGES & WORLD LANDMARKS
 * ----------------------------------------------------------------------------
 * Replaces every plain untextured 3D building/sign with detailed, multi-part,
 * pixel-art textured 3D architecture; adds 3D pixel-textured bridge guardrail
 * fences & cliff railings across all elevated spans; upgrades Suspension Bridge
 * steel/stone surfaces; and populates all 6 biomes with animated 3D windmills,
 * village wells, market stalls, desert water towers, volcanic rune obelisks,
 * and a 16-tile rich biome scatter atlas.
 * ============================================================================
 */

const UPGRADED_3D_TEMPLATE_KEYS = new Set([
  'town_house_a',
  'town_house_b',
  'paddock_tent',
  'desert_adobe',
  'ski_chalet',
  'lighthouse',
  'chevron_sign',
]);

export function isUpgraded3DBuildingKey(key) {
  return UPGRADED_3D_TEMPLATE_KEYS.has(key);
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ============================================================================
// 1. HAND-CRAFTED 64x64 PIXEL-ART ARCHITECTURAL TEXTURES (ALL NearestFilter!)
// ============================================================================

function drawPixelWindow(pc, x, y, w, h, frameHex, shutterHex, glassHi, glassMid, glassDark, addFlowerBox = false) {
  // Shutters on left and right
  if (shutterHex) {
    const sw = 4;
    pc.fillRect(x - sw, y, sw, h, shutterHex);
    pc.fillRect(x + w, y, sw, h, shutterHex);
    for (let sy = y + 2; sy < y + h - 1; sy += 3) {
      pc.fillRect(x - sw + 1, sy, sw - 2, 1, '#18221e');
      pc.fillRect(x + w + 1, sy, sw - 2, 1, '#18221e');
    }
  }
  // Outer timber frame + shadow recess
  pc.fillRect(x - 1, y - 1, w + 2, h + 2, '#1d1612');
  pc.fillRect(x, y, w, h, frameHex);
  // Glowing glass pane interior
  pc.fillRect(x + 2, y + 2, w - 4, h - 4, glassMid);
  pc.fillRect(x + 2, y + 2, Math.max(2, Math.floor((w - 4) * 0.5)), Math.max(2, Math.floor((h - 4) * 0.45)), glassHi);
  pc.fillRect(x + 2, y + h - 4, w - 4, 2, glassDark);
  // Crisp mullion crossbars
  const mx = x + Math.floor(w / 2);
  const my = y + Math.floor(h / 2);
  pc.fillRect(mx, y + 1, 2, h - 2, frameHex);
  pc.fillRect(x + 1, my, w - 2, 2, frameHex);
  // Stone/wood windowsill
  pc.fillRect(x - 2, y + h, w + 4, 2, '#5c422c');
  pc.fillRect(x - 2, y + h + 2, w + 4, 1, '#261b12');

  if (addFlowerBox) {
    pc.fillRect(x - 1, y + h + 1, w + 2, 4, '#7d4924');
    pc.fillRect(x, y + h + 1, w, 1, '#a66838');
    // Lush little pixel foliage & crimson/yellow blooms spilling over box
    for (let fx = x; fx < x + w; fx += 2) {
      pc.set(fx, y + h, '#2fa824');
      pc.set(fx + 1, y + h - 1, '#5cd62c');
    }
    pc.fillRect(x + 2, y + h - 2, 2, 2, '#ff3333');
    pc.fillRect(x + Math.floor(w / 2) - 1, y + h - 2, 2, 2, '#ffdd33');
    pc.fillRect(x + w - 4, y + h - 2, 2, 2, '#ff3333');
  }
}

export function buildArchitecturalTextureCanvases() {
  const S = 64;
  const map = {};

  // 1. Town House A Side Wall: cobblestone plinth + half-timbered stucco + lit shuttered windows + flower boxes
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(301);
    // Warm aged cream stucco plaster base
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = rng();
        pc.set(x, y, r > 0.72 ? '#efe7d4' : (r < 0.22 ? '#d9cdb4' : '#e6dcc5'));
      }
    }
    // Cobblestone foundation along bottom (y = 50..63)
    pc.fillRect(0, 50, S, 14, '#565c66');
    for (let row = 0; row < 3; row++) {
      const yy = 51 + row * 4;
      const off = (row % 2) * 5;
      pc.fillRect(0, yy - 1, S, 1, '#2a2e36');
      for (let xx = -off; xx < S; xx += 10) {
        pc.fillRect(xx, yy, 9, 3, (row + xx) % 3 === 0 ? '#78808c' : '#656c78');
        pc.fillRect(xx + 1, yy, 7, 1, '#8c94a1');
        pc.fillRect(xx + 9, yy, 1, 3, '#2a2e36');
      }
    }
    // Dark oak timber framing (posts, horizontal beam & diagonal braces)
    const timber = '#59361e';
    const timberHi = '#7a4d2c';
    const timberDark = '#2e1a0d';
    const beamH = (yy, hh) => {
      pc.fillRect(0, yy, S, hh, timber);
      pc.fillRect(0, yy, S, 1, timberHi);
      pc.fillRect(0, yy + hh - 1, S, 1, timberDark);
    };
    const postV = (xx, ww) => {
      pc.fillRect(xx, 0, ww, 50, timber);
      pc.fillRect(xx, 0, 1, 50, timberHi);
      pc.fillRect(xx + ww - 1, 0, 1, 50, timberDark);
    };
    beamH(0, 4);
    beamH(25, 4);
    beamH(47, 4);
    postV(0, 4);
    postV(30, 4);
    postV(60, 4);
    // Two cozy shuttered windows with flower boxes
    drawPixelWindow(pc, 10, 7, 14, 14, '#4a2b16', '#2b6e42', '#fff0a8', '#f5c85b', '#ba7e28', true);
    drawPixelWindow(pc, 40, 7, 14, 14, '#4a2b16', '#2b6e42', '#fff0a8', '#f5c85b', '#ba7e28', true);
    drawPixelWindow(pc, 10, 31, 14, 13, '#4a2b16', '#2b6e42', '#fff0a8', '#f5c85b', '#ba7e28', false);
    drawPixelWindow(pc, 40, 31, 14, 13, '#4a2b16', '#2b6e42', '#fff0a8', '#f5c85b', '#ba7e28', false);
    map.townWallA = pc;
  }

  // 2. Town House A Front Facade: clean arched oak front door + lantern + neatly flanked windows (ZERO chopped shutters!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(302);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = rng();
        pc.set(x, y, r > 0.72 ? '#efe7d4' : (r < 0.22 ? '#d9cdb4' : '#e6dcc5'));
      }
    }
    // Cobblestone plinth
    pc.fillRect(0, 50, S, 14, '#565c66');
    for (let row = 0; row < 3; row++) {
      const yy = 51 + row * 4;
      const off = (row % 2) * 5;
      pc.fillRect(0, yy - 1, S, 1, '#2a2e36');
      for (let xx = -off; xx < S; xx += 10) {
        pc.fillRect(xx, yy, 9, 3, (row + xx) % 3 === 0 ? '#78808c' : '#656c78');
        pc.fillRect(xx + 1, yy, 7, 1, '#8c94a1');
        pc.fillRect(xx + 9, yy, 1, 3, '#2a2e36');
      }
    }
    // Timber framing beams
    const timber = '#59361e', timberHi = '#7a4d2c', timberDark = '#2e1a0d';
    const beamH = (yy, hh) => {
      pc.fillRect(0, yy, S, hh, timber);
      pc.fillRect(0, yy, S, 1, timberHi);
      pc.fillRect(0, yy + hh - 1, S, 1, timberDark);
    };
    beamH(0, 4); beamH(25, 4); beamH(47, 4);
    for (const xx of [0, 60]) {
      pc.fillRect(xx, 0, 4, 50, timber);
      pc.fillRect(xx, 0, 1, 50, timberHi);
      pc.fillRect(xx + 3, 0, 1, 50, timberDark);
    }
    // Upstairs windows with shutters & blooming flower boxes
    drawPixelWindow(pc, 10, 7, 14, 14, '#4a2b16', '#2b6e42', '#fff0a8', '#f5c85b', '#ba7e28', true);
    drawPixelWindow(pc, 40, 7, 14, 14, '#4a2b16', '#2b6e42', '#fff0a8', '#f5c85b', '#ba7e28', true);
    // Cleanly flanked ground-floor cottage windows (no overlap with doorway!)
    drawPixelWindow(pc, 6, 32, 11, 12, '#4a2b16', null, '#fff0a8', '#f5c85b', '#ba7e28', false);
    drawPixelWindow(pc, 47, 32, 11, 12, '#4a2b16', null, '#fff0a8', '#f5c85b', '#ba7e28', false);
    // Arched oak front door + stone arch frame + brass doorknob + porch lantern!
    pc.fillRect(23, 32, 18, 31, '#424752');
    pc.fillRect(25, 34, 14, 29, '#6e3f1f');
    pc.fillEllipse(32, 36, 7, 4, '#6e3f1f');
    for (let dx = 27; dx <= 37; dx += 3) pc.fillRect(dx, 34, 1, 29, '#472611');
    pc.fillRect(25, 45, 14, 2, '#3d210f');
    pc.fillRect(25, 55, 14, 2, '#3d210f');
    pc.fillRect(35, 49, 2, 2, '#ffd43b');
    pc.fillRect(30, 38, 4, 4, '#ffe88a');
    // Glowing warm porch lantern beside the door
    pc.fillRect(42, 37, 4, 6, '#262b33');
    pc.fillRect(43, 38, 2, 4, '#ffea70');
    // Stone doorstep
    pc.fillRect(21, 61, 22, 3, '#9aa2ad');
    pc.fillRect(21, 61, 22, 1, '#c4ccd6');
    map.townFrontA = pc;
  }

  // 3. Terracotta Roof Shingles (rich scalloped Mediterranean pixel clay tiles!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(303);
    for (let y = 0; y < S; y++) {
      const row = Math.floor(y / 8);
      const ry = y % 8;
      const xOff = (row % 2) * 4;
      for (let x = 0; x < S; x++) {
        const col = Math.floor((x + xOff) / 8);
        const rx = (x + xOff) % 8;
        const tileVar = ((row * 7 + col * 13) % 5) * 0.04;
        const arch = ry === 7 && (rx === 0 || rx === 7);
        let c = '#c4522d';
        if (ry === 0) c = '#e3774b'; // sunlit upper ridge!
        else if (ry === 7 || rx === 0) c = '#6e2314'; // crisp deep tile shadow notch!
        else if (ry >= 5 || arch) c = '#9c381d';
        else if (tileVar > 0.10) c = '#d46137';
        else if (rng() > 0.85) c = '#b54626';
        pc.set(x, y, c);
      }
    }
    map.terracottaRoof = pc;
  }

  // 4. Town House B Clapboard & Shop Wall (warm ochre wood siding + blue shutters + shop windows!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(304);
    for (let y = 0; y < S; y++) {
      const plankRow = y % 5;
      for (let x = 0; x < S; x++) {
        let c = '#dec79b';
        if (plankRow === 0) c = '#f0deb8';
        else if (plankRow === 4) c = '#a88f65';
        else if (rng() > 0.85) c = '#d1b788';
        pc.set(x, y, c);
      }
    }
    // Red brick foundation (bottom 12px)
    pc.fillRect(0, 52, S, 12, '#7d382c');
    for (let r = 0; r < 3; r++) {
      const yy = 53 + r * 4;
      pc.fillRect(0, yy - 1, S, 1, '#4a211b');
      for (let xx = (r % 2) * 4; xx < S; xx += 8) {
        pc.fillRect(xx, yy, 7, 3, (r + xx) % 2 === 0 ? '#964738' : '#853c2f');
        pc.fillRect(xx + 7, yy, 1, 3, '#4a211b');
      }
    }
    // Crisp white corner trim boards
    pc.fillRect(0, 0, 3, 52, '#f2efe6');
    pc.fillRect(61, 0, 3, 52, '#f2efe6');
    pc.fillRect(0, 27, S, 3, '#f2efe6');
    pc.fillRect(0, 30, S, 1, '#9e9584');
    // Upstairs cozy blue-shuttered windows
    drawPixelWindow(pc, 10, 7, 13, 14, '#f2efe6', '#2f5d8c', '#d4f1ff', '#7fc4eb', '#3d79a6', true);
    drawPixelWindow(pc, 41, 7, 13, 14, '#f2efe6', '#2f5d8c', '#d4f1ff', '#7fc4eb', '#3d79a6', true);
    // Ground-floor wide warm cafe display window + timber shop door (Front only!)
    drawPixelWindow(pc, 7, 34, 24, 15, '#59361e', null, '#fff4b8', '#f5c249', '#b8761c', false);
    pc.fillRect(39, 34, 16, 28, '#4a2c18');
    pc.fillRect(41, 36, 12, 12, '#ffe894');
    pc.fillRect(46, 36, 2, 12, '#4a2c18');
    pc.fillRect(41, 50, 12, 12, '#734627');
    pc.fillRect(50, 52, 2, 2, '#ffd43b');
    map.townFrontB = pc;
  }

  // 4b. Town House B Side/Back Clapboard Wall (windows only, no duplicate doors!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(3041);
    for (let y = 0; y < S; y++) {
      const plankRow = y % 5;
      for (let x = 0; x < S; x++) {
        let c = '#dec79b';
        if (plankRow === 0) c = '#f0deb8';
        else if (plankRow === 4) c = '#a88f65';
        else if (rng() > 0.85) c = '#d1b788';
        pc.set(x, y, c);
      }
    }
    pc.fillRect(0, 52, S, 12, '#7d382c');
    for (let r = 0; r < 3; r++) {
      const yy = 53 + r * 4;
      pc.fillRect(0, yy - 1, S, 1, '#4a211b');
      for (let xx = (r % 2) * 4; xx < S; xx += 8) {
        pc.fillRect(xx, yy, 7, 3, (r + xx) % 2 === 0 ? '#964738' : '#853c2f');
        pc.fillRect(xx + 7, yy, 1, 3, '#4a211b');
      }
    }
    pc.fillRect(0, 0, 3, 52, '#f2efe6');
    pc.fillRect(61, 0, 3, 52, '#f2efe6');
    pc.fillRect(0, 27, S, 3, '#f2efe6');
    pc.fillRect(0, 30, S, 1, '#9e9584');
    drawPixelWindow(pc, 10, 7, 13, 14, '#f2efe6', '#2f5d8c', '#d4f1ff', '#7fc4eb', '#3d79a6', true);
    drawPixelWindow(pc, 41, 7, 13, 14, '#f2efe6', '#2f5d8c', '#d4f1ff', '#7fc4eb', '#3d79a6', true);
    drawPixelWindow(pc, 10, 34, 13, 14, '#f2efe6', '#2f5d8c', '#fff4b8', '#f5c249', '#b8761c', false);
    drawPixelWindow(pc, 41, 34, 13, 14, '#f2efe6', '#2f5d8c', '#fff4b8', '#f5c249', '#b8761c', false);
    map.townWallB = pc;
  }

  // 5. Blue-Slate Pixel Roof Shingles
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(305);
    for (let y = 0; y < S; y++) {
      const row = Math.floor(y / 8);
      const ry = y % 8;
      const xOff = (row % 2) * 4;
      for (let x = 0; x < S; x++) {
        const col = Math.floor((x + xOff) / 8);
        const rx = (x + xOff) % 8;
        let c = '#3e4c61';
        if (ry === 0) c = '#5c6e8a';
        else if (ry === 7 || rx === 0) c = '#1f2733';
        else if ((row * 5 + col * 11) % 4 === 0) c = '#4a5a73';
        else if (rng() > 0.90) c = '#354354';
        pc.set(x, y, c);
      }
    }
    map.slateRoof = pc;
  }

  // 6. Alpine Ski Chalet Stacked Pine-Log Cabin Wall + Glowing Warm Hearth Windows
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(306);
    for (let y = 0; y < 50; y++) {
      const ly = y % 6;
      for (let x = 0; x < S; x++) {
        let c = '#784826';
        if (ly === 0) c = '#a36839';
        else if (ly === 1) c = '#8f582e';
        else if (ly === 5) c = '#381e0e';
        else if (ly === 4) c = '#593319';
        else if (rng() > 0.88) c = '#633a1d';
        pc.set(x, y, c);
      }
    }
    // Notched log ends along left & right corners
    for (let y = 0; y < 50; y += 6) {
      pc.fillRect(0, y + 1, 4, 4, '#b87d48');
      pc.fillRect(1, y + 2, 2, 2, '#6e401f');
      pc.fillRect(60, y + 1, 4, 4, '#b87d48');
      pc.fillRect(61, y + 2, 2, 2, '#6e401f');
    }
    // Heavy frosted alpine stone foundation
    pc.fillRect(0, 50, S, 14, '#5e6b78');
    for (let r = 0; r < 3; r++) {
      const yy = 51 + r * 4;
      pc.fillRect(0, yy - 1, S, 1, '#2b3440');
      for (let xx = (r % 2) * 5; xx < S; xx += 10) {
        pc.fillRect(xx, yy, 9, 3, '#7b8a99');
        pc.fillRect(xx + 1, yy, 7, 1, '#c4dbe8'); // frost dusting on top stones!
      }
    }
    // Warm golden glowing chalet windows with cozy red alpine shutters + snow sills
    drawPixelWindow(pc, 10, 8, 14, 14, '#3d2210', '#a62626', '#fff2a6', '#ffb838', '#cc6b14', false);
    drawPixelWindow(pc, 40, 8, 14, 14, '#3d2210', '#a62626', '#fff2a6', '#ffb838', '#cc6b14', false);
    pc.fillRect(8, 22, 18, 2, '#eef8ff'); // snow on sills!
    pc.fillRect(38, 22, 18, 2, '#eef8ff');
    // Heavy timber chalet door + warm side windows (Front only!)
    pc.fillRect(25, 31, 14, 30, '#4f2b14');
    pc.fillRect(27, 33, 10, 26, '#6e3f1f');
    pc.fillRect(30, 36, 4, 5, '#ffdf66');
    pc.fillRect(35, 48, 2, 2, '#ffd43b');
    drawPixelWindow(pc, 8, 32, 12, 12, '#3d2210', null, '#fff2a6', '#ffb838', '#cc6b14', false);
    drawPixelWindow(pc, 44, 32, 12, 12, '#3d2210', null, '#fff2a6', '#ffb838', '#cc6b14', false);
    map.chaletFront = pc;
  }

  // 6b. Ski Chalet Side/Back Log Wall (windows only, no duplicate front doors!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(3061);
    for (let y = 0; y < 50; y++) {
      const ly = y % 6;
      for (let x = 0; x < S; x++) {
        let c = '#784826';
        if (ly === 0) c = '#a36839';
        else if (ly === 1) c = '#8f582e';
        else if (ly === 5) c = '#381e0e';
        else if (ly === 4) c = '#593319';
        else if (rng() > 0.88) c = '#633a1d';
        pc.set(x, y, c);
      }
    }
    for (let y = 0; y < 50; y += 6) {
      pc.fillRect(0, y + 1, 4, 4, '#b87d48');
      pc.fillRect(60, y + 1, 4, 4, '#b87d48');
    }
    pc.fillRect(0, 50, S, 14, '#5e6b78');
    for (let r = 0; r < 3; r++) {
      const yy = 51 + r * 4;
      pc.fillRect(0, yy - 1, S, 1, '#2b3440');
      for (let xx = (r % 2) * 5; xx < S; xx += 10) {
        pc.fillRect(xx, yy, 9, 3, '#7b8a99');
        pc.fillRect(xx + 1, yy, 7, 1, '#c4dbe8');
      }
    }
    drawPixelWindow(pc, 10, 8, 14, 14, '#3d2210', '#a62626', '#fff2a6', '#ffb838', '#cc6b14', false);
    drawPixelWindow(pc, 40, 8, 14, 14, '#3d2210', '#a62626', '#fff2a6', '#ffb838', '#cc6b14', false);
    drawPixelWindow(pc, 10, 32, 14, 13, '#3d2210', '#a62626', '#fff2a6', '#ffb838', '#cc6b14', false);
    drawPixelWindow(pc, 40, 32, 14, 13, '#3d2210', '#a62626', '#fff2a6', '#ffb838', '#cc6b14', false);
    map.chaletWall = pc;
  }

  // 7. Snow-Laden Alpine Shingle Roof (heavy fluffy snow blanket + icicle trim along eave!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(307);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (y > 54) {
          // Dark cedar roof eave peeking beneath snow with crisp icicles!
          const icicle = ((x % 7 === 1 || x % 7 === 2) && y < 60) || (x % 7 === 1 && y < 63);
          pc.set(x, y, icicle ? '#c8eeff' : (y === 55 ? '#2b2019' : '#4a3528'));
        } else {
          const drift = Math.sin(x * 0.25 + y * 0.14) * 0.25 + rng() * 0.25;
          let c = '#e8f5fc';
          if (y > 50) c = '#9ccbe8'; // underside blue shadow of snow lip!
          else if (drift > 0.22) c = '#ffffff';
          else if (drift < -0.05) c = '#c4e2f5';
          pc.set(x, y, c);
        }
      }
    }
    map.snowRoof = pc;
  }

  // 8. Southwest Desert Adobe Plaster Wall + Exposed Mud Bricks + Turquoise Doors/Windows + Tapestry
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(308);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = rng();
        pc.set(x, y, r > 0.72 ? '#e3a674' : (r < 0.20 ? '#bd794b' : '#d4925f'));
      }
    }
    // Exposed weathered adobe mud-brick patches peeking through plaster!
    const brickPatch = (bx, by) => {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          pc.fillRect(bx + c * 5 + (r % 2) * 2, by + r * 3, 4, 2, '#a35d35');
          pc.fillRect(bx + c * 5 + (r % 2) * 2, by + r * 3 + 2, 4, 1, '#6e381c');
        }
      }
    };
    brickPatch(4, 48);
    brickPatch(44, 14);
    // Warm earth foundation band
    pc.fillRect(0, 56, S, 8, '#9c5a34');
    pc.fillRect(0, 56, S, 1, '#753d20');
    // Recessed turquoise-trimmed adobe windows with wooden lintels!
    const adobeWin = (wx, wy, ww, wh) => {
      pc.fillRect(wx - 2, wy - 3, ww + 4, 3, '#693d1f'); // timber lintel beam
      pc.fillRect(wx - 1, wy, ww + 2, wh + 1, '#2ca8a8'); // turquoise Southwest trim!
      pc.fillRect(wx + 1, wy + 1, ww - 2, wh - 2, '#36231a');
      pc.fillRect(wx + 2, wy + 2, ww - 4, wh - 4, '#241814');
      pc.fillRect(wx + Math.floor(ww / 2), wy + 1, 1, wh - 2, '#3ec4c4');
    };
    adobeWin(9, 14, 11, 12);
    adobeWin(44, 32, 11, 12);
    // Arched recessed turquoise doorway
    pc.fillRect(22, 28, 20, 3, '#693d1f');
    pc.fillRect(24, 31, 16, 32, '#248f8f');
    pc.fillRect(26, 33, 12, 30, '#59331a');
    for (let dx = 28; dx <= 36; dx += 3) pc.fillRect(dx, 33, 1, 30, '#381e0e');
    // Colorful hanging Southwest woven geometric tapestry banner!
    pc.fillRect(9, 32, 10, 14, '#c9382b');
    pc.fillRect(9, 35, 10, 2, '#ffcf38');
    pc.fillRect(9, 39, 10, 2, '#2ec4c4');
    pc.fillRect(9, 43, 10, 2, '#f2e8cf');
    map.adobeFront = pc;
  }

  // 8b. Desert Adobe Side/Back Wall (windows + exposed mud bricks + tapestry, no duplicate doors!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(3081);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = rng();
        pc.set(x, y, r > 0.72 ? '#e3a674' : (r < 0.20 ? '#bd794b' : '#d4925f'));
      }
    }
    for (const [bx, by] of [[6, 44], [42, 12]]) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          pc.fillRect(bx + c * 5 + (r % 2) * 2, by + r * 3, 4, 2, '#a35d35');
          pc.fillRect(bx + c * 5 + (r % 2) * 2, by + r * 3 + 2, 4, 1, '#6e381c');
        }
      }
    }
    pc.fillRect(0, 56, S, 8, '#9c5a34');
    pc.fillRect(0, 56, S, 1, '#753d20');
    const adobeWin = (wx, wy, ww, wh) => {
      pc.fillRect(wx - 2, wy - 3, ww + 4, 3, '#693d1f');
      pc.fillRect(wx - 1, wy, ww + 2, wh + 1, '#2ca8a8');
      pc.fillRect(wx + 1, wy + 1, ww - 2, wh - 2, '#36231a');
      pc.fillRect(wx + 2, wy + 2, ww - 4, wh - 4, '#241814');
      pc.fillRect(wx + Math.floor(ww / 2), wy + 1, 1, wh - 2, '#3ec4c4');
    };
    adobeWin(12, 22, 12, 13);
    adobeWin(40, 22, 12, 13);
    map.adobeWall = pc;
  }

  // 9. Adobe Flat Rooftop Plaster
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(309);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const edge = x < 3 || x > 60 || y < 3 || y > 60;
        pc.set(x, y, edge ? '#bd7c4d' : (rng() > 0.65 ? '#deb083' : '#cf9665'));
      }
    }
    map.adobeRoof = pc;
  }

  // 10. Coastal Lighthouse Red-and-White Pixel Brickwork + Portholes
  {
    const pc = new PixelCanvas(S, S);
    for (let y = 0; y < S; y++) {
      const band = Math.floor(y / 16) % 2; // crisp alternating red & white lighthouse bands!
      const brickRow = Math.floor(y / 4);
      const by = y % 4;
      const xOff = (brickRow % 2) * 4;
      for (let x = 0; x < S; x++) {
        const bx = (x + xOff) % 8;
        const mortar = by === 3 || bx === 0;
        if (band === 0) {
          pc.set(x, y, mortar ? '#7a1919' : (by === 0 ? '#eb4438' : '#cc2924'));
        } else {
          pc.set(x, y, mortar ? '#b8bec7' : (by === 0 ? '#ffffff' : '#e6ebf0'));
        }
      }
    }
    // Crisp dark naval porthole windows on white bands
    for (const py of [24, 56]) {
      pc.fillEllipse(32, py, 4.5, 4.5, '#2b323d');
      pc.fillEllipse(32, py, 3.0, 3.0, '#ffe885');
      pc.set(31, py - 1, '#ffffff');
    }
    map.lighthouseBody = pc;
  }

  // 11. Paddock Motorsport Festival Tent Canopy (vibrant orange/white stripes + checkered trim!)
  {
    const pc = new PixelCanvas(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (y >= 54) {
          // Crisp motorsport checkered racing flag valance along the eave!
          const chk = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0);
          pc.set(x, y, chk ? '#181c24' : '#f7f9fc');
        } else {
          const stripe = Math.floor(x / 8) % 2 === 0;
          const seam = x % 8 === 0;
          if (seam) pc.set(x, y, stripe ? '#b84c12' : '#c2c8d1');
          else pc.set(x, y, stripe ? '#f26d1d' : '#f5f7fa');
        }
      }
    }
    map.paddockCanopy = pc;
  }

  // 12. High-Vis Pixel Chevron Curve Sign
  {
    const pc = new PixelCanvas(S, S);
    pc.fillRect(0, 0, S, S, '#f5c418');
    pc.fillRect(0, 0, S, 3, '#1a1d24');
    pc.fillRect(0, S - 3, S, 3, '#1a1d24');
    pc.fillRect(0, 0, 3, S, '#1a1d24');
    pc.fillRect(S - 3, 0, 3, S, '#1a1d24');
    // Bold crisp black chevron arrow pointing right!
    for (let y = 6; y < S - 6; y++) {
      const distMid = Math.abs(y - 32);
      const tipX = 50 - distMid;
      pc.fillRect(tipX - 18, y, 18, 1, '#181b21');
    }
    // Corner rivet bolts
    for (const [rx, ry] of [[6, 6], [56, 6], [6, 56], [56, 56]]) {
      pc.fillRect(rx, ry, 2, 2, '#7d8591');
    }
    map.chevronSign = pc;
  }

  // 13. Riveted Bridge Steel & Masonry (for Suspension Bridges, Guardrails & Trusses!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(313);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const panelEdge = (x % 32 === 0 || y % 16 === 0);
        const hiEdge = (x % 32 === 1 || y % 16 === 1);
        let c = '#596575';
        if (panelEdge) c = '#28303b';
        else if (hiEdge) c = '#7c8b9e';
        else if (rng() > 0.88) c = '#4a5563';
        else if (rng() < 0.08) c = '#755645'; // subtle weathered rust patina speck!
        pc.set(x, y, c);
      }
    }
    // Crisp metallic rivet rows along plates
    for (let y = 3; y < S; y += 16) {
      for (let x = 4; x < S; x += 8) {
        pc.set(x, y, '#9db0c7');
        pc.set(x, y + 1, '#262d38');
        pc.set(x, y + 10, '#9db0c7');
        pc.set(x, y + 11, '#262d38');
      }
    }
    map.bridgeSteel = pc;
  }

  // 14. Mossy Cobblestone Masonry (chimneys, wells, foundations, lighthouse bases)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(314);
    pc.fillRect(0, 0, S, S, '#333842');
    for (let row = 0; row < 8; row++) {
      const yy = row * 8;
      const off = (row % 2) * 7;
      for (let xx = -off; xx < S; xx += 14) {
        const v = rng();
        const col = v > 0.65 ? '#7e8794' : (v < 0.30 ? '#5c6470' : '#6c7582');
        pc.fillRect(xx + 1, yy + 1, 12, 6, col);
        pc.fillRect(xx + 1, yy + 1, 12, 1, '#9ca6b5');
        if (rng() > 0.72) {
          // Tiny emerald moss tuck in stone mortar!
          pc.fillRect(xx + 2, yy + 6, 4, 2, '#3a8c2b');
        }
      }
    }
    map.stoneWall = pc;
  }

  // 15. Weathered Timber Planks (windmills, water towers, wooden guard fences, market stalls)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(315);
    for (let y = 0; y < S; y++) {
      const py = y % 8;
      for (let x = 0; x < S; x++) {
        let c = '#87552e';
        if (py === 0) c = '#ab7141';
        else if (py === 7) c = '#3d2210';
        else if (rng() > 0.85) c = '#6e4322';
        pc.set(x, y, c);
      }
    }
    // Iron bolt nails & vertical plank seams
    for (let r = 0; r < 8; r++) {
      const sx = ((r * 23) % 48) + 8;
      pc.fillRect(sx, r * 8, 1, 8, '#3d2210');
      pc.set(sx - 2, r * 8 + 3, '#262b33');
      pc.set(sx + 2, r * 8 + 3, '#262b33');
    }
    map.woodPlank = pc;
  }

  // 16. Windmill Linen Lattice Sail + Market Striped Awning
  {
    const pc = new PixelCanvas(S, S);
    pc.fillRect(0, 0, S, S, '#f5ecd4');
    for (let y = 0; y < S; y += 8) pc.fillRect(0, y, S, 2, '#7a4b26');
    for (let x = 0; x < S; x += 16) pc.fillRect(x, 0, 2, S, '#7a4b26');
    pc.fillRect(0, 0, S, 3, '#5c361a');
    pc.fillRect(0, S - 3, S, 3, '#5c361a');
    pc.fillRect(0, 0, 3, S, '#5c361a');
    pc.fillRect(S - 3, 0, 3, S, '#5c361a');
    map.windmillSail = pc;
  }

  // 17. Volcanic Obsidian Rune Pillar Texture (inspired by user's Cinnabar Crater screenshot!)
  {
    const pc = new PixelCanvas(S, S);
    const rng = makeRng(317);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const edge = x < 3 || x > 60 || y % 16 === 0;
        pc.set(x, y, edge ? '#121017' : (rng() > 0.7 ? '#332e3b' : '#221f29'));
      }
    }
    // Glowing molten gold/amber carved rune bands & vertical sigils!
    pc.fillRect(4, 10, 56, 3, '#ff7b1a');
    pc.fillRect(6, 11, 52, 1, '#ffea66');
    pc.fillRect(4, 50, 56, 3, '#ff7b1a');
    pc.fillRect(6, 51, 52, 1, '#ffea66');
    // Carved geometric obsidian runes down center
    for (const rx of [16, 32, 48]) {
      pc.fillRect(rx - 1, 18, 3, 26, '#ff6614');
      pc.fillRect(rx, 20, 1, 22, '#fff080');
      pc.fillRect(rx - 4, 24, 9, 2, '#ff881a');
      pc.fillRect(rx - 4, 36, 9, 2, '#ff881a');
    }
    map.volcanoRune = pc;
  }

  return map;
}

let cachedArchMaterials = null;

function getArchMaterials() {
  if (cachedArchMaterials) return cachedArchMaterials;
  const canvases = buildArchitecturalTextureCanvases();
  const makeMat = (pc, opts = {}) => {
    const tex = pc.toTexture();
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: opts.roughness ?? 0.88,
      metalness: opts.metalness ?? 0.04,
      emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
      emissiveMap: opts.emissiveMap ? tex : null,
      emissiveIntensity: opts.emissiveIntensity ?? 0.0,
      side: opts.side ?? THREE.FrontSide,
    });
    patchWorldPropMaterialForPixelTheme(mat);
    return mat;
  };

  cachedArchMaterials = {
    townWallA:      makeMat(canvases.townWallA),
    townFrontA:     makeMat(canvases.townFrontA),
    terracottaRoof: makeMat(canvases.terracottaRoof, { side: THREE.DoubleSide }),
    townWallB:      makeMat(canvases.townWallB),
    townFrontB:     makeMat(canvases.townFrontB),
    slateRoof:      makeMat(canvases.slateRoof, { side: THREE.DoubleSide }),
    chaletWall:     makeMat(canvases.chaletWall),
    chaletFront:    makeMat(canvases.chaletFront),
    snowRoof:       makeMat(canvases.snowRoof, { side: THREE.DoubleSide }),
    adobeWall:      makeMat(canvases.adobeWall),
    adobeFront:     makeMat(canvases.adobeFront),
    adobeRoof:      makeMat(canvases.adobeRoof, { side: THREE.DoubleSide }),
    lighthouseBody: makeMat(canvases.lighthouseBody),
    paddockCanopy:  makeMat(canvases.paddockCanopy, { side: THREE.DoubleSide }),
    chevronSign:    makeMat(canvases.chevronSign, { side: THREE.DoubleSide }),
    bridgeSteel:    makeMat(canvases.bridgeSteel, { roughness: 0.65, metalness: 0.25 }),
    stoneWall:      makeMat(canvases.stoneWall),
    woodPlank:      makeMat(canvases.woodPlank, { side: THREE.DoubleSide }),
    windmillSail:   makeMat(canvases.windmillSail, { side: THREE.DoubleSide }),
    volcanoRune:    makeMat(canvases.volcanoRune, { emissive: 0xff6b1a, emissiveMap: true, emissiveIntensity: 0.55 }),
    beaconGlow: new THREE.MeshBasicMaterial({ color: 0xfff099 }),
    redTrim: (() => {
      const m = new THREE.MeshStandardMaterial({ color: 0xcc2e24, roughness: 0.72, metalness: 0.05 });
      patchWorldPropMaterialForPixelTheme(m);
      return m;
    })(),
    darkMetal: (() => {
      const m = new THREE.MeshStandardMaterial({ color: 0x262d38, roughness: 0.55, metalness: 0.35 });
      patchWorldPropMaterialForPixelTheme(m);
      return m;
    })(),
  };
  return cachedArchMaterials;
}

// ============================================================================
// 2. PROCEDURAL GEOMETRY HELPERS (CLEAN OUTWARD NORMALS + CRISP UVS!)
// ============================================================================

function boxGeo(w, h, d, cx = 0, cy = 0, cz = 0, uvRepeatX = 1, uvRepeatY = 1, rotX = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotX !== 0) g.rotateX(rotX);
  g.translate(cx, cy, cz);
  if (uvRepeatX !== 1 || uvRepeatY !== 1) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * uvRepeatX, uv.getY(i) * uvRepeatY);
    }
  }
  return g;
}

/**
 * Helper to create a valance skirt box whose V coordinates map strictly to the bottom
 * checkered strip (v in [0.0, 0.16]) of paddockCanopy!
 */
function checkeredSkirtGeo(w, h, d, cx, cy, cz, uvRepeatX = 2.0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uvRepeatX, uv.getY(i) * 0.155);
  }
  return g;
}

/**
 * Builds a pitched triangular prism roof (ridge along X axis, sloping down in +/-Z)
 * with clean planar UVs on the two roof slopes and gable triangles!
 */
function gableRoofGeo(widthX, heightY, depthZ, baseY = 0, uvTilesX = 2.0, uvTilesSlope = 1.5) {
  const hw = widthX * 0.5;
  const hd = depthZ * 0.5;
  const positions = [];
  const uvs = [];

  const pushTri = (a, b, c, ua, ub, uc) => {
    positions.push(...a, ...b, ...c);
    uvs.push(...ua, ...ub, ...uc);
  };

  // Front roof slope (+Z)
  const fBL = [-hw, baseY, hd], fBR = [hw, baseY, hd];
  const topL = [-hw, baseY + heightY, 0], topR = [hw, baseY + heightY, 0];
  pushTri(fBL, fBR, topR, [0, 0], [uvTilesX, 0], [uvTilesX, uvTilesSlope]);
  pushTri(fBL, topR, topL, [0, 0], [uvTilesX, uvTilesSlope], [0, uvTilesSlope]);

  // Back roof slope (-Z)
  const bBL = [-hw, baseY, -hd], bBR = [hw, baseY, -hd];
  pushTri(bBR, bBL, topL, [0, 0], [uvTilesX, 0], [uvTilesX, uvTilesSlope]);
  pushTri(bBR, topL, topR, [0, 0], [uvTilesX, uvTilesSlope], [0, uvTilesSlope]);

  // Under-eave soffit floor so roof looks solid from underneath
  pushTri(bBL, bBR, fBR, [0, 0], [1, 0], [1, 1]);
  pushTri(bBL, fBR, fBL, [0, 0], [1, 1], [0, 1]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Builds the two vertical triangular gable end walls closing the +/-X ends of a gable roof!
 */
function gableEndsGeo(widthX, heightY, depthZ, baseY = 0) {
  const hw = widthX * 0.5;
  const hd = depthZ * 0.5;
  const positions = [];
  const uvs = [];
  // +X gable triangle (outward normal +X)
  positions.push(hw, baseY, hd,  hw, baseY, -hd,  hw, baseY + heightY, 0);
  uvs.push(0, 0,  1, 0,  0.5, 0.5);
  // -X gable triangle (outward normal -X)
  positions.push(-hw, baseY, -hd,  -hw, baseY, hd,  -hw, baseY + heightY, 0);
  uvs.push(0, 0,  1, 0,  0.5, 0.5);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

function mergeSafe(geos) {
  const normalized = geos.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g.clone();
    if (!ng.attributes.normal) ng.computeVertexNormals();
    if (!ng.attributes.uv) {
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    }
    return ng;
  });
  const merged = BufferGeometryUtils.mergeGeometries(normalized, false);
  normalized.forEach((g) => g.dispose());
  geos.forEach((g) => g.dispose());
  return merged;
}

// ============================================================================
// 3. REBUILT HIGH-DETAIL 3D PIXEL-ART BUILDINGS (MATCHING ORIGINAL FOOTPRINTS!)
// ============================================================================

export function buildUpgraded3DBuildingParts(key) {
  const M = getArchMaterials();

  // --- 1. TOWN HOUSE A: Half-Timbered Village Cottage (7.1 x 6.6 x 5.7m) ---
  if (key === 'town_house_a') {
    const stoneGeo = mergeSafe([
      // Deep cobblestone retaining foundation (extends -1.6m down so hillside corners NEVER float!)
      boxGeo(6.9, 2.2, 5.4, 0, -0.50, 0, 2, 1.4),
      boxGeo(1.0, 2.6, 1.0, 2.0, 5.4, -1.2, 1, 1.5),
      boxGeo(1.25, 0.24, 1.25, 2.0, 6.75, -1.2, 1, 0.25),
      boxGeo(1.8, 0.95, 0.9, 0, -0.18, 2.95, 1, 0.6),
    ]);
    const wallGeo = mergeSafe([
      boxGeo(6.6, 3.85, 5.1, 0, 2.45, 0, 1, 1),
    ]);
    const frontGeo = new THREE.PlaneGeometry(6.58, 3.85);
    frontGeo.translate(0, 2.45, 2.57);
    const roofGeo = mergeSafe([
      gableRoofGeo(7.45, 2.45, 6.0, 4.25, 2.4, 1.6),
      boxGeo(2.4, 0.18, 1.25, 0, 2.55, 3.05, 1.0, 0.6, 0.18),
    ]);
    // Warm timber gable ends + porch posts + roof ridge beam (ZERO cobblestone in attic!)
    const trimGeo = mergeSafe([
      gableEndsGeo(6.6, 2.35, 5.1, 4.35),
      boxGeo(0.22, 2.4, 0.22, -1.05, 1.35, 3.45, 0.2, 1.5),
      boxGeo(0.22, 2.4, 0.22,  1.05, 1.35, 3.45, 0.2, 1.5),
      boxGeo(7.55, 0.26, 0.28, 0, 6.72, 0, 3.0, 0.2),
    ]);
    return [
      { geometry: stoneGeo, material: M.stoneWall, localMatrix: null },
      { geometry: wallGeo,  material: M.townWallA, localMatrix: null },
      { geometry: frontGeo, material: M.townFrontA, localMatrix: null },
      { geometry: roofGeo,  material: M.terracottaRoof, localMatrix: null },
      { geometry: trimGeo,  material: M.woodPlank, localMatrix: null },
    ];
  }

  // --- 2. TOWN HOUSE B: Two-Story Roadside Shop / Cafe Townhouse (8.7 x 5.6 x 6.45m) ---
  if (key === 'town_house_b') {
    const stoneGeo = mergeSafe([
      // Deep stone foundation skirt extending -1.65m down for solid hillside grounding!
      boxGeo(8.2, 2.25, 5.6, 0, -0.52, 0, 2.4, 1.4),
      boxGeo(1.0, 2.1, 1.0, -2.5, 5.3, -1.3, 1, 1.2),
      boxGeo(3.2, 0.95, 1.1, 0, -0.20, 3.2, 1.5, 0.6),
    ]);
    const wallGeo = mergeSafe([
      boxGeo(7.9, 3.9, 5.3, 0, 2.4, 0, 1, 1),
    ]);
    const frontGeo = new THREE.PlaneGeometry(7.88, 3.9);
    frontGeo.translate(0, 2.4, 2.67);
    const roofGeo = mergeSafe([
      gableRoofGeo(8.7, 1.95, 6.2, 4.25, 2.8, 1.5),
      boxGeo(8.8, 0.24, 0.26, 0, 6.22, 0, 3, 0.2),
    ]);
    // Properly rotated-before-translated striped cafe awning right above shop entrance!
    const awningSlope = boxGeo(4.8, 0.16, 1.35, 0, 2.48, 3.28, 1.5, 0.8, 0.22);
    const trimGeo = mergeSafe([
      gableEndsGeo(7.9, 1.85, 5.3, 4.35),
      boxGeo(0.22, 2.35, 0.22, -2.2, 1.25, 3.72, 0.2, 1.5),
      boxGeo(0.22, 2.35, 0.22,  2.2, 1.25, 3.72, 0.2, 1.5),
    ]);
    return [
      { geometry: stoneGeo,    material: M.stoneWall, localMatrix: null },
      { geometry: wallGeo,     material: M.townWallB, localMatrix: null },
      { geometry: frontGeo,    material: M.townFrontB, localMatrix: null },
      { geometry: roofGeo,     material: M.slateRoof, localMatrix: null },
      { geometry: awningSlope, material: M.paddockCanopy, localMatrix: null },
      { geometry: trimGeo,     material: M.woodPlank, localMatrix: null },
    ];
  }

  // --- 3. PADDOCK TENT: Motorsport Festival Pit Canopy (7.8 x 4.35 x 5.4m) ---
  if (key === 'paddock_tent') {
    const frameGeo = mergeSafe([
      boxGeo(0.24, 3.1, 0.24, -3.55, 1.45, -2.35),
      boxGeo(0.24, 3.1, 0.24,  3.55, 1.45, -2.35),
      boxGeo(0.24, 3.1, 0.24, -3.55, 1.45,  2.35),
      boxGeo(0.24, 3.1, 0.24,  3.55, 1.45,  2.35),
      boxGeo(7.35, 0.16, 0.16, 0, 2.95, -2.35),
      boxGeo(7.35, 0.16, 0.16, 0, 2.95,  2.35),
      boxGeo(0.16, 0.16, 4.95, -3.55, 2.95, 0),
      boxGeo(0.16, 0.16, 4.95,  3.55, 2.95, 0),
    ]);
    // Peaked orange-white striped canopy + exact checkered-flag valance skirts!
    const canopyGeo = mergeSafe([
      gableRoofGeo(7.8, 1.45, 5.4, 2.95, 2.0, 0.84),
      gableEndsGeo(7.75, 1.42, 5.35, 2.95),
      checkeredSkirtGeo(7.82, 0.45, 0.08, 0, 2.75,  2.68, 2.0),
      checkeredSkirtGeo(7.82, 0.45, 0.08, 0, 2.75, -2.68, 2.0),
      checkeredSkirtGeo(0.08, 0.45, 5.40, -3.88, 2.75, 0, 1.5),
      checkeredSkirtGeo(0.08, 0.45, 5.40,  3.88, 2.75, 0, 1.5),
    ]);
    const cratesGeo = mergeSafe([
      boxGeo(1.6, 0.95, 0.9, -2.2, 0.48, -1.3, 1, 1),
      boxGeo(0.85, 0.85, 0.85, -0.7, 0.42, -1.4, 1, 1),
      boxGeo(0.75, 0.75, 0.75, -2.4, 1.32, -1.35, 1, 1),
    ]);
    return [
      { geometry: frameGeo,  material: M.bridgeSteel, localMatrix: null },
      { geometry: canopyGeo, material: M.paddockCanopy, localMatrix: null },
      { geometry: cratesGeo, material: M.woodPlank, localMatrix: null },
    ];
  }

  // --- 4. DESERT ADOBE: Two-Tier Southwest Pueblo Villa (7.4 x 4.9 x 5.8m) ---
  if (key === 'desert_adobe') {
    const wallGeo = mergeSafe([
      // Lower adobe tier + deep -1.5m desert clay plinth so hillside adobes never float
      boxGeo(7.1, 3.35, 5.4, 0, 1.45, 0, 1, 1),
      boxGeo(7.2, 1.65, 5.5, 0, -0.82, 0, 1.5, 0.8),
      boxGeo(4.2, 1.85, 3.6, -1.1, 3.95, -0.5, 0.75, 0.65),
      boxGeo(7.25, 0.42, 0.32, 0, 3.22,  2.62, 2, 0.2),
      boxGeo(7.25, 0.42, 0.32, 0, 3.22, -2.62, 2, 0.2),
      boxGeo(0.32, 0.42, 5.45,  3.48, 3.22, 0, 1.5, 0.2),
      boxGeo(0.32, 0.42, 5.45, -3.48, 3.22, 0, 1.5, 0.2),
    ]);
    const frontGeo = new THREE.PlaneGeometry(7.08, 3.35);
    frontGeo.translate(0, 1.45, 2.72);
    const roofGeo = mergeSafe([
      boxGeo(6.9, 0.16, 5.2, 0, 3.12, 0, 1.5, 1.5),
      boxGeo(4.35, 0.22, 3.75, -1.1, 4.88, -0.5, 1.0, 1.0),
    ]);
    const timberParts = [];
    for (let vx = -2.6; vx <= 2.6; vx += 1.3) {
      timberParts.push(boxGeo(0.24, 0.24, 6.25, vx, 2.85, 0, 0.2, 2));
    }
    for (let vx = -2.4; vx <= 0.4; vx += 1.1) {
      timberParts.push(boxGeo(0.20, 0.20, 4.35, vx, 4.55, -0.5, 0.2, 1.5));
    }
    // Properly rotated-before-translated leaning pueblo ladder right against +Z wall!
    timberParts.push(boxGeo(0.14, 3.65, 0.14, 2.25, 1.75, 3.05, 1, 1, -0.18));
    timberParts.push(boxGeo(0.14, 3.65, 0.14, 2.95, 1.75, 3.05, 1, 1, -0.18));
    for (let ly = 0.45; ly <= 3.05; ly += 0.52) {
      const zOff = 3.05 + (1.75 - ly) * Math.tan(0.18);
      timberParts.push(boxGeo(0.82, 0.11, 0.11, 2.6, ly, zOff));
    }
    return [
      { geometry: wallGeo,   material: M.adobeWall, localMatrix: null },
      { geometry: frontGeo,  material: M.adobeFront, localMatrix: null },
      { geometry: roofGeo,   material: M.adobeRoof, localMatrix: null },
      { geometry: mergeSafe(timberParts), material: M.woodPlank, localMatrix: null },
    ];
  }

  // --- 5. SKI CHALET: Cozy Alpine Timber Cabin with Balcony & Snow Roof (7.7 x 6.9 x 6.7m) ---
  if (key === 'ski_chalet') {
    const stoneGeo = mergeSafe([
      // Deep alpine stone retaining base extending -1.6m into snowy mountainsides!
      boxGeo(7.0, 2.25, 5.8, 0, -0.50, 0, 2, 1.4),
      boxGeo(1.1, 3.2, 1.1, 2.2, 5.4, -1.4, 1, 1.8),
      boxGeo(1.35, 0.26, 1.35, 2.2, 7.05, -1.4, 1, 0.25),
    ]);
    const wallGeo = mergeSafe([
      boxGeo(6.7, 3.65, 5.5, 0, 2.38, 0, 1, 1),
    ]);
    const frontGeo = new THREE.PlaneGeometry(6.68, 3.65);
    frontGeo.translate(0, 2.38, 2.77);
    // Single-tile uvTilesSlope=1.0 so snow blanket runs ridge-to-eave with ONE clean icicle row at bottom!
    const roofGeo = mergeSafe([
      gableRoofGeo(7.9, 2.95, 6.9, 4.05, 2.0, 1.0),
      boxGeo(7.95, 0.28, 0.34, 0, 7.0, 0, 2.5, 0.2),
    ]);
    const balconyParts = [
      gableEndsGeo(6.7, 2.85, 5.5, 4.20),
      boxGeo(5.2, 0.24, 1.35, 0, 2.55, 3.35, 2.0, 0.5),
      boxGeo(5.2, 0.14, 0.14, 0, 3.45, 3.95, 2.0, 0.2),
      boxGeo(5.2, 0.14, 0.14, 0, 3.00, 3.95, 2.0, 0.2),
      boxGeo(0.24, 2.55, 0.24, -2.4, 1.3, 3.85),
      boxGeo(0.24, 2.55, 0.24,  2.4, 1.3, 3.85),
    ];
    for (let bx = -2.4; bx <= 2.4; bx += 0.8) {
      balconyParts.push(boxGeo(0.14, 0.95, 0.14, bx, 3.05, 3.95));
    }
    return [
      { geometry: stoneGeo, material: M.stoneWall, localMatrix: null },
      { geometry: wallGeo,  material: M.chaletWall, localMatrix: null },
      { geometry: frontGeo, material: M.chaletFront, localMatrix: null },
      { geometry: roofGeo,  material: M.snowRoof, localMatrix: null },
      { geometry: mergeSafe(balconyParts), material: M.woodPlank, localMatrix: null },
    ];
  }

  // --- 6. LIGHTHOUSE: Grand Red-and-White Striped Coastal Beacon (4.8 x 17.1 x 4.8m) ---
  if (key === 'lighthouse') {
    const baseCyl = new THREE.CylinderGeometry(2.35, 2.85, 4.2, 8);
    baseCyl.translate(0, 0.2, 0);
    const towerCyl = new THREE.CylinderGeometry(1.45, 2.20, 10.6, 12);
    towerCyl.translate(0, 7.5, 0);
    // Gallery deck + railing posts + lantern cap
    const deckCyl = new THREE.CylinderGeometry(2.15, 1.65, 0.65, 12);
    deckCyl.translate(0, 13.0, 0);
    const railParts = [deckCyl];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      railParts.push(boxGeo(0.14, 0.95, 0.14, Math.cos(a) * 1.98, 13.8, Math.sin(a) * 1.98));
    }
    const railRing = new THREE.CylinderGeometry(2.04, 2.04, 0.14, 12, 1, true);
    railRing.translate(0, 14.25, 0);
    railParts.push(railRing);

    const glowCyl = new THREE.CylinderGeometry(1.18, 1.18, 1.75, 10);
    glowCyl.translate(0, 14.2, 0);

    const roofCone = new THREE.ConeGeometry(1.62, 2.1, 10);
    roofCone.translate(0, 16.05, 0);
    const spire = new THREE.CylinderGeometry(0.06, 0.12, 1.0, 6);
    spire.translate(0, 17.3, 0);

    return [
      { geometry: mergeSafe([baseCyl]), material: M.stoneWall, localMatrix: null },
      { geometry: mergeSafe([towerCyl]), material: M.lighthouseBody, localMatrix: null },
      { geometry: mergeSafe(railParts), material: M.darkMetal, localMatrix: null },
      { geometry: mergeSafe([glowCyl]), material: M.beaconGlow, localMatrix: null },
      { geometry: mergeSafe([roofCone, spire]), material: M.redTrim, localMatrix: null },
    ];
  }

  // --- 7. CHEVRON SIGN: Crisp Pixel Motorsport Curve Sign (1.16 x 2.35 x 0.22m) ---
  if (key === 'chevron_sign') {
    const posts = mergeSafe([
      boxGeo(0.12, 2.35, 0.12, -0.36, 1.10, -0.04),
      boxGeo(0.12, 2.35, 0.12,  0.36, 1.10, -0.04),
    ]);
    const plate = boxGeo(1.16, 1.05, 0.08, 0, 1.78, 0.04);
    return [
      { geometry: posts, material: M.darkMetal, localMatrix: null },
      { geometry: plate, material: M.chevronSign, localMatrix: null },
    ];
  }

  return null;
}

// ============================================================================
// 4. BRIDGE STEEL TEXTURING + AUTOMATIC 3D BRIDGE GUARDRAIL FENCES & POSTS!
// ============================================================================

/**
 * Patches `Scenery_Props` (Suspension Bridge towers, piers, cables & lampposts)
 * with crisp world-space riveted steel & stone masonry pixel textures!
 */
export function patchBridgeSceneryMaterial(m, isEmitter = false) {
  if (!m) return;
  if (isEmitter) {
    m.emissive = new THREE.Color(0xffe08a);
    m.emissiveIntensity = 1.6;
    m.needsUpdate = true;
    return;
  }
  const M = getArchMaterials();
  m.map = M.bridgeSteel.map;
  m.roughness = 0.72;
  m.metalness = 0.18;
  m.customProgramCacheKey = () => 'pixel_bridge_scenery_v1';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrPos;\nvarying vec3 vBrNorm;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vBrPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vBrNorm = normalize(mat3(modelMatrix) * objectNormal);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrPos;\nvarying vec3 vBrNorm;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
           vec2 triUv = (abs(vBrNorm.y) > 0.72)
             ? vBrPos.xz * 0.25
             : ((abs(vBrNorm.x) > abs(vBrNorm.z)) ? vBrPos.zy * 0.25 : vBrPos.xy * 0.25);
           vec2 snapped = (floor(fract(triUv) * 64.0) + 0.5) / 64.0;
           vec4 sampledDiffuseColor = texture2D(map, snapped);
           diffuseColor *= sampledDiffuseColor;
           // Subtle crimson-steel bridge tower accent on high towers (y > 8m)
           if (vBrPos.y > 10.0) {
             diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.38, 0.55, 0.48), 0.55);
           }
         #endif`
      );
  };
  m.needsUpdate = true;
}

/**
 * Automatically detects EVERY elevated bridge span across all road routes in
 * `map_routes.json` (where road deck sits >= 2.15m above terrain or over water)
 * and builds:
 *   1. Crisp 3D pixel-textured steel guardrail fences + safety posts + reflectors
 *   2. Sturdy 3D stone & steel support piers + crosshead beams underneath every
 *      elevated bridge span (extending cleanly into terrain/riverbed so ZERO bridges float!)
 *   3. Heavy flared stone pier footings around every Suspension Bridge tower!
 */
export async function createBridgeGuardrails(scene, terrainSampler, mapRoutesData, obstacles = [], roadCorridors = [], RAPIER = null, world = null) {
  if (!mapRoutesData || !mapRoutesData.routes || !terrainSampler) return null;

  // Build spatial grid of roads so:
  //   1) Bridge piers NEVER land on a lower underpass road
  //   2) Guardrails & piers use the EXACT real road half-width (r[3]) of the Blender road mesh!
  const RCELL = 14.0;
  const underpassGrid = new Map();
  if (roadCorridors && roadCorridors.length) {
    for (let i = 0; i < roadCorridors.length; i++) {
      const r = roadCorridors[i];
      const rx = r[0], rz = -r[1], ry = r[2] || 0, rw = r[3] || 7.5;
      const gx = Math.floor(rx / RCELL), gz = Math.floor(rz / RCELL);
      const key = `${gx}_${gz}`;
      if (!underpassGrid.has(key)) underpassGrid.set(key, []);
      underpassGrid.get(key).push({ x: rx, y: ry, z: rz, w: rw });
    }
  }
  const blocksLowerRoad = (x, z, deckY) => {
    const gx = Math.floor(x / RCELL), gz = Math.floor(z / RCELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const pts = underpassGrid.get(`${gx + dx}_${gz + dz}`);
        if (!pts) continue;
        for (let i = 0; i < pts.length; i++) {
          if (deckY - pts[i].y > 2.5 && Math.hypot(x - pts[i].x, z - pts[i].z) < pts[i].w + 2.2) {
            return true;
          }
        }
      }
    }
    return false;
  };
  // Returns true if (x, y, z) lies inside ANY same-elevation drivable road's asphalt!
  // Normal curb posts sit at (w + 0.15m), safely outside (w - 0.55m), whereas ANY fence post
  // or rail crossing a T-junction, Y-fork, ramp merge, or 4-way bridge intersection lands
  // inside the joining road's asphalt and is cleanly omitted so cars NEVER get blocked!
  const isOnSameLevelAsphalt = (x, y, z, margin = 0.25) => {
    const gx = Math.floor(x / RCELL), gz = Math.floor(z / RCELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const pts = underpassGrid.get(`${gx + dx}_${gz + dz}`);
        if (!pts) continue;
        for (let i = 0; i < pts.length; i++) {
          if (Math.abs(y - pts[i].y) > 2.8) continue;
          if (Math.hypot(x - pts[i].x, z - pts[i].z) < pts[i].w - margin) {
            return true;
          }
        }
      }
    }
    return false;
  };
  const isSegmentOnAsphalt = (a, b) => {
    for (const t of [0.25, 0.5, 0.75]) {
      const mx = a.x + (b.x - a.x) * t;
      const my = a.y + (b.y - a.y) * t;
      const mz = a.z + (b.z - a.z) * t;
      if (isOnSameLevelAsphalt(mx, my, mz, 0.25)) return true;
    }
    return false;
  };

  const M = getArchMaterials();
  const railGeos = [];
  const postGeos = [];
  const reflectorGeos = [];
  const pierStoneGeos = [];

  const up = new THREE.Vector3(0, 1, 0);
  const tmpDir = new THREE.Vector3();
  const tmpRight = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpMat = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpScale = new THREE.Vector3(1, 1, 1);

  // Exact Blender road half-widths from road_corridors.json (+0.15m outer curb rim)
  // Using constant per-route width prevents fences & piers from ever bowing out into water
  // when a narrow bridge approaches a wider highway or roundabout!
  const halfWidthByType = {
    highway: 8.90,
    secondary: 6.70,
    narrow: 4.85,
  };

  // Collect existing bridge pillars & Suspension Bridge main towers and ground them with heavy stone caisson footings!
  const existingPillars = [];
  const suspensionTowers = [];
  if (obstacles && obstacles.length) {
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (obs.type !== 'pillar') continue;
      const px = obs.x;
      const pz = -obs.y;
      existingPillars.push([px, pz]);
      const surf = terrainSampler.sample(px, pz);
      const baseY = surf ? surf.y : -4.0;
      const obsBottomY = (obs.z != null && obs.hy != null) ? (obs.z - obs.hy) : baseY;
      const isMainTower = (obs.hx || 0) >= 2.0;

      if (isMainTower) {
        suspensionTowers.push([px, pz]);
        // Heroic 2-tier stepped stone caisson pier wrapping the Suspension Bridge tower leg
        // from deep below riverbed/sand all the way up +2.2m past the tower base (ZERO gap!)
        const bottomY = Math.min(baseY - 4.0, -8.5);
        const topY = Math.max(baseY + 2.4, obsBottomY + 2.2, 4.5);
        const shaftH = Math.max(3.5, topY - bottomY);
        const wX = Math.max(4.4, (obs.hx || 2.4) * 2.25);
        const wZ = Math.max(3.6, (obs.hz || 1.35) * 2.85);
        tmpQuat.setFromAxisAngle(up, obs.rot || 0);

        const shaft = boxGeo(wX, shaftH, wZ, 0, 0, 0, 1.5, Math.max(1.5, shaftH * 0.35));
        tmpPos.set(px, (topY + bottomY) * 0.5, pz);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        shaft.applyMatrix4(tmpMat);
        pierStoneGeos.push(shaft);

        // Flared lower waterline/sandbank collar plinth
        const collarTop = Math.max(baseY + 1.3, 1.6);
        const collarH = Math.max(3.0, collarTop - bottomY);
        const collar = boxGeo(wX + 1.4, collarH, wZ + 1.4, 0, 0, 0, 1.8, Math.max(1.2, collarH * 0.35));
        tmpPos.set(px, (collarTop + bottomY) * 0.5, pz);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        collar.applyMatrix4(tmpMat);
        pierStoneGeos.push(collar);
      } else {
        // Heavy flared stone footing plinth around regular bridge pillar bases
        const bottomY = Math.min(baseY - 3.5, -7.5);
        const topY = Math.max(baseY + 1.15, obsBottomY + 1.0);
        const footH = Math.max(3.2, topY - bottomY);
        const foot = boxGeo(Math.max(3.2, (obs.hx || 1.35) * 2.35), footH, Math.max(3.2, (obs.hz || 1.35) * 2.35), 0, 0, 0, 1.4, Math.max(1.2, footH * 0.35));
        tmpQuat.setFromAxisAngle(up, obs.rot || 0);
        tmpPos.set(px, (topY + bottomY) * 0.5, pz);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        foot.applyMatrix4(tmpMat);
        pierStoneGeos.push(foot);
      }
    }
  }

  // Compute bounding box of the Suspension Bridge cable-suspended center span
  // so we do NOT place viaduct columns under the cable-suspended river span!
  let suspBounds = null;
  if (suspensionTowers.length >= 2) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [tx, tz] of suspensionTowers) {
      if (tx < minX) minX = tx;
      if (tx > maxX) maxX = tx;
      if (tz < minZ) minZ = tz;
      if (tz > maxZ) maxZ = tz;
    }
    suspBounds = { minX: minX - 18, maxX: maxX + 18, minZ: minZ - 14, maxZ: maxZ + 14 };
  }

  // Spatial deduplication grid so overlapping routes NEVER generate double guardrails or double piers!
  const DCELL = 5.5;
  const usedDeckGrid = new Map();
  const isDeckAlreadyFenced = (x, y, z) => {
    const gx = Math.floor(x / DCELL), gz = Math.floor(z / DCELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = usedDeckGrid.get(`${gx + dx}_${gz + dz}`);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          if (Math.abs(y - list[i].y) < 3.0 && Math.hypot(x - list[i].x, z - list[i].z) < 4.0) {
            return true;
          }
        }
      }
    }
    return false;
  };
  const markDeckFenced = (x, y, z) => {
    const gx = Math.floor(x / DCELL), gz = Math.floor(z / DCELL);
    const key = `${gx}_${gz}`;
    if (!usedDeckGrid.has(key)) usedDeckGrid.set(key, []);
    usedDeckGrid.get(key).push({ x, y, z });
  };

  // Single shared fixed Rapier rigid body for all solid bridge guardrail colliders
  let guardrailBody = null;
  if (RAPIER && world) {
    guardrailBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  }

  for (const route of mapRoutesData.routes) {
    // Skip duplicate non-drivable overlay routes (overpass_bridge_1..32, alpine_tunnel) that caused double fences!
    if (
      route.type === 'bridge_elevated' ||
      route.type === 'tunnel' ||
      (route.id && route.id.startsWith('overpass_bridge_'))
    ) {
      continue;
    }
    const pts = route.points;
    if (!pts || pts.length < 4) continue;
    const fallbackHw = halfWidthByType[route.type] || 6.25;

    // Classify which route vertices are on an elevated bridge span or over water
    const isBridge = new Uint8Array(pts.length);
    const groundYs = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const [px, py, pz] = pts[i];
      const surf = terrainSampler.sample(px, pz, py);
      const gy = surf ? surf.y : -6.0;
      groundYs[i] = gy;
      const clearance = py - gy;
      if (clearance >= 2.15 || (py < 0.2 && clearance >= 1.2)) {
        isBridge[i] = 1;
      }
    }

    // Build continuous fence spans along each bridge run (step ~4.4m between posts)
    // and sturdy 3D stone/steel support piers every ~22m underneath elevated spans!
    let accumDist = 0;
    let pierDist = 11.0; // Start first pier ~11m into each elevated span
    let prevLeft = null;
    let prevRight = null;
    let postCounter = 0;

    for (let i = 0; i < pts.length - 1; i++) {
      if (!isBridge[i]) {
        prevLeft = null;
        prevRight = null;
        accumDist = 0;
        pierDist = 11.0;
        continue;
      }

      const p0 = pts[i];
      const p1 = pts[i + 1];
      const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      if (segLen < 0.1 || segLen > 25.0) {
        prevLeft = null;
        prevRight = null;
        continue;
      }
      accumDist += segLen;
      pierDist += segLen;
      if ((prevLeft !== null || prevRight !== null) && accumDist < 4.4 && isBridge[i + 1]) continue;
      accumDist = 0;

      // Skip if another overlapping route already placed guardrails at this exact 3D deck location!
      if (isDeckAlreadyFenced(p0[0], p0[1], p0[2])) {
        prevLeft = null;
        prevRight = null;
        continue;
      }
      markDeckFenced(p0[0], p0[1], p0[2]);

      tmpDir.set(p1[0] - p0[0], 0, p1[2] - p0[2]);
      if (tmpDir.lengthSq() < 1e-4) continue;
      tmpDir.normalize();
      tmpRight.crossVectors(tmpDir, up).normalize();

      // Use the route's exact constant Blender half-width (9.20m strictly inside the Suspension Bridge deck)
      // so fences and piers NEVER jump or bow outward into water near intersections!
      const inSuspSpan = suspBounds &&
        p0[0] >= suspBounds.minX && p0[0] <= suspBounds.maxX &&
        p0[2] >= suspBounds.minZ && p0[2] <= suspBounds.maxZ;
      const hw = (inSuspSpan && route.type === 'highway') ? 9.20 : fallbackHw;

      const curL = new THREE.Vector3(p0[0] - tmpRight.x * hw, p0[1], p0[2] - tmpRight.z * hw);
      const curR = new THREE.Vector3(p0[0] + tmpRight.x * hw, p0[1], p0[2] + tmpRight.z * hw);

      // Check each side independently: if a post lands inside ANY joining/crossing road's
      // drivable asphalt at the same elevation, omit it so intersections stay 100% open & drivable!
      const leftBlocked = isOnSameLevelAsphalt(curL.x, curL.y, curL.z, 0.25);
      const rightBlocked = isOnSameLevelAsphalt(curR.x, curR.y, curR.z, 0.25);

      // Vertical fence post on each unobstructed edge
      const yaw = Math.atan2(tmpDir.x, tmpDir.z);
      tmpQuat.setFromAxisAngle(up, yaw);
      const edgePairs = [
        { cur: curL, blocked: leftBlocked, prev: prevLeft, isLeft: true },
        { cur: curR, blocked: rightBlocked, prev: prevRight, isLeft: false },
      ];
      for (const edge of edgePairs) {
        if (edge.blocked) continue;
        const pEdge = edge.cur;
        const post = new THREE.BoxGeometry(0.22, 1.22, 0.22);
        tmpPos.set(pEdge.x, pEdge.y + 0.52, pEdge.z);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        post.applyMatrix4(tmpMat);
        postGeos.push(post);

        if (postCounter % 2 === 0) {
          const refl = new THREE.BoxGeometry(0.25, 0.16, 0.25);
          tmpPos.set(pEdge.x, pEdge.y + 1.04, pEdge.z);
          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          refl.applyMatrix4(tmpMat);
          reflectorGeos.push(refl);
        }
      }

      // Place sturdy 3D stone & steel support pier pair + under-deck crosshead beam every ~22m!
      // Skip piers right at T/Y/4-way bridge junctions (leftBlocked || rightBlocked) so piers sit cleanly on spans!
      if (pierDist >= 22.0 && !leftBlocked && !rightBlocked) {
        const gy = groundYs[i];
        const clearance = p0[1] - gy;
        const nearTower = existingPillars.some(([ex, ez]) => Math.hypot(ex - p0[0], ez - p0[2]) < 19.0);
        if (clearance >= 2.6 && !nearTower && !inSuspSpan) {
          pierDist = 0;
          const bottomY = Math.min(gy - 2.6, -7.0); // Always anchored deep into sand, soil, or riverbed!
          const topY = p0[1] - 0.65;
          const colH = Math.max(2.5, topY - bottomY);
          const colCenterY = (topY + bottomY) * 0.5;
          // Tuck columns cleanly UNDERNEATH the actual bridge deck (never poking out past the curb!)
          const pierOff = Math.max(1.5, hw - 2.25);

          // Twin vertical stone masonry bridge columns (skipping any column that would land on a lower road!)
          let placedAnyCol = false;
          for (const side of [-1, 1]) {
            const cx = p0[0] + tmpRight.x * pierOff * side;
            const cz = p0[2] + tmpRight.z * pierOff * side;
            if (blocksLowerRoad(cx, cz, p0[1])) continue;
            placedAnyCol = true;
            const col = boxGeo(1.30, colH, 1.30, 0, 0, 0, 1.0, Math.max(1.0, colH * 0.35));
            tmpPos.set(cx, colCenterY, cz);
            tmpMat.compose(tmpPos, tmpQuat, tmpScale);
            col.applyMatrix4(tmpMat);
            pierStoneGeos.push(col);

            // Flared stone base plinth right at ground level
            const plinth = boxGeo(2.1, 2.1, 2.1, 0, 0, 0, 1.2, 1.0);
            tmpPos.set(cx, gy - 0.55, cz);
            tmpMat.compose(tmpPos, tmpQuat, tmpScale);
            plinth.applyMatrix4(tmpMat);
            pierStoneGeos.push(plinth);
          }

          if (placedAnyCol) {
            // Heavy horizontal pier crosshead girder tucked cleanly flush underneath the bridge deck!
            const capBeam = boxGeo(pierOff * 2.0 + 1.50, 0.90, 1.45, 0, 0, 0, 3.0, 0.5);
            tmpPos.set(p0[0], p0[1] - 0.78, p0[2]);
            tmpMat.compose(tmpPos, tmpQuat, tmpScale);
            capBeam.applyMatrix4(tmpMat);
            railGeos.push(capBeam);
          }
        }
      }

      // Connect each unobstructed side independently with dual safety rails + Rapier static colliders!
      for (const edge of edgePairs) {
        if (edge.blocked || !edge.prev) continue;
        const a = edge.prev;
        const b = edge.cur;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const len = Math.hypot(dx, dy, dz);
        if (len > 0.3 && len < 14.0 && !isSegmentOnAsphalt(a, b)) {
          const midX = (a.x + b.x) * 0.5;
          const midY = (a.y + b.y) * 0.5;
          const midZ = (a.z + b.z) * 0.5;
          const rYaw = Math.atan2(dx, dz);
          const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
          const euler = new THREE.Euler(pitch, rYaw, 0, 'YXZ');
          tmpQuat.setFromEuler(euler);

          // Top rail (y + 0.96m) & Mid guardrail beam (y + 0.52m)
          for (const [ry, rh, rw] of [[0.96, 0.14, 0.14], [0.52, 0.22, 0.12]]) {
            const rail = new THREE.BoxGeometry(rw, rh, len + 0.08);
            tmpPos.set(midX, midY + ry, midZ);
            tmpMat.compose(tmpPos, tmpQuat, tmpScale);
            rail.applyMatrix4(tmpMat);
            railGeos.push(rail);
          }

          // Solid Rapier static cuboid collider so bridge guardrails are 100% collidable!
          if (guardrailBody && RAPIER && world) {
            const colDesc = RAPIER.ColliderDesc.cuboid(0.28, 0.75, len * 0.5 + 0.12)
              .setTranslation(midX, midY + 0.65, midZ)
              .setRotation({ x: tmpQuat.x, y: tmpQuat.y, z: tmpQuat.z, w: tmpQuat.w })
              .setFriction(0.12)
              .setRestitution(0.15);
            world.createCollider(colDesc, guardrailBody);
          }
        }
      }

      prevLeft = leftBlocked ? null : curL;
      prevRight = rightBlocked ? null : curR;
      postCounter++;
    }
  }

  const group = new THREE.Group();
  if (railGeos.length > 0) {
    const mRails = new THREE.Mesh(mergeSafe(railGeos), M.bridgeSteel);
    mRails.castShadow = true;
    mRails.receiveShadow = true;
    group.add(mRails);
  }
  if (postGeos.length > 0) {
    const mPosts = new THREE.Mesh(mergeSafe(postGeos), M.darkMetal);
    mPosts.castShadow = true;
    mPosts.receiveShadow = true;
    group.add(mPosts);
  }
  if (reflectorGeos.length > 0) {
    const reflMat = new THREE.MeshBasicMaterial({ color: 0xffc82e });
    const mRefl = new THREE.Mesh(mergeSafe(reflectorGeos), reflMat);
    group.add(mRefl);
  }
  if (pierStoneGeos.length > 0) {
    const mPiers = new THREE.Mesh(mergeSafe(pierStoneGeos), M.stoneWall);
    mPiers.castShadow = true;
    mPiers.receiveShadow = true;
    group.add(mPiers);
  }

  scene.add(group);
  console.log(`Built 3D Pixel Bridge Guardrails & Piers: ${postGeos.length} posts, ${railGeos.length} rails/girders, ${pierStoneGeos.length} stone piers/footings.`);
  return group;
}

// ============================================================================
// 5. NEW 3D LANDMARKS (SPINNING WINDMILLS, WELLS, STALLS, WATER TOWERS, OBELISKS!)
// ============================================================================

export function createPixel3DLandmarks(scene, terrainSampler, roadCorridors, natureInstances) {
  const M = getArchMaterials();
  const rng = makeRng(771122);
  const spinningSails = [];

  // Build fast road clearance grid so zero 3D landmarks ever touch asphalt!
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

  // --- A. 16 ANIMATED 3D SPINNING WOODEN WINDMILLS (Meadow & Coast scenic hilltops!) ---
  {
    const towerBase = new THREE.CylinderGeometry(1.75, 2.75, 10.2, 8);
    towerBase.translate(0, 3.3, 0); // extends -1.8m down for rock-solid hillside grounding!
    const roofCap = new THREE.ConeGeometry(2.2, 2.4, 8);
    roofCap.translate(0, 9.5, 0);
    const hubBox = boxGeo(0.85, 0.85, 1.1, 0, 7.6, 1.9);
    const windmillBaseGeo = mergeSafe([towerBase]);
    const windmillCapGeo = mergeSafe([roofCap]);
    const windmillHubGeo = mergeSafe([hubBox]);

    // 4-blade rotating wooden sail assembly (centered at local origin)
    const bladeParts = [];
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2;
      const sail = boxGeo(1.15, 4.4, 0.12, 0.35, 2.55, 0, 1, 2);
      sail.rotateZ(a);
      bladeParts.push(sail);
    }
    const sailGeo = mergeSafe(bladeParts);

    let placed = 0;
    const wmCoords = [];
    for (let attempt = 0; attempt < 900 && placed < 16; attempt++) {
      if (!roadCorridors || !roadCorridors.length) break;
      const rc = roadCorridors[Math.floor(rng() * roadCorridors.length)];
      const ang = rng() * Math.PI * 2;
      const dist = (rc[3] || 7.5) + 18.0 + rng() * 34.0;
      const x = rc[0] + Math.cos(ang) * dist;
      const z = -rc[1] + Math.sin(ang) * dist;
      if (getMinRoadClearance(x, z) < 14.0) continue;
      if (wmCoords.some(([wx, wz]) => Math.hypot(wx - x, wz - z) < 90.0)) continue;
      const surf = terrainSampler ? terrainSampler.sample(x, z) : null;
      if (!surf || surf.y < 1.0 || surf.ny < 0.84) continue;
      const bio = getBiomeIdAt(x, surf.y, z);
      if (bio !== 0 && bio !== 1 && bio !== 5) continue; // Meadow, Autumn, Coast only!

      const g = new THREE.Group();
      const rotY = rng() * Math.PI * 2;
      g.position.set(x, surf.y - 0.15, z);
      g.rotation.y = rotY;
      const baseMesh = new THREE.Mesh(windmillBaseGeo, M.stoneWall);
      const capMesh = new THREE.Mesh(windmillCapGeo, M.terracottaRoof);
      const hubMesh = new THREE.Mesh(windmillHubGeo, M.woodPlank);
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      capMesh.castShadow = true;
      g.add(baseMesh, capMesh, hubMesh);

      const sailMesh = new THREE.Mesh(sailGeo, M.windmillSail);
      sailMesh.position.set(0, 7.6, 2.48);
      sailMesh.castShadow = true;
      g.add(sailMesh);
      scene.add(g);

      spinningSails.push({ mesh: sailMesh, speed: 0.55 + rng() * 0.45, phase: rng() * Math.PI * 2 });
      wmCoords.push([x, z]);
      placed++;
    }
  }

  // --- B. INSTANCED VILLAGE WELLS, MARKET STALLS, DESERT WATER TOWERS & VOLCANO RUNE OBELISKS! ---
  const wellPositions = [];
  const stallPositions = [];
  const waterTowerPositions = [];
  const obeliskPositions = [];

  for (let attempt = 0; attempt < 2600; attempt++) {
    if (!roadCorridors || !roadCorridors.length) break;
    const rc = roadCorridors[Math.floor(rng() * roadCorridors.length)];
    const ang = rng() * Math.PI * 2;
    const dist = (rc[3] || 7.5) + 6.5 + rng() * 24.0;
    const x = rc[0] + Math.cos(ang) * dist;
    const z = -rc[1] + Math.sin(ang) * dist;
    if (getMinRoadClearance(x, z) < 6.5) continue;
    const surf = terrainSampler ? terrainSampler.sample(x, z) : null;
    if (!surf || surf.y < 0.2 || surf.ny < 0.85) continue;

    const bio = getBiomeIdAt(x, surf.y, z);
    const rotY = rng() * Math.PI * 2;

    if (bio === 3 && obeliskPositions.length < 34) {
      if (!obeliskPositions.some((p) => Math.hypot(p.x - x, p.z - z) < 22)) {
        obeliskPositions.push({ x, y: surf.y - 0.15, z, rotY, s: 0.9 + rng() * 0.65 });
      }
    } else if (bio === 2 && waterTowerPositions.length < 22) {
      if (!waterTowerPositions.some((p) => Math.hypot(p.x - x, p.z - z) < 34)) {
        waterTowerPositions.push({ x, y: surf.y - 0.15, z, rotY, s: 0.95 + rng() * 0.25 });
      }
    } else if ((bio === 0 || bio === 1 || bio === 5) && wellPositions.length < 30 && rng() < 0.5) {
      if (!wellPositions.some((p) => Math.hypot(p.x - x, p.z - z) < 28)) {
        wellPositions.push({ x, y: surf.y - 0.10, z, rotY, s: 1.0 + rng() * 0.2 });
      }
    } else if ((bio === 0 || bio === 5) && stallPositions.length < 28) {
      if (!stallPositions.some((p) => Math.hypot(p.x - x, p.z - z) < 28)) {
        stallPositions.push({ x, y: surf.y - 0.10, z, rotY, s: 1.0 + rng() * 0.15 });
      }
    }
  }

  const spawnInstanced = (parts, list) => {
    if (!list.length) return;
    const dummy = new THREE.Object3D();
    for (const [geo, mat] of parts) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.rotY, 0);
        dummy.scale.set(it.s, it.s, it.s);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
  };

  // 1. Stone Garden Wells (with solid closed wooden gable ends + double-sided pitched roof!)
  {
    const base = new THREE.CylinderGeometry(0.95, 1.12, 1.85, 8);
    base.translate(0, 0.12, 0); // extends -0.8m below ground so hillsides never show gaps!
    const posts = mergeSafe([
      boxGeo(0.16, 1.55, 0.16, -0.82, 1.65, 0),
      boxGeo(0.16, 1.55, 0.16,  0.82, 1.65, 0),
      boxGeo(1.75, 0.12, 0.12,  0,    1.75, 0),
      gableEndsGeo(2.05, 0.78, 1.78, 2.35),
    ]);
    const roof = gableRoofGeo(2.2, 0.85, 1.9, 2.35, 1.2, 0.8);
    spawnInstanced([[mergeSafe([base]), M.stoneWall], [posts, M.woodPlank], [roof, M.terracottaRoof]], wellPositions);
  }

  // 2. Striped Village Market Stalls (properly rotated-before-translated striped canopy!)
  {
    const counter = mergeSafe([
      boxGeo(2.8, 0.95, 1.25, 0, 0.48, 0, 1.5, 0.8),
      boxGeo(0.16, 2.35, 0.16, -1.32, 1.18, -0.55),
      boxGeo(0.16, 2.35, 0.16,  1.32, 1.18, -0.55),
      boxGeo(0.16, 2.15, 0.16, -1.32, 1.08,  0.55),
      boxGeo(0.16, 2.15, 0.16,  1.32, 1.08,  0.55),
    ]);
    const awning = boxGeo(3.15, 0.16, 1.85, 0, 2.32, 0.05, 1.2, 1.0, 0.16);
    spawnInstanced([[counter, M.woodPlank], [awning, M.paddockCanopy]], stallPositions);
  }

  // 3. Stilted Desert Wooden Water Towers
  {
    const legs = [];
    for (const [lx, lz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
      legs.push(boxGeo(0.28, 5.4, 0.28, lx, 1.6, lz)); // extends -1.1m into sandy hillsides
    }
    legs.push(boxGeo(2.6, 0.26, 2.6, 0, 4.25, 0));
    const tank = new THREE.CylinderGeometry(1.45, 1.45, 2.65, 10);
    tank.translate(0, 5.65, 0);
    const cap = new THREE.ConeGeometry(1.75, 1.35, 10);
    cap.translate(0, 7.6, 0);
    spawnInstanced([[mergeSafe(legs), M.woodPlank], [mergeSafe([tank]), M.woodPlank], [mergeSafe([cap]), M.bridgeSteel]], waterTowerPositions);
  }

  // 4. Volcano Glowing Obsidian Rune Obelisks (like Cinnabar Crater screenshot!)
  {
    const pillar = new THREE.CylinderGeometry(0.75, 1.25, 8.6, 6);
    pillar.translate(0, 2.8, 0); // extends -1.5m into volcanic slopes!
    const tip = new THREE.ConeGeometry(0.76, 1.4, 6);
    tip.translate(0, 7.8, 0);
    spawnInstanced([[mergeSafe([pillar, tip]), M.volcanoRune]], obeliskPositions);
  }

  console.log(`Spawned 3D Pixel Landmarks: ${spinningSails.length} windmills, ${wellPositions.length} wells, ${stallPositions.length} market stalls, ${waterTowerPositions.length} water towers, ${obeliskPositions.length} volcano rune obelisks.`);

  return {
    update(timeSec) {
      for (let i = 0; i < spinningSails.length; i++) {
        const s = spinningSails[i];
        s.mesh.rotation.z = s.phase + timeSec * s.speed;
      }
    },
  };
}

// ============================================================================
// 6. EXPANDED 16-TILE BIOME SCATTER SPRITES (ADDED TO LIVELY WORLD!)
// ============================================================================

export function buildExpandedScatterTileCanvases() {
  // 8 brand-new crisp 32x32 biome scatter sprites (all bottom-anchored cleanly at y=30, outline at 31!):
  //   0: Golden Hay Bale (Meadow)
  //   1: Wooden Crate & Barrel Stack (Town/Meadow)
  //   2: Roadside Wooden Direction Signpost (Roads/Meadow/Autumn)
  //   3: Autumn Pumpkin Patch (Autumn)
  //   4: Desert Bleached Skull & Bones (Desert/Volcano)
  //   5: Amethyst Purple Crystal Cluster (Volcano — like user's Cinnabar screenshot!)
  //   6: Glowing Frosted Alpine Lantern Post (Snow)
  //   7: Striped Coastal Beach Umbrella & Surfboard (Coast)
  const W = 32, H = 32;
  const tiles = [];

  // 0: Golden Hay Bale
  {
    const pc = new PixelCanvas(W, H);
    pc.fillEllipse(16, 22, 10, 8, '#d9a12b');
    pc.fillEllipse(14, 20, 7, 5, '#f2cc4b');
    pc.fillRect(6, 20, 20, 9, '#c78c20');
    pc.fillRect(8, 22, 16, 2, '#996214');
    pc.fillRect(8, 26, 16, 2, '#996214');
    // Rope twine straps
    pc.fillRect(11, 15, 2, 15, '#6e3f1c');
    pc.fillRect(19, 15, 2, 15, '#6e3f1c');
    pc.applyOutline('#1a120a');
    tiles.push(pc);
  }

  // 1: Wooden Crates & Apple Barrel Stack
  {
    const pc = new PixelCanvas(W, H);
    // Left wooden crate
    pc.fillRect(4, 18, 12, 12, '#9c6334');
    pc.fillRect(5, 19, 10, 10, '#bd7e48');
    pc.fillRect(4, 23, 12, 2, '#6e411f');
    pc.fillRect(9, 18, 2, 12, '#6e411f');
    // Right rounded barrel with iron hoops
    pc.fillEllipse(22, 24, 6, 6.5, '#784622');
    pc.fillRect(17, 20, 10, 2, '#3a424d');
    pc.fillRect(17, 26, 10, 2, '#3a424d');
    // Bright red apples spilling on top of barrel!
    pc.fillRect(19, 16, 3, 3, '#e82525');
    pc.fillRect(23, 17, 3, 3, '#ff4538');
    pc.set(20, 16, '#ff9980');
    pc.applyOutline('#140d0a');
    tiles.push(pc);
  }

  // 2: Roadside Wooden Direction Signpost
  {
    const pc = new PixelCanvas(W, H);
    pc.fillRect(14, 6, 4, 24, '#7a4924');
    pc.fillRect(15, 6, 1, 24, '#a66b3c');
    // Top wooden arrow pointing right
    pc.fillRect(7, 9, 19, 5, '#c98e55');
    pc.fillRect(26, 10, 2, 3, '#c98e55');
    pc.fillRect(28, 11, 1, 1, '#c98e55');
    pc.fillRect(9, 11, 13, 1, '#4a2912');
    // Lower wooden arrow pointing left
    pc.fillRect(6, 16, 19, 5, '#b07440');
    pc.fillRect(4, 17, 2, 3, '#b07440');
    pc.fillRect(9, 18, 12, 1, '#4a2912');
    pc.applyOutline('#140d0a');
    tiles.push(pc);
  }

  // 3: Autumn Pumpkin Patch
  {
    const pc = new PixelCanvas(W, H);
    // Big plump pumpkin
    pc.fillEllipse(13, 24, 7.5, 6.2, '#e66a17');
    pc.fillEllipse(12, 23, 4.5, 5.2, '#ff8e24');
    pc.fillRect(12, 16, 3, 3, '#387d22');
    // Companion smaller pumpkin
    pc.fillEllipse(23, 26, 5.2, 4.5, '#d45214');
    pc.fillEllipse(22, 25, 3, 3.5, '#f27c1d');
    pc.fillRect(22, 20, 2, 2, '#387d22');
    // Vines
    pc.fillRect(5, 29, 22, 2, '#2d6e1e');
    pc.applyOutline('#1a0e08');
    tiles.push(pc);
  }

  // 4: Iconic Horned Desert Bull Skull (bold sweeping horns, clear sockets & snout!)
  {
    const pc = new PixelCanvas(W, H);
    // Curved sweeping pale-ivory horns
    pc.drawThickCurve(12, 16, 5, 14, 4, 8, 2.0, 0.9, '#e0d6c0', 12);
    pc.drawThickCurve(20, 16, 27, 14, 28, 8, 2.0, 0.9, '#e0d6c0', 12);
    // Broad cranium + tapered snout
    pc.fillEllipse(16, 18, 6.2, 4.8, '#f5efe0');
    pc.fillEllipse(16, 24, 3.8, 5.2, '#ebe2cc');
    pc.fillRect(14, 28, 4, 2, '#d4c9b0');
    // Crisp dark eye sockets & nasal cavity
    pc.fillRect(12, 18, 3, 3, '#1f1916');
    pc.fillRect(17, 18, 3, 3, '#1f1916');
    pc.fillRect(15, 24, 2, 3, '#2b221e');
    pc.applyOutline('#1a1512');
    tiles.push(pc);
  }

  // 5: Amethyst Purple Crystal Cluster (Volcano — matching Cinnabar Crater screenshot!)
  {
    const pc = new PixelCanvas(W, H);
    pc.fillEllipse(16, 27, 10, 4, '#322b3d');
    pc.drawThickCurve(12, 26, 8, 20, 5, 14, 2.8, 0.9, (t) => (t > 0.6 ? '#eab8ff' : (t > 0.25 ? '#a84dff' : '#631fa8')), 14);
    pc.drawThickCurve(20, 26, 24, 20, 27, 15, 2.8, 0.9, (t) => (t > 0.6 ? '#d99eff' : (t > 0.25 ? '#9438f0' : '#53188c')), 14);
    pc.drawThickCurve(16, 26, 16, 17, 15, 6, 3.6, 0.9, (t, x) => (x < 15.5 ? '#ffffff' : (t > 0.5 ? '#d48cff' : '#7c2bd9')), 18);
    pc.applyOutline('#120c1a');
    tiles.push(pc);
  }

  // 6: Glowing Frosted Alpine Timber Lantern Post (Snow!)
  {
    const pc = new PixelCanvas(W, H);
    pc.fillRect(14, 10, 4, 20, '#5c381f');
    pc.fillRect(12, 10, 12, 3, '#5c381f');
    pc.fillRect(12, 9, 12, 2, '#edf7ff'); // snow cap on crossbeam!
    // Hanging warm glowing lantern
    pc.fillRect(20, 13, 2, 2, '#2a303b');
    pc.fillRect(18, 15, 6, 7, '#2a303b');
    pc.fillRect(19, 16, 4, 5, '#ffea70');
    pc.fillRect(20, 17, 2, 3, '#ffffff');
    pc.applyOutline('#101724');
    tiles.push(pc);
  }

  // 7: Striped Coastal Beach Umbrella & Surfboard (Coast!)
  {
    const pc = new PixelCanvas(W, H);
    // Pole
    pc.fillRect(13, 12, 2, 18, '#c7b89c');
    // Vibrant red & white striped umbrella canopy
    for (let y = 6; y <= 14; y++) {
      const t = (y - 6) / 8;
      const hw = Math.round(2 + t * 10);
      for (let x = 14 - hw; x <= 14 + hw; x++) {
        const stripe = Math.floor((x - 4) / 4) % 2 === 0;
        pc.set(x, y, stripe ? '#ff3844' : '#ffffff');
      }
    }
    // Bright turquoise surfboard stuck in sand beside umbrella!
    pc.fillEllipse(25, 22, 3.2, 8.5, '#29c4d9');
    pc.fillRect(24, 15, 2, 14, '#ffe040');
    pc.applyOutline('#101824');
    tiles.push(pc);
  }

  return tiles;
}

export function createExpandedScatterWorld(scene, terrainSampler, roadCorridors) {
  const rng = makeRng(993311);
  const tiles = buildExpandedScatterTileCanvases();
  const W = 32, H = 32;
  const canvas = document.createElement('canvas');
  canvas.width = W * tiles.length;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  tiles.forEach((pc, idx) => ctx.putImageData(new ImageData(pc.data, W, H), idx * W, 0));

  const atlasTex = new THREE.CanvasTexture(canvas);
  atlasTex.magFilter = THREE.NearestFilter;
  atlasTex.minFilter = THREE.NearestFilter;
  atlasTex.generateMipmaps = false;
  atlasTex.colorSpace = THREE.SRGBColorSpace;

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

  const items = [];
  const target = 680;
  for (let attempt = 0; attempt < 6500 && items.length < target; attempt++) {
    let x, z;
    if (roadCorridors && roadCorridors.length > 0 && attempt < 5000) {
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
    if (!surf || surf.y < -1.0 || surf.ny < 0.80) continue;

    const bio = getBiomeIdAt(x, surf.y, z);
    const r = rng();
    let tileIdx = 0;
    let scale = 1.65 + rng() * 0.55;

    if (bio === 0) {
      // Meadow: hay bales, apple barrels/crates, wooden signposts!
      if (r < 0.42) { tileIdx = 0; scale = 1.7 + rng() * 0.45; }
      else if (r < 0.78) { tileIdx = 1; scale = 1.65 + rng() * 0.4; }
      else { tileIdx = 2; scale = 2.1 + rng() * 0.35; }
    } else if (bio === 1) {
      // Autumn: pumpkin patches, barrels/crates, wooden signposts!
      if (r < 0.55) { tileIdx = 3; scale = 1.65 + rng() * 0.5; }
      else if (r < 0.82) { tileIdx = 1; scale = 1.65; }
      else { tileIdx = 2; scale = 2.1; }
    } else if (bio === 2) {
      // Desert: bleached bones/skulls, wooden crates, signposts!
      if (r < 0.58) { tileIdx = 4; scale = 1.7 + rng() * 0.5; }
      else if (r < 0.84) { tileIdx = 1; scale = 1.55; }
      else { tileIdx = 2; scale = 2.0; }
    } else if (bio === 3) {
      // Volcano: glowing amethyst crystals & bleached crater bones!
      if (r < 0.62) { tileIdx = 5; scale = 1.9 + rng() * 0.9; }
      else { tileIdx = 4; scale = 1.75 + rng() * 0.45; }
    } else if (bio === 4) {
      // Snow: glowing alpine lantern posts & frosted signposts!
      if (r < 0.72) { tileIdx = 6; scale = 2.35 + rng() * 0.45; }
      else { tileIdx = 2; scale = 2.1; }
    } else {
      // Coast: spawn beach umbrellas & surfboards STRICTLY on sandy beaches (y < 2.1m)!
      // Above y >= 2.1m (green coastal hillsides), spawn crates/barrels or wooden signposts!
      if (surf.y < 2.1 && r < 0.78) { tileIdx = 7; scale = 2.4 + rng() * 0.55; }
      else if (r < 0.55) { tileIdx = 1; scale = 1.65; }
      else { tileIdx = 2; scale = 2.1; }
    }

    const slopeSin = Math.sqrt(Math.max(0.0, 1.0 - surf.ny * surf.ny));
    items.push({
      x, y: surf.y - (0.02 + slopeSin * 0.10 * scale), z,
      scale, tileIdx, nx: surf.nx, ny: surf.ny, nz: surf.nz,
    });
  }

  if (!items.length) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, 0.0, 0.0,
     0.5, 0.0, 0.0,
     0.5, 1.0, 0.0,
    -0.5, 1.0, 0.0,
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  const count = items.length;
  const tileAttr = new Float32Array(count);
  const normAttr = new Float32Array(count * 3);
  const dummy = new THREE.Object3D();

  const mat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsLib.fog, uMap: { value: atlasTex } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      attribute float aTileIdx;
      attribute vec3 aSurfNorm;
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
        // Lanterns/signposts/umbrellas stay mostly upright; hay/bones/pumpkins hug terrain gently!
        float tiltAmt = (aTileIdx > 1.5 && aTileIdx < 2.5 || aTileIdx > 5.5) ? 0.12 : 0.38;
        vec3 upDir = normalize(mix(vec3(0.0, 1.0, 0.0), tNorm, tiltAmt));
        vec3 rightDir = normalize(flatRight - upDir * dot(flatRight, upDir));

        vec3 worldPos = instPos + rightDir * (position.x * instScale) + upDir * (position.y * instScale);
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
        // Subtle glow lift on amethyst crystals (5) & alpine lanterns (6)
        float isGlow = (abs(vTile - 5.0) < 0.2 || abs(vTile - 6.0) < 0.2) ? 1.0 : 0.0;
        vec3 col = t.rgb * mix(1.0, 1.24, isGlow * step(0.45, max(t.r, t.b)));
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
    const it = items[i];
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(it.scale, it.scale, it.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    tileAttr[i] = it.tileIdx;
    normAttr[i * 3 + 0] = it.nx;
    normAttr[i * 3 + 1] = it.ny;
    normAttr[i * 3 + 2] = it.nz;
  }
  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute('aTileIdx', new THREE.InstancedBufferAttribute(tileAttr, 1));
  geo.setAttribute('aSurfNorm', new THREE.InstancedBufferAttribute(normAttr, 3));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/**
 * Renders a crisp 2048x1920 PokeBonk Pixel Overworld Map directly from the live
 * Three.js pixel-shaded terrain, pixel water, 3D buildings, roads, and bridges,
 * then stamps biome-colored pixel-art tree canopies & pixel ocean glints so the
 * World Map (`M`) and Pause Map Preview match the new pixel theme 1-to-1!
 */
export function bakePixelWorldMap(renderer, scene, sun, obstacles = [], hideObjects = []) {
  const RW = 1024;
  const RH = 960;
  const OUT_W = 2048;
  const OUT_H = 1920;
  const minX = -2120.0, maxX = 2120.0, spanX = 4240.0;
  const minZ = -1987.5, maxZ = 1987.5, spanZ = 3975.0;

  const orthoCam = new THREE.OrthographicCamera(minX, maxX, -minZ, -maxZ, 1.0, 1600.0);
  orthoCam.position.set(0, 750, 0);
  orthoCam.up.set(0, 0, -1);
  orthoCam.lookAt(0, 0, 0);
  orthoCam.updateMatrixWorld(true);

  // Save scene state
  const prevFog = scene.fog;
  const prevBg = scene.background;
  const prevTarget = renderer.getRenderTarget();
  const prevClearColor = new THREE.Color();
  renderer.getClearColor(prevClearColor);
  const prevClearAlpha = renderer.getClearAlpha();
  const prevSunCast = sun ? sun.castShadow : false;

  // Hide sky, clouds, vertical billboard sprites, particles, and vehicles during top-down capture
  const hiddenStates = [];
  const markHidden = (obj) => {
    if (!obj) return;
    hiddenStates.push([obj, obj.visible]);
    obj.visible = false;
  };
  for (const obj of hideObjects) markHidden(obj);
  const tmpWorldPos = new THREE.Vector3();
  scene.traverse((child) => {
    if (!child.visible) return;
    if (child.isPoints) { markHidden(child); return; }
    // Hide high-altitude clouds (y > 110m)
    child.getWorldPosition(tmpWorldPos);
    if (tmpWorldPos.y > 110.0) { markHidden(child); return; }
    // Hide billboard sprite InstancedMeshes (trees/grass/scatter)
    if (child.isInstancedMesh && child.material && child.material.isShaderMaterial) {
      markHidden(child);
      return;
    }
    if (child.isMesh && child.geometry && child.geometry.type === 'SphereGeometry') {
      markHidden(child);
      return;
    }
  });

  scene.fog = null;
  scene.background = null;
  if (sun) sun.castShadow = false;

  const rt = new THREE.WebGLRenderTarget(RW, RH, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: true,
    stencilBuffer: false,
  });

  renderer.setRenderTarget(rt);
  // Use linear-space clear color so after sRGB gamma encoding it becomes crisp ocean blue (#2a7cc0)
  renderer.setClearColor(0x062958, 1.0);
  renderer.clear(true, true, true);
  renderer.render(scene, orthoCam);

  const raw = new Uint8Array(RW * RH * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, RW, RH, raw);

  // Restore scene & renderer state immediately
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClearColor, prevClearAlpha);
  scene.fog = prevFog;
  scene.background = prevBg;
  if (sun) sun.castShadow = prevSunCast;
  for (const [obj, vis] of hiddenStates) obj.visible = vis;
  rt.dispose();

  // Precompute Linear -> sRGB gamma LUT (fixes dark WebGLRenderTarget raw linear readout!)
  const srgbLut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const lin = i / 255.0;
    const srgb = lin <= 0.0031308 ? lin * 12.92 : (1.055 * Math.pow(lin, 1.0 / 2.2) - 0.055);
    srgbLut[i] = Math.max(0, Math.min(255, Math.round(srgb * 255.0)));
  }

  // Copy flipped WebGL buffer to 1024x960 canvas with proper sRGB encoding + clean horizontal pixel ocean ripples
  const lowCanvas = document.createElement('canvas');
  lowCanvas.width = RW;
  lowCanvas.height = RH;
  const lctx = lowCanvas.getContext('2d');
  const imgData = lctx.createImageData(RW, RH);
  const dst = imgData.data;

  for (let y = 0; y < RH; y++) {
    const srcY = RH - 1 - y;
    for (let x = 0; x < RW; x++) {
      const si = (srcY * RW + x) * 4;
      const di = (y * RW + x) * 4;
      const lr = raw[si], lg = raw[si + 1], lb = raw[si + 2];
      // Detect clear deep-ocean background (linear 6, 41, 88)
      if (Math.abs(lr - 6) < 8 && Math.abs(lg - 41) < 10 && Math.abs(lb - 88) < 12) {
        let r = 42, g = 122, b = 188;
        // Subtle horizontal PokeBonk pixel water wave dashes (zero vertical striping!)
        const cellX = Math.floor(x / 6);
        const cellY = Math.floor(y / 6);
        const h = Math.sin(cellX * 127.1 + cellY * 311.7) * 43758.5453;
        const frac = h - Math.floor(h);
        if ((y % 6) === 2 && (x % 6) >= 1 && (x % 6) <= 3 && frac > 0.78) {
          r = 72; g = 152; b = 212;
        } else if ((y % 6) === 5 && (x % 6) >= 2 && (x % 6) <= 4 && frac < 0.22) {
          r = 32; g = 104; b = 166;
        }
        dst[di] = r;
        dst[di + 1] = g;
        dst[di + 2] = b;
        dst[di + 3] = 255;
      } else {
        dst[di] = srgbLut[lr];
        dst[di + 1] = srgbLut[lg];
        dst[di + 2] = srgbLut[lb];
        dst[di + 3] = 255;
      }
    }
  }
  lctx.putImageData(imgData, 0, 0);

  // Stamp crisp pixel-art biome tree canopies at every tree position from nature_obstacles.json
  const treePalettes = {
    0: ['#1a4a24', '#2e8b38', '#56bd48'], // Emerald Meadow
    1: ['#5e2414', '#d46824', '#f2a936'], // Golden Autumn Forest
    2: ['#2b3d1e', '#587c3a', '#7da34f'], // Desert Scrub / Cactus
    3: ['#1d181c', '#3a3034', '#d9581e'], // Volcanic Charred / Ember
    4: ['#1a3c34', '#2e6a54', '#cbe4ee'], // Alpine Snow-Dusted Pine
    5: ['#1d4f22', '#3a9938', '#68c74a'], // Coastal Tropical Palm
  };

  if (obstacles && obstacles.length) {
    for (let i = 0; i < obstacles.length; i++) {
      const obs = obstacles[i];
      if (obs.type !== 'tree') continue;
      const wx = obs.x;
      const wz = -obs.y;
      const px = Math.round(((wx - minX) / spanX) * RW);
      const py = Math.round(((wz - minZ) / spanZ) * RH);
      if (px < 2 || px >= RW - 2 || py < 2 || py >= RH - 2) continue;

      const bio = getBiomeIdAt(wx, obs.z || 6.0, wz);
      const pal = treePalettes[bio] || treePalettes[0];
      // Slight autumn variety (red/gold/orange)
      let mid = pal[1], hi = pal[2];
      if (bio === 1) {
        const v = i % 3;
        if (v === 1) { mid = '#bf3b22'; hi = '#e66e2c'; }
        else if (v === 2) { mid = '#c98820'; hi = '#f2cc48'; }
      }
      // 1px dark drop shadow + 2x2 canopy + 1px top-left sunlit pixel
      lctx.fillStyle = pal[0];
      lctx.fillRect(px, py + 1, 2, 2);
      lctx.fillStyle = mid;
      lctx.fillRect(px - 1, py - 1, 2, 2);
      lctx.fillStyle = hi;
      lctx.fillRect(px - 1, py - 1, 1, 1);
    }
  }

  // Nearest-neighbor 2x upscale to exact 2048x1920 WorldMapController dimensions
  const outCanvas = document.createElement('canvas');
  outCanvas.width = OUT_W;
  outCanvas.height = OUT_H;
  const octx = outCanvas.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(lowCanvas, 0, 0, OUT_W, OUT_H);

  // Trigger download so we can save directly into public/assets/satellite_world_map.png
  const dataUrl = outCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'satellite_world_map.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { width: OUT_W, height: OUT_H, bytes: dataUrl.length };
}

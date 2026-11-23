/**
 * Interactive Race Circuit Builder (Lives inside the World Map)
 * ==============================================================
 * Allows designing custom Circuit (Loop) and Sprint (Point-to-Point) races
 * directly on the existing road network using A* road pathfinding, previewing
 * auto-generated checkpoints & driving direction, test-driving from the start
 * line, saving multiple tracks locally, and exporting clean `races.json` data.
 */

const STORAGE_KEY = 'acg_custom_circuits_v1';
const CHECKPOINT_SPACING_M = 155.0;
const METERS_TO_MILES = 0.000621371;

export class RaceCircuitBuilder {
  constructor(worldMap) {
    this.worldMap = worldMap;
    this.isActive = false;

    // Current draft track state
    this.editingId = null;
    this.trackName = '';
    this.trackType = 'circuit'; // 'circuit' | 'sprint'
    this.raceMode = 'both';     // 'both' | 'time_trial' | 'ai_race'
    this.laps = 3;
    this.anchors = [];          // [{ x, y, z, routeId, routeName }]
    this.tracedPath = [];       // Full A* centerline [{ x, y, z }]
    this.checkpoints = [];      // Auto-generated gates [{ x, y, z, fwdX, fwdZ, width }]
    this.totalDistanceM = 0;

    // Saved circuits library
    this.savedTracks = this._loadSavedTracks();

    // DOM elements
    this.toggleBtnEl = document.getElementById('map-race-builder-btn');
    this.panelEl = document.getElementById('race-builder-panel');
    this.svgGroupEl = document.getElementById('map-race-builder-group');

    this.nameInputEl = document.getElementById('rb-track-name');
    this.typeBtns = Array.from(document.querySelectorAll('.rb-type-btn'));
    this.lapsRowEl = document.getElementById('rb-laps-row');
    this.lapBtns = Array.from(document.querySelectorAll('.rb-lap-btn'));
    this.modeBtns = Array.from(document.querySelectorAll('.rb-mode-btn'));

    this.statDistEl = document.getElementById('rb-stat-dist');
    this.statAnchorsEl = document.getElementById('rb-stat-anchors');
    this.statCheckpointsEl = document.getElementById('rb-stat-checkpoints');
    this.hintEl = document.getElementById('rb-hint-text');

    this.undoBtnEl = document.getElementById('rb-undo-btn');
    this.reverseBtnEl = document.getElementById('rb-reverse-btn');
    this.clearBtnEl = document.getElementById('rb-clear-btn');
    this.testDriveBtnEl = document.getElementById('rb-test-drive-btn');
    this.saveBtnEl = document.getElementById('rb-save-btn');
    this.copyJsonBtnEl = document.getElementById('rb-copy-json-btn');
    this.downloadJsonBtnEl = document.getElementById('rb-download-json-btn');
    this.savedListEl = document.getElementById('rb-saved-list');
    this.savedCountEl = document.getElementById('rb-saved-count');
    this.statusToastEl = document.getElementById('rb-status-toast');

    this._toastTimer = null;
    this._bindEvents();
    this._syncUI();
    this._renderSavedList();
  }

  _loadSavedTracks() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  _persistSavedTracks() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedTracks));
    } catch (_) {}
  }

  _showStatus(msg) {
    if (!this.statusToastEl) return;
    this.statusToastEl.textContent = msg;
    this.statusToastEl.classList.add('visible');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      if (this.statusToastEl) this.statusToastEl.classList.remove('visible');
    }, 2400);
  }

  setActive(active) {
    const next = Boolean(active);
    if (this.isActive === next) return;
    this.isActive = next;
    if (this.toggleBtnEl) {
      this.toggleBtnEl.classList.toggle('active', next);
    }
    if (this.panelEl) {
      this.panelEl.classList.toggle('hidden', !next);
    }
    if (!next) {
      this._clearSvg();
    } else {
      this._recomputeRoute();
    }
  }

  _bindEvents() {
    if (this.toggleBtnEl) {
      this.toggleBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setActive(!this.isActive);
      });
    }

    if (this.panelEl) {
      // Prevent map dragging/zooming when interacting with builder controls
      this.panelEl.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.panelEl.addEventListener('pointerup', (e) => e.stopPropagation());
      this.panelEl.addEventListener('wheel', (e) => e.stopPropagation());
      this.panelEl.addEventListener('click', (e) => e.stopPropagation());
    }

    if (this.nameInputEl) {
      this.nameInputEl.addEventListener('input', () => {
        this.trackName = this.nameInputEl.value;
      });
      // Prevent typing in the track name box from triggering map hotkeys (M, R, etc.)
      this.nameInputEl.addEventListener('keydown', (e) => e.stopPropagation());
    }

    this.typeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.rbType;
        if (t === 'circuit' || t === 'sprint') {
          this.trackType = t;
          this._recomputeRoute();
          this._syncUI();
        }
      });
    });

    this.lapBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.rbLaps, 10);
        if (!Number.isNaN(val) && val >= 1) {
          this.laps = val;
          this._syncUI();
        }
      });
    });

    this.modeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.rbMode;
        if (m === 'both' || m === 'time_trial' || m === 'ai_race') {
          this.raceMode = m;
          this._syncUI();
        }
      });
    });

    if (this.undoBtnEl) {
      this.undoBtnEl.addEventListener('click', () => {
        if (this.anchors.length > 0) {
          this.anchors.pop();
          this._recomputeRoute();
          this._syncUI();
        }
      });
    }

    if (this.reverseBtnEl) {
      this.reverseBtnEl.addEventListener('click', () => {
        if (this.anchors.length >= 2) {
          if (this.trackType === 'circuit') {
            // Keep START at index 0, reverse remaining anchors so loop runs opposite way
            const [first, ...rest] = this.anchors;
            this.anchors = [first, ...rest.reverse()];
          } else {
            this.anchors.reverse();
          }
          this._recomputeRoute();
          this._syncUI();
          this._showStatus('Reversed race direction');
        }
      });
    }

    if (this.clearBtnEl) {
      this.clearBtnEl.addEventListener('click', () => {
        this.editingId = null;
        this.trackName = '';
        if (this.nameInputEl) this.nameInputEl.value = '';
        this.anchors = [];
        this._recomputeRoute();
        this._syncUI();
      });
    }

    if (this.testDriveBtnEl) {
      this.testDriveBtnEl.addEventListener('click', () => this._testDriveStart());
    }

    if (this.saveBtnEl) {
      this.saveBtnEl.addEventListener('click', () => this._saveCurrentTrack());
    }

    if (this.copyJsonBtnEl) {
      this.copyJsonBtnEl.addEventListener('click', () => this._copyExportJson());
    }

    if (this.downloadJsonBtnEl) {
      this.downloadJsonBtnEl.addEventListener('click', () => this._downloadExportJson());
    }
  }

  /**
   * Called by WorldMapController when the user clicks a snapped road point while builder is active.
   */
  handleRoadClick(roadMatch) {
    if (!this.isActive || !roadMatch || !roadMatch.point) return;
    const pt = roadMatch.point;
    const routeId = roadMatch.route ? roadMatch.route.id : 'road';
    const routeName = this.worldMap.getRouteDisplayName(routeId);

    // Avoid accidental double-click on virtually the same spot (< 10m from last anchor)
    if (this.anchors.length > 0) {
      const prev = this.anchors[this.anchors.length - 1];
      if (Math.hypot(pt.x - prev.x, pt.z - prev.z) < 10.0) {
        this._showStatus('Click further along a road to add the next point');
        return;
      }
    }

    this.anchors.push({
      x: Number(pt.x.toFixed(2)),
      y: Number((pt.y ?? 0).toFixed(2)),
      z: Number(pt.z.toFixed(2)),
      routeId,
      routeName,
    });

    this._recomputeRoute();
    this._syncUI();
  }

  getHoverLabel() {
    if (this.anchors.length === 0) return 'PLACE START';
    return `ADD POINT #${this.anchors.length + 1}`;
  }

  _recomputeRoute() {
    this.tracedPath = [];
    this.checkpoints = [];
    this.totalDistanceM = 0;

    const gpsNav = this.worldMap.gpsNav;
    if (!gpsNav || !gpsNav.isGraphReady || this.anchors.length === 0) {
      this._renderSvg();
      return;
    }

    if (this.anchors.length === 1) {
      this.tracedPath = [{ x: this.anchors[0].x, y: this.anchors[0].y, z: this.anchors[0].z }];
      this._renderSvg();
      return;
    }

    const pairs = [];
    for (let i = 0; i < this.anchors.length - 1; i++) {
      pairs.push([this.anchors[i], this.anchors[i + 1]]);
    }
    // Automatically close the loop in Circuit mode once we have at least 3 anchors
    if (this.trackType === 'circuit' && this.anchors.length >= 3) {
      pairs.push([this.anchors[this.anchors.length - 1], this.anchors[0]]);
    }

    const combined = [];
    for (const [a, b] of pairs) {
      const seg = gpsNav.calculateAStarPath(a, b, false);
      if (!seg || seg.length === 0) {
        // Fallback straight segment if road branch was disconnected
        if (combined.length === 0) combined.push({ x: a.x, y: a.y, z: a.z });
        combined.push({ x: b.x, y: b.y, z: b.z });
      } else {
        for (let k = 0; k < seg.length; k++) {
          const n = seg[k];
          if (combined.length > 0) {
            const last = combined[combined.length - 1];
            if (Math.hypot(n.x - last.x, n.z - last.z) < 0.25) continue;
          }
          combined.push({
            x: Number(n.x.toFixed(2)),
            y: Number((n.y ?? 0).toFixed(2)),
            z: Number(n.z.toFixed(2)),
          });
        }
      }
    }

    this.tracedPath = combined;
    if (combined.length < 2) {
      this._renderSvg();
      return;
    }

    // Compute arc length + auto-generate evenly spaced checkpoints with exact forward headings
    let totalDist = 0;
    const cumDist = [0];
    for (let i = 1; i < combined.length; i++) {
      const d = Math.hypot(
        combined[i].x - combined[i - 1].x,
        combined[i].z - combined[i - 1].z
      );
      totalDist += d;
      cumDist.push(totalDist);
    }
    this.totalDistanceM = totalDist;

    const sampleAtDist = (targetD) => {
      const dClamped = Math.max(0, Math.min(totalDist, targetD));
      let idx = 0;
      while (idx < cumDist.length - 2 && cumDist[idx + 1] < dClamped) idx++;
      const d0 = cumDist[idx];
      const d1 = cumDist[idx + 1];
      const span = Math.max(1e-4, d1 - d0);
      const t = (dClamped - d0) / span;
      const p0 = combined[idx];
      const p1 = combined[idx + 1];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz) || 1;
      return {
        x: Number((p0.x + dx * t).toFixed(2)),
        y: Number((p0.y + (p1.y - p0.y) * t).toFixed(2)),
        z: Number((p0.z + dz * t).toFixed(2)),
        fwdX: Number((dx / len).toFixed(4)),
        fwdZ: Number((dz / len).toFixed(4)),
        width: 14.0,
      };
    };

    const numChecks = Math.max(2, Math.round(totalDist / CHECKPOINT_SPACING_M));
    const step = totalDist / numChecks;
    const isClosedLoop = this.trackType === 'circuit' && this.anchors.length >= 3;
    const count = isClosedLoop ? numChecks : numChecks + 1;
    for (let i = 0; i < count; i++) {
      this.checkpoints.push(sampleAtDist(i * step));
    }

    this._renderSvg();
  }

  _clearSvg() {
    if (this.svgGroupEl) {
      this.svgGroupEl.innerHTML = '';
    }
  }

  _renderSvg() {
    if (!this.svgGroupEl) return;
    this.svgGroupEl.innerHTML = '';
    if (!this.isActive || this.anchors.length === 0) return;

    const svgNS = 'http://www.w3.org/2000/svg';

    // 1. Traced Race Route Line (Bold dark casing + crisp racing gold/crimson ribbon)
    if (this.tracedPath.length >= 2) {
      const ptsStr = this.tracedPath
        .map((p) => {
          const mp = this.worldMap.worldToMapPx(p.x, p.z);
          return `${mp.x.toFixed(1)},${mp.y.toFixed(1)}`;
        })
        .join(' ');

      const casing = document.createElementNS(svgNS, 'polyline');
      casing.setAttribute('points', ptsStr);
      casing.setAttribute('fill', 'none');
      casing.setAttribute('stroke', 'rgba(10, 14, 20, 0.90)');
      casing.setAttribute('stroke-width', '12');
      casing.setAttribute('stroke-linecap', 'round');
      casing.setAttribute('stroke-linejoin', 'round');
      this.svgGroupEl.appendChild(casing);

      const core = document.createElementNS(svgNS, 'polyline');
      core.setAttribute('points', ptsStr);
      core.setAttribute('fill', 'none');
      core.setAttribute('stroke', this.trackType === 'circuit' ? '#e5a93c' : '#e05248');
      core.setAttribute('stroke-width', '6.5');
      core.setAttribute('stroke-linecap', 'round');
      core.setAttribute('stroke-linejoin', 'round');
      this.svgGroupEl.appendChild(core);

      // 2. Auto-Generated Checkpoint Dots + Direction Chevrons along the route
      for (let i = 0; i < this.checkpoints.length; i++) {
        const cp = this.checkpoints[i];
        const mp = this.worldMap.worldToMapPx(cp.x, cp.z);

        // Direction arrow on every checkpoint
        const angleDeg = (Math.atan2(cp.fwdZ, cp.fwdX) * 180) / Math.PI;
        const arrow = document.createElementNS(svgNS, 'polygon');
        arrow.setAttribute('points', '7,0 -4,-4.5 -2,0 -4,4.5');
        arrow.setAttribute('fill', '#ffffff');
        arrow.setAttribute('stroke', '#0e131b');
        arrow.setAttribute('stroke-width', '1.4');
        arrow.setAttribute('transform', `translate(${mp.x.toFixed(1)},${mp.y.toFixed(1)}) rotate(${angleDeg.toFixed(1)})`);
        this.svgGroupEl.appendChild(arrow);
      }
    }

    // 3. Numbered User Anchor Pins (START = emerald, FINISH = crimson, intermediate = gold)
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      const mp = this.worldMap.worldToMapPx(a.x, a.z);
      const isStart = i === 0;
      const isFinish = this.trackType === 'sprint' && i === this.anchors.length - 1 && i > 0;

      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('transform', `translate(${mp.x.toFixed(1)},${mp.y.toFixed(1)})`);

      const circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('r', isStart || isFinish ? '12' : '9.5');
      circle.setAttribute('fill', isStart ? '#22c55e' : (isFinish ? '#ef4444' : '#e5a93c'));
      circle.setAttribute('stroke', '#0d1118');
      circle.setAttribute('stroke-width', '2.8');
      g.appendChild(circle);

      const txt = document.createElementNS(svgNS, 'text');
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('dominant-baseline', 'central');
      txt.setAttribute('fill', '#0b0f16');
      txt.setAttribute('font-size', isStart || isFinish ? '10' : '9.5');
      txt.setAttribute('font-weight', '900');
      txt.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      txt.textContent = isStart ? 'S' : (isFinish ? 'F' : String(i + 1));
      g.appendChild(txt);

      this.svgGroupEl.appendChild(g);
    }
  }

  _isCurrentTrackValid() {
    const minAnchors = this.trackType === 'circuit' ? 3 : 2;
    return this.anchors.length >= minAnchors && this.tracedPath.length >= 2;
  }

  _buildTrackPayload() {
    const rawName = (this.trackName || '').trim();
    const fallbackName = `Custom ${this.trackType === 'circuit' ? 'Circuit' : 'Sprint'} #${this.savedTracks.length + 1}`;
    const name = rawName || fallbackName;
    const id = this.editingId || (
      name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `race_${Date.now()}`
    );

    // Downsample centerline slightly (~every 10m) to keep exported JSON clean and compact
    const compactPath = [];
    let acc = 0;
    for (let i = 0; i < this.tracedPath.length; i++) {
      const p = this.tracedPath[i];
      if (i === 0 || i === this.tracedPath.length - 1) {
        compactPath.push([p.x, p.y, p.z]);
        acc = 0;
      } else {
        const prev = this.tracedPath[i - 1];
        acc += Math.hypot(p.x - prev.x, p.z - prev.z);
        if (acc >= 10.0) {
          compactPath.push([p.x, p.y, p.z]);
          acc = 0;
        }
      }
    }

    return {
      id,
      name,
      type: this.trackType,
      mode: this.raceMode,
      laps: this.trackType === 'circuit' ? this.laps : 1,
      distanceMeters: Math.round(this.totalDistanceM),
      distanceMiles: Number((this.totalDistanceM * METERS_TO_MILES).toFixed(2)),
      anchors: this.anchors.map((a) => ({ x: a.x, y: a.y, z: a.z, routeId: a.routeId })),
      checkpoints: this.checkpoints,
      path: compactPath,
    };
  }

  _saveCurrentTrack() {
    if (!this._isCurrentTrackValid()) {
      this._showStatus(this.trackType === 'circuit'
        ? 'Place at least 3 road points to complete a Circuit'
        : 'Place at least 2 road points to complete a Sprint');
      return;
    }

    const track = this._buildTrackPayload();
    const existingIdx = this.savedTracks.findIndex((t) => t.id === track.id);
    if (existingIdx >= 0) {
      this.savedTracks[existingIdx] = track;
      this._showStatus(`Updated "${track.name}"`);
    } else {
      this.savedTracks.push(track);
      this._showStatus(`Saved "${track.name}"`);
    }
    this.editingId = track.id;
    this.trackName = track.name;
    if (this.nameInputEl) this.nameInputEl.value = track.name;

    this._persistSavedTracks();
    this._renderSavedList();
    this._syncUI();
  }

  _loadTrackIntoEditor(track) {
    if (!track) return;
    this.editingId = track.id;
    this.trackName = track.name || '';
    this.trackType = track.type === 'sprint' ? 'sprint' : 'circuit';
    this.raceMode = track.mode || 'both';
    this.laps = track.laps || 3;
    this.anchors = (track.anchors || []).map((a) => ({
      x: a.x,
      y: a.y ?? 0,
      z: a.z,
      routeId: a.routeId || 'road',
      routeName: this.worldMap.getRouteDisplayName(a.routeId || 'road'),
    }));
    if (this.nameInputEl) this.nameInputEl.value = this.trackName;
    this._recomputeRoute();
    this._syncUI();
    if (this.anchors.length > 0) {
      this.worldMap.centerOnWorld(this.anchors[0].x, this.anchors[0].z, 0.95);
    }
    this._showStatus(`Loaded "${track.name}"`);
  }

  _deleteSavedTrack(id) {
    this.savedTracks = this.savedTracks.filter((t) => t.id !== id);
    if (this.editingId === id) this.editingId = null;
    this._persistSavedTracks();
    this._renderSavedList();
    this._syncUI();
  }

  _getAllExportTracks() {
    const out = [...this.savedTracks];
    if (this._isCurrentTrackValid()) {
      const cur = this._buildTrackPayload();
      const idx = out.findIndex((t) => t.id === cur.id);
      if (idx >= 0) out[idx] = cur;
      else out.push(cur);
    }
    return out;
  }

  async _copyExportJson() {
    const tracks = this._getAllExportTracks();
    if (tracks.length === 0) {
      this._showStatus('Build at least 1 track before exporting');
      return;
    }
    const json = JSON.stringify({ version: 1, races: tracks }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this._showStatus(`Copied ${tracks.length} track${tracks.length > 1 ? 's' : ''} JSON to clipboard!`);
    } catch (_) {
      this._downloadExportJson();
    }
  }

  _downloadExportJson() {
    const tracks = this._getAllExportTracks();
    if (tracks.length === 0) {
      this._showStatus('Build at least 1 track before downloading');
      return;
    }
    const json = JSON.stringify({ version: 1, races: tracks }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'races.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    this._showStatus(`Downloaded races.json (${tracks.length} track${tracks.length > 1 ? 's' : ''})`);
  }

  _testDriveStart() {
    if (!this._isCurrentTrackValid() || !this.checkpoints.length) {
      this._showStatus('Finish placing your route first');
      return;
    }
    const startCp = this.checkpoints[0];
    const vehicle = this.worldMap.vehicle;
    if (vehicle && typeof vehicle.reset === 'function') {
      const yaw = Math.atan2(startCp.fwdX, startCp.fwdZ);
      const THREE_VEC = vehicle.rootGroup ? vehicle.rootGroup.position.clone() : { x: 0, y: 0, z: 0 };
      THREE_VEC.x = startCp.x;
      THREE_VEC.y = (startCp.y ?? 0) + 1.1;
      THREE_VEC.z = startCp.z;
      vehicle.reset(THREE_VEC, yaw, 0);
      this.worldMap.setOpen(false);
    }
  }

  _renderSavedList() {
    if (!this.savedListEl) return;
    if (this.savedCountEl) this.savedCountEl.textContent = String(this.savedTracks.length);

    if (this.savedTracks.length === 0) {
      this.savedListEl.innerHTML = '<div class="rb-saved-empty">No saved tracks yet</div>';
      return;
    }

    this.savedListEl.innerHTML = '';
    for (const track of this.savedTracks) {
      const item = document.createElement('div');
      item.className = 'rb-saved-item' + (this.editingId === track.id ? ' active' : '');

      const info = document.createElement('div');
      info.className = 'rb-saved-info';
      const title = document.createElement('div');
      title.className = 'rb-saved-name';
      title.textContent = track.name;
      const meta = document.createElement('div');
      meta.className = 'rb-saved-meta';
      const modeLabel = track.mode === 'time_trial' ? 'TIME TRIAL' : (track.mode === 'ai_race' ? 'AI RACE' : 'TT + AI');
      meta.textContent = `${track.type.toUpperCase()} • ${track.distanceMiles} MI • ${modeLabel}`;
      info.appendChild(title);
      info.appendChild(meta);
      info.addEventListener('click', () => this._loadTrackIntoEditor(track));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'rb-saved-del';
      delBtn.title = 'Delete Track';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._deleteSavedTrack(track.id);
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      this.savedListEl.appendChild(item);
    }
  }

  _syncUI() {
    this.typeBtns.forEach((b) => b.classList.toggle('active', b.dataset.rbType === this.trackType));
    this.lapBtns.forEach((b) => b.classList.toggle('active', parseInt(b.dataset.rbLaps, 10) === this.laps));
    this.modeBtns.forEach((b) => b.classList.toggle('active', b.dataset.rbMode === this.raceMode));

    if (this.lapsRowEl) {
      this.lapsRowEl.classList.toggle('hidden', this.trackType !== 'circuit');
    }

    if (this.statDistEl) {
      const mi = (this.totalDistanceM * METERS_TO_MILES).toFixed(2);
      this.statDistEl.textContent = `${mi} MI`;
    }
    if (this.statAnchorsEl) {
      this.statAnchorsEl.textContent = String(this.anchors.length);
    }
    if (this.statCheckpointsEl) {
      this.statCheckpointsEl.textContent = String(this.checkpoints.length);
    }

    if (this.hintEl) {
      if (this.anchors.length === 0) {
        this.hintEl.textContent = 'Click any road on the map to place the START line.';
      } else if (this.trackType === 'circuit' && this.anchors.length < 3) {
        this.hintEl.textContent = `Click ${3 - this.anchors.length} more road point${3 - this.anchors.length > 1 ? 's' : ''} to auto-close the circuit loop.`;
      } else if (this.trackType === 'sprint' && this.anchors.length < 2) {
        this.hintEl.textContent = 'Click another road point to trace the Sprint route.';
      } else {
        this.hintEl.textContent = 'Route ready! Keep clicking roads to extend, Test Drive, or Save & Export JSON.';
      }
    }

    const valid = this._isCurrentTrackValid();
    if (this.saveBtnEl) this.saveBtnEl.disabled = !valid;
    if (this.testDriveBtnEl) this.testDriveBtnEl.disabled = !valid;
    if (this.undoBtnEl) this.undoBtnEl.disabled = this.anchors.length === 0;
    if (this.reverseBtnEl) this.reverseBtnEl.disabled = this.anchors.length < 2;
    if (this.clearBtnEl) this.clearBtnEl.disabled = this.anchors.length === 0;
  }
}


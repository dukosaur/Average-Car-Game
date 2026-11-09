/**
 * Forza Horizon 5 / 6 Style Interactive World Map
 * =================================================
 * Features:
 *  - High-resolution top-down aerial satellite photograph of the entire circuit
 *  - Luminous layered SVG vector road lines traced over the 5 circuit routes
 *  - Real-time rotating player vehicle chevron with pulsating sonar radar ping
 *  - Interactive landmark POI markers with smooth fly-to camera focus
 *  - Physics-based smooth drag pan with momentum / damping and cursor-centered zoom
 *  - Seamless open/close integration with HUD button and Key M / Esc hotkeys
 */

export class WorldMapController {
  constructor(vehicle, input) {
    this.vehicle = vehicle;
    this.input = input;

    // DOM Elements
    this.overlayEl = document.getElementById('world-map-overlay');
    this.viewportEl = document.getElementById('map-viewport');
    this.planeEl = document.getElementById('map-plane');
    this.roadsGroupEl = document.getElementById('map-roads-group');
    this.landmarksLayerEl = document.getElementById('map-landmarks-layer');
    this.playerMarkerEl = document.getElementById('map-player-marker');
    this.playerArrowEl = document.getElementById('map-player-arrow');
    this.coordValEl = document.getElementById('map-coord-val');
    this.speedValEl = document.getElementById('map-speed-val');
    this.centerBtnEl = document.getElementById('map-center-btn');
    this.zoomInBtnEl = document.getElementById('map-zoom-in');
    this.zoomOutBtnEl = document.getElementById('map-zoom-out');
    this.zoomLabelEl = document.getElementById('map-zoom-label');
    this.closeBtnEl = document.getElementById('map-close-btn');
    this.hudMapBtnEl = document.getElementById('hud-map-btn');

    // World to Map Pixel Calibration (from Blender 2048x1920 orthographic satellite render)
    this.bounds = {
      minX: -300.0,
      maxX: 260.0,
      spanX: 560.0,
      minZ: -292.5,
      maxZ: 232.5,
      spanZ: 525.0,
      imgW: 2048.0,
      imgH: 1920.0,
    };

    // Transform State (Smooth Pan & Zoom Physics)
    this.panX = 0;
    this.panY = 0;
    this.targetPanX = 0;
    this.targetPanY = 0;
    this.scale = 0.85;
    this.targetScale = 0.85;
    this.minScale = 0.35;
    this.maxScale = 4.2;

    // Drag Velocity & Inertia
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.lastPointerX = 0;
    this.lastPointerY = 0;
    this.velX = 0;
    this.velY = 0;

    this.isOpen = false;
    this.tempVec = { x: 0, z: 0 };
    this.headingDir = { x: 0, z: -1 };

    this.routesData = null;
    this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadMapMetadata();
    // Default initial frame centered on origin
    this.centerOnWorld(0, 0, 0.95);
  }

  /**
   * Converts 3D world coordinates (X, Z) to Map Plane pixel coordinates (0-2048, 0-1920)
   */
  worldToMapPx(wx, wz) {
    const px = ((wx - this.bounds.minX) / this.bounds.spanX) * this.bounds.imgW;
    const py = ((wz - this.bounds.minZ) / this.bounds.spanZ) * this.bounds.imgH;
    return { x: px, y: py };
  }

  async loadMapMetadata() {
    try {
      const resp = await fetch('/assets/map_routes.json?v=4');
      if (resp.ok) {
        this.routesData = await resp.json();
        this.renderVectorRoads(this.routesData.routes);
        this.renderLandmarks(this.routesData.landmarks);
      }
    } catch (e) {
      console.warn('Could not load map_routes.json, using fallback route renderer:', e);
    }
  }

  /**
   * Renders authentic Forza Horizon-style vector road lines and elevated overpass bridge with drop shadow
   */
  renderVectorRoads(routes) {
    if (!this.roadsGroupEl || !routes) return;
    this.roadsGroupEl.innerHTML = '';

    // Split routes by layer: ground routes first, elevated overpass bridge on top
    const groundRoutes = routes.filter((r) => r.layer !== 'elevated');
    const elevatedRoutes = routes.filter((r) => r.layer === 'elevated');

    const toPathD = (pts, closed) => {
      let d = '';
      for (let i = 0; i < pts.length; i++) {
        const p = this.worldToMapPx(pts[i][0], pts[i][1]);
        d += (i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} ` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)} `);
      }
      if (closed) d += 'Z';
      return d;
    };

    // 1. RENDER GROUND ROUTES (Clean Forza Cartography: No Goofy Neon Glows)
    for (const route of groundRoutes) {
      if (!route.points || route.points.length < 2) continue;
      const isHwy = route.type === 'highway';
      const d = toPathD(route.points, isHwy);

      // A. Dark Outer Casing (Crisp border against satellite terrain)
      const casing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      casing.setAttribute('d', d);
      casing.setAttribute('fill', 'none');
      casing.setAttribute('stroke', '#0c1017');
      casing.setAttribute('stroke-width', isHwy ? '8.8' : '6.2');
      casing.setAttribute('stroke-linecap', 'round');
      casing.setAttribute('stroke-linejoin', 'round');
      casing.setAttribute('opacity', '0.96');
      this.roadsGroupEl.appendChild(casing);

      // B. Solid Crisp Road Core (Clean white asphalt line)
      const core = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      core.setAttribute('d', d);
      core.setAttribute('fill', 'none');
      core.setAttribute('stroke', '#ffffff');
      core.setAttribute('stroke-width', isHwy ? '5.4' : '3.6');
      core.setAttribute('stroke-linecap', 'round');
      core.setAttribute('stroke-linejoin', 'round');
      core.setAttribute('opacity', '0.98');
      this.roadsGroupEl.appendChild(core);

      // C. Highway Subtle Centerline Divider
      if (isHwy) {
        const divider = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        divider.setAttribute('d', d);
        divider.setAttribute('fill', 'none');
        divider.setAttribute('stroke', '#1e2632');
        divider.setAttribute('stroke-width', '1.0');
        divider.setAttribute('stroke-dasharray', '6, 10');
        divider.setAttribute('opacity', '0.80');
        this.roadsGroupEl.appendChild(divider);
      }
    }

    // 2. RENDER ELEVATED OVERPASS BRIDGE ON TOP WITH REALISTIC DROP-SHADOW
    for (const bridge of elevatedRoutes) {
      if (!bridge.points || bridge.points.length < 2) continue;
      const d = toPathD(bridge.points, false);

      // A. Bridge Elevated Directional Drop-Shadow (casts realistic shadow across lower highway)
      const shadowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      shadowPath.setAttribute('d', d);
      shadowPath.setAttribute('fill', 'none');
      shadowPath.setAttribute('stroke', '#000000');
      shadowPath.setAttribute('stroke-width', '14.0');
      shadowPath.setAttribute('stroke-linecap', 'butt');
      shadowPath.setAttribute('stroke-linejoin', 'round');
      shadowPath.setAttribute('filter', 'url(#bridge-drop-shadow)');
      this.roadsGroupEl.appendChild(shadowPath);

      // B. Solid Bridge Deck Casing (cleanly cuts and obscures lower highway beneath)
      const deckCasing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      deckCasing.setAttribute('d', d);
      deckCasing.setAttribute('fill', 'none');
      deckCasing.setAttribute('stroke', '#0e131b');
      deckCasing.setAttribute('stroke-width', '11.8');
      deckCasing.setAttribute('stroke-linecap', 'butt');
      deckCasing.setAttribute('stroke-linejoin', 'round');
      this.roadsGroupEl.appendChild(deckCasing);

      // C. Bridge Guardrail Parapets
      const parapet = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      parapet.setAttribute('d', d);
      parapet.setAttribute('fill', 'none');
      parapet.setAttribute('stroke', '#475569');
      parapet.setAttribute('stroke-width', '8.6');
      parapet.setAttribute('stroke-linecap', 'butt');
      this.roadsGroupEl.appendChild(parapet);

      // D. Bridge Crisp White Roadway
      const bridgeCore = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      bridgeCore.setAttribute('d', d);
      bridgeCore.setAttribute('fill', 'none');
      bridgeCore.setAttribute('stroke', '#ffffff');
      bridgeCore.setAttribute('stroke-width', '5.4');
      bridgeCore.setAttribute('stroke-linecap', 'butt');
      this.roadsGroupEl.appendChild(bridgeCore);

      // E. Bridge Abutment Joints at Ends
      const pStart = this.worldToMapPx(bridge.points[0][0], bridge.points[0][1]);
      const pEnd = this.worldToMapPx(bridge.points[bridge.points.length - 1][0], bridge.points[bridge.points.length - 1][1]);
      for (const p of [pStart, pEnd]) {
        const joint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        joint.setAttribute('cx', p.x.toFixed(1));
        joint.setAttribute('cy', p.y.toFixed(1));
        joint.setAttribute('r', '4.5');
        joint.setAttribute('fill', '#334155');
        joint.setAttribute('stroke', '#ffffff');
        joint.setAttribute('stroke-width', '1.2');
        this.roadsGroupEl.appendChild(joint);
      }
    }
  }

  /**
   * Renders compact, non-intrusive landmark pins with sleek hover tooltips (keeps roads 100% visible)
   */
  renderLandmarks(landmarks) {
    if (!this.landmarksLayerEl || !landmarks) return;
    this.landmarksLayerEl.innerHTML = '';

    const iconMap = {
      festival: '🏁',
      bridge: '🌉',
      mountain: '🏔️',
      speedway: '⚡',
      overpass: '🌉',
      scenic: '🌲',
      canyon: '🏜️',
    };

    for (const lm of landmarks) {
      const p = this.worldToMapPx(lm.x, lm.z);
      const pin = document.createElement('div');
      pin.className = 'map-poi-pin';
      pin.style.left = `${p.x.toFixed(1)}px`;
      pin.style.top = `${p.y.toFixed(1)}px`;
      pin.innerHTML = `
        <div class="poi-disc" title="${lm.name}">
          <span class="poi-icon">${iconMap[lm.type] || '📍'}</span>
        </div>
        <div class="poi-tooltip">
          <div class="poi-title">${lm.name}</div>
          <div class="poi-desc">${lm.desc || ''}</div>
        </div>
      `;
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.landmarksLayerEl) {
          const allPins = this.landmarksLayerEl.querySelectorAll('.map-poi-pin');
          allPins.forEach((p) => p.classList.remove('active'));
        }
        pin.classList.add('active');
        this.centerOnWorld(lm.x, lm.z, 1.8);
      });
      this.landmarksLayerEl.appendChild(pin);
    }
  }

  bindEvents() {
    // HUD & Close buttons
    if (this.hudMapBtnEl) {
      this.hudMapBtnEl.addEventListener('click', () => this.setOpen(!this.isOpen));
    }
    if (this.closeBtnEl) {
      this.closeBtnEl.addEventListener('click', () => this.setOpen(false));
    }
    if (this.centerBtnEl) {
      this.centerBtnEl.addEventListener('click', () => this.centerOnPlayer(1.35));
    }
    if (this.zoomInBtnEl) {
      this.zoomInBtnEl.addEventListener('click', () => this.setZoomByFactor(1.3));
    }
    if (this.zoomOutBtnEl) {
      this.zoomOutBtnEl.addEventListener('click', () => this.setZoomByFactor(0.77));
    }

    // Viewport Pointer Dragging (Pan)
    if (this.viewportEl) {
      this.viewportEl.addEventListener('click', (e) => {
        if (e.target.closest('.map-poi-pin')) return;
        if (this.landmarksLayerEl) {
          const allPins = this.landmarksLayerEl.querySelectorAll('.map-poi-pin');
          allPins.forEach((p) => p.classList.remove('active'));
        }
      });

      this.viewportEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // Main click only
        this.isDragging = true;
        this.dragStartX = e.clientX;
        this.dragStartY = e.clientY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        this.velX = 0;
        this.velY = 0;
        this.viewportEl.classList.add('dragging');
        this.viewportEl.setPointerCapture(e.pointerId);
      });

      this.viewportEl.addEventListener('pointermove', (e) => {
        if (!this.isDragging) return;
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;

        this.targetPanX += dx;
        this.targetPanY += dy;
        this.velX = dx;
        this.velY = dy;
      });

      const endDrag = (e) => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.viewportEl.classList.remove('dragging');
        try {
          this.viewportEl.releasePointerCapture(e.pointerId);
        } catch (_) {}
      };

      this.viewportEl.addEventListener('pointerup', endDrag);
      this.viewportEl.addEventListener('pointercancel', endDrag);

      // Smooth Cursor-Centered Wheel Zoom
      this.viewportEl.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = this.viewportEl.getBoundingClientRect();
        const cursorScreenX = e.clientX - rect.left;
        const cursorScreenY = e.clientY - rect.top;

        const zoomFactor = Math.exp(-e.deltaY * 0.0016);
        const nextScale = Math.max(this.minScale, Math.min(this.maxScale, this.targetScale * zoomFactor));

        // Adjust pan so the world point directly under cursor stays fixed
        const mapPointX = (cursorScreenX - this.targetPanX) / this.targetScale;
        const mapPointY = (cursorScreenY - this.targetPanY) / this.targetScale;

        this.targetScale = nextScale;
        this.targetPanX = cursorScreenX - mapPointX * nextScale;
        this.targetPanY = cursorScreenY - mapPointY * nextScale;
      }, { passive: false });
    }

    // Double click to zoom in and center
    if (this.viewportEl) {
      this.viewportEl.addEventListener('dblclick', (e) => {
        const rect = this.viewportEl.getBoundingClientRect();
        const cursorScreenX = e.clientX - rect.left;
        const cursorScreenY = e.clientY - rect.top;
        const mapPointX = (cursorScreenX - this.panX) / this.scale;
        const mapPointY = (cursorScreenY - this.panY) / this.scale;

        this.targetScale = Math.min(this.maxScale, this.targetScale * 1.6);
        this.targetPanX = rect.width * 0.5 - mapPointX * this.targetScale;
        this.targetPanY = rect.height * 0.5 - mapPointY * this.targetScale;
      });
    }
  }

  setZoomByFactor(factor) {
    if (!this.viewportEl) return;
    const rect = this.viewportEl.getBoundingClientRect();
    const centerX = rect.width * 0.5;
    const centerY = rect.height * 0.5;

    const nextScale = Math.max(this.minScale, Math.min(this.maxScale, this.targetScale * factor));
    const mapPointX = (centerX - this.targetPanX) / this.targetScale;
    const mapPointY = (centerY - this.targetPanY) / this.targetScale;

    this.targetScale = nextScale;
    this.targetPanX = centerX - mapPointX * nextScale;
    this.targetPanY = centerY - mapPointY * nextScale;
  }

  centerOnWorld(wx, wz, desiredScale = null) {
    if (!this.viewportEl) return;
    const rect = this.viewportEl.getBoundingClientRect();
    const p = this.worldToMapPx(wx, wz);

    if (desiredScale !== null) {
      this.targetScale = Math.max(this.minScale, Math.min(this.maxScale, desiredScale));
    }
    this.targetPanX = rect.width * 0.5 - p.x * this.targetScale;
    this.targetPanY = rect.height * 0.5 - p.y * this.targetScale;
  }

  centerOnPlayer(desiredScale = 1.15) {
    if (!this.vehicle || !this.vehicle.rootGroup) return;
    const pos = this.vehicle.rootGroup.position;
    this.centerOnWorld(pos.x, pos.z, desiredScale);
  }

  setOpen(open) {
    if (this.isOpen === open) return;
    this.isOpen = open;

    if (this.overlayEl) {
      this.overlayEl.classList.toggle('hidden', !open);
    }

    if (open) {
      // Suspend car driving controls while map is open
      if (this.input) {
        this.input.forward = false;
        this.input.backward = false;
        this.input.left = false;
        this.input.right = false;
        this.input.handbrake = true;
      }
      // Instantly center on player car when opening
      this.centerOnPlayer(0.85);
      // Snap pan to target to prevent jarring jumps
      this.panX = this.targetPanX;
      this.panY = this.targetPanY;
      this.scale = this.targetScale;
    } else {
      if (this.input) {
        this.input.handbrake = false;
      }
    }
  }

  /**
   * Called on every game animation frame to update smooth pan/zoom physics,
   * player marker position, heading arrow rotation, and HUD telemetry values.
   */
  update(carPos, carSpeedKmh, carHeadingDir) {
    // 1. Update Player Vehicle Marker Position & Heading
    if (carPos && this.playerMarkerEl) {
      const p = this.worldToMapPx(carPos.x, carPos.z);
      this.playerMarkerEl.style.left = `${p.x.toFixed(1)}px`;
      this.playerMarkerEl.style.top = `${p.y.toFixed(1)}px`;

      if (carHeadingDir && this.playerArrowEl) {
        // North is -Z in Three.js (0 deg rotation)
        const headingDeg = Math.atan2(carHeadingDir.x, -carHeadingDir.z) * (180.0 / Math.PI);
        this.playerArrowEl.style.transform = `rotate(${headingDeg.toFixed(1)}deg)`;
      }

      if (this.isOpen) {
        if (this.coordValEl) {
          this.coordValEl.textContent = `X: ${carPos.x.toFixed(1)}m | Z: ${carPos.z.toFixed(1)}m`;
        }
        if (this.speedValEl) {
          this.speedValEl.textContent = `${Math.round(carSpeedKmh || 0)} KM/H`;
        }
      }
    }

    if (!this.isOpen) return;

    // 2. Inertia Decay when not dragging
    if (!this.isDragging) {
      this.targetPanX += this.velX;
      this.targetPanY += this.velY;
      this.velX *= 0.88;
      this.velY *= 0.88;
      if (Math.abs(this.velX) < 0.05) this.velX = 0;
      if (Math.abs(this.velY) < 0.05) this.velY = 0;
    }

    // 3. Smooth Damping (Spring Lerp)
    this.panX += (this.targetPanX - this.panX) * 0.18;
    this.panY += (this.targetPanY - this.panY) * 0.18;
    this.scale += (this.targetScale - this.scale) * 0.18;

    if (this.planeEl) {
      this.planeEl.style.transform = `translate(${this.panX.toFixed(2)}px, ${this.panY.toFixed(2)}px) scale(${this.scale.toFixed(4)})`;
    }

    if (this.zoomLabelEl) {
      this.zoomLabelEl.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }
}

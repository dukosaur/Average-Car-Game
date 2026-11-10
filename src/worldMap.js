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
  constructor(vehicle, input, gpsNav = null) {
    this.vehicle = vehicle;
    this.input = input;
    this.gpsNav = gpsNav;

    // DOM Elements
    this.overlayEl = document.getElementById('world-map-overlay');
    this.viewportEl = document.getElementById('map-viewport');
    this.planeEl = document.getElementById('map-plane');
    this.roadsGroupEl = document.getElementById('map-roads-group');
    this.gpsGroupEl = document.getElementById('map-gps-group');
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

    // GPS Navigation UI Elements
    this.mapGpsHudEl = document.getElementById('map-gps-hud');
    this.gpsTargetNameEl = document.getElementById('gps-target-name');
    this.gpsTargetDistEl = document.getElementById('gps-target-dist');
    this.mapGpsCancelBtnEl = document.getElementById('map-gps-cancel-btn');
    this.waypointMarkerEl = document.getElementById('map-waypoint-marker');
    this.roadHoverDotEl = document.getElementById('map-road-hover-dot');
    this.roadHoverLabelEl = document.getElementById('road-hover-label');
    this.hudGpsIndicatorEl = document.getElementById('hud-gps-indicator');
    this.hudGpsNameEl = document.getElementById('hud-gps-name');
    this.hudGpsDistEl = document.getElementById('hud-gps-dist');
    this.hudGpsCancelBtnEl = document.getElementById('hud-gps-cancel');

    this.hoveredRoad = null;

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
    this.pointerDist = 0;
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

  /**
   * Converts Map Plane pixel coordinates (0-2048, 0-1920) back to 3D world coordinates (X, Z)
   */
  mapPxToWorld(px, py) {
    const wx = (px / this.bounds.imgW) * this.bounds.spanX + this.bounds.minX;
    const wz = (py / this.bounds.imgH) * this.bounds.spanZ + this.bounds.minZ;
    return { x: wx, z: wz };
  }

  getRouteDisplayName(routeId) {
    const names = {
      hwy: 'ISLA EXPRESSWAY',
      touge: 'LA GRAN CALDERA TOUGE',
      overpass: 'CROSS-VALLEY OVERPASS',
      valley: 'SOUTH COAST RUN',
      sw_shortcut: 'FOOTHILL SHORTCUT',
    };
    return names[routeId] || 'ROAD WAYPOINT';
  }

  /**
   * Snaps a world coordinate (wx, wz) to the closest point on any road spline.
   * Returns distance, projected 3D point, and route details.
   */
  getClosestRoadPoint(wx, wz) {
    if (!this.routesData || !this.routesData.routes) return null;
    let minDist = Infinity;
    let closestPoint = null;
    let closestRoute = null;

    const routes = this.routesData.routes.filter((r) => r.id !== 'overpass_bridge');
    for (const route of routes) {
      const pts = route.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const x1 = p1[0], z1 = p1.length > 2 ? p1[2] : p1[1];
        const x2 = p2[0], z2 = p2.length > 2 ? p2[2] : p2[1];

        const dx = x2 - x1;
        const dz = z2 - z1;
        const lenSq = dx * dx + dz * dz;
        let t = lenSq > 0 ? ((wx - x1) * dx + (wz - z1) * dz) / lenSq : 0;
        t = Math.max(0, Math.min(1, t));

        const projX = x1 + t * dx;
        const projZ = z1 + t * dz;
        const dist = Math.hypot(wx - projX, wz - projZ);

        if (dist < minDist) {
          minDist = dist;
          const y1 = p1.length > 2 ? p1[1] : 0;
          const y2 = p2.length > 2 ? p2[1] : 0;
          closestPoint = { x: projX, y: y1 + t * (y2 - y1), z: projZ };
          closestRoute = route;
        }
      }
    }

    return { dist: minDist, point: closestPoint, route: closestRoute };
  }

  async loadMapMetadata() {
    try {
      const resp = await fetch('/assets/map_routes.json?v=4');
      if (resp.ok) {
        this.routesData = await resp.json();
        this.renderVectorRoads(this.routesData.routes);
        this.renderLandmarks(this.routesData.landmarks);

        // Initialize GPS graph if GPS navigation system was injected
        if (this.gpsNav) {
          this.gpsNav.initGraph(this.routesData);
          this.gpsNav.onRouteUpdated = (waypoint, path, remDist) => {
            this.onGpsRouteUpdated(waypoint, path, remDist);
          };
        }
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
        const wx = pts[i][0];
        const wz = pts[i].length > 2 ? pts[i][2] : pts[i][1];
        const p = this.worldToMapPx(wx, wz);
        d += (i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} ` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)} `);
      }
      if (closed) d += 'Z';
      return d;
    };

    // 1. RENDER GROUND ROUTES (Clean Forza Cartography: Bold & Readable)
    for (const route of groundRoutes) {
      if (!route.points || route.points.length < 2) continue;
      const isHwy = route.type === 'highway';
      const d = toPathD(route.points, isHwy);

      // A. Dark Outer Casing (Crisp border against satellite terrain)
      const casing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      casing.setAttribute('d', d);
      casing.setAttribute('fill', 'none');
      casing.setAttribute('stroke', '#0c1017');
      casing.setAttribute('stroke-width', isHwy ? '11.5' : '8.5');
      casing.setAttribute('stroke-linecap', 'round');
      casing.setAttribute('stroke-linejoin', 'round');
      casing.setAttribute('opacity', '0.96');
      this.roadsGroupEl.appendChild(casing);

      // B. Solid Crisp Road Core (Clean white asphalt line)
      const core = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      core.setAttribute('d', d);
      core.setAttribute('fill', 'none');
      core.setAttribute('stroke', '#ffffff');
      core.setAttribute('stroke-width', isHwy ? '7.0' : '5.0');
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
        divider.setAttribute('stroke-width', '1.2');
        divider.setAttribute('stroke-dasharray', '8, 12');
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
      shadowPath.setAttribute('stroke-width', '18.0');
      shadowPath.setAttribute('stroke-linecap', 'butt');
      shadowPath.setAttribute('stroke-linejoin', 'round');
      shadowPath.setAttribute('filter', 'url(#bridge-drop-shadow)');
      this.roadsGroupEl.appendChild(shadowPath);

      // B. Solid Bridge Deck Casing (cleanly cuts and obscures lower highway beneath)
      const deckCasing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      deckCasing.setAttribute('d', d);
      deckCasing.setAttribute('fill', 'none');
      deckCasing.setAttribute('stroke', '#0e131b');
      deckCasing.setAttribute('stroke-width', '15.0');
      deckCasing.setAttribute('stroke-linecap', 'butt');
      deckCasing.setAttribute('stroke-linejoin', 'round');
      this.roadsGroupEl.appendChild(deckCasing);

      // C. Bridge Guardrail Parapets
      const parapet = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      parapet.setAttribute('d', d);
      parapet.setAttribute('fill', 'none');
      parapet.setAttribute('stroke', '#475569');
      parapet.setAttribute('stroke-width', '10.8');
      parapet.setAttribute('stroke-linecap', 'butt');
      this.roadsGroupEl.appendChild(parapet);

      // D. Bridge Crisp White Roadway
      const bridgeCore = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      bridgeCore.setAttribute('d', d);
      bridgeCore.setAttribute('fill', 'none');
      bridgeCore.setAttribute('stroke', '#ffffff');
      bridgeCore.setAttribute('stroke-width', '7.0');
      bridgeCore.setAttribute('stroke-linecap', 'butt');
      this.roadsGroupEl.appendChild(bridgeCore);

      // E. Bridge Abutment Joints at Ends
      const p0 = bridge.points[0];
      const p1 = bridge.points[bridge.points.length - 1];
      const pStart = this.worldToMapPx(p0[0], p0.length > 2 ? p0[2] : p0[1]);
      const pEnd = this.worldToMapPx(p1[0], p1.length > 2 ? p1[2] : p1[1]);
      for (const p of [pStart, pEnd]) {
        const joint = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        joint.setAttribute('cx', p.x.toFixed(1));
        joint.setAttribute('cy', p.y.toFixed(1));
        joint.setAttribute('r', '5.5');
        joint.setAttribute('fill', '#334155');
        joint.setAttribute('stroke', '#ffffff');
        joint.setAttribute('stroke-width', '1.5');
        this.roadsGroupEl.appendChild(joint);
      }
    }

    if (window.__pauseMenu && typeof window.__pauseMenu.syncRoads === 'function') {
      window.__pauseMenu.syncRoads();
    }
  }

  /**
   * Renders compact, non-intrusive landmark pins with sleek SVG icons & Track Route buttons
   */
  renderLandmarks(landmarks) {
    if (!this.landmarksLayerEl || !landmarks) return;
    this.landmarksLayerEl.innerHTML = '';

    const ICONS = {
      festival: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
      bridge: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 19h18M3 15h18M6 5v14M18 5v14M6 5l12 10M18 5L6 15"/></svg>`,
      mountain: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18L13 4l-4 7-2-3-4 12z"/></svg>`,
      speedway: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
      overpass: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2v20M7 7l10 10M17 7L7 17"/></svg>`,
      canyon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 22 22 22"/><circle cx="12" cy="16" r="2" fill="currentColor"/></svg>`,
      scenic: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 22 22 22"/></svg>`,
      default: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`,
    };

    for (const lm of landmarks) {
      const p = this.worldToMapPx(lm.x, lm.z);
      const pin = document.createElement('div');
      pin.className = 'map-poi-pin';
      pin.style.left = `${p.x.toFixed(1)}px`;
      pin.style.top = `${p.y.toFixed(1)}px`;
      pin.innerHTML = `
        <div class="poi-disc" title="${lm.name}">
          <span class="poi-icon">${ICONS[lm.type] || ICONS.default}</span>
        </div>
        <div class="poi-tooltip">
          <div class="poi-title">${lm.name}</div>
          <div class="poi-desc">${lm.desc || ''}</div>
          <button class="poi-track-btn" data-x="${lm.x}" data-z="${lm.z}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/></svg>
            <span>TRACK ROUTE</span>
          </button>
        </div>
      `;

      // Track button inside tooltip sets route directly
      const trackBtn = pin.querySelector('.poi-track-btn');
      if (trackBtn) {
        trackBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.setGpsWaypoint(lm.x, lm.z, lm.name, lm.type);
        });
      }

      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.landmarksLayerEl) {
          const allPins = this.landmarksLayerEl.querySelectorAll('.map-poi-pin');
          allPins.forEach((p) => p.classList.remove('active'));
        }
        pin.classList.add('active');
        this.centerOnWorld(lm.x, lm.z, 1.8);
        this.setGpsWaypoint(lm.x, lm.z, lm.name, lm.type);
      });
      this.landmarksLayerEl.appendChild(pin);
    }

    if (window.__pauseMenu && typeof window.__pauseMenu.syncLandmarks === 'function') {
      window.__pauseMenu.syncLandmarks();
    }
  }

  setGpsWaypoint(wx, wz, name = 'WAYPOINT', type = 'custom') {
    if (this.gpsNav) {
      this.gpsNav.setWaypoint(wx, wz, name, type);
    }
  }

  clearGpsWaypoint() {
    if (this.gpsNav) {
      this.gpsNav.clearWaypoint();
    }
    if (this.hoveredRoad) {
      this.hoveredRoad = null;
    }
    if (window.__pauseMenu && typeof window.__pauseMenu.syncGps === 'function') {
      window.__pauseMenu.syncGps();
    }
  }

  /**
   * Called whenever the GPS pathfinder updates the active route
   */
  onGpsRouteUpdated(waypoint, path, remDist) {
    if (!this.gpsGroupEl) return;
    this.gpsGroupEl.innerHTML = '';

    if (!waypoint || !path || path.length < 2) {
      if (this.waypointMarkerEl) this.waypointMarkerEl.classList.add('hidden');
      if (this.mapGpsHudEl) this.mapGpsHudEl.classList.add('hidden');
      if (this.hudGpsIndicatorEl) this.hudGpsIndicatorEl.classList.add('hidden');
      if (window.__pauseMenu && typeof window.__pauseMenu.syncGps === 'function') {
        window.__pauseMenu.syncGps();
      }
      return;
    }

    // 1. Draw Vibrant Forza Blue Route Ribbon in SVG
    let d = '';
    for (let i = 0; i < path.length; i++) {
      const p = this.worldToMapPx(path[i].x, path[i].z);
      d += (i === 0 ? `M ${p.x.toFixed(1)} ${p.y.toFixed(1)} ` : `L ${p.x.toFixed(1)} ${p.y.toFixed(1)} `);
    }

    // A. Outer Luminous Halo / Glow (Motorsport Amber)
    const glowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glowPath.setAttribute('d', d);
    glowPath.setAttribute('fill', 'none');
    glowPath.setAttribute('stroke', '#E5A93C');
    glowPath.setAttribute('stroke-width', '16.0');
    glowPath.setAttribute('stroke-linecap', 'round');
    glowPath.setAttribute('stroke-linejoin', 'round');
    glowPath.setAttribute('opacity', '0.75');
    glowPath.setAttribute('filter', 'url(#gps-route-glow)');
    this.gpsGroupEl.appendChild(glowPath);

    // B. Contrast Casing Border
    const casingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    casingPath.setAttribute('d', d);
    casingPath.setAttribute('fill', 'none');
    casingPath.setAttribute('stroke', '#1a1408');
    casingPath.setAttribute('stroke-width', '12.5');
    casingPath.setAttribute('stroke-linecap', 'round');
    casingPath.setAttribute('stroke-linejoin', 'round');
    casingPath.setAttribute('opacity', '0.92');
    this.gpsGroupEl.appendChild(casingPath);

    // C. Clean Motorsport Amber Ribbon Core
    const ribbonPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ribbonPath.setAttribute('d', d);
    ribbonPath.setAttribute('fill', 'none');
    ribbonPath.setAttribute('stroke', '#FFB74D');
    ribbonPath.setAttribute('stroke-width', '8.8');
    ribbonPath.setAttribute('stroke-linecap', 'round');
    ribbonPath.setAttribute('stroke-linejoin', 'round');
    ribbonPath.setAttribute('opacity', '1.0');
    this.gpsGroupEl.appendChild(ribbonPath);

    // D. White Bright Centerline Stripe
    const centerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    centerPath.setAttribute('d', d);
    centerPath.setAttribute('fill', 'none');
    centerPath.setAttribute('stroke', '#ffffff');
    centerPath.setAttribute('stroke-width', '3.8');
    centerPath.setAttribute('stroke-linecap', 'round');
    centerPath.setAttribute('stroke-linejoin', 'round');
    centerPath.setAttribute('opacity', '0.96');
    this.gpsGroupEl.appendChild(centerPath);

    // 2. Position Waypoint Marker on Map (FH6 Minimalist Glowing Target Dot - NO TEXT TAG)
    const pWp = this.worldToMapPx(waypoint.x, waypoint.z);
    if (this.waypointMarkerEl) {
      this.waypointMarkerEl.style.left = `${pWp.x.toFixed(1)}px`;
      this.waypointMarkerEl.style.top = `${pWp.y.toFixed(1)}px`;
      this.waypointMarkerEl.classList.remove('hidden');
    }

    const distStr = remDist >= 1000 ? `${(remDist / 1000).toFixed(1)} KM` : `${Math.round(remDist)} M`;

    // 3. Update Map Top Bar GPS HUD
    if (this.mapGpsHudEl) {
      if (this.gpsTargetNameEl) this.gpsTargetNameEl.textContent = waypoint.name;
      if (this.gpsTargetDistEl) this.gpsTargetDistEl.textContent = distStr;
      this.mapGpsHudEl.classList.remove('hidden');
    }

    // 4. Update HUD Gameplay Indicator
    if (this.hudGpsIndicatorEl) {
      if (this.hudGpsNameEl) this.hudGpsNameEl.textContent = waypoint.name;
      if (this.hudGpsDistEl) this.hudGpsDistEl.textContent = distStr;
      this.hudGpsIndicatorEl.classList.remove('hidden');
    }

    if (window.__pauseMenu && typeof window.__pauseMenu.syncGps === 'function') {
      window.__pauseMenu.syncGps();
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

    // GPS Cancel Buttons & Waypoint Click
    if (this.mapGpsCancelBtnEl) {
      this.mapGpsCancelBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearGpsWaypoint();
      });
    }
    if (this.hudGpsCancelBtnEl) {
      this.hudGpsCancelBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearGpsWaypoint();
      });
    }
    if (this.waypointMarkerEl) {
      this.waypointMarkerEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.clearGpsWaypoint();
      });
    }

    // Viewport Pointer Interaction: Drag Pan & Road Hover / Road Click Only
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
        this.pointerDist = 0;
        this.velX = 0;
        this.velY = 0;
        this.viewportEl.classList.add('dragging');
        this.viewportEl.setPointerCapture(e.pointerId);
      });

      this.viewportEl.addEventListener('pointermove', (e) => {
        if (this.isDragging) {
          const dx = e.clientX - this.lastPointerX;
          const dy = e.clientY - this.lastPointerY;
          this.lastPointerX = e.clientX;
          this.lastPointerY = e.clientY;
          this.pointerDist += Math.hypot(dx, dy);

          this.targetPanX += dx;
          this.targetPanY += dy;
          this.velX = dx;
          this.velY = dy;
          if (this.roadHoverDotEl) this.roadHoverDotEl.classList.add('hidden');
          return;
        }

        // Road Hover Check (Only when map is open and routes are loaded)
        if (!this.isOpen || !this.routesData) return;
        const rect = this.viewportEl.getBoundingClientRect();
        const mapPxX = (e.clientX - rect.left - this.panX) / this.scale;
        const mapPxY = (e.clientY - rect.top - this.panY) / this.scale;
        const world = this.mapPxToWorld(mapPxX, mapPxY);

        const roadMatch = this.getClosestRoadPoint(world.x, world.z);
        if (roadMatch && roadMatch.dist <= 8.5) {
          this.hoveredRoad = roadMatch;
          const hp = this.worldToMapPx(roadMatch.point.x, roadMatch.point.z);
          if (this.roadHoverDotEl) {
            this.roadHoverDotEl.style.left = `${hp.x.toFixed(1)}px`;
            this.roadHoverDotEl.style.top = `${hp.y.toFixed(1)}px`;
            this.roadHoverDotEl.classList.remove('hidden');
          }
          if (this.roadHoverLabelEl) {
            const routeName = this.getRouteDisplayName(roadMatch.route.id);
            this.roadHoverLabelEl.textContent = `SET DESTINATION • ${routeName}`;
          }
          this.viewportEl.style.cursor = 'crosshair';
        } else {
          this.hoveredRoad = null;
          if (this.roadHoverDotEl) this.roadHoverDotEl.classList.add('hidden');
          this.viewportEl.style.cursor = '';
        }
      });

      this.viewportEl.addEventListener('pointerleave', () => {
        this.hoveredRoad = null;
        if (this.roadHoverDotEl) this.roadHoverDotEl.classList.add('hidden');
        if (this.viewportEl) this.viewportEl.style.cursor = '';
      });

      const endDrag = (e) => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.viewportEl.classList.remove('dragging');
        try {
          this.viewportEl.releasePointerCapture(e.pointerId);
        } catch (_) {}

        // Road Click to Waypoint: ONLY set waypoint if clicking on the road!
        if (this.pointerDist < 6 &&
            !e.target.closest('.map-poi-pin') &&
            !e.target.closest('.poi-track-btn') &&
            !e.target.closest('.map-actions-group') &&
            !e.target.closest('.map-waypoint-marker') &&
            !e.target.closest('.map-gps-hud')) {
          if (this.hoveredRoad && this.hoveredRoad.dist <= 8.5) {
            const pt = this.hoveredRoad.point;
            const routeName = this.getRouteDisplayName(this.hoveredRoad.route.id);
            this.setGpsWaypoint(pt.x, pt.z, routeName, 'road');
          }
        }
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

  clampPan(panX, panY, scale) {
    if (!this.viewportEl) return { x: panX, y: panY };
    const rect = this.viewportEl.getBoundingClientRect();
    const mapW = this.bounds.imgW * scale;
    const mapH = this.bounds.imgH * scale;

    let minX, maxX;
    if (mapW >= rect.width) {
      minX = rect.width - mapW;
      maxX = 0;
    } else {
      minX = (rect.width - mapW) * 0.5;
      maxX = minX;
    }

    let minY, maxY;
    if (mapH >= rect.height) {
      minY = rect.height - mapH;
      maxY = 0;
    } else {
      minY = (rect.height - mapH) * 0.5;
      maxY = minY;
    }

    return {
      x: Math.min(maxX, Math.max(minX, panX)),
      y: Math.min(maxY, Math.max(minY, panY))
    };
  }

  centerOnWorld(wx, wz, desiredScale = null) {
    if (!this.viewportEl) return;
    const rect = this.viewportEl.getBoundingClientRect();
    const p = this.worldToMapPx(wx, wz);

    if (desiredScale !== null) {
      this.targetScale = Math.max(this.minScale, Math.min(this.maxScale, desiredScale));
    }
    const rawPanX = rect.width * 0.5 - p.x * this.targetScale;
    const rawPanY = rect.height * 0.5 - p.y * this.targetScale;
    const clamped = this.clampPan(rawPanX, rawPanY, this.targetScale);
    this.targetPanX = clamped.x;
    this.targetPanY = clamped.y;
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
      // Immediately place player vehicle marker at current 3D position
      if (this.vehicle && this.vehicle.rootGroup) {
        const pos = this.vehicle.rootGroup.position;
        const p = this.worldToMapPx(pos.x, pos.z);
        if (this.playerMarkerEl) {
          this.playerMarkerEl.style.left = `${p.x.toFixed(1)}px`;
          this.playerMarkerEl.style.top = `${p.y.toFixed(1)}px`;
        }
        if (this.coordValEl) {
          this.coordValEl.textContent = `X: ${pos.x.toFixed(1)}m | Z: ${pos.z.toFixed(1)}m`;
        }
      }
      // Instantly center on player car when opening
      this.centerOnPlayer(0.85);
      // Snap pan to target to prevent jarring jumps
      this.panX = this.targetPanX;
      this.panY = this.targetPanY;
      this.scale = this.targetScale;

      // Immediately sync active GPS route from current car position
      if (this.gpsNav && this.gpsNav.activeWaypoint) {
        this.onGpsRouteUpdated(this.gpsNav.activeWaypoint, this.gpsNav.activePath, this.gpsNav.remainingDistance);
      }
    } else {
      if (this.input) {
        this.input.handbrake = false;
      }
      if (this.roadHoverDotEl) {
        this.roadHoverDotEl.classList.add('hidden');
      }
      this.hoveredRoad = null;
      if (this.viewportEl) {
        this.viewportEl.style.cursor = '';
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

    // 2. Real-Time GPS Telemetry Distance Updates
    if (this.gpsNav && this.gpsNav.activeWaypoint) {
      const remDist = this.gpsNav.remainingDistance;
      const distStr = remDist >= 1000 ? `${(remDist / 1000).toFixed(1)} KM` : `${Math.round(remDist)} M`;
      if (this.gpsTargetDistEl) this.gpsTargetDistEl.textContent = distStr;
      if (this.hudGpsDistEl) this.hudGpsDistEl.textContent = distStr;
      if (this.waypointTagEl) this.waypointTagEl.textContent = `${this.gpsNav.activeWaypoint.name} • ${distStr}`;
    }

    if (!this.isOpen) return;

    // 3. Inertia Decay & Viewport Clamping when not dragging
    if (!this.isDragging) {
      this.targetPanX += this.velX;
      this.targetPanY += this.velY;
      this.velX *= 0.88;
      this.velY *= 0.88;
      if (Math.abs(this.velX) < 0.05) this.velX = 0;
      if (Math.abs(this.velY) < 0.05) this.velY = 0;
    }

    const clamped = this.clampPan(this.targetPanX, this.targetPanY, this.targetScale);
    this.targetPanX = clamped.x;
    this.targetPanY = clamped.y;

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

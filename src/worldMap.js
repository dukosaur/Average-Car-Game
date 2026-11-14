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
    this.controlsCardEl = document.getElementById('map-controls-card');
    this.controlsToggleBtnEl = document.getElementById('map-controls-toggle-btn');

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

    // Forza Horizon 6 Style HUD Circular Radar Mini-Map Elements
    this.hudPausePromptEl = document.getElementById('hud-pause-prompt');
    this.hudMinimapWrapEl = document.getElementById('hud-minimap-wrap');
    this.hudMinimapCanvasEl = document.getElementById('hud-minimap-canvas');
    this.hudMinimapCtx = this.hudMinimapCanvasEl ? this.hudMinimapCanvasEl.getContext('2d') : null;
    this.hudMinimapDotEl = document.getElementById('hud-minimap-dot');
    this.hudMinimapStatusEl = document.getElementById('hud-minimap-status');
    this.miniFwdX = 0;
    this.miniFwdZ = -1;
    this.miniRadarScale = 3.85;

    this.hoveredRoad = null;

    // World to Map Pixel Calibration (from Blender 2048x1920 orthographic satellite render, ortho_scale=1800)
    this.bounds = {
      minX: -900.0,
      maxX: 900.0,
      spanX: 1800.0,
      minZ: -843.75,
      maxZ: 843.75,
      spanZ: 1687.5,
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
    this.maxScale = 5.6;

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
      hwy: 'HORIZON GRAND EXPRESSWAY',
      hwy_west: 'WESTERN MESA EXPRESSWAY',
      touge: 'ALPINE SUMMIT TOUGE',
      overpass: 'CROSSTOWN SKYWAY OVERPASS',
      river_run: 'EMERALD RIVER CANYON RUN',
      coastal_loop: 'GOLDEN BAY COASTAL DRIVE',
      east_ridge: 'EAST CLIFFSIDE SKYBRIDGE',
      valley: 'FESTIVAL MEADOW CONNECTOR',
      canyon_cut: 'RED-ROCK CANYON GORGE',
      west_mesa_rim: 'WESTERN DESERT MESA RIM',
      autumn_loop: 'AUTUMN HIGHLAND SKYBRIDGE',
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

    const routes = this.routesData.routes.filter(
      (r) => (!r.layer || r.layer === 'ground') && !r.id.startsWith('overpass_bridge') && r.id !== 'alpine_tunnel'
    );
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
      const resp = await fetch('/assets/map_routes.json?v=37');
      if (resp.ok) {
        this.routesData = await resp.json();
        if (this.routesData.routes) {
          for (const r of this.routesData.routes) {
            if (!r.points || !r.points.length) continue;
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
            for (let i = 0; i < r.points.length; i++) {
              const p = r.points[i];
              const x = Array.isArray(p) ? p[0] : p.x;
              const z = Array.isArray(p) ? (p.length > 2 ? p[2] : p[1]) : p.z;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (z < minZ) minZ = z;
              if (z > maxZ) maxZ = z;
            }
            r._bbox = { minX, maxX, minZ, maxZ };
          }
          this._miniDrivableRoutes = this.routesData.routes.filter(
            (r) => (!r.layer || r.layer === 'ground') && !r.id.startsWith('overpass_bridge') && r.id !== 'alpine_tunnel'
          );
          this._miniBridgeSegments = this.routesData.routes.filter(
            (r) => r.layer === 'elevated' || r.id.startsWith('overpass_bridge')
          );
          this._miniTunnelSegments = this.routesData.routes.filter(
            (r) => r.layer === 'tunnel' || r.id === 'alpine_tunnel'
          );
        }
        if (this.routesData.world_bounds) {
          const wb = this.routesData.world_bounds;
          this.bounds.minX = wb.min_x;
          this.bounds.maxX = wb.max_x;
          this.bounds.spanX = wb.span_x;
          this.bounds.minZ = wb.min_z;
          this.bounds.maxZ = wb.max_z;
          this.bounds.spanZ = wb.span_z;
        }
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
   * Renders authentic Forza Horizon-style vector road lines with multi-pass cartographic
   * layering (all dark casings first, then all white road cores on top) so every T-junction
   * across the entire map merges into a single seamless white road network with zero black dividers,
   * while elevated overpass bridges cleanly cross over ground roads with drop shadows.
   */
  renderVectorRoads(routes) {
    if (!this.roadsGroupEl || !routes) return;
    this.roadsGroupEl.innerHTML = '';

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

    const drawCasing = (route, isHwy) => {
      if (!route.points || route.points.length < 2) return;
      const d = toPathD(route.points, isHwy);
      const isNarrow = route.type === 'narrow';
      const casingW = isHwy ? '11.5' : (isNarrow ? '6.4' : '8.5');

      const casing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      casing.setAttribute('d', d);
      casing.setAttribute('fill', 'none');
      casing.setAttribute('stroke', '#0c1017');
      casing.setAttribute('stroke-width', casingW);
      casing.setAttribute('stroke-linecap', 'round');
      casing.setAttribute('stroke-linejoin', 'round');
      casing.setAttribute('opacity', '0.96');
      this.roadsGroupEl.appendChild(casing);
    };

    const drawCore = (route, isHwy) => {
      if (!route.points || route.points.length < 2) return;
      const d = toPathD(route.points, isHwy);
      const isNarrow = route.type === 'narrow';
      const coreW = isHwy ? '7.0' : (isNarrow ? '3.6' : '5.0');

      const core = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      core.setAttribute('d', d);
      core.setAttribute('fill', 'none');
      core.setAttribute('stroke', '#ffffff');
      core.setAttribute('stroke-width', coreW);
      core.setAttribute('stroke-linecap', 'round');
      core.setAttribute('stroke-linejoin', 'round');
      core.setAttribute('opacity', '1.0');
      this.roadsGroupEl.appendChild(core);
    };

    const drivableRoutes = routes.filter(
      (r) => (!r.layer || r.layer === 'ground') && !r.id.startsWith('overpass_bridge') && r.id !== 'alpine_tunnel'
    );
    const isRouteClosed = (r) => Boolean(r.closed || r.id === 'hwy');
    const isElevatedCrossing = (r) => r.id === 'overpass' || r.id === 'hwy_west' || r.id === 'autumn_loop';
    const highways = drivableRoutes.filter((r) => r.type === 'highway');

    // PASS 1: Render ALL dark outer road casings first (underneath all white cores!)
    for (const r of drivableRoutes) {
      drawCasing(r, isRouteClosed(r));
    }

    // PASS 2: Render ground road white cores on top of casings so every T-junction fuses seamlessly!
    for (const r of highways) {
      if (!isElevatedCrossing(r)) {
        drawCore(r, isRouteClosed(r));
      }
    }
    for (const r of drivableRoutes) {
      if (r.type === 'highway' || isElevatedCrossing(r)) continue;
      drawCore(r, false);
    }

    // PASS 3: Render subtle Alpine Tunnel bore overlay on Touge summit
    const tunnels = routes.filter((r) => r.layer === 'tunnel');
    for (const tun of tunnels) {
      if (tun.points && tun.points.length >= 2) {
        const dTun = toPathD(tun.points, false);
        const tunDash = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tunDash.setAttribute('d', dTun);
        tunDash.setAttribute('fill', 'none');
        tunDash.setAttribute('stroke', '#4a5568');
        tunDash.setAttribute('stroke-width', '3.2');
        tunDash.setAttribute('stroke-dasharray', '5, 6');
        tunDash.setAttribute('stroke-linecap', 'round');
        tunDash.setAttribute('opacity', '0.75');
        this.roadsGroupEl.appendChild(tunDash);
      }
    }

    // PASS 4: Render bridge drop-shadows & butt-capped casings across elevated bridges
    const bridges = routes.filter((r) => r.layer === 'elevated' || r.id.startsWith('overpass_bridge'));
    for (const bridge of bridges) {
      if (bridge.points && bridge.points.length >= 2) {
        const dBridge = toPathD(bridge.points, false);
        const rType = bridge.road_type || 'secondary';
        const bShadowW = rType === 'highway' ? '12.0' : (rType === 'narrow' ? '6.8' : '8.8');
        const bCasingW = rType === 'highway' ? '11.5' : (rType === 'narrow' ? '6.4' : '8.5');

        const shadowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shadowPath.setAttribute('d', dBridge);
        shadowPath.setAttribute('fill', 'none');
        shadowPath.setAttribute('stroke', 'rgba(0, 0, 0, 0.58)');
        shadowPath.setAttribute('stroke-width', bShadowW);
        shadowPath.setAttribute('stroke-linecap', 'butt');
        shadowPath.setAttribute('stroke-linejoin', 'round');
        shadowPath.setAttribute('filter', 'url(#bridge-drop-shadow)');
        this.roadsGroupEl.appendChild(shadowPath);

        const bridgeCasing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        bridgeCasing.setAttribute('d', dBridge);
        bridgeCasing.setAttribute('fill', 'none');
        bridgeCasing.setAttribute('stroke', '#0c1017');
        bridgeCasing.setAttribute('stroke-width', bCasingW);
        bridgeCasing.setAttribute('stroke-linecap', 'butt');
        bridgeCasing.setAttribute('stroke-linejoin', 'round');
        bridgeCasing.setAttribute('opacity', '0.96');
        this.roadsGroupEl.appendChild(bridgeCasing);
      }
    }

    // PASS 5: Render white road cores continuously end-to-end for all routes with bridges
    //         so bridge spans merge seamlessly into ground approaches with zero seam notches!
    for (const r of drivableRoutes) {
      if (isElevatedCrossing(r) || r.id === 'hwy' || r.id === 'east_ridge') {
        drawCore(r, isRouteClosed(r));
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
    if (this.hudMinimapWrapEl) {
      this.hudMinimapWrapEl.addEventListener('click', () => this.setOpen(true));
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
    if (this.controlsToggleBtnEl && this.controlsCardEl) {
      this.controlsToggleBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.controlsCardEl.classList.toggle('collapsed');
      });
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

          if (this.pointerDist > 4) {
            this.targetPanX += dx;
            this.targetPanY += dy;
            this.velX = dx;
            this.velY = dy;
            if (this.roadHoverDotEl) this.roadHoverDotEl.classList.add('hidden');
          }
          return;
        }

        // Road Hover Check (Only when map is open and routes are loaded)
        if (!this.isOpen || !this.routesData) return;
        const rect = this.viewportEl.getBoundingClientRect();
        const mapPxX = (e.clientX - rect.left - this.panX) / this.scale;
        const mapPxY = (e.clientY - rect.top - this.panY) / this.scale;
        const world = this.mapPxToWorld(mapPxX, mapPxY);

        const maxSnapDist = Math.max(12.5, 16.0 / Math.sqrt(Math.max(0.35, this.scale)));
        const roadMatch = this.getClosestRoadPoint(world.x, world.z);
        if (roadMatch && roadMatch.dist <= maxSnapDist) {
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

        // Road Click to Waypoint: Set waypoint when clicking on any road across the map
        if (this.pointerDist < 9 &&
            !e.target.closest('.map-poi-pin') &&
            !e.target.closest('.poi-track-btn') &&
            !e.target.closest('.map-actions-group') &&
            !e.target.closest('.map-waypoint-marker') &&
            !e.target.closest('.map-gps-hud')) {
          const maxSnapDist = Math.max(12.5, 16.0 / Math.sqrt(Math.max(0.35, this.scale)));
          let match = this.hoveredRoad;
          if (!match || match.dist > maxSnapDist) {
            const rect = this.viewportEl.getBoundingClientRect();
            const mapPxX = (e.clientX - rect.left - this.panX) / this.scale;
            const mapPxY = (e.clientY - rect.top - this.panY) / this.scale;
            const world = this.mapPxToWorld(mapPxX, mapPxY);
            match = this.getClosestRoadPoint(world.x, world.z);
          }
          if (match && match.dist <= maxSnapDist) {
            const pt = match.point;
            const routeName = this.getRouteDisplayName(match.route.id);
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
    const pauseOpen = window.__pauseMenu && window.__pauseMenu.isOpen;
    if (this.hudMinimapWrapEl) {
      this.hudMinimapWrapEl.classList.toggle('hidden', open || pauseOpen);
    }
    if (this.hudPausePromptEl) {
      this.hudPausePromptEl.classList.toggle('hidden', open || pauseOpen);
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
          this.coordValEl.textContent = `${pos.x.toFixed(1)}m, ${pos.z.toFixed(1)}m`;
        }
        if (this.speedValEl) {
          this.speedValEl.textContent = '0 MPH (0 KM/H)';
        }
      }
      // Instantly center on player car when opening
      this.centerOnPlayer(0.85);
      // Snap pan to target to prevent jarring jumps
      this.panX = this.targetPanX;
      this.panY = this.targetPanY;
      this.scale = this.targetScale;

      // Immediately recompute & sync active GPS route from current car position
      if (this.gpsNav && this.gpsNav.activeWaypoint) {
        if (this.vehicle && this.vehicle.rootGroup) {
          this.gpsNav.update(this.vehicle.rootGroup.position);
        }
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
          this.coordValEl.textContent = `${carPos.x.toFixed(1)}m, ${carPos.z.toFixed(1)}m`;
        }
        if (this.speedValEl) {
          const mph = Math.round((carSpeedKmh || 0) * 0.621371);
          const kmh = Math.round(carSpeedKmh || 0);
          this.speedValEl.textContent = `${mph} MPH (${kmh} KM/H)`;
        }
      }
    }

    // 2. Real-Time GPS Telemetry Distance Updates & FH6 Circular Radar Mini-Map
    if (this.gpsNav && this.gpsNav.activeWaypoint) {
      const remDist = this.gpsNav.remainingDistance;
      const distStr = remDist >= 1000 ? `${(remDist / 1000).toFixed(1)} KM` : `${Math.round(remDist)} M`;
      if (this.gpsTargetDistEl) this.gpsTargetDistEl.textContent = distStr;
      if (this.hudGpsDistEl) this.hudGpsDistEl.textContent = distStr;
      if (this.waypointTagEl) this.waypointTagEl.textContent = `${this.gpsNav.activeWaypoint.name} • ${distStr}`;
      if (this.hudMinimapStatusEl) this.hudMinimapStatusEl.textContent = distStr;
      if (this.hudMinimapDotEl) this.hudMinimapDotEl.classList.remove('idle');
    } else {
      if (this.hudMinimapStatusEl) this.hudMinimapStatusEl.textContent = 'FREE ROAM';
      if (this.hudMinimapDotEl) this.hudMinimapDotEl.classList.add('idle');
    }

    if (!this.isOpen && !(window.__pauseMenu && window.__pauseMenu.isOpen)) {
      this.renderHudMiniMap(carPos, carSpeedKmh, carHeadingDir);
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

  renderHudMiniMap(carPos, carSpeedKmh = 0, carHeadingDir = null) {
    if (!this.hudMinimapCtx || !this.hudMinimapCanvasEl || !carPos) return;

    const ctx = this.hudMinimapCtx;
    const W = this.hudMinimapCanvasEl.width;
    const H = this.hudMinimapCanvasEl.height;
    const R = W * 0.5;

    // 1. Smoothly track the car's forward unit vector in XZ
    if (carHeadingDir) {
      const hLen = Math.hypot(carHeadingDir.x, carHeadingDir.z) || 1;
      const tx = carHeadingDir.x / hLen;
      const tz = carHeadingDir.z / hLen;
      this.miniFwdX += (tx - this.miniFwdX) * 0.24;
      this.miniFwdZ += (tz - this.miniFwdZ) * 0.24;
      const mLen = Math.hypot(this.miniFwdX, this.miniFwdZ) || 1;
      this.miniFwdX /= mLen;
      this.miniFwdZ /= mLen;
    }

    const fwdX = this.miniFwdX;
    const fwdZ = this.miniFwdZ;
    // In Three.js (X right, Z South), turning 90 deg clockwise from (fwdX, fwdZ) gives Right = (-fwdZ, fwdX)
    const rightX = -fwdZ;
    const rightZ = fwdX;

    // Dynamic speed-adaptive radar zoom (much closer/zoomed-in, zooms out smoothly at high speed)
    const speedFactor = Math.min(1.0, Math.max(0.0, (carSpeedKmh || 0) / 210.0));
    const targetScale = 3.85 - speedFactor * 0.95;
    this.miniRadarScale += (targetScale - this.miniRadarScale) * 0.14;
    const scale = this.miniRadarScale;

    // Player delta sits at (50%, 70%) inside the circle so ~70% of the disc shows the road ahead
    const cx = W * 0.50;
    const cy = H * 0.70;

    // 3D tilted forward-up radar projection (strong Forza Horizon 6 angled perspective radar)
    const projectPt = (wx, wz) => {
      const dx = wx - carPos.x;
      const dz = wz - carPos.z;
      const localRight = dx * rightX + dz * rightZ;
      const localFwd = dx * fwdX + dz * fwdZ;
      const clampedFwd = Math.max(-58.0, localFwd);
      const persp = 1.0 / (1.0 + clampedFwd * 0.0072);
      return {
        x: cx + localRight * scale * persp,
        y: cy - localFwd * scale * 0.56 * persp,
        persp,
        localFwd,
        localRight
      };
    };

    ctx.clearRect(0, 0, W, H);
    ctx.save();

    const drivableRoutes = this._miniDrivableRoutes || [];
    const isRouteClosed = (r) => Boolean(r.closed || r.id === 'hwy');
    const isElevatedCrossing = (r) => r.id === 'overpass' || r.id === 'hwy_west' || r.id === 'autumn_loop';
    const bridgeSegments = this._miniBridgeSegments || [];
    const tunnelSegments = this._miniTunnelSegments || [];

    // Forward-shifted directional cull box: skips roads behind the car (-110m behind)
    // while keeping the entire forward perspective horizon (+840m ahead) seamless
    const cullCenterX = carPos.x + fwdX * 320.0;
    const cullCenterZ = carPos.z + fwdZ * 320.0;
    const cullMinX = cullCenterX - 580.0;
    const cullMaxX = cullCenterX + 580.0;
    const cullMinZ = cullCenterZ - 580.0;
    const cullMaxZ = cullCenterZ + 580.0;

    const drawPerspectivePolyline = (pts, baseWidth, strokeStyle, closeLoop = false, lineCap = 'round', stride = 3) => {
      if (!pts || pts.length < 2) return;
      ctx.strokeStyle = strokeStyle;
      ctx.lineCap = lineCap;
      ctx.lineJoin = 'round';

      const len = pts.length;
      const maxIdx = closeLoop ? len : len - 1;
      let pathOpen = false;
      let lastWidth = -1;
      let prevEndX = 1e9;
      let prevEndY = 1e9;

      for (let i = 0; i < maxIdx; i += stride) {
        const nextIdx = i + stride;
        const j = nextIdx < len ? nextIdx : (closeLoop ? nextIdx % len : len - 1);
        if (!closeLoop && j === i) break;

        const a = pts[i];
        const b = pts[j];
        const ax = Array.isArray(a) ? a[0] : a.x;
        const az = Array.isArray(a) ? (a.length > 2 ? a[2] : a[1]) : a.z;
        const bx = Array.isArray(b) ? b[0] : b.x;
        const bz = Array.isArray(b) ? (b.length > 2 ? b[2] : b[1]) : b.z;

        const adx = ax - carPos.x;
        const adz = az - carPos.z;
        const alf = adx * fwdX + adz * fwdZ;
        const bdx = bx - carPos.x;
        const bdz = bz - carPos.z;
        const blf = bdx * fwdX + bdz * fwdZ;

        // Cull segments completely behind the car or beyond the forward horizon
        if ((alf < -110.0 && blf < -110.0) || (alf > 840.0 && blf > 840.0)) {
          continue;
        }

        const alr = adx * rightX + adz * rightZ;
        const blr = bdx * rightX + bdz * rightZ;
        if ((alr < -380.0 && blr < -380.0) || (alr > 380.0 && blr > 380.0)) {
          continue;
        }

        const acf = alf < -58.0 ? -58.0 : alf;
        const ap = 1.0 / (1.0 + acf * 0.0072);
        const p0x = cx + alr * scale * ap;
        const p0y = cy - alf * scale * 0.56 * ap;

        const bcf = blf < -58.0 ? -58.0 : blf;
        const bp = 1.0 / (1.0 + bcf * 0.0072);
        const p1x = cx + blr * scale * bp;
        const p1y = cy - blf * scale * 0.56 * bp;

        if (
          (p0x < -90 && p1x < -90) ||
          (p0x > W + 90 && p1x > W + 90) ||
          (p0y < -90 && p1y < -90) ||
          (p0y > H + 90 && p1y > H + 90)
        ) {
          continue;
        }

        const segPersp = Math.max(0.30, Math.min(1.55, (ap + bp) * 0.5));
        const w = baseWidth * segPersp;

        // Flush only when width shifts by >0.35px (sub-pixel smooth tapering, zero visible steps)
        if (!pathOpen || Math.abs(w - lastWidth) > 0.35) {
          if (pathOpen) ctx.stroke();
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(p0x, p0y);
          ctx.lineTo(p1x, p1y);
          lastWidth = w;
          pathOpen = true;
        } else {
          if (Math.abs(p0x - prevEndX) > 0.5 || Math.abs(p0y - prevEndY) > 0.5) {
            ctx.moveTo(p0x, p0y);
          }
          ctx.lineTo(p1x, p1y);
        }
        prevEndX = p1x;
        prevEndY = p1y;
      }

      if (pathOpen) {
        ctx.stroke();
      }
    };

    const routeNearCar = (r) => {
      if (!r._bbox) return true;
      return !(r._bbox.maxX < cullMinX || r._bbox.minX > cullMaxX || r._bbox.maxZ < cullMinZ || r._bbox.minZ > cullMaxZ);
    };

    const getRoadCoreWidth = (r) => {
      if (r.type === 'highway' || r.id === 'hwy' || r.id === 'hwy_west') return 19.5;
      if (r.type === 'narrow' || r.id === 'east_ridge' || r.id === 'canyon_cut' || r.id === 'autumn_loop') return 11.5;
      return 15.0;
    };

    // PASS 1: All ground road dark casings first (merges all T-junctions seamlessly)
    for (const r of drivableRoutes) {
      if (!routeNearCar(r)) continue;
      const isClosed = isRouteClosed(r);
      const coreW = getRoadCoreWidth(r);
      drawPerspectivePolyline(r.points, coreW + 6.5, 'rgba(10, 14, 20, 0.96)', isClosed, 'round', 3);
    }

    // PASS 2: All ground road cores in unified crisp silver-white (highways first, then secondary/narrow)
    for (const r of drivableRoutes) {
      if (r.type === 'highway' && !isElevatedCrossing(r) && routeNearCar(r)) {
        drawPerspectivePolyline(r.points, getRoadCoreWidth(r), '#f2f5f9', isRouteClosed(r), 'round', 3);
      }
    }
    for (const r of drivableRoutes) {
      if (r.type === 'highway' || isElevatedCrossing(r) || !routeNearCar(r)) continue;
      drawPerspectivePolyline(r.points, getRoadCoreWidth(r), '#f2f5f9', false, 'round', 3);
    }

    // PASS 2.5: Subtle dashed tunnel bore overlay on Alpine Summit
    for (const tun of tunnelSegments) {
      if (!routeNearCar(tun)) continue;
      ctx.save();
      ctx.setLineDash([10, 11]);
      drawPerspectivePolyline(tun.points, 9.5, 'rgba(74, 85, 104, 0.85)', false, 'round', 3);
      ctx.restore();
    }

    // PASS 3: Elevated overpass bridge deck casings & continuous white cores across ALL routes with bridges
    for (const b of bridgeSegments) {
      if (!routeNearCar(b)) continue;
      const bCoreW = getRoadCoreWidth({ type: b.road_type || 'secondary', id: b.id });
      drawPerspectivePolyline(b.points, bCoreW + 10.0, 'rgba(0, 0, 0, 0.35)', false, 'round', 3);
      drawPerspectivePolyline(b.points, bCoreW + 6.5, '#0c1017', false, 'round', 3);
    }
    for (const r of drivableRoutes) {
      if ((isElevatedCrossing(r) || r.id === 'hwy' || r.id === 'east_ridge') && routeNearCar(r)) {
        drawPerspectivePolyline(r.points, getRoadCoreWidth(r), '#f8fafc', isRouteClosed(r), 'round', 3);
      }
    }

    // PASS 4: Active GPS Route Ribbon in Forza Cyan (#18e4ff) with lightweight outer glow stroke
    const gpsPath = this.gpsNav && this.gpsNav.activePath;
    if (gpsPath && gpsPath.length >= 2) {
      drawPerspectivePolyline(gpsPath, 22.0, 'rgba(24, 228, 255, 0.28)', false, 'round', 2);
      drawPerspectivePolyline(gpsPath, 19.0, 'rgba(7, 30, 40, 0.94)', false, 'round', 2);
      drawPerspectivePolyline(gpsPath, 14.0, '#18e4ff', false, 'round', 2);
    }

    // PASS 5: Soft radial edge feather mask so roads fade smoothly before touching the outer white bezel ring
    ctx.globalCompositeOperation = 'destination-in';
    const featherGrad = ctx.createRadialGradient(R, R, R * 0.72, R, R, R * 0.965);
    featherGrad.addColorStop(0.0, 'rgba(0, 0, 0, 1)');
    featherGrad.addColorStop(0.76, 'rgba(0, 0, 0, 0.90)');
    featherGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = featherGrad;
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    // PASS 6: Upright Landmark POI badges inside the radar
    const landmarks = (this.routesData && this.routesData.landmarks) ? this.routesData.landmarks : [];
    for (const lm of landmarks) {
      const p = projectPt(lm.x, lm.z);
      const distFromCenter = Math.hypot(p.x - R, p.y - R);
      if (distFromCenter > R * 0.84) continue;

      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 10.0, 0, Math.PI * 2);
      const cat = lm.type || lm.category || '';
      ctx.fillStyle = cat === 'festival' ? '#e11d48' : cat === 'speedway' ? '#7c3aed' : cat === 'mountain' ? '#ea580c' : '#2563eb';
      ctx.fill();
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }

    // Active GPS Destination bullseye (clamped to radar rim if far away)
    if (this.gpsNav && this.gpsNav.activeWaypoint) {
      const wp = this.gpsNav.activeWaypoint;
      const p = projectPt(wp.x, wp.z);
      let tx = p.x;
      let ty = p.y;
      const dx = tx - R;
      const dy = ty - R;
      const dist = Math.hypot(dx, dy);
      const maxRim = R * 0.85;
      if (dist > maxRim && dist > 1e-4) {
        tx = R + (dx / dist) * maxRim;
        ty = R + (dy / dist) * maxRim;
      }

      ctx.save();
      ctx.beginPath();
      ctx.arc(tx, ty, 11.5, 0, Math.PI * 2);
      ctx.fillStyle = '#09222c';
      ctx.fill();
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = '#18e4ff';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(tx, ty, 4.8, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    }

    // PASS 7: Perspective-Skewed Notched White Player Delta Arrow at (cx, cy) matching the tilted road plane
    ctx.save();
    ctx.translate(cx, cy);

    const projectArrowVert = (ax, ay) => {
      // ay is forward (+up is negative screen Y): match the 3D radar tilt (0.56) & perspective taper
      const tiltY = ay * 0.58;
      const persp = 1.0 / (1.0 - tiltY * 0.0085);
      return {
        x: ax * persp,
        y: tiltY * persp
      };
    };

    const tip = projectArrowVert(0, -33.0);
    const rightWing = projectArrowVert(25.0, 21.0);
    const notch = projectArrowVert(0, 9.0);
    const leftWing = projectArrowVert(-25.0, 21.0);

    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(rightWing.x, rightWing.y);
    ctx.lineTo(notch.x, notch.y);
    ctx.lineTo(leftWing.x, leftWing.y);
    ctx.closePath();

    ctx.lineJoin = 'round';
    ctx.lineWidth = 7.2;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 4.6;
    ctx.strokeStyle = '#10141d';
    ctx.stroke();
    ctx.restore();

    // PASS 8: Orbiting North ("N") Compass Indicator along the inner bezel rim
    // World North is (0, -1): localRight_N = -rightZ = -fwdX, localFwd_N = -fwdZ => screen dir = (-fwdX, fwdZ)
    const nx = -fwdX;
    const ny = fwdZ;
    const nOrbitR = R - 23;
    const nPosX = R + nx * nOrbitR;
    const nPosY = R + ny * nOrbitR;

    ctx.save();
    ctx.beginPath();
    ctx.arc(nPosX, nPosY, 13.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(14, 18, 26, 0.85)';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.stroke();

    ctx.font = '800 15px "Outfit", -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('N', nPosX, nPosY + 0.5);
    ctx.restore();

    ctx.restore();
  }
}

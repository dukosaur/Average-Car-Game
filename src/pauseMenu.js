/**
 * Forza Horizon "Apple Glass" Pause Menu Controller
 * ==================================================
 * Features:
 *  - Apple-grade frosted glass aesthetic with dual specular rim lighting
 *  - Central hero World Map tile with live satellite map crop & vehicle reticle
 *  - Dedicated Cars Showroom with real car render thumbnails and instant swap
 *  - Reset Vehicle action (flips car upright onto nearest road centerline)
 *  - Camera mode switcher & Performance (Grass density) settings
 *  - Full 2D grid keyboard navigation (WASD / Arrow Keys, Enter, Esc)
 *  - Completely soundless, zero emojis, clean high-contrast motorsport typography
 */

export class PauseMenuController {
  constructor({
    vehicle,
    input,
    worldMap,
    carRoster,
    selectCarFn,
    getActiveCarIndexFn,
    cameraModes,
    selectCameraModeFn,
    getCurrentCamIndexFn,
    setGrassDensityFn,
    getGrassDensityFn
  }) {
    this.vehicle = vehicle;
    this.input = input;
    this.worldMap = worldMap;
    this.carRoster = carRoster || [];
    this.selectCarFn = selectCarFn;
    this.getActiveCarIndexFn = getActiveCarIndexFn;
    this.cameraModes = cameraModes || [];
    this.selectCameraModeFn = selectCameraModeFn;
    this.getCurrentCamIndexFn = getCurrentCamIndexFn;
    this.setGrassDensityFn = setGrassDensityFn;
    this.getGrassDensityFn = getGrassDensityFn;

    this.isOpen = false;
    this.currentView = 'main'; // 'main' | 'cars' | 'settings'
    this.focusedTileIndex = 1; // Default focus to Hero World Map (Tile 1)
    this.focusedCarIndex = 0;

    // Map bounds matching WorldMapController (2048x1920, ortho_scale=1800)
    this.mapBounds = {
      minX: -900.0,
      maxX: 900.0,
      spanX: 1800.0,
      minZ: -843.75,
      maxZ: 843.75,
      spanZ: 1687.5,
      imgW: 2048.0,
      imgH: 1920.0
    };

    // DOM Elements
    this.overlayEl = document.getElementById('pause-menu-overlay');
    this.mainViewEl = document.getElementById('pause-main-view');
    this.carsViewEl = document.getElementById('pause-cars-view');
    this.settingsViewEl = document.getElementById('pause-settings-view');

    this.headerCarNameEl = document.getElementById('pause-header-car-name');
    this.headerSpeedEl = document.getElementById('pause-header-speed');
    this.headerSectorEl = document.getElementById('pause-header-sector');

    // Tiles
    this.tileGarageEl = document.getElementById('pause-tile-garage');
    this.tileMapEl = document.getElementById('pause-tile-map');
    this.tileCamEl = document.getElementById('pause-tile-camera');
    this.tileResetEl = document.getElementById('pause-tile-reset');
    this.tileSettingsEl = document.getElementById('pause-tile-settings');
    this.tiles = [
      this.tileGarageEl,
      this.tileMapEl,
      this.tileCamEl,
      this.tileResetEl,
      this.tileSettingsEl
    ];

    // Mini Map Elements in Hero Tile
    this.miniMapViewportEl = document.querySelector('.pause-mini-map-viewport');
    this.miniMapPlaneEl = document.getElementById('pause-mini-map-plane');
    this.miniMapMarkerEl = document.getElementById('pause-mini-map-marker');
    this.miniMapArrowEl = document.getElementById('pause-mini-map-arrow');
    this.miniMapRoadsGroupEl = document.getElementById('pause-mini-map-roads-group');
    this.miniMapGpsGroupEl = document.getElementById('pause-mini-map-gps-group');
    this.miniMapLandmarksEl = document.getElementById('pause-mini-map-landmarks');
    this.miniMapWaypointEl = document.getElementById('pause-mini-map-waypoint');

    // Live previews in tiles
    this.tileGarageImgEl = document.getElementById('pause-garage-current-img');
    this.tileGarageNameEl = document.getElementById('pause-garage-current-name');
    this.tileCamNameEl = document.getElementById('pause-cam-current-name');
    this.tileCamDotsEl = document.getElementById('pause-cam-dots');

    // Cars Grid in Showroom
    this.carsGridEl = document.getElementById('pause-cars-grid');
    this.carsBackBtnEl = document.getElementById('pause-cars-back-btn');

    // Settings Subview
    this.settingsBackBtnEl = document.getElementById('pause-settings-back-btn');
    this.grassOptionBtns = document.querySelectorAll('.pause-grass-opt-btn');

    // Minimalist HUD Pause Prompt (Top-Left) & Circular Mini-Map (Bottom-Left)
    this.hudPausePromptEl = document.getElementById('hud-pause-prompt');
    this.hudMinimapWrapEl = document.getElementById('hud-minimap-wrap');
    this.hudPauseBtnEl = document.getElementById('hud-pause-btn');
    this.footerPromptsEl = document.getElementById('pause-footer-prompts');

    this.init();
  }

  init() {
    this.buildCarsGrid();
    this.buildCameraDots();
    this.bindEvents();
    this.initParallax();
    this.updateFocusedTile(1);
  }

  initParallax() {
    if (!this.overlayEl) return;
    const shell = this.overlayEl.querySelector('.pause-menu-shell');
    if (!shell) return;

    this.overlayEl.addEventListener('mousemove', (e) => {
      if (!this.isOpen) return;
      const xNorm = (e.clientX / window.innerWidth - 0.5) * 2;
      const yNorm = (e.clientY / window.innerHeight - 0.5) * 2;
      const rotY = xNorm * 1.4;
      const rotX = -yNorm * 1.4;
      shell.style.transform = `perspective(1200px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
    });

    this.overlayEl.addEventListener('mouseleave', () => {
      shell.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg)';
    });
  }

  worldToMapPx(wx, wz) {
    if (this.worldMap && typeof this.worldMap.worldToMapPx === 'function') {
      return this.worldMap.worldToMapPx(wx, wz);
    }
    const px = ((wx - this.mapBounds.minX) / this.mapBounds.spanX) * this.mapBounds.imgW;
    const py = ((wz - this.mapBounds.minZ) / this.mapBounds.spanZ) * this.mapBounds.imgH;
    return { x: px, y: py };
  }

  buildCarsGrid() {
    if (!this.carsGridEl || !this.carRoster) return;
    this.carsGridEl.innerHTML = '';

    const activeIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;

    this.carRoster.forEach((car, idx) => {
      const card = document.createElement('div');
      card.className = `pause-car-card ${idx === activeIdx ? 'active' : ''}`;
      card.dataset.carIndex = idx;
      card.innerHTML = `
        <div class="pause-car-thumb-wrap">
          <img class="pause-car-thumb" src="${car.thumb}" alt="${car.name}" />
        </div>
        <div class="pause-car-info">
          <div class="pause-car-name">${car.name}</div>
          <div class="pause-car-fullname">${car.fullName}</div>
          <div class="pause-car-badge ${idx === activeIdx ? 'active' : ''}">
            ${idx === activeIdx ? 'CURRENTLY DRIVING' : 'SELECT VEHICLE'}
          </div>
        </div>
      `;

      card.addEventListener('mouseenter', () => {
        this.updateCarFocus(idx);
      });

      card.addEventListener('click', () => {
        this.selectCar(idx);
      });

      this.carsGridEl.appendChild(card);
    });
  }

  buildCameraDots() {
    if (!this.tileCamDotsEl || !this.cameraModes) return;
    this.tileCamDotsEl.innerHTML = '';
    const currentIdx = this.getCurrentCamIndexFn ? this.getCurrentCamIndexFn() : 0;
    this.cameraModes.forEach((_, idx) => {
      const dot = document.createElement('span');
      dot.className = `pause-cam-dot ${idx === currentIdx ? 'active' : ''}`;
      this.tileCamDotsEl.appendChild(dot);
    });
  }

  bindEvents() {
    // Minimalist HUD Pause Prompt (Bottom-Left)
    if (this.hudPausePromptEl) {
      this.hudPausePromptEl.addEventListener('click', () => {
        this.setOpen(true);
      });
      this.hudPausePromptEl.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          this.setOpen(true);
          e.preventDefault();
        }
      });
    }

    // Legacy HUD Pause Button fallback
    if (this.hudPauseBtnEl) {
      this.hudPauseBtnEl.addEventListener('click', () => {
        this.setOpen(!this.isOpen);
      });
    }

    // Tile Click Actions
    if (this.tileGarageEl) {
      this.tileGarageEl.addEventListener('click', () => this.showView('cars'));
      this.tileGarageEl.addEventListener('mouseenter', () => this.updateFocusedTile(0));
    }

    if (this.tileMapEl) {
      this.tileMapEl.addEventListener('click', () => this.openWorldMap());
      this.tileMapEl.addEventListener('mouseenter', () => this.updateFocusedTile(1));
    }

    if (this.tileCamEl) {
      this.tileCamEl.addEventListener('click', () => this.cycleCamera());
      this.tileCamEl.addEventListener('mouseenter', () => this.updateFocusedTile(2));
    }

    if (this.tileResetEl) {
      this.tileResetEl.addEventListener('click', () => this.resetVehicle());
      this.tileResetEl.addEventListener('mouseenter', () => this.updateFocusedTile(3));
    }

    if (this.tileSettingsEl) {
      this.tileSettingsEl.addEventListener('click', () => this.showView('settings'));
      this.tileSettingsEl.addEventListener('mouseenter', () => this.updateFocusedTile(4));
    }

    // Subview Back Buttons
    if (this.carsBackBtnEl) {
      this.carsBackBtnEl.addEventListener('click', () => this.showView('main'));
    }
    if (this.settingsBackBtnEl) {
      this.settingsBackBtnEl.addEventListener('click', () => this.showView('main'));
    }

    // Grass Density Options
    if (this.grassOptionBtns) {
      this.grassOptionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const density = btn.dataset.density;
          if (this.setGrassDensityFn) {
            this.setGrassDensityFn(density);
          }
          this.updateGrassButtons(density);
        });
      });
    }

    // Clicking outside modal content / on overlay backdrop resumes
    if (this.overlayEl) {
      this.overlayEl.addEventListener('click', (e) => {
        if (e.target === this.overlayEl) {
          this.setOpen(false);
        }
      });
    }
  }

  updateGrassButtons(activeDensity) {
    if (!this.grassOptionBtns) return;
    this.grassOptionBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.density === activeDensity);
    });
  }

  showView(viewName) {
    this.currentView = viewName;
    if (this.mainViewEl) this.mainViewEl.classList.toggle('hidden', viewName !== 'main');
    if (this.carsViewEl) this.carsViewEl.classList.toggle('hidden', viewName !== 'cars');
    if (this.settingsViewEl) this.settingsViewEl.classList.toggle('hidden', viewName !== 'settings');

    if (viewName === 'cars') {
      const activeIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
      this.focusedCarIndex = activeIdx;
      this.updateCarFocus(activeIdx);
    } else if (viewName === 'main') {
      this.updateTilePreviews();
    }
    this.updateFooterPrompts();
  }

  updateFooterPrompts() {
    if (!this.footerPromptsEl) return;
    if (this.currentView === 'cars') {
      this.footerPromptsEl.innerHTML = `
        <div class="pause-footer-item"><span class="pause-key-badge">ENTER</span> EQUIP CAR</div>
        <div class="pause-footer-item"><span class="pause-key-badge">ESC</span> BACK TO MENU</div>
        <div class="pause-footer-item"><span class="pause-key-badge">A D / ARROWS</span> NAVIGATE FLEET</div>
      `;
    } else if (this.currentView === 'settings') {
      this.footerPromptsEl.innerHTML = `
        <div class="pause-footer-item"><span class="pause-key-badge">ESC</span> BACK TO MENU</div>
        <div class="pause-footer-item"><span class="pause-key-badge">CLICK</span> SELECT DENSITY PRESET</div>
      `;
    } else {
      this.footerPromptsEl.innerHTML = `
        <div class="pause-footer-item"><span class="pause-key-badge">ENTER</span> SELECT</div>
        <div class="pause-footer-item"><span class="pause-key-badge">ESC</span> RESUME</div>
        <div class="pause-footer-item"><span class="pause-key-badge">WASD / ARROWS</span> NAVIGATE</div>
        <div class="pause-footer-item"><span class="pause-key-badge">R</span> RESET POSITION</div>
        <div class="pause-footer-item"><span class="pause-key-badge">M</span> WORLD MAP</div>
      `;
    }
  }

  updateFocusedTile(index) {
    this.focusedTileIndex = Math.max(0, Math.min(this.tiles.length - 1, index));
    this.tiles.forEach((tile, idx) => {
      if (tile) {
        tile.classList.toggle('keyboard-focused', idx === this.focusedTileIndex);
      }
    });
  }

  updateCarFocus(index) {
    if (!this.carRoster) return;
    this.focusedCarIndex = Math.max(0, Math.min(this.carRoster.length - 1, index));
    if (!this.carsGridEl) return;
    const cards = this.carsGridEl.querySelectorAll('.pause-car-card');
    cards.forEach((c, idx) => {
      c.classList.toggle('keyboard-focused', idx === this.focusedCarIndex);
    });
  }

  handleKeyDown(e) {
    if (!this.isOpen) return false;

    // Cars Sub-View Navigation
    if (this.currentView === 'cars') {
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          this.updateCarFocus((this.focusedCarIndex - 1 + this.carRoster.length) % this.carRoster.length);
          e.preventDefault();
          return true;
        case 'ArrowRight':
        case 'KeyD':
          this.updateCarFocus((this.focusedCarIndex + 1) % this.carRoster.length);
          e.preventDefault();
          return true;
        case 'Enter':
        case 'Space':
          this.selectCar(this.focusedCarIndex);
          e.preventDefault();
          return true;
        case 'Escape':
        case 'Backspace':
          this.showView('main');
          e.preventDefault();
          return true;
      }
      return true;
    }

    // Settings Sub-View Navigation
    if (this.currentView === 'settings') {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        this.showView('main');
        e.preventDefault();
        return true;
      }
      return true;
    }

    // Main 5-Tile Grid 2D Navigation
    // 0: Garage (TL), 1: Map (Center Hero), 2: Camera (TR), 3: Reset (BL), 4: Settings (BR)
    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        if (this.focusedTileIndex === 3) this.updateFocusedTile(0);
        else if (this.focusedTileIndex === 4) this.updateFocusedTile(2);
        else this.updateFocusedTile(1);
        e.preventDefault();
        return true;

      case 'ArrowDown':
      case 'KeyS':
        if (this.focusedTileIndex === 0) this.updateFocusedTile(3);
        else if (this.focusedTileIndex === 2) this.updateFocusedTile(4);
        else if (this.focusedTileIndex === 1) this.updateFocusedTile(3);
        e.preventDefault();
        return true;

      case 'ArrowLeft':
      case 'KeyA':
        if (this.focusedTileIndex === 1) this.updateFocusedTile(0);
        else if (this.focusedTileIndex === 2) this.updateFocusedTile(1);
        else if (this.focusedTileIndex === 4) this.updateFocusedTile(3);
        e.preventDefault();
        return true;

      case 'ArrowRight':
      case 'KeyD':
        if (this.focusedTileIndex === 0) this.updateFocusedTile(1);
        else if (this.focusedTileIndex === 1) this.updateFocusedTile(2);
        else if (this.focusedTileIndex === 3) this.updateFocusedTile(4);
        e.preventDefault();
        return true;

      case 'Enter':
      case 'Space':
        this.activateFocusedTile();
        e.preventDefault();
        return true;

      case 'Escape':
        this.setOpen(false);
        e.preventDefault();
        return true;

      case 'KeyM':
        this.openWorldMap();
        e.preventDefault();
        return true;

      case 'KeyR':
        this.resetVehicle();
        e.preventDefault();
        return true;
    }

    return false;
  }

  activateFocusedTile() {
    switch (this.focusedTileIndex) {
      case 0: // Garage
        this.showView('cars');
        break;
      case 1: // World Map
        this.openWorldMap();
        break;
      case 2: // Camera
        this.cycleCamera();
        break;
      case 3: // Reset
        this.resetVehicle();
        break;
      case 4: // Settings
        this.showView('settings');
        break;
    }
  }

  cycleCamera() {
    if (!this.selectCameraModeFn || !this.getCurrentCamIndexFn || !this.cameraModes) return;
    const nextIdx = (this.getCurrentCamIndexFn() + 1) % this.cameraModes.length;
    this.selectCameraModeFn(nextIdx);
    this.updateCameraPreview();
  }

  resetVehicle() {
    if (this.vehicle && typeof this.vehicle.reset === 'function') {
      this.vehicle.reset();
      this.setOpen(false);
    }
  }

  openWorldMap() {
    this.setOpen(false);
    if (this.worldMap && typeof this.worldMap.setOpen === 'function') {
      this.worldMap.setOpen(true);
      if (typeof this.worldMap.centerOnPlayer === 'function') {
        this.worldMap.centerOnPlayer(0.90);
      }
    }
  }

  async selectCar(index) {
    if (this.selectCarFn) {
      await this.selectCarFn(index, false);
    }
    this.updateTilePreviews();
    this.buildCarsGrid();
    this.setOpen(false); // Seamlessly return to driving the chosen car
  }

  updateTilePreviews() {
    const activeIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
    const currentCar = this.carRoster[activeIdx];

    if (currentCar) {
      if (this.headerCarNameEl) this.headerCarNameEl.textContent = currentCar.fullName;
      if (this.tileGarageNameEl) this.tileGarageNameEl.textContent = currentCar.name;
      if (this.tileGarageImgEl) {
        this.tileGarageImgEl.src = currentCar.thumb;
        this.tileGarageImgEl.alt = currentCar.name;
      }
    }

    this.updateCameraPreview();
    this.updateMiniMapPreview();

    // Grass buttons state
    if (this.getGrassDensityFn) {
      this.updateGrassButtons(this.getGrassDensityFn());
    }
  }

  updateCameraPreview() {
    if (!this.getCurrentCamIndexFn || !this.cameraModes) return;
    const currentIdx = this.getCurrentCamIndexFn();
    const mode = this.cameraModes[currentIdx];
    if (mode && this.tileCamNameEl) {
      this.tileCamNameEl.textContent = mode.name;
    }
    if (this.tileCamDotsEl) {
      const dots = this.tileCamDotsEl.querySelectorAll('.pause-cam-dot');
      dots.forEach((dot, idx) => {
        dot.classList.toggle('active', idx === currentIdx);
      });
    }
  }

  syncRoads() {
    if (this.miniMapRoadsGroupEl && this.worldMap && this.worldMap.roadsGroupEl) {
      this.miniMapRoadsGroupEl.innerHTML = this.worldMap.roadsGroupEl.innerHTML;
    }
  }

  syncLandmarks() {
    if (this.miniMapLandmarksEl && this.worldMap && this.worldMap.landmarksLayerEl) {
      this.miniMapLandmarksEl.innerHTML = this.worldMap.landmarksLayerEl.innerHTML;
    }
  }

  syncGps() {
    if (this.miniMapGpsGroupEl && this.worldMap && this.worldMap.gpsGroupEl) {
      this.miniMapGpsGroupEl.innerHTML = this.worldMap.gpsGroupEl.innerHTML;
    }
    if (this.miniMapWaypointEl) {
      if (this.worldMap && this.worldMap.gpsNav && this.worldMap.gpsNav.activeWaypoint) {
        const wp = this.worldMap.gpsNav.activeWaypoint;
        const wpPx = this.worldToMapPx(wp.x, wp.z);
        this.miniMapWaypointEl.style.left = `${wpPx.x.toFixed(1)}px`;
        this.miniMapWaypointEl.style.top = `${wpPx.y.toFixed(1)}px`;
        this.miniMapWaypointEl.classList.remove('hidden');
      } else {
        this.miniMapWaypointEl.classList.add('hidden');
      }
    }
  }

  updateMiniMapPreview() {
    if (!this.vehicle || !this.vehicle.rootGroup || !this.miniMapPlaneEl) return;
    const pos = this.vehicle.rootGroup.position;
    const p = this.worldToMapPx(pos.x, pos.z);

    // Dynamic measurement of hero tile viewport
    const vpRect = this.miniMapViewportEl ? this.miniMapViewportEl.getBoundingClientRect() : { width: 540, height: 440 };
    const containerW = vpRect.width || 540;
    const containerH = vpRect.height || 440;
    // High-fidelity zoom tightly focused on player car, matching Forza Horizon 5 hero map card
    const miniScale = 0.90;

    let offsetX = containerW * 0.5 - p.x * miniScale;
    let offsetY = containerH * 0.5 - p.y * miniScale;

    // Viewport Edge Clamping: Ensure the satellite map covers 100% of the hero tile at all times.
    // When the vehicle is driving near the island perimeters (e.g. western hairpin loop),
    // the camera smoothly clamps at the image border so zero black void or cutoffs are ever exposed.
    const maxOffsetX = 0;
    const minOffsetX = Math.min(0, containerW - this.mapBounds.imgW * miniScale);
    const maxOffsetY = 0;
    const minOffsetY = Math.min(0, containerH - this.mapBounds.imgH * miniScale);

    offsetX = Math.min(maxOffsetX, Math.max(minOffsetX, offsetX));
    offsetY = Math.min(maxOffsetY, Math.max(minOffsetY, offsetY));

    this.miniMapPlaneEl.style.transform = `translate(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px) scale(${miniScale})`;

    // Position player marker (marker wrapper sits at p.x, p.y; heading arrow rotates inside)
    if (this.miniMapMarkerEl) {
      this.miniMapMarkerEl.style.left = `${p.x.toFixed(1)}px`;
      this.miniMapMarkerEl.style.top = `${p.y.toFixed(1)}px`;
    }

    if (this.miniMapArrowEl) {
      const carQuat = this.vehicle.rootGroup.quaternion;
      const headingX = 2 * (carQuat.x * carQuat.z + carQuat.w * carQuat.y);
      const headingZ = 1 - 2 * (carQuat.x * carQuat.x + carQuat.y * carQuat.y);
      const headingDeg = Math.atan2(headingX, -headingZ) * (180.0 / Math.PI);
      this.miniMapArrowEl.style.transform = `rotate(${headingDeg.toFixed(1)}deg)`;
    }

    // Sync roads from WorldMapController if not populated yet
    if (this.miniMapRoadsGroupEl && this.worldMap && this.worldMap.roadsGroupEl) {
      if (this.miniMapRoadsGroupEl.children.length === 0 && this.worldMap.roadsGroupEl.children.length > 0) {
        this.miniMapRoadsGroupEl.innerHTML = this.worldMap.roadsGroupEl.innerHTML;
      }
    }

    // Sync GPS routes
    if (this.miniMapGpsGroupEl && this.worldMap && this.worldMap.gpsGroupEl) {
      this.miniMapGpsGroupEl.innerHTML = this.worldMap.gpsGroupEl.innerHTML;
    }

    // Sync landmark POI pins
    if (this.miniMapLandmarksEl && this.worldMap && this.worldMap.landmarksLayerEl) {
      if (this.miniMapLandmarksEl.children.length === 0 && this.worldMap.landmarksLayerEl.children.length > 0) {
        this.miniMapLandmarksEl.innerHTML = this.worldMap.landmarksLayerEl.innerHTML;
      }
    }

    // Sync active destination waypoint marker
    if (this.miniMapWaypointEl) {
      if (this.worldMap && this.worldMap.gpsNav && this.worldMap.gpsNav.activeWaypoint) {
        const wp = this.worldMap.gpsNav.activeWaypoint;
        const wpPx = this.worldToMapPx(wp.x, wp.z);
        this.miniMapWaypointEl.style.left = `${wpPx.x.toFixed(1)}px`;
        this.miniMapWaypointEl.style.top = `${wpPx.y.toFixed(1)}px`;
        this.miniMapWaypointEl.classList.remove('hidden');
      } else {
        this.miniMapWaypointEl.classList.add('hidden');
      }
    }

    // Telemetry text
    const kmh = Math.round(this.vehicle.speedKmh || (Math.abs(this.vehicle.forwardSpeed || 0) * 3.6));
    const mph = Math.round(kmh * 0.621371);
    if (this.headerSpeedEl) {
      this.headerSpeedEl.textContent = `${mph} MPH (${kmh} KM/H)`;
    }
  }

  setOpen(open) {
    if (this.isOpen === open) return;
    this.isOpen = open;

    if (this.overlayEl) {
      this.overlayEl.classList.toggle('hidden', !open);
    }

    if (this.hudPausePromptEl) {
      this.hudPausePromptEl.classList.toggle('hidden', open);
    }
    if (this.hudMinimapWrapEl) {
      this.hudMinimapWrapEl.classList.toggle('hidden', open);
    }

    if (open) {
      // Clear driving inputs while in pause menu
      if (this.input) {
        this.input.forward = false;
        this.input.backward = false;
        this.input.left = false;
        this.input.right = false;
        this.input.handbrake = true;
      }
      this.showView('main');
      this.updateTilePreviews();
    } else {
      if (this.input) {
        this.input.handbrake = false;
      }
    }
  }
}

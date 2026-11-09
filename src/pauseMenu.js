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

    // Map bounds matching WorldMapController (2048x1920)
    this.mapBounds = {
      minX: -450.0,
      maxX: 520.0,
      minZ: -480.0,
      maxZ: 420.0,
      spanX: 970.0,
      spanZ: 900.0,
      imgW: 2048,
      imgH: 1920
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
    this.miniMapPlaneEl = document.getElementById('pause-mini-map-plane');
    this.miniMapArrowEl = document.getElementById('pause-mini-map-arrow');
    this.miniMapGpsSvgEl = document.getElementById('pause-mini-map-gps-svg');

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

    // HUD trigger button
    this.hudPauseBtnEl = document.getElementById('hud-pause-btn');
    this.footerPromptsEl = document.getElementById('pause-footer-prompts');

    this.init();
  }

  init() {
    this.buildCarsGrid();
    this.buildCameraDots();
    this.bindEvents();
    this.updateFocusedTile(1);
  }

  worldToMapPx(wx, wz) {
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
    // HUD Pause Button
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

  updateMiniMapPreview() {
    if (!this.vehicle || !this.vehicle.rootGroup || !this.miniMapPlaneEl) return;
    const pos = this.vehicle.rootGroup.position;
    const p = this.worldToMapPx(pos.x, pos.z);

    // Mini map container is ~480px x 300px
    // Center the satellite plane around player position
    const miniScale = 0.42;
    const containerW = 480;
    const containerH = 300;

    const offsetX = containerW * 0.5 - p.x * miniScale;
    const offsetY = containerH * 0.5 - p.y * miniScale;

    this.miniMapPlaneEl.style.transform = `translate(${offsetX.toFixed(1)}px, ${offsetY.toFixed(1)}px) scale(${miniScale})`;

    // Position and rotate player arrow
    if (this.miniMapArrowEl) {
      this.miniMapArrowEl.style.left = `${p.x.toFixed(1)}px`;
      this.miniMapArrowEl.style.top = `${p.y.toFixed(1)}px`;

      const carQuat = this.vehicle.rootGroup.quaternion;
      const headingX = 2 * (carQuat.x * carQuat.z + carQuat.w * carQuat.y);
      const headingZ = 1 - 2 * (carQuat.x * carQuat.x + carQuat.y * carQuat.y);
      const headingDeg = Math.atan2(headingX, -headingZ) * (180.0 / Math.PI);
      this.miniMapArrowEl.style.transform = `translate(-50%, -50%) rotate(${headingDeg.toFixed(1)}deg)`;
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

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

import { OnlineSessionManager, formatSessionCode } from './onlineSession.js';
import { CustomizeShowroom } from './customizeShowroom.js';
import {
  PAINT_SWATCHES,
  getCarPaintZones,
  getSavedCarPaint,
  setSavedCarPaint,
  resetSavedCarPaint,
  hsvToHex,
  hexToHsv,
} from './carPaintSystem.js';

// Optional: Paste a Formspree endpoint (https://formspree.io/f/YOUR_ID) or Discord Webhook URL
// to receive player bug reports & feedback silently in-game. When empty, opens a pre-filled GitHub Issue.
const FEEDBACK_WEBHOOK_URL = 'https://discord.com/api/webhooks/1571864266456178712/64gMEUBEMbJF3Pc0HvYSOgcHLVbsQ-P3pV1f52O6TO35jAYqYeGjjNeEicd4Zq8q5Yg-';
const GITHUB_ISSUES_URL = 'https://github.com/dukosaur/Average-Car-Game/issues/new';

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
    getGrassDensityFn,
    setPixelScaleFn,
    getPixelScaleFn,
    setOutlinesEnabledFn,
    getOutlinesEnabledFn,
    setTimeOfDayFn,
    getTimeOfDayFn,
    resetVehicleFn,
    applyCarPaintFn
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
    this.setPixelScaleFn = setPixelScaleFn;
    this.getPixelScaleFn = getPixelScaleFn;
    this.setOutlinesEnabledFn = setOutlinesEnabledFn;
    this.getOutlinesEnabledFn = getOutlinesEnabledFn;
    this.setTimeOfDayFn = setTimeOfDayFn;
    this.getTimeOfDayFn = getTimeOfDayFn;
    this.resetVehicleFn = resetVehicleFn;
    this.applyCarPaintFn = applyCarPaintFn;

    this.isOpen = false;
    this.currentView = 'main'; // 'main' | 'cars' | 'settings'
    this.focusedTileIndex = 1; // Default focus to Hero World Map (Tile 1)
    this.focusedCarIndex = 0;

    // Map bounds matching WorldMapController (2048x1920, ortho_scale=4240)
    this.mapBounds = {
      minX: -2120.0,
      maxX: 2120.0,
      spanX: 4240.0,
      minZ: -1987.5,
      maxZ: 1987.5,
      spanZ: 3975.0,
      imgW: 2048.0,
      imgH: 1920.0
    };

    // DOM Elements
    this.overlayEl = document.getElementById('pause-menu-overlay');
    this.shellEl = this.overlayEl ? this.overlayEl.querySelector('.pause-menu-shell') : null;
    this.tabHomeEl = document.getElementById('pause-tab-home');
    this.tabCustomizeEl = document.getElementById('pause-tab-customize');
    this.tabOnlineEl = document.getElementById('pause-tab-online');
    this.customizeCanvasEl = document.getElementById('pause-customize-canvas');
    this.customizeCarNameEl = document.getElementById('pause-customize-car-name');
    this.customizeShowroom = this.customizeCanvasEl
      ? new CustomizeShowroom(this.customizeCanvasEl, this.customizeCarNameEl)
      : null;
    this._dynamicThumbs = {};
    this._onlinePaintThumbs = {};
    this._thumbsWarmed = false;
    this._thumbDebounceTimer = null;
    this._pendingThumbCarId = null;
    this._initCustomizePaintUI();
    this.activeTab = 'home';
    this.onlineSession = new OnlineSessionManager(() => {
      this.updateOnlineView();
      if (typeof this.onOnlinePlayersChangedFn === 'function' && this.onlineSession.isActive()) {
        this.onOnlinePlayersChangedFn(this.onlineSession.players);
      }
    });
    this.onlineSession.onSyncStageFn = (text, pct) => this.showSyncOverlay(text, pct);
    this.onlineCreateBtnEl = document.getElementById('online-create-btn');
    this.onlineHostCodeBoxEl = document.getElementById('online-host-code-box');
    this.onlineHostCodeValueEl = document.getElementById('online-host-code-value');
    this.onlineJoinCodeInputEl = document.getElementById('online-join-code-input');
    this.onlineJoinBtnEl = document.getElementById('online-join-btn');
    this.onlineToastEl = document.getElementById('online-toast');
    this.onlineToastTextEl = document.getElementById('online-toast-text');
    this.onlineToastTimer = null;
    this.onlineSyncOverlayEl = document.getElementById('online-sync-overlay');
    this.onlineSyncStageEl = document.getElementById('online-sync-stage');
    this.onlineSyncBarEl = document.getElementById('online-sync-bar');
    this.onlinePlayersListEl = document.getElementById('online-players-list');
    if (this.onlinePlayersListEl) {
      this.onlinePlayersListEl.addEventListener('scroll', () => this._updatePlayersScrollFade());
    }
    this.onOnlinePlayersChangedFn = null;
    if (this.tabHomeEl) {
      this.tabHomeEl.addEventListener('click', () => this.setTab('home'));
    }
    if (this.tabCustomizeEl) {
      this.tabCustomizeEl.addEventListener('click', () => this.setTab('customize'));
    }
    if (this.tabOnlineEl) {
      this.tabOnlineEl.addEventListener('click', () => this.setTab('online'));
    }
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
    this.pixelScaleBtns = document.querySelectorAll('.pause-pixel-scale-btn');
    this.inkOptionBtns = document.querySelectorAll('.pause-ink-opt-btn');
    this.todOptionBtns = document.querySelectorAll('.pause-tod-opt-btn');

    // Minimalist HUD Pause Prompt (Top-Left) & Circular Mini-Map (Bottom-Left)
    this.hudPausePromptEl = document.getElementById('hud-pause-prompt');
    this.hudMinimapWrapEl = document.getElementById('hud-minimap-wrap');
    this.hudPauseBtnEl = document.getElementById('hud-pause-btn');
    this.footerPromptsEl = document.getElementById('pause-footer-prompts');

    // Feedback / Bug Report Modal
    this.feedbackBtnEl = document.getElementById('pause-feedback-btn');
    this.feedbackModalEl = document.getElementById('pause-feedback-modal');
    this.feedbackCloseEl = document.getElementById('pause-feedback-close');
    this.feedbackCancelEl = document.getElementById('pause-feedback-cancel');
    this.feedbackSubmitEl = document.getElementById('pause-feedback-submit');
    this.feedbackSummaryEl = document.getElementById('pause-feedback-summary');
    this.feedbackDetailsEl = document.getElementById('pause-feedback-details');
    this.feedbackDiagEl = document.getElementById('pause-feedback-diag');
    this.feedbackStatusEl = document.getElementById('pause-feedback-status');
    this.feedbackTypeBtns = document.querySelectorAll('.pause-feedback-type');
    this.feedbackType = 'Bug Report';
    this.isFeedbackOpen = false;

    this.init();
  }

  init() {
    this.buildCarsGrid();
    this.buildCameraDots();
    this.bindEvents();
    this.initParallax();
    this.initGlassSpotlight();
    this.updatePixelStyleButtons();
    this.updateFocusedTile(1);
  }

  initGlassSpotlight() {
    // Lightweight cursor-reactive frosted glass specular refraction (zero neon, pure ceramic sheen)
    const updateSpot = (e) => {
      const target = e.target && e.target.closest
        ? e.target.closest('.pause-glass-tile, .pause-car-card, .pause-setting-section, .title-side-card')
        : null;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${(e.clientX - rect.left).toFixed(1)}px`);
      target.style.setProperty('--my', `${(e.clientY - rect.top).toFixed(1)}px`);
    };
    document.addEventListener('pointermove', updateSpot, { passive: true });
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

    if (!this._garageHeroBound) {
      this._garageHeroBound = true;
      this.garageHeroImgEl = document.getElementById('garage-hero-img');
      this.garageHeroNameEl = document.getElementById('garage-hero-name');
      this.garageHeroSubEl = document.getElementById('garage-hero-sub');
      this.garageStatSpeedValEl = document.getElementById('garage-stat-speed-val');
      this.garageStatSpeedFillEl = document.getElementById('garage-stat-speed-fill');
      this.garageStatAccelValEl = document.getElementById('garage-stat-accel-val');
      this.garageStatAccelFillEl = document.getElementById('garage-stat-accel-fill');
      this.garageStatWeightValEl = document.getElementById('garage-stat-weight-val');
      this.garageEquipBtnEl = document.getElementById('garage-equip-btn');
      if (this.garageEquipBtnEl) {
        this.garageEquipBtnEl.addEventListener('click', () => {
          this.selectCar(this.focusedCarIndex);
        });
      }
    }

    this.carRoster.forEach((car, idx) => {
      const card = document.createElement('div');
      card.className = `pause-car-card ${idx === activeIdx ? 'active' : ''}`;
      card.dataset.carIndex = idx;
      card.innerHTML = `
        <div class="pause-car-thumb-wrap">
          <img class="pause-car-thumb" data-car-id="${car.id}" src="${this.getCarThumbSrc(car)}" alt="${car.name}" />
        </div>
        <div class="pause-car-info">
          <div class="pause-car-category">${car.category || 'STREET'}</div>
          <div class="pause-car-name">${car.name}</div>
        </div>
        ${idx === activeIdx ? '<span class="pause-car-badge active">DRIVING</span>' : ''}
      `;

      card.addEventListener('mouseenter', () => {
        this.updateCarFocus(idx);
      });

      card.addEventListener('click', () => {
        this.selectCar(idx);
      });

      this.carsGridEl.appendChild(card);
    });

    this.updateGarageHero(this.focusedCarIndex);
  }

  updateGarageHero(index) {
    if (!this.carRoster || !this.carRoster.length) return;
    const safeIdx = Math.max(0, Math.min(this.carRoster.length - 1, index));
    const car = this.carRoster[safeIdx];
    if (!car) return;
    const activeIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
    const isDriving = safeIdx === activeIdx;
    const stats = car.stats || {};
    const topSpeedMph = stats.topSpeedMph || 100;
    const speedPct = Math.max(15, Math.min(100, Math.round((topSpeedMph / 145) * 100)));
    const pwrRatio = (stats.maxEngineForce || 7500) / Math.max(800, stats.mass || 1400);
    const accelScore = Math.min(9.9, Math.max(3.0, pwrRatio * 1.15));
    const accelPct = Math.max(18, Math.min(100, Math.round((accelScore / 10) * 100)));
    const massKg = stats.mass || 1400;

    if (this.garageHeroImgEl) {
      this.garageHeroImgEl.dataset.carId = car.id;
      this.garageHeroImgEl.src = this.getCarThumbSrc(car);
      this.garageHeroImgEl.alt = car.name;
    }
    if (this.garageHeroNameEl) this.garageHeroNameEl.textContent = car.name;
    if (this.garageStatSpeedValEl) this.garageStatSpeedValEl.textContent = `${topSpeedMph} MPH`;
    if (this.garageStatSpeedFillEl) this.garageStatSpeedFillEl.style.width = `${speedPct}%`;
    if (this.garageStatAccelValEl) this.garageStatAccelValEl.textContent = `${accelScore.toFixed(1)} / 10`;
    if (this.garageStatAccelFillEl) this.garageStatAccelFillEl.style.width = `${accelPct}%`;
    if (this.garageStatWeightValEl) this.garageStatWeightValEl.textContent = `${massKg.toLocaleString()} KG`;
    if (this.garageEquipBtnEl) {
      this.garageEquipBtnEl.textContent = isDriving ? 'CURRENTLY DRIVING' : 'EQUIP CAR';
      this.garageEquipBtnEl.classList.toggle('is-driving', isDriving);
    }
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
    }

    if (this.tileMapEl) {
      this.tileMapEl.addEventListener('click', () => this.openWorldMap());
    }

    if (this.tileCamEl) {
      this.tileCamEl.addEventListener('click', () => this.cycleCamera());
    }

    if (this.tileResetEl) {
      this.tileResetEl.addEventListener('click', () => this.resetVehicle());
    }

    if (this.tileSettingsEl) {
      this.tileSettingsEl.addEventListener('click', () => this.showView('settings'));
    }

    this.tiles.forEach((tile, idx) => {
      if (!tile) return;
      tile.addEventListener('mouseenter', () => {
        this.focusedTileIndex = idx;
        this.clearFocusedTile();
      });
      tile.addEventListener('mouseleave', () => this.clearFocusedTile());
    });

    // Subview Back Buttons
    if (this.carsBackBtnEl) {
      this.carsBackBtnEl.addEventListener('click', () => this.showView('main'));
    }
    if (this.settingsBackBtnEl) {
      this.settingsBackBtnEl.addEventListener('click', () => this.showView('main'));
    }

    // Online Session Create / End
    if (this.onlineCreateBtnEl) {
      this.onlineCreateBtnEl.addEventListener('click', () => {
        if (this.onlineSession.isActive() && this.onlineSession.isHost) {
          this.onlineSession.leaveSession();
        } else {
          const carIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
          this.onlineSession.createSession(this.getActiveCar(), carIdx);
        }
      });
    }

    // Format Join Code Input as XXXX XXXX & Join on Enter
    if (this.onlineJoinCodeInputEl) {
      this.onlineJoinCodeInputEl.addEventListener('input', () => {
        this.onlineJoinCodeInputEl.value = formatSessionCode(this.onlineJoinCodeInputEl.value);
      });
      this.onlineJoinCodeInputEl.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' && this.onlineJoinBtnEl && !this.onlineJoinBtnEl.disabled) {
          e.preventDefault();
          this.onlineJoinBtnEl.click();
        }
      });
    }

    // Online Session Join / Leave
    if (this.onlineJoinBtnEl) {
      this.onlineJoinBtnEl.addEventListener('click', () => {
        if (this.onlineSession.isJoinedAsGuest()) {
          this.onlineSession.leaveSession();
        } else {
          const code = this.onlineJoinCodeInputEl ? this.onlineJoinCodeInputEl.value : '';
          const carIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
          this.onlineSession.joinSession(code, this.getActiveCar(), carIdx);
        }
      });
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

    // Pixel Scale Presets (Moved from HUD bar -> Settings, 1.0x default)
    if (this.pixelScaleBtns) {
      this.pixelScaleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const scale = parseFloat(btn.dataset.scale);
          if (!Number.isNaN(scale) && this.setPixelScaleFn) {
            this.setPixelScaleFn(scale);
          }
          this.updatePixelStyleButtons();
        });
      });
    }

    // Ink Outlines Toggle (Moved from HUD bar -> Settings)
    if (this.inkOptionBtns) {
      this.inkOptionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const enabled = btn.dataset.ink === 'on';
          if (this.setOutlinesEnabledFn) {
            this.setOutlinesEnabledFn(enabled);
          }
          this.updatePixelStyleButtons();
        });
      });
    }

    // Time of Day Presets (Noon / Sunset / Night)
    if (this.todOptionBtns) {
      this.todOptionBtns.forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.tod;
          if (mode && this.setTimeOfDayFn) {
            this.setTimeOfDayFn(mode);
          }
          this.updatePixelStyleButtons();
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

    // Feedback / Bug Report Modal
    if (this.feedbackBtnEl) {
      this.feedbackBtnEl.addEventListener('click', () => this.setFeedbackOpen(true));
    }
    if (this.feedbackCloseEl) {
      this.feedbackCloseEl.addEventListener('click', () => this.setFeedbackOpen(false));
    }
    if (this.feedbackCancelEl) {
      this.feedbackCancelEl.addEventListener('click', () => this.setFeedbackOpen(false));
    }
    if (this.feedbackModalEl) {
      this.feedbackModalEl.addEventListener('click', (e) => {
        if (e.target === this.feedbackModalEl) {
          this.setFeedbackOpen(false);
        }
      });
      this.feedbackModalEl.addEventListener('keydown', (e) => {
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.setFeedbackOpen(false);
          return;
        }
        e.stopPropagation();
      });
    }
    if (this.feedbackTypeBtns) {
      this.feedbackTypeBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.feedbackType = btn.dataset.feedbackType || 'Bug Report';
          this.feedbackTypeBtns.forEach((b) => b.classList.toggle('active', b === btn));
        });
      });
    }
    if (this.feedbackSubmitEl) {
      this.feedbackSubmitEl.addEventListener('click', () => this._submitFeedback());
    }
  }

  setFeedbackOpen(open) {
    this.isFeedbackOpen = Boolean(open);
    if (!this.feedbackModalEl) return;
    this.feedbackModalEl.classList.toggle('hidden', !this.isFeedbackOpen);
    if (this.isFeedbackOpen) {
      if (this.feedbackStatusEl) this.feedbackStatusEl.textContent = '';
      if (this.feedbackSummaryEl) {
        setTimeout(() => this.feedbackSummaryEl.focus(), 20);
      }
    }
  }

  _getReadablePlatform() {
    const ua = navigator.userAgent || '';
    const os = /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Linux/.test(ua)
          ? 'Linux'
          : 'Unknown OS';
    const browserMatch = ua.match(/(Edg|Chrome|Firefox|Safari)\/(\d+)/);
    const browser = browserMatch
      ? `${browserMatch[1] === 'Edg' ? 'Edge' : browserMatch[1]} ${browserMatch[2]}`
      : 'Browser';
    return `${browser} • ${os}`;
  }

  _collectFeedbackDiagnosticsObj() {
    const carIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
    const carName = (this.carRoster[carIdx] && this.carRoster[carIdx].name) || 'Unknown';
    const pos = this.vehicle && this.vehicle.rootGroup ? this.vehicle.rootGroup.position : null;
    const coords = pos ? `(${Math.round(pos.x)}, ${pos.y.toFixed(1)}, ${Math.round(pos.z)})` : 'N/A';
    const fps = window.__fps !== undefined ? `${window.__fps} FPS` : 'N/A';
    const onlineStatus = this.onlineSession ? this.onlineSession.status : 'offline';
    const driver = (this.onlineSession && this.onlineSession.localName) || 'Driver';
    const display = `${window.innerWidth}×${window.innerHeight} (${window.devicePixelRatio || 1}x)`;
    const platform = this._getReadablePlatform();
    return { driver, carName, coords, fps, onlineStatus, display, platform };
  }

  _collectFeedbackDiagnostics() {
    const d = this._collectFeedbackDiagnosticsObj();
    return [
      `Driver: ${d.driver}`,
      `Car: ${d.carName}`,
      `Coords: ${d.coords}`,
      `FPS: ${d.fps}`,
      `Online: ${d.onlineStatus}`,
      `Display: ${d.display}`,
      `Platform: ${d.platform}`,
    ].join('\n');
  }

  async _submitFeedback() {
    const summary = this.feedbackSummaryEl ? this.feedbackSummaryEl.value.trim() : '';
    const details = this.feedbackDetailsEl ? this.feedbackDetailsEl.value.trim() : '';
    if (!summary && !details) {
      if (this.feedbackStatusEl) this.feedbackStatusEl.textContent = 'Please enter a short summary or description.';
      return;
    }

    const title = `[${this.feedbackType}] ${summary || details.slice(0, 60)}`;
    const includeDiag = this.feedbackDiagEl ? this.feedbackDiagEl.checked : true;
    const diagText = includeDiag ? this._collectFeedbackDiagnostics() : '';
    const fullBody = [details || summary, diagText ? `\n--- Diagnostics ---\n${diagText}` : ''].join('\n');

    if (FEEDBACK_WEBHOOK_URL) {
      if (this.feedbackSubmitEl) this.feedbackSubmitEl.disabled = true;
      if (this.feedbackStatusEl) this.feedbackStatusEl.textContent = 'Sending...';
      try {
        const isDiscord = FEEDBACK_WEBHOOK_URL.includes('discord.com/api/webhooks/');
        let payload;
        if (isDiscord) {
          const isBug = this.feedbackType === 'Bug Report';
          const d = this._collectFeedbackDiagnosticsObj();
          const fields = includeDiag
            ? [
                { name: 'Driver', value: d.driver, inline: true },
                { name: 'Vehicle', value: d.carName, inline: true },
                { name: 'Performance', value: d.fps, inline: true },
                { name: 'Online', value: d.onlineStatus, inline: true },
                { name: 'Coords', value: `\`${d.coords}\``, inline: true },
                { name: 'Display', value: d.display, inline: true },
                { name: 'Platform', value: d.platform, inline: false },
              ]
            : [{ name: 'Driver', value: d.driver, inline: true }];
          payload = {
            username: 'Average Car Game',
            embeds: [
              {
                author: { name: isBug ? 'BUG REPORT' : 'PLAYER FEEDBACK' },
                title: summary || (details.length > 80 ? `${details.slice(0, 77)}...` : details),
                description: details && summary ? details : details || summary,
                color: isBug ? 0xef4444 : 0xe5a93c,
                fields,
                footer: { text: 'Average Car Game • In-Game Report' },
                timestamp: new Date().toISOString(),
              },
            ],
          };
        } else {
          payload = { type: this.feedbackType, title, message: details || summary, diagnostics: diagText, timestamp: new Date().toISOString() };
        }
        const res = await fetch(FEEDBACK_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (this.feedbackStatusEl) this.feedbackStatusEl.textContent = 'Sent! Thank you for the report.';
        if (this.feedbackSummaryEl) this.feedbackSummaryEl.value = '';
        if (this.feedbackDetailsEl) this.feedbackDetailsEl.value = '';
        setTimeout(() => this.setFeedbackOpen(false), 1100);
      } catch (err) {
        if (this.feedbackStatusEl) this.feedbackStatusEl.textContent = 'Failed to send. Opening GitHub Issue fallback...';
        const url = `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(fullBody)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      } finally {
        if (this.feedbackSubmitEl) this.feedbackSubmitEl.disabled = false;
      }
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(`${title}\n\n${fullBody}`).catch(() => {});
    }
    const url = `${GITHUB_ISSUES_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(fullBody)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    if (this.feedbackStatusEl) this.feedbackStatusEl.textContent = 'Opened pre-filled GitHub Issue & copied to clipboard.';
    if (this.feedbackSummaryEl) this.feedbackSummaryEl.value = '';
    if (this.feedbackDetailsEl) this.feedbackDetailsEl.value = '';
    setTimeout(() => this.setFeedbackOpen(false), 1100);
  }

  updateGrassButtons(activeDensity) {
    if (!this.grassOptionBtns) return;
    this.grassOptionBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.density === activeDensity);
    });
  }

  updatePixelStyleButtons() {
    const activeScale = this.getPixelScaleFn ? this.getPixelScaleFn() : 1.0;
    if (this.pixelScaleBtns) {
      this.pixelScaleBtns.forEach(btn => {
        const val = parseFloat(btn.dataset.scale);
        btn.classList.toggle('active', Math.abs(activeScale - val) < 0.04);
      });
    }
    const inkOn = this.getOutlinesEnabledFn ? Boolean(this.getOutlinesEnabledFn()) : true;
    if (this.inkOptionBtns) {
      this.inkOptionBtns.forEach(btn => {
        btn.classList.toggle('active', (btn.dataset.ink === 'on') === inkOn);
      });
    }
    const activeTod = this.getTimeOfDayFn ? this.getTimeOfDayFn() : 'noon';
    if (this.todOptionBtns) {
      this.todOptionBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tod === activeTod);
      });
    }
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
    } else if (viewName === 'settings') {
      this.updatePixelStyleButtons();
    } else if (viewName === 'main') {
      this.updateTilePreviews();
    }
    this.updateFooterPrompts();
  }

  updateFooterPrompts() {
    if (!this.footerPromptsEl) return;
    if (this.currentView === 'cars') {
      this.footerPromptsEl.innerHTML = `
        <div class="pause-footer-item"><span class="pause-key-badge">ENTER</span> EQUIP</div>
        <div class="pause-footer-item"><span class="pause-key-badge">ESC</span> BACK</div>
        <div class="pause-footer-item"><span class="pause-key-badge">A D</span> BROWSE</div>
      `;
    } else if (this.currentView === 'settings') {
      this.footerPromptsEl.innerHTML = `
        <div class="pause-footer-item"><span class="pause-key-badge">ESC</span> BACK</div>
      `;
    } else {
      this.footerPromptsEl.innerHTML = `
        <div class="pause-footer-item"><span class="pause-key-badge">ENTER</span> SELECT</div>
        <div class="pause-footer-item"><span class="pause-key-badge">ESC</span> RESUME</div>
        <div class="pause-footer-item"><span class="pause-key-badge">R</span> RESET</div>
        <div class="pause-footer-item"><span class="pause-key-badge">M</span> MAP</div>
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

  clearFocusedTile() {
    this.tiles.forEach((tile) => {
      if (tile) {
        tile.classList.remove('keyboard-focused');
      }
    });
  }

  updateCarFocus(index) {
    if (!this.carRoster) return;
    this.focusedCarIndex = Math.max(0, Math.min(this.carRoster.length - 1, index));
    if (this.carsGridEl) {
      const cards = this.carsGridEl.querySelectorAll('.pause-car-card');
      cards.forEach((c, idx) => {
        c.classList.toggle('keyboard-focused', idx === this.focusedCarIndex);
      });
    }
    this.updateGarageHero(this.focusedCarIndex);
  }

  handleKeyDown(e) {
    if (!this.isOpen) return false;

    if (this.activeTab === 'online') {
      if (e.code === 'Escape') {
        this.setOpen(false);
        e.preventDefault();
        return true;
      }
      return true;
    }

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
        case 'ArrowUp':
        case 'KeyW':
          this.updateCarFocus((this.focusedCarIndex - 2 + this.carRoster.length) % this.carRoster.length);
          e.preventDefault();
          return true;
        case 'ArrowDown':
        case 'KeyS':
          this.updateCarFocus((this.focusedCarIndex + 2) % this.carRoster.length);
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
    if (typeof this.resetVehicleFn === 'function') {
      this.resetVehicleFn();
      this.setOpen(false);
    } else if (this.vehicle && typeof this.vehicle.reset === 'function') {
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

  getActiveCar() {
    const activeIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
    return this.carRoster[activeIdx] || null;
  }

  getCarThumbSrc(car) {
    if (!car) return '';
    return this._dynamicThumbs[car.id] || car.thumb || 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  }

  async _refreshSingleCarThumbnail(carId, paintMap = null) {
    if (!this.customizeShowroom || !carId) return;
    const car = this.carRoster.find((c) => c.id === carId);
    if (!car) return;
    const dataUrl = await this.customizeShowroom.renderPixelThumbnail(car, paintMap);
    if (!dataUrl) return;
    this._dynamicThumbs[car.id] = dataUrl;

    const activeCar = this.getActiveCar();
    if (activeCar && activeCar.id === car.id && this.tileGarageImgEl) {
      this.tileGarageImgEl.src = dataUrl;
    }
    if (this.carsGridEl) {
      const img = this.carsGridEl.querySelector(`.pause-car-thumb[data-car-id="${car.id}"]`);
      if (img) img.src = dataUrl;
    }
    if (this.garageHeroImgEl && this.garageHeroImgEl.dataset.carId === car.id) {
      this.garageHeroImgEl.src = dataUrl;
    }
    if (this.onlineSession && this.onlineSession.isActive() && activeCar && activeCar.id === car.id) {
      const activeIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
      this.onlineSession.updateLocalCar(activeCar, activeIdx, paintMap || getSavedCarPaint(car.id));
    }
  }

  _scheduleCarThumbnailRefresh(carId, paintMap = null, immediate = false) {
    if (this._thumbDebounceTimer) {
      clearTimeout(this._thumbDebounceTimer);
      this._thumbDebounceTimer = null;
    }
    this._pendingThumbCarId = carId;
    if (immediate) {
      this._pendingThumbCarId = null;
      this._refreshSingleCarThumbnail(carId, paintMap);
      return;
    }
    this._thumbDebounceTimer = setTimeout(() => {
      this._thumbDebounceTimer = null;
      const id = this._pendingThumbCarId;
      this._pendingThumbCarId = null;
      if (id) this._refreshSingleCarThumbnail(id);
    }, 150);
  }

  async _warmAllCarThumbnails() {
    if (this._thumbsWarmed || !this.customizeShowroom || !this.carRoster.length) return;
    this._thumbsWarmed = true;
    const activeCar = this.getActiveCar();
    const ordered = activeCar
      ? [activeCar, ...this.carRoster.filter((c) => c.id !== activeCar.id)]
      : [...this.carRoster];
    for (const car of ordered) {
      await this._refreshSingleCarThumbnail(car.id);
    }
  }

  updateTilePreviews() {
    const currentCar = this.getActiveCar();

    if (currentCar) {
      const carIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
      if (this.headerCarNameEl) this.headerCarNameEl.textContent = currentCar.fullName;
      if (this.tileGarageNameEl) this.tileGarageNameEl.textContent = currentCar.name;
      if (this.tileGarageImgEl) {
        this.tileGarageImgEl.src = this.getCarThumbSrc(currentCar);
        this.tileGarageImgEl.alt = currentCar.name;
      }
      this.onlineSession.updateLocalCar(currentCar, carIdx);
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
    if (!this.isOpen) return;
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

    // Sync GPS routes (refresh WorldMap SVG first if waypoint is active while map was closed)
    if (this.worldMap && this.worldMap.gpsNav && this.worldMap.gpsNav.activeWaypoint) {
      this.worldMap.onGpsRouteUpdated(
        this.worldMap.gpsNav.activeWaypoint,
        this.worldMap.gpsNav.activePath,
        this.worldMap.gpsNav.remainingDistance
      );
    }
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
      this.headerSpeedEl.textContent = `${mph} MPH`;
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
      this.setTab('home');
      this.showView('main');
      this.updateTilePreviews();
      this._warmAllCarThumbnails();
    } else {
      if (this.customizeShowroom) {
        this.customizeShowroom.stop();
      }
      if (this.input) {
        this.input.handbrake = false;
      }
    }
  }

  setTab(tab) {
    this.activeTab = tab === 'online' ? 'online' : (tab === 'customize' ? 'customize' : 'home');
    if (this.shellEl) {
      this.shellEl.classList.toggle('tab-online', this.activeTab === 'online');
      this.shellEl.classList.toggle('tab-customize', this.activeTab === 'customize');
    }
    if (this.tabHomeEl) {
      this.tabHomeEl.classList.toggle('active', this.activeTab === 'home');
    }
    if (this.tabCustomizeEl) {
      this.tabCustomizeEl.classList.toggle('active', this.activeTab === 'customize');
    }
    if (this.tabOnlineEl) {
      this.tabOnlineEl.classList.toggle('active', this.activeTab === 'online');
    }
    if (this.currentView !== 'main') {
      this.showView('main');
    }
    if (this.activeTab === 'online') {
      this.updateOnlineView();
    }
    if (this.customizeShowroom) {
      if (this.isOpen && this.activeTab === 'customize') {
        const carIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
        const currentCar = this.carRoster[carIdx] || this.carRoster[0];
        this.customizeShowroom.start(currentCar);
        if (currentCar) this._syncCustomizePaintUI(currentCar.id);
      } else {
        this.customizeShowroom.stop();
        if (this._pendingThumbCarId) {
          const id = this._pendingThumbCarId;
          this._pendingThumbCarId = null;
          if (this._thumbDebounceTimer) {
            clearTimeout(this._thumbDebounceTimer);
            this._thumbDebounceTimer = null;
          }
          this._refreshSingleCarThumbnail(id);
        }
      }
    }
  }

  _initCustomizePaintUI() {
    this.paintZoneRowEl = document.getElementById('customize-zone-row');
    this.paintModeSwatchesBtn = document.getElementById('customize-mode-swatches');
    this.paintModeGradientBtn = document.getElementById('customize-mode-gradient');
    this.paintSwatchPanelEl = document.getElementById('customize-swatch-panel');
    this.paintGradientPanelEl = document.getElementById('customize-gradient-panel');
    this.paintSwatchGridEl = document.getElementById('customize-swatch-grid');
    this.paintSvWrapEl = document.getElementById('customize-sv-wrap');
    this.paintSvCanvasEl = document.getElementById('customize-sv-canvas');
    this.paintSvCursorEl = document.getElementById('customize-sv-cursor');
    this.paintHueWrapEl = document.getElementById('customize-hue-wrap');
    this.paintHueCanvasEl = document.getElementById('customize-hue-canvas');
    this.paintHueCursorEl = document.getElementById('customize-hue-cursor');
    this.paintColorPreviewEl = document.getElementById('customize-color-preview');
    this.paintColorHexEl = document.getElementById('customize-color-hex');
    this.paintResetBtnEl = document.getElementById('customize-paint-reset-btn');

    this._paintCarId = null;
    this._paintZoneKey = 'primary';
    this._paintMode = 'swatches'; // 'swatches' | 'gradient'
    this._paintHsv = { h: 45, s: 0.7, v: 1.0 };

    // Build Swatch Buttons
    if (this.paintSwatchGridEl) {
      this.paintSwatchGridEl.innerHTML = '';
      for (const sw of PAINT_SWATCHES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'customize-swatch-btn';
        btn.style.background = sw.hex;
        btn.dataset.hex = sw.hex.toLowerCase();
        btn.title = sw.name;
        btn.addEventListener('click', () => {
          this._applySelectedPaintHex(sw.hex, true);
        });
        this.paintSwatchGridEl.appendChild(btn);
      }
    }

    // Draw Rainbow Hue Bar once
    if (this.paintHueCanvasEl) {
      const hctx = this.paintHueCanvasEl.getContext('2d');
      const hw = this.paintHueCanvasEl.width;
      const hh = this.paintHueCanvasEl.height;
      const grad = hctx.createLinearGradient(0, 0, hw, 0);
      grad.addColorStop(0.0, '#ff0000');
      grad.addColorStop(1 / 6, '#ffff00');
      grad.addColorStop(2 / 6, '#00ff00');
      grad.addColorStop(3 / 6, '#00ffff');
      grad.addColorStop(4 / 6, '#0000ff');
      grad.addColorStop(5 / 6, '#ff00ff');
      grad.addColorStop(1.0, '#ff0000');
      hctx.fillStyle = grad;
      hctx.fillRect(0, 0, hw, hh);
    }

    // Mode Switcher (SWATCHES | GRADIENT)
    const setMode = (mode) => {
      this._paintMode = mode;
      if (this.paintModeSwatchesBtn) this.paintModeSwatchesBtn.classList.toggle('active', mode === 'swatches');
      if (this.paintModeGradientBtn) this.paintModeGradientBtn.classList.toggle('active', mode === 'gradient');
      if (this.paintSwatchPanelEl) this.paintSwatchPanelEl.classList.toggle('hidden', mode !== 'swatches');
      if (this.paintGradientPanelEl) this.paintGradientPanelEl.classList.toggle('hidden', mode !== 'gradient');
      if (mode === 'gradient') {
        this._redrawSvCanvas();
        this._syncGradientCursors();
      }
    };
    if (this.paintModeSwatchesBtn) this.paintModeSwatchesBtn.addEventListener('click', () => setMode('swatches'));
    if (this.paintModeGradientBtn) this.paintModeGradientBtn.addEventListener('click', () => setMode('gradient'));

    // 2D SV Gradient Drag
    if (this.paintSvWrapEl) {
      let draggingSv = false;
      const pickSv = (e) => {
        const rect = this.paintSvWrapEl.getBoundingClientRect();
        const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
        const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / Math.max(1, rect.height)));
        this._paintHsv.s = s;
        this._paintHsv.v = v;
        const hex = hsvToHex(this._paintHsv.h, s, v);
        this._applySelectedPaintHex(hex, false);
      };
      this.paintSvWrapEl.addEventListener('pointerdown', (e) => {
        draggingSv = true;
        try { this.paintSvWrapEl.setPointerCapture(e.pointerId); } catch (_) {}
        pickSv(e);
      });
      this.paintSvWrapEl.addEventListener('pointermove', (e) => {
        if (draggingSv) pickSv(e);
      });
      const stopSv = (e) => {
        if (!draggingSv) return;
        draggingSv = false;
        try { this.paintSvWrapEl.releasePointerCapture(e.pointerId); } catch (_) {}
      };
      this.paintSvWrapEl.addEventListener('pointerup', stopSv);
      this.paintSvWrapEl.addEventListener('pointercancel', stopSv);
    }

    // Hue Bar Drag
    if (this.paintHueWrapEl) {
      let draggingHue = false;
      const pickHue = (e) => {
        const rect = this.paintHueWrapEl.getBoundingClientRect();
        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
        this._paintHsv.h = frac * 359.9;
        this._redrawSvCanvas();
        const hex = hsvToHex(this._paintHsv.h, this._paintHsv.s, this._paintHsv.v);
        this._applySelectedPaintHex(hex, false);
      };
      this.paintHueWrapEl.addEventListener('pointerdown', (e) => {
        draggingHue = true;
        try { this.paintHueWrapEl.setPointerCapture(e.pointerId); } catch (_) {}
        pickHue(e);
      });
      this.paintHueWrapEl.addEventListener('pointermove', (e) => {
        if (draggingHue) pickHue(e);
      });
      const stopHue = (e) => {
        if (!draggingHue) return;
        draggingHue = false;
        try { this.paintHueWrapEl.releasePointerCapture(e.pointerId); } catch (_) {}
      };
      this.paintHueWrapEl.addEventListener('pointerup', stopHue);
      this.paintHueWrapEl.addEventListener('pointercancel', stopHue);
    }

    // Reset Stock Paint
    if (this.paintResetBtnEl) {
      this.paintResetBtnEl.addEventListener('click', () => {
        if (!this._paintCarId) return;
        const paintMap = resetSavedCarPaint(this._paintCarId);
        if (this.customizeShowroom) this.customizeShowroom.updatePaint(this._paintCarId, paintMap);
        if (this.applyCarPaintFn) this.applyCarPaintFn(this._paintCarId, paintMap);
        this._syncCustomizePaintUI(this._paintCarId, this._paintZoneKey);
        this._scheduleCarThumbnailRefresh(this._paintCarId, paintMap, true);
      });
    }
  }

  _redrawSvCanvas() {
    if (!this.paintSvCanvasEl) return;
    const ctx = this.paintSvCanvasEl.getContext('2d');
    const w = this.paintSvCanvasEl.width;
    const h = this.paintSvCanvasEl.height;
    const pureHue = hsvToHex(this._paintHsv.h, 1, 1);

    ctx.fillStyle = pureHue;
    ctx.fillRect(0, 0, w, h);

    const whiteGrad = ctx.createLinearGradient(0, 0, w, 0);
    whiteGrad.addColorStop(0, '#ffffff');
    whiteGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = whiteGrad;
    ctx.fillRect(0, 0, w, h);

    const blackGrad = ctx.createLinearGradient(0, 0, 0, h);
    blackGrad.addColorStop(0, 'rgba(0,0,0,0)');
    blackGrad.addColorStop(1, '#000000');
    ctx.fillStyle = blackGrad;
    ctx.fillRect(0, 0, w, h);
  }

  _syncGradientCursors() {
    if (this.paintSvCursorEl) {
      this.paintSvCursorEl.style.left = `${(this._paintHsv.s * 100).toFixed(1)}%`;
      this.paintSvCursorEl.style.top = `${((1 - this._paintHsv.v) * 100).toFixed(1)}%`;
    }
    if (this.paintHueCursorEl) {
      this.paintHueCursorEl.style.left = `${((this._paintHsv.h / 360) * 100).toFixed(1)}%`;
    }
  }

  _syncCustomizePaintUI(carId, preferredZone = null) {
    if (!carId) return;
    this._paintCarId = carId;
    const zones = getCarPaintZones(carId);
    const paintMap = getSavedCarPaint(carId);

    const validPreferred = preferredZone && zones.some((z) => z.key === preferredZone);
    this._paintZoneKey = validPreferred ? preferredZone : zones[0].key;

    // Render Paint Zone buttons (1 button for single-color cars, 2+ buttons for multi-color cars)
    if (this.paintZoneRowEl) {
      this.paintZoneRowEl.innerHTML = '';
      for (const z of zones) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'customize-zone-btn' + (z.key === this._paintZoneKey ? ' active' : '');
        btn.dataset.zoneKey = z.key;
        const curHex = paintMap[z.key] || z.defaultHex;
        btn.innerHTML = `<span class="customize-zone-chip" style="background:${curHex}"></span><span>${z.label}</span>`;
        btn.addEventListener('click', () => {
          this._syncCustomizePaintUI(carId, z.key);
        });
        this.paintZoneRowEl.appendChild(btn);
      }
    }

    const activeHex = (paintMap[this._paintZoneKey] || zones[0].defaultHex).toLowerCase();
    this._paintHsv = hexToHsv(activeHex);
    this._redrawSvCanvas();
    this._syncGradientCursors();
    this._updatePaintReadoutAndSwatches(activeHex);
  }

  _updatePaintReadoutAndSwatches(hex) {
    const cleanHex = String(hex || '#ffffff').toLowerCase();
    if (this.paintColorPreviewEl) this.paintColorPreviewEl.style.background = cleanHex;
    if (this.paintColorHexEl) this.paintColorHexEl.textContent = cleanHex.toUpperCase();

    if (this.paintSwatchGridEl) {
      const btns = this.paintSwatchGridEl.querySelectorAll('.customize-swatch-btn');
      btns.forEach((b) => b.classList.toggle('active', b.dataset.hex === cleanHex));
    }
    if (this.paintZoneRowEl) {
      const activeBtn = this.paintZoneRowEl.querySelector(`.customize-zone-btn[data-zone-key="${this._paintZoneKey}"] .customize-zone-chip`);
      if (activeBtn) activeBtn.style.background = cleanHex;
    }
  }

  _applySelectedPaintHex(hex, syncHsvFromHex = false) {
    if (!this._paintCarId || !this._paintZoneKey) return;
    const paintMap = setSavedCarPaint(this._paintCarId, this._paintZoneKey, hex);
    if (syncHsvFromHex) {
      this._paintHsv = hexToHsv(hex);
      this._redrawSvCanvas();
    }
    this._syncGradientCursors();
    this._updatePaintReadoutAndSwatches(hex);

    if (this.customizeShowroom) {
      this.customizeShowroom.updatePaint(this._paintCarId, paintMap);
    }
    if (this.applyCarPaintFn) {
      this.applyCarPaintFn(this._paintCarId, paintMap);
    }
    this._scheduleCarThumbnailRefresh(this._paintCarId, paintMap, syncHsvFromHex);
  }

  updateOnlineView() {
    const active = this.onlineSession.isActive();
    const isHostActive = active && this.onlineSession.isHost;
    const isJoining = this.onlineSession.status === 'joining';
    const isJoinedGuest = this.onlineSession.isJoinedAsGuest();

    if (this.onlineCreateBtnEl) {
      this.onlineCreateBtnEl.textContent = isHostActive ? 'END SESSION' : 'CREATE SESSION';
      this.onlineCreateBtnEl.disabled = isJoining;
    }
    if (this.onlineHostCodeBoxEl) {
      this.onlineHostCodeBoxEl.classList.toggle('active', isHostActive);
    }
    if (this.onlineHostCodeValueEl) {
      this.onlineHostCodeValueEl.textContent = isHostActive ? this.onlineSession.sessionCode : '---- ----';
      this.onlineHostCodeValueEl.classList.toggle('active', isHostActive);
    }

    if (this.onlineJoinBtnEl) {
      if (isJoining) {
        this.onlineJoinBtnEl.textContent = 'CONNECTING...';
        this.onlineJoinBtnEl.disabled = true;
      } else if (isJoinedGuest) {
        this.onlineJoinBtnEl.textContent = 'LEAVE SESSION';
        this.onlineJoinBtnEl.disabled = false;
      } else {
        this.onlineJoinBtnEl.textContent = 'JOIN SESSION';
        this.onlineJoinBtnEl.disabled = false;
      }
    }
    if (this.onlineJoinCodeInputEl) {
      if (isJoinedGuest) {
        this.onlineJoinCodeInputEl.value = '';
      }
      this.onlineJoinCodeInputEl.disabled = isJoining || isJoinedGuest;
    }
    if (this.onlineSession.errorMessage) {
      this.showOnlineToast(this.onlineSession.errorMessage);
      this.onlineSession.errorMessage = '';
    }

    if (!this.onlinePlayersListEl) return;
    this.onlinePlayersListEl.innerHTML = '';

    if (!active || this.onlineSession.players.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'pause-online-empty';
      emptyEl.textContent = isJoining ? 'Connecting to session...' : 'No session active.';
      this.onlinePlayersListEl.appendChild(emptyEl);
      return;
    }

    this.onlineSession.players.forEach((player) => {
      const row = document.createElement('div');
      row.className = 'pause-online-player-row';

      const info = document.createElement('div');
      info.className = 'pause-online-player-info';

      const nameRow = document.createElement('div');
      nameRow.className = 'pause-online-player-name-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'pause-online-player-name';
      nameEl.textContent = player.name;
      nameRow.appendChild(nameEl);

      if (player.isHost) {
        const badge = document.createElement('span');
        badge.className = 'pause-online-host-badge';
        badge.textContent = 'HOST';
        nameRow.appendChild(badge);
      }

      if (player.id === this.onlineSession.localId) {
        const youBadge = document.createElement('span');
        youBadge.className = 'pause-online-you-badge';
        youBadge.textContent = 'YOU';
        nameRow.appendChild(youBadge);
      }

      const carEl = document.createElement('div');
      carEl.className = 'pause-online-player-car';
      carEl.textContent = player.carName;

      const statusEl = document.createElement('div');
      statusEl.className = 'pause-online-player-status';
      const statusDot = document.createElement('span');
      statusDot.className = 'pause-online-status-dot';
      const statusText = document.createElement('span');
      statusText.textContent = 'IN SESSION';
      statusEl.appendChild(statusDot);
      statusEl.appendChild(statusText);

      info.appendChild(nameRow);
      info.appendChild(carEl);
      info.appendChild(statusEl);
      row.appendChild(info);

      if (player.carThumb || Number.isFinite(player.carIdx)) {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'pause-online-player-thumb-wrap';
        const img = document.createElement('img');
        img.className = 'pause-online-player-thumb';
        const matchedCar =
          (Number.isFinite(player.carIdx) && this.carRoster[player.carIdx]) ||
          this.carRoster.find((c) => c.name === player.carName || c.thumb === player.carThumb);

        if (player.id === this.onlineSession.localId && matchedCar) {
          img.src = this.getCarThumbSrc(matchedCar);
        } else if (matchedCar && this.customizeShowroom) {
          const paintKey = `${matchedCar.id}:${JSON.stringify(player.carPaint || null)}`;
          if (this._onlinePaintThumbs[paintKey]) {
            img.src = this._onlinePaintThumbs[paintKey];
          } else {
            img.src = player.carThumb || matchedCar.thumb || '';
            this.customizeShowroom.renderPixelThumbnail(matchedCar, player.carPaint || null).then((dataUrl) => {
              if (!dataUrl) return;
              this._onlinePaintThumbs[paintKey] = dataUrl;
              img.src = dataUrl;
            });
          }
        } else {
          img.src = player.carThumb || '';
        }
        img.alt = player.carName;
        thumbWrap.appendChild(img);
        row.appendChild(thumbWrap);
      }

      this.onlinePlayersListEl.appendChild(row);
    });
    requestAnimationFrame(() => this._updatePlayersScrollFade());
  }

  _updatePlayersScrollFade() {
    const el = this.onlinePlayersListEl;
    if (!el) return;
    const canScroll = el.scrollHeight > el.clientHeight + 2;
    const fadeTop = canScroll && el.scrollTop > 4;
    const fadeBottom = canScroll && el.scrollTop + el.clientHeight < el.scrollHeight - 4;
    el.classList.toggle('fade-top', fadeTop);
    el.classList.toggle('fade-bottom', fadeBottom);
  }

  showOnlineToast(message, durationMs = 3800) {
    if (!this.onlineToastEl || !this.onlineToastTextEl) return;
    this.onlineToastTextEl.textContent = message;
    this.onlineToastEl.classList.remove('hidden');
    if (this.onlineToastTimer) {
      clearTimeout(this.onlineToastTimer);
    }
    this.onlineToastTimer = setTimeout(() => {
      if (this.onlineToastEl) {
        this.onlineToastEl.classList.add('hidden');
      }
      this.onlineToastTimer = null;
    }, durationMs);
  }

  showSyncOverlay(stageText = 'SYNCING SESSION...', progressPct = 30) {
    if (this.onlineSyncStageEl) {
      this.onlineSyncStageEl.textContent = stageText;
    }
    if (this.onlineSyncBarEl) {
      this.onlineSyncBarEl.style.width = `${Math.max(8, Math.min(100, progressPct))}%`;
    }
    if (this.onlineSyncOverlayEl) {
      this.onlineSyncOverlayEl.classList.remove('hidden');
    }
  }

  hideSyncOverlay() {
    if (this.onlineSyncOverlayEl) {
      this.onlineSyncOverlayEl.classList.add('hidden');
    }
  }
}

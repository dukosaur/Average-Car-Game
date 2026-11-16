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
    resetVehicleFn
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
    this.resetVehicleFn = resetVehicleFn;

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
    this.tabOnlineEl = document.getElementById('pause-tab-online');
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
      const stats = car.stats || {};
      const topSpeedMph = stats.topSpeedMph || 138;
      const speedRating = Math.max(10, Math.min(100, stats.speedRating || 78));

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
          <div class="pause-car-stats-panel">
            <div class="pause-car-stat-row">
              <span class="pause-car-stat-label">SPEED</span>
              <span class="pause-car-stat-val">${topSpeedMph} MPH</span>
            </div>
            <div class="pause-car-stat-bar">
              <div class="pause-car-stat-fill" style="width: ${speedRating}%;"></div>
            </div>
          </div>
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
    if (!this.carsGridEl) return;
    const cards = this.carsGridEl.querySelectorAll('.pause-car-card');
    cards.forEach((c, idx) => {
      c.classList.toggle('keyboard-focused', idx === this.focusedCarIndex);
    });
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

  updateTilePreviews() {
    const currentCar = this.getActiveCar();

    if (currentCar) {
      const carIdx = this.getActiveCarIndexFn ? this.getActiveCarIndexFn() : 0;
      if (this.headerCarNameEl) this.headerCarNameEl.textContent = currentCar.fullName;
      if (this.tileGarageNameEl) this.tileGarageNameEl.textContent = currentCar.name;
      if (this.tileGarageImgEl) {
        this.tileGarageImgEl.src = currentCar.thumb;
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
    } else {
      if (this.input) {
        this.input.handbrake = false;
      }
    }
  }

  setTab(tab) {
    this.activeTab = tab === 'online' ? 'online' : 'home';
    if (this.shellEl) {
      this.shellEl.classList.toggle('tab-online', this.activeTab === 'online');
    }
    if (this.tabHomeEl) {
      this.tabHomeEl.classList.toggle('active', this.activeTab === 'home');
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

      if (player.carThumb) {
        const thumbWrap = document.createElement('div');
        thumbWrap.className = 'pause-online-player-thumb-wrap';
        const img = document.createElement('img');
        img.className = 'pause-online-player-thumb';
        img.src = player.carThumb;
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

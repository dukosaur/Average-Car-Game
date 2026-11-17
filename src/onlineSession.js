// Paste your deployed Render WebSocket URL here (e.g. 'wss://average-car-game-relay.onrender.com')
const PROD_RELAY_URL = '';
const LOCAL_RELAY_URL = 'ws://localhost:8080';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_TIMEOUT_MS = 35000; // Allow Render free tier cold-start wake-up

function getRelayBaseUrl() {
  if (typeof window !== 'undefined' && window.__relayUrl) return window.__relayUrl;
  if (import.meta.env && import.meta.env.VITE_RELAY_URL) return import.meta.env.VITE_RELAY_URL;
  if (PROD_RELAY_URL) return PROD_RELAY_URL;
  return LOCAL_RELAY_URL;
}

const PKT_PLAYER_SINGLE = 1;
const PKT_PLAYERS_BATCH = 2;
const PKT_TRAFFIC_BATCH = 3;
const PKT_BUMP_IMPULSE = 4;

function generateRawCode() {
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return raw;
}

export function formatSessionCode(raw) {
  const clean = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)} ${clean.slice(4)}` : clean;
}

function makeLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function encodePlayerStatePacketInto(dv, netId, carIdx, timestamp, s, isAway = false) {
  dv.setUint8(0, PKT_PLAYER_SINGLE);
  dv.setUint8(1, carIdx & 0xff);
  dv.setUint16(2, netId & 0xffff, true);
  dv.setFloat64(4, timestamp, true);
  let off = 12;
  dv.setFloat32(off, s.px, true); off += 4;
  dv.setFloat32(off, s.py, true); off += 4;
  dv.setFloat32(off, s.pz, true); off += 4;
  dv.setFloat32(off, s.qx, true); off += 4;
  dv.setFloat32(off, s.qy, true); off += 4;
  dv.setFloat32(off, s.qz, true); off += 4;
  dv.setFloat32(off, s.qw, true); off += 4;
  dv.setFloat32(off, s.vx, true); off += 4;
  dv.setFloat32(off, s.vy, true); off += 4;
  dv.setFloat32(off, s.vz, true); off += 4;
  dv.setFloat32(off, s.steer, true); off += 4;
  dv.setFloat32(off, s.spin, true); off += 4;
  dv.setFloat32(off, isAway ? -1.0 : (s.brake || 0), true);
}

function decodePlayerStatePacket(dv) {
  let off = 12;
  const rawBrake = dv.getFloat32(off + 48, true);
  return {
    type: PKT_PLAYER_SINGLE,
    carIdx: dv.getUint8(1),
    netId: dv.getUint16(2, true),
    timestamp: dv.getFloat64(4, true),
    px: dv.getFloat32(off, true),
    py: dv.getFloat32(off + 4, true),
    pz: dv.getFloat32(off + 8, true),
    qx: dv.getFloat32(off + 12, true),
    qy: dv.getFloat32(off + 16, true),
    qz: dv.getFloat32(off + 20, true),
    qw: dv.getFloat32(off + 24, true),
    vx: dv.getFloat32(off + 28, true),
    vy: dv.getFloat32(off + 32, true),
    vz: dv.getFloat32(off + 36, true),
    steer: dv.getFloat32(off + 40, true),
    spin: dv.getFloat32(off + 44, true),
    brake: rawBrake < 0 ? 0 : rawBrake,
    isAway: rawBrake < 0,
  };
}

function encodePlayersBatchPacket(timestamp, list) {
  const count = Math.min(list.length, 255);
  const stride = 60;
  const buf = new ArrayBuffer(12 + count * stride);
  const dv = new DataView(buf);
  dv.setUint8(0, PKT_PLAYERS_BATCH);
  dv.setUint8(1, count);
  dv.setFloat64(4, timestamp, true);
  let off = 12;
  for (let i = 0; i < count; i++) {
    const s = list[i];
    const ageMs = s.recvAtHost ? Math.min(1000, Math.max(0, Math.round(timestamp - s.recvAtHost))) : 0;
    dv.setUint16(off, s.netId & 0xffff, true);
    dv.setUint8(off + 2, s.carIdx & 0xff);
    dv.setUint8(off + 3, s.isAway ? 1 : 0);
    dv.setUint16(off + 4, ageMs, true);
    dv.setFloat32(off + 8, s.px, true);
    dv.setFloat32(off + 12, s.py, true);
    dv.setFloat32(off + 16, s.pz, true);
    dv.setFloat32(off + 20, s.qx, true);
    dv.setFloat32(off + 24, s.qy, true);
    dv.setFloat32(off + 28, s.qz, true);
    dv.setFloat32(off + 32, s.qw, true);
    dv.setFloat32(off + 36, s.vx, true);
    dv.setFloat32(off + 40, s.vy, true);
    dv.setFloat32(off + 44, s.vz, true);
    dv.setFloat32(off + 48, s.steer, true);
    dv.setFloat32(off + 52, s.spin, true);
    dv.setFloat32(off + 56, s.brake, true);
    off += stride;
  }
  return buf;
}

function decodePlayersBatchPacket(dv) {
  const count = dv.getUint8(1);
  const timestamp = dv.getFloat64(4, true);
  const stride = 60;
  const states = new Array(count);
  let off = 12;
  for (let i = 0; i < count; i++) {
    states[i] = {
      netId: dv.getUint16(off, true),
      carIdx: dv.getUint8(off + 2),
      isAway: dv.getUint8(off + 3) === 1,
      ageMs: dv.getUint16(off + 4, true),
      px: dv.getFloat32(off + 8, true),
      py: dv.getFloat32(off + 12, true),
      pz: dv.getFloat32(off + 16, true),
      qx: dv.getFloat32(off + 20, true),
      qy: dv.getFloat32(off + 24, true),
      qz: dv.getFloat32(off + 28, true),
      qw: dv.getFloat32(off + 32, true),
      vx: dv.getFloat32(off + 36, true),
      vy: dv.getFloat32(off + 40, true),
      vz: dv.getFloat32(off + 44, true),
      steer: dv.getFloat32(off + 48, true),
      spin: dv.getFloat32(off + 52, true),
      brake: dv.getFloat32(off + 56, true),
    };
    off += stride;
  }
  return { timestamp, states };
}

function encodeTrafficBatchPacket(snapshot) {
  const vehicles = snapshot.vehicles || [];
  const count = Math.min(vehicles.length, 65535);
  const stride = 64;
  const buf = new ArrayBuffer(12 + count * stride);
  const dv = new DataView(buf);
  dv.setUint8(0, PKT_TRAFFIC_BATCH);
  dv.setUint16(2, count, true);
  dv.setFloat64(4, snapshot.timestamp, true);
  let off = 12;
  for (let i = 0; i < count; i++) {
    const v = vehicles[i];
    dv.setUint32(off, v.id >>> 0, true);
    dv.setUint8(off + 4, v.specIndex & 0xff);
    dv.setUint32(off + 8, v.paintColorHex >>> 0, true);
    dv.setFloat32(off + 12, v.px, true);
    dv.setFloat32(off + 16, v.py, true);
    dv.setFloat32(off + 20, v.pz, true);
    dv.setFloat32(off + 24, v.qx, true);
    dv.setFloat32(off + 28, v.qy, true);
    dv.setFloat32(off + 32, v.qz, true);
    dv.setFloat32(off + 36, v.qw, true);
    dv.setFloat32(off + 40, v.vx, true);
    dv.setFloat32(off + 44, v.vy, true);
    dv.setFloat32(off + 48, v.vz, true);
    dv.setFloat32(off + 52, v.steer, true);
    dv.setFloat32(off + 56, v.spin, true);
    dv.setFloat32(off + 60, v.brake, true);
    off += stride;
  }
  return buf;
}

function decodeTrafficBatchPacket(dv) {
  const count = dv.getUint16(2, true);
  const timestamp = dv.getFloat64(4, true);
  const stride = 64;
  const vehicles = new Array(count);
  let off = 12;
  for (let i = 0; i < count; i++) {
    vehicles[i] = {
      id: dv.getUint32(off, true),
      specIndex: dv.getUint8(off + 4),
      paintColorHex: dv.getUint32(off + 8, true),
      px: dv.getFloat32(off + 12, true),
      py: dv.getFloat32(off + 16, true),
      pz: dv.getFloat32(off + 20, true),
      qx: dv.getFloat32(off + 24, true),
      qy: dv.getFloat32(off + 28, true),
      qz: dv.getFloat32(off + 32, true),
      qw: dv.getFloat32(off + 36, true),
      vx: dv.getFloat32(off + 40, true),
      vy: dv.getFloat32(off + 44, true),
      vz: dv.getFloat32(off + 48, true),
      steer: dv.getFloat32(off + 52, true),
      spin: dv.getFloat32(off + 56, true),
      brake: dv.getFloat32(off + 60, true),
    };
    off += stride;
  }
  return { timestamp, vehicles };
}

function toArrayBuffer(data) {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return null;
}

function encodeBumpPacket(targetNetId, dvx, dvz, torqueY) {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  dv.setUint8(0, PKT_BUMP_IMPULSE);
  dv.setUint16(2, targetNetId & 0xffff, true);
  dv.setFloat32(4, dvx, true);
  dv.setFloat32(8, dvz, true);
  dv.setFloat32(12, torqueY, true);
  return buf;
}

function decodeBumpPacket(dv) {
  return {
    targetNetId: dv.getUint16(2, true),
    dvx: dv.getFloat32(4, true),
    dvz: dv.getFloat32(8, true),
    torqueY: dv.getFloat32(12, true),
  };
}

/**
 * Manages multiplayer sessions + low-latency WebSocket (wss://) relay state/traffic sync.
 */
export class OnlineSessionManager {
  constructor(onChange = null) {
    this.onChange = onChange;
    this.localId = makeLocalId();
    this.localName = 'Driver';
    this.localNetId = 1;
    this.nextNetId = 2;
    this.ws = null;
    this.connectedGuestIds = new Set();
    this.joinTimeout = null;
    this.wakeTimer = null;

    this.sessionCode = null;
    this.isHost = false;
    this.status = 'idle'; // 'idle' | 'creating' | 'joining' | 'active'
    this.errorMessage = '';
    this.players = [];

    // Host-side latest kinematic states keyed by netId
    this.latestPlayerStates = new Map();
    this._singleBuf = new ArrayBuffer(64);
    this._singleDv = new DataView(this._singleBuf);

    // Runtime callbacks wired by main.js
    this.getInitialWorldStateFn = null;
    this.onWorldInitFn = null;
    this.onPlayerStatesFn = null;
    this.onTrafficSnapshotFn = null;
    this.onBumpImpulseFn = null;
    this.onSessionEndedFn = null;
    this.onSyncStageFn = null;

    window.addEventListener('beforeunload', () => this.leaveSession(true));
  }

  setLocalName(name) {
    const cleaned = String(name || '').trim().slice(0, 16);
    this.localName = cleaned || 'Driver';
  }

  _emitChange() {
    if (typeof this.onChange === 'function') {
      this.onChange();
    }
  }

  _emitSyncStage(text, pct) {
    if (typeof this.onSyncStageFn === 'function') {
      this.onSyncStageFn(text, pct);
    }
  }

  isActive() {
    return this.status === 'active' || this.status === 'creating';
  }

  isJoinedAsGuest() {
    return this.status === 'active' && !this.isHost;
  }

  _cleanupNetwork() {
    if (this.joinTimeout) {
      clearTimeout(this.joinTimeout);
      this.joinTimeout = null;
    }
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
    this.connectedGuestIds.clear();
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    this.latestPlayerStates.clear();
  }

  _sendJson(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  _broadcastPlayers() {
    this._sendJson({
      type: 'players',
      players: this.players.map((p) => ({
        id: p.id,
        netId: p.netId,
        carIdx: p.carIdx,
        name: p.name,
        carName: p.carName,
        carThumb: p.carThumb,
        isHost: p.isHost,
      })),
    });
  }

  _handleFastBinary(data) {
    const buf = toArrayBuffer(data);
    if (!buf || buf.byteLength < 12) return;
    const dv = new DataView(buf);
    const pktType = dv.getUint8(0);
    if (pktType === PKT_PLAYER_SINGLE) {
      const s = decodePlayerStatePacket(dv);
      if (this.isHost && s.netId !== this.localNetId) {
        s.recvAtHost = performance.now();
        this.latestPlayerStates.set(s.netId, s);
        if (typeof this.onPlayerStatesFn === 'function') {
          this.onPlayerStatesFn(s.timestamp, [s]);
        }
      }
    } else if (pktType === PKT_PLAYERS_BATCH) {
      const batch = decodePlayersBatchPacket(dv);
      if (!this.isHost && typeof this.onPlayerStatesFn === 'function') {
        this.onPlayerStatesFn(batch.timestamp, batch.states);
      }
    } else if (pktType === PKT_TRAFFIC_BATCH) {
      const snapshot = decodeTrafficBatchPacket(dv);
      if (!this.isHost && typeof this.onTrafficSnapshotFn === 'function') {
        this.onTrafficSnapshotFn(snapshot);
      }
    } else if (pktType === PKT_BUMP_IMPULSE && buf.byteLength >= 16) {
      const bump = decodeBumpPacket(dv);
      if (bump.targetNetId === this.localNetId) {
        if (typeof this.onBumpImpulseFn === 'function') {
          this.onBumpImpulseFn(bump);
        }
      } else if (this.isHost && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(buf);
      }
    }
  }

  createSession(car, carIdx = 0) {
    this.leaveSession(true);
    const rawCode = generateRawCode();
    this.sessionCode = formatSessionCode(rawCode);
    this.isHost = true;
    this.localNetId = 1;
    this.nextNetId = 2;
    this.status = 'creating';
    this.errorMessage = '';
    this.players = [
      {
        id: this.localId,
        netId: 1,
        guestId: null,
        carIdx,
        name: this.localName,
        carName: car?.name || 'Unknown Car',
        carThumb: car?.thumb || '',
        isHost: true,
      },
    ];
    this._emitChange();

    const wsUrl = `${getRelayBaseUrl()}?role=host&code=${rawCode}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws) return;
      if (ev.data instanceof ArrayBuffer) {
        this._handleFastBinary(ev.data);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'room-created') {
        this.status = 'active';
        this.errorMessage = '';
        this._emitChange();
      } else if (msg.type === 'guest-joined' && msg.guestId) {
        this.connectedGuestIds.add(msg.guestId);
      } else if (msg.type === 'guest-left' && msg.guestId) {
        this.connectedGuestIds.delete(msg.guestId);
        const removed = this.players.filter((p) => p.guestId === msg.guestId);
        if (removed.length > 0) {
          for (const r of removed) {
            this.latestPlayerStates.delete(r.netId);
          }
          this.players = this.players.filter((p) => p.guestId !== msg.guestId);
          this._broadcastPlayers();
          this._emitChange();
        }
      } else if (msg.type === 'hello' && msg.player && msg.fromGuestId) {
        const guestId = msg.fromGuestId;
        this.connectedGuestIds.add(guestId);
        let target = this.players.find((p) => p.id === msg.player.id || p.guestId === guestId);
        if (!target) {
          const netId = this.nextNetId++;
          target = {
            id: msg.player.id || guestId,
            netId,
            guestId,
            carIdx: msg.player.carIdx ?? 0,
            name: msg.player.name || 'Guest',
            carName: msg.player.carName || 'Unknown Car',
            carThumb: msg.player.carThumb || '',
            isHost: false,
          };
          this.players.push(target);
        } else {
          target.guestId = guestId;
          target.carIdx = msg.player.carIdx ?? target.carIdx;
          target.carName = msg.player.carName || target.carName;
          target.carThumb = msg.player.carThumb || target.carThumb;
        }

        const initSnapshot =
          typeof this.getInitialWorldStateFn === 'function' ? this.getInitialWorldStateFn() : {};
        this._sendJson({
          type: 'world-init',
          targetGuestId: guestId,
          assignedNetId: target.netId,
          players: this.players.map((p) => ({
            id: p.id,
            netId: p.netId,
            carIdx: p.carIdx,
            name: p.name,
            carName: p.carName,
            carThumb: p.carThumb,
            isHost: p.isHost,
          })),
          hostState: initSnapshot.hostState || null,
          trafficSnapshot: initSnapshot.trafficSnapshot || null,
        });

        this._broadcastPlayers();
        this._emitChange();
      } else if (msg.type === 'car-update') {
        const target = this.players.find((p) => p.id === msg.id || (msg.fromGuestId && p.guestId === msg.fromGuestId));
        if (target) {
          target.carIdx = msg.carIdx ?? target.carIdx;
          target.carName = msg.carName || target.carName;
          target.carThumb = msg.carThumb || target.carThumb;
          this._broadcastPlayers();
          this._emitChange();
        }
      } else if (msg.type === 'relay-error') {
        this._cleanupNetwork();
        this.status = 'idle';
        this.sessionCode = null;
        this.players = [];
        this.errorMessage = msg.reason || 'RELAY ERROR';
        this._emitChange();
      }
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      const wasActive = this.status === 'active' || this.status === 'creating';
      this._cleanupNetwork();
      this.status = 'idle';
      this.sessionCode = null;
      this.players = [];
      if (wasActive && !this.errorMessage) {
        this.errorMessage = 'RELAY DISCONNECTED';
      }
      if (typeof this.onSessionEndedFn === 'function') this.onSessionEndedFn();
      this._emitChange();
    });

    ws.addEventListener('error', () => {
      if (this.ws !== ws) return;
      this.errorMessage = 'RELAY CONNECTION ERROR';
      this._emitChange();
    });

    return this.sessionCode;
  }

  joinSession(rawInput, car, carIdx = 0) {
    const clean = String(rawInput || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 8) {
      this.errorMessage = 'ENTER AN 8-CHARACTER CODE';
      this._emitChange();
      return false;
    }

    this.leaveSession(true);
    this.isHost = false;
    this.status = 'joining';
    this.errorMessage = '';
    this.sessionCode = formatSessionCode(clean);
    this._emitSyncStage('CONNECTING TO RELAY...', 20);
    this._emitChange();

    const wsUrl = `${getRelayBaseUrl()}?role=guest&code=${clean}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    this.wakeTimer = setTimeout(() => {
      if (this.ws === ws && this.status === 'joining') {
        this._emitSyncStage('WAKING RELAY SERVER...', 30);
      }
    }, 3000);

    this.joinTimeout = setTimeout(() => {
      if (this.ws !== ws || this.status !== 'joining') return;
      this._cleanupNetwork();
      this.status = 'idle';
      this.sessionCode = null;
      this.players = [];
      this.errorMessage = 'SESSION NOT FOUND OR TIMED OUT';
      if (typeof this.onSessionEndedFn === 'function') this.onSessionEndedFn();
      this._emitChange();
    }, JOIN_TIMEOUT_MS);

    ws.addEventListener('message', async (ev) => {
      if (this.ws !== ws) return;
      if (ev.data instanceof ArrayBuffer) {
        this._handleFastBinary(ev.data);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'room-joined') {
        this._emitSyncStage('REQUESTING WORLD STATE...', 45);
        this._sendJson({
          type: 'hello',
          player: {
            id: this.localId,
            carIdx,
            name: this.localName,
            carName: car?.name || 'Unknown Car',
            carThumb: car?.thumb || '',
          },
        });
      } else if (msg.type === 'world-init') {
        if (this.joinTimeout) {
          clearTimeout(this.joinTimeout);
          this.joinTimeout = null;
        }
        if (this.wakeTimer) {
          clearTimeout(this.wakeTimer);
          this.wakeTimer = null;
        }
        this.localNetId = msg.assignedNetId || 2;
        this.players = Array.isArray(msg.players) ? msg.players : [];
        this.status = 'active';
        this.errorMessage = '';

        if (typeof this.onWorldInitFn === 'function') {
          await this.onWorldInitFn(msg);
        }
        this._emitChange();
      } else if (msg.type === 'players' && Array.isArray(msg.players)) {
        this.players = msg.players;
        this._emitChange();
      } else if (msg.type === 'host-left') {
        this._cleanupNetwork();
        this.status = 'idle';
        this.sessionCode = null;
        this.players = [];
        this.errorMessage = 'HOST ENDED THE SESSION';
        if (typeof this.onSessionEndedFn === 'function') this.onSessionEndedFn();
        this._emitChange();
      } else if (msg.type === 'relay-error') {
        this._cleanupNetwork();
        this.status = 'idle';
        this.sessionCode = null;
        this.players = [];
        this.errorMessage = msg.reason || 'UNABLE TO JOIN SESSION';
        if (typeof this.onSessionEndedFn === 'function') this.onSessionEndedFn();
        this._emitChange();
      }
    });

    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      const wasActive = this.status === 'active';
      const hadError = Boolean(this.errorMessage);
      this._cleanupNetwork();
      this.status = 'idle';
      this.sessionCode = null;
      this.players = [];
      if (!hadError) {
        this.errorMessage = wasActive ? 'HOST ENDED THE SESSION' : 'UNABLE TO JOIN SESSION';
      }
      if (typeof this.onSessionEndedFn === 'function') this.onSessionEndedFn();
      this._emitChange();
    });

    ws.addEventListener('error', () => {
      if (this.ws !== ws) return;
      this._cleanupNetwork();
      this.status = 'idle';
      this.sessionCode = null;
      this.players = [];
      this.errorMessage = 'CONNECTION ERROR';
      if (typeof this.onSessionEndedFn === 'function') this.onSessionEndedFn();
      this._emitChange();
    });

    return true;
  }

  leaveSession(silent = false) {
    const hadSession = this.isActive() || this.status === 'joining';
    this._cleanupNetwork();
    this.sessionCode = null;
    this.isHost = false;
    this.status = 'idle';
    this.errorMessage = '';
    this.players = [];
    if (hadSession && typeof this.onSessionEndedFn === 'function') {
      this.onSessionEndedFn();
    }
    if (!silent) {
      this._emitChange();
    }
  }

  updateLocalCar(car, carIdx = 0) {
    if (!this.isActive() || !car) return;
    if (this.isHost) {
      const localPlayer = this.players.find((p) => p.id === this.localId);
      if (localPlayer) {
        localPlayer.carIdx = carIdx;
        localPlayer.carName = car.name || 'Unknown Car';
        localPlayer.carThumb = car.thumb || '';
        this._broadcastPlayers();
      }
    } else {
      this._sendJson({
        type: 'car-update',
        id: this.localId,
        carIdx,
        carName: car.name || 'Unknown Car',
        carThumb: car.thumb || '',
      });
    }
  }

  sendLocalPlayerState(localState, carIdx = 0, isAway = false) {
    if (this.status !== 'active') return;
    const now = performance.now();

    if (this.isHost) {
      const selfEntry = { netId: this.localNetId, carIdx, isAway, recvAtHost: now, ...localState };
      this.latestPlayerStates.set(this.localNetId, selfEntry);
      if (this.connectedGuestIds.size === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.ws.bufferedAmount >= 65536) return;

      const list = Array.from(this.latestPlayerStates.values());
      const buf = encodePlayersBatchPacket(now, list);
      this.ws.send(buf);
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.bufferedAmount < 32768) {
      encodePlayerStatePacketInto(this._singleDv, this.localNetId, carIdx, now, localState, isAway);
      this.ws.send(this._singleBuf);
    }
  }

  hasConnectedGuests() {
    return this.isHost && this.connectedGuestIds.size > 0;
  }

  sendTrafficSnapshot(snapshot) {
    if (
      this.status !== 'active' ||
      !this.isHost ||
      this.connectedGuestIds.size === 0 ||
      !snapshot ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      this.ws.bufferedAmount >= 131072
    ) {
      return;
    }
    const buf = encodeTrafficBatchPacket(snapshot);
    this.ws.send(buf);
  }

  sendBumpImpulse(targetNetId, dvx, dvz, torqueY = 0) {
    if (this.status !== 'active' || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = encodeBumpPacket(targetNetId, dvx, dvz, torqueY);
    this.ws.send(buf);
  }
}

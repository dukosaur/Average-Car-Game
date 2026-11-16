import * as THREE from 'three';

const REMOTE_PLAYER_COLLISION_GROUPS = (0x0004 << 16) | 0xFFFF;
const DEFAULT_CHASSIS_DIMS = new THREE.Vector3(1.86, 0.96, 4.36);
const REMOTE_PLAYER_MASS = 1320;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Renders and physically simulates remote multiplayer players using equal-mass dynamic
 * Rapier bodies (soft yield on contact + mutual bump relay) and Cubic Hermite interpolation.
 */
export class MultiplayerWorldSync {
  constructor(RAPIER, world, scene, createAICarPartsFn, carRoster) {
    this.RAPIER = RAPIER;
    this.world = world;
    this.scene = scene;
    this.createAICarParts = createAICarPartsFn;
    this.carRoster = carRoster || [];

    this.remotePlayers = new Map(); // netId -> proxy
    this.nameplatesContainer = null;
    this._q0 = new THREE.Quaternion();
    this._q1 = new THREE.Quaternion();
    this._projVec = new THREE.Vector3();
  }

  setNameplatesContainer(el) {
    this.nameplatesContainer = el || null;
    for (const proxy of this.remotePlayers.values()) {
      this._ensureNameplate(proxy);
    }
  }

  _ensureNameplate(proxy) {
    if (!this.nameplatesContainer || !proxy || proxy.nameplateEl) return;
    const el = document.createElement('div');
    el.className = 'remote-nameplate';
    const pill = document.createElement('div');
    pill.className = 'remote-nameplate-pill';
    pill.textContent = proxy.name || 'Driver';
    const arrow = document.createElement('div');
    arrow.className = 'remote-nameplate-arrow';
    el.appendChild(pill);
    el.appendChild(arrow);
    this.nameplatesContainer.appendChild(el);
    proxy.nameplateEl = el;
    proxy.nameplatePillEl = pill;
  }

  _getCarItem(carIdx) {
    if (this.carRoster.length === 0) return null;
    const safeIdx = ((carIdx || 0) % this.carRoster.length + this.carRoster.length) % this.carRoster.length;
    return this.carRoster[safeIdx];
  }

  async syncRoster(players, localNetId, initialHostState = null) {
    const activeRemoteIds = new Set();
    const tasks = [];

    for (const p of players) {
      if (!p || p.netId === localNetId) continue;
      activeRemoteIds.add(p.netId);
      const carIdx = p.carIdx ?? 0;
      let proxy = this.remotePlayers.get(p.netId);

      if (!proxy) {
        const seedPose = p.isHost && initialHostState
          ? initialHostState
          : { px: 0, py: -40, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, steer: 0, spin: 0, brake: 0 };

        proxy = {
          netId: p.netId,
          id: p.id,
          name: p.name || 'Driver',
          carIdx,
          loadingCarIdx: null,
          disposed: false,
          rootGroup: new THREE.Group(),
          wheels: [],
          chassisLocalOffset: new THREE.Vector3(0, 0.36, 0),
          nameHeight: 1.85,
          nameplateEl: null,
          nameplatePillEl: null,
          rigidBody: null,
          chassisCollider: null,
          cabinCollider: null,
          brakeUniform: { value: 0 },
          targetBrakeLight: 0,
          clonedMaterials: [],
          snapshots: [],
          clockOffset: null,
          jitterMs: 0,
          interpDelayMs: 14,
          lastSenderTs: null,
          lastRecvMs: null,
          lastContactMs: -10000,
          lastBumpSentMs: -10000,
          isAway: false,
          isGhosted: false,
          pose: { ...seedPose },
        };
        proxy.rootGroup.name = `Remote_Player_${p.netId}`;
        this._initDynamicProxyBody(proxy);
        this.scene.add(proxy.rootGroup);
        this.remotePlayers.set(p.netId, proxy);
        this._ensureNameplate(proxy);
        tasks.push(this._loadProxyCarModel(proxy, carIdx));
      } else {
        const nextName = p.name || 'Driver';
        if (proxy.name !== nextName) {
          proxy.name = nextName;
          if (proxy.nameplatePillEl) proxy.nameplatePillEl.textContent = nextName;
        }
        if (proxy.carIdx !== carIdx && proxy.loadingCarIdx !== carIdx) {
          proxy.carIdx = carIdx;
          tasks.push(this._loadProxyCarModel(proxy, carIdx));
        }
      }
    }

    for (const [netId, proxy] of this.remotePlayers.entries()) {
      if (!activeRemoteIds.has(netId)) {
        this._destroyProxy(proxy);
        this.remotePlayers.delete(netId);
      }
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }

  _initDynamicProxyBody(proxy) {
    const { RAPIER, world } = this;
    const p = proxy.pose;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.px, p.py, p.pz)
      .setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw })
      .setGravityScale(0.0)
      .setLinearDamping(0.6)
      .setAngularDamping(6.0)
      .setCanSleep(false);
    const body = world.createRigidBody(bodyDesc);

    const { lowerHull, upperCabin } = this._buildProxyColliderDescs(null);
    proxy.chassisCollider = world.createCollider(lowerHull, body);
    proxy.cabinCollider = world.createCollider(upperCabin, body);
    proxy.rigidBody = body;
  }

  _buildProxyColliderDescs(bounds = null) {
    const { RAPIER } = this;
    let lowerHull;
    let upperCabin;

    if (bounds && bounds.size && bounds.center) {
      const s = bounds.size;
      const c = bounds.center;
      const rawBottomY = c.y - s.y * 0.5;
      const clearedBottomY = Math.max(rawBottomY + 0.16, -0.05);
      const lowerHy = Math.max(0.12, s.y * 0.20);
      const upperHy = Math.max(0.14, s.y * 0.22);

      lowerHull = RAPIER.ColliderDesc.cuboid(s.x * 0.48, lowerHy, s.z * 0.48)
        .setTranslation(c.x, clearedBottomY + lowerHy, c.z)
        .setMass(REMOTE_PLAYER_MASS * 0.85)
        .setFriction(0.14)
        .setRestitution(0.0)
        .setCollisionGroups(REMOTE_PLAYER_COLLISION_GROUPS);

      upperCabin = RAPIER.ColliderDesc.cuboid(s.x * 0.42, upperHy, s.z * 0.26)
        .setTranslation(c.x, clearedBottomY + lowerHy * 2.0 + upperHy, c.z - s.z * 0.04)
        .setMass(REMOTE_PLAYER_MASS * 0.15)
        .setFriction(0.14)
        .setRestitution(0.0)
        .setCollisionGroups(REMOTE_PLAYER_COLLISION_GROUPS);
    } else {
      lowerHull = RAPIER.ColliderDesc.cuboid(
        DEFAULT_CHASSIS_DIMS.x * 0.48,
        0.16,
        DEFAULT_CHASSIS_DIMS.z * 0.48
      )
        .setTranslation(0, 0.11, 0)
        .setMass(REMOTE_PLAYER_MASS * 0.85)
        .setFriction(0.14)
        .setRestitution(0.0)
        .setCollisionGroups(REMOTE_PLAYER_COLLISION_GROUPS);

      upperCabin = RAPIER.ColliderDesc.cuboid(
        DEFAULT_CHASSIS_DIMS.x * 0.42,
        0.20,
        DEFAULT_CHASSIS_DIMS.z * 0.25
      )
        .setTranslation(0, 0.44, -0.15)
        .setMass(REMOTE_PLAYER_MASS * 0.15)
        .setFriction(0.14)
        .setRestitution(0.0)
        .setCollisionGroups(REMOTE_PLAYER_COLLISION_GROUPS);
    }
    return { lowerHull, upperCabin };
  }

  _rebuildProxyColliders(proxy, bounds) {
    if (!this.world || !proxy.rigidBody || !bounds) return;
    if (proxy.chassisCollider) {
      this.world.removeCollider(proxy.chassisCollider, false);
      proxy.chassisCollider = null;
    }
    if (proxy.cabinCollider) {
      this.world.removeCollider(proxy.cabinCollider, false);
      proxy.cabinCollider = null;
    }
    const { lowerHull, upperCabin } = this._buildProxyColliderDescs(bounds);
    proxy.chassisCollider = this.world.createCollider(lowerHull, proxy.rigidBody);
    proxy.cabinCollider = this.world.createCollider(upperCabin, proxy.rigidBody);
  }

  async _loadProxyCarModel(proxy, carIdx) {
    const carItem = this._getCarItem(carIdx);
    if (!carItem) return;
    proxy.loadingCarIdx = carIdx;

    try {
      const { parts, clonedMaterials, bounds } = await this.createAICarParts(
        carItem.url,
        proxy.brakeUniform,
        null
      );
      if (proxy.disposed || proxy.carIdx !== carIdx) {
        for (const mat of clonedMaterials) mat.dispose();
        return;
      }

      if (bounds) {
        this._rebuildProxyColliders(proxy, bounds);
      }

      while (proxy.rootGroup.children.length > 0) {
        proxy.rootGroup.remove(proxy.rootGroup.children[0]);
      }
      for (const oldMat of proxy.clonedMaterials) {
        oldMat.dispose();
      }
      const ownedSet = new Set(clonedMaterials);
      const cloneMatMap = new Map();
      const ensureUniqueMat = (m) => {
        if (!m || ownedSet.has(m)) return m;
        let cloned = cloneMatMap.get(m);
        if (!cloned) {
          cloned = m.clone();
          cloneMatMap.set(m, cloned);
          clonedMaterials.push(cloned);
          ownedSet.add(cloned);
        }
        return cloned;
      };
      for (const partObj of Object.values(parts)) {
        partObj.traverse((child) => {
          if (!child.isMesh || !child.material) return;
          child.material = Array.isArray(child.material)
            ? child.material.map(ensureUniqueMat)
            : ensureUniqueMat(child.material);
        });
      }
      proxy.clonedMaterials = clonedMaterials;
      if (proxy.isGhosted) {
        proxy.isGhosted = false;
        this._setProxyGhosted(proxy, true);
      }

      const chassisMesh = parts.Chassis_Body;
      proxy.chassisLocalOffset.copy(chassisMesh.position);
      if (bounds && bounds.size && bounds.center) {
        proxy.nameHeight = proxy.chassisLocalOffset.y + bounds.center.y + bounds.size.y * 0.5 + 0.45;
      }
      proxy.rootGroup.add(chassisMesh);

      const wheelOrder = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
      proxy.wheels = wheelOrder.map((id, idx) => {
        const mesh = parts[id];
        mesh.rotation.order = 'YXZ';
        proxy.rootGroup.add(mesh);
        return {
          mesh,
          isFront: idx < 2,
          restPos: mesh.position.clone(),
        };
      });

      this._applyVisuals(proxy);
    } catch (err) {
      console.warn('Failed to load remote player car model:', err);
    } finally {
      if (proxy.loadingCarIdx === carIdx) {
        proxy.loadingCarIdx = null;
      }
    }
  }

  _setProxyGhosted(proxy, ghosted) {
    if (!proxy || proxy.isGhosted === ghosted) return;
    proxy.isGhosted = ghosted;

    if (proxy.chassisCollider) {
      proxy.chassisCollider.setSensor(ghosted);
    }
    if (proxy.cabinCollider) {
      proxy.cabinCollider.setSensor(ghosted);
    }
    if (proxy.clonedMaterials) {
      for (const mat of proxy.clonedMaterials) {
        if (mat.userData.baseTransparent === undefined) {
          mat.userData.baseTransparent = !!mat.transparent;
          mat.userData.baseOpacity = mat.opacity !== undefined ? mat.opacity : 1.0;
        }
        if (ghosted) {
          mat.transparent = true;
          mat.opacity = Math.min(mat.userData.baseOpacity, 0.42);
        } else {
          mat.transparent = mat.userData.baseTransparent;
          mat.opacity = mat.userData.baseOpacity;
        }
        mat.needsUpdate = true;
      }
    }
  }

  pushPlayerStates(senderTs, states, localNetId) {
    const nowMs = performance.now();
    const baseTs = Number.isFinite(senderTs) ? senderTs : nowMs;

    for (const s of states) {
      if (!s || s.netId === localNetId) continue;
      const proxy = this.remotePlayers.get(s.netId);
      if (!proxy) continue;

      if (s.carIdx !== undefined && s.carIdx !== proxy.carIdx && proxy.loadingCarIdx !== s.carIdx) {
        proxy.carIdx = s.carIdx;
        this._loadProxyCarModel(proxy, s.carIdx);
      }

      const effectiveSenderTs = baseTs - (s.ageMs || 0);
      const rawOffset = nowMs - effectiveSenderTs;
      if (proxy.clockOffset === null) {
        proxy.clockOffset = rawOffset;
      } else {
        const alpha = rawOffset < proxy.clockOffset ? 0.06 : 0.008;
        proxy.clockOffset += (rawOffset - proxy.clockOffset) * alpha;
      }

      if (proxy.lastSenderTs !== null && proxy.lastRecvMs !== null) {
        const dtS = effectiveSenderTs - proxy.lastSenderTs;
        const dtR = nowMs - proxy.lastRecvMs;
        if (dtS > 0 && dtS < 500) {
          const jitter = Math.abs(dtR - dtS);
          proxy.jitterMs = proxy.jitterMs * 0.88 + Math.min(jitter, 100) * 0.12;
          proxy.interpDelayMs = clamp(10 + proxy.jitterMs * 1.1, 10, 65);
        }
      }
      proxy.lastSenderTs = effectiveSenderTs;
      proxy.lastRecvMs = nowMs;
      proxy.isAway = !!s.isAway;

      const sampleTime = effectiveSenderTs + proxy.clockOffset;
      proxy.targetBrakeLight = s.brake || 0;

      const snaps = proxy.snapshots;
      if (snaps.length === 0 || sampleTime > snaps[snaps.length - 1].t) {
        snaps.push({
          t: sampleTime,
          px: s.px,
          py: s.py,
          pz: s.pz,
          qx: s.qx,
          qy: s.qy,
          qz: s.qz,
          qw: s.qw,
          vx: s.vx || 0,
          vy: s.vy || 0,
          vz: s.vz || 0,
          steer: s.steer || 0,
          spin: s.spin || 0,
        });
        if (snaps.length > 16) snaps.shift();
      }
    }
  }

  _evaluatePose(proxy, nowMs, localPos = null) {
    const snaps = proxy.snapshots;
    if (snaps.length === 0) return;

    const latest = snaps[snaps.length - 1];
    let effDelayMs = proxy.interpDelayMs;
    if (localPos) {
      const nearDist = Math.hypot(latest.px - localPos.x, latest.pz - localPos.z);
      const proxFactor = clamp((nearDist - 3.5) / 4.5, 0, 1);
      effDelayMs *= 0.15 + 0.85 * proxFactor;
    }
    const evalTime = nowMs - effDelayMs;
    const p = proxy.pose;

    if (snaps.length === 1 || evalTime >= latest.t) {
      if (proxy.isAway || proxy.isGhosted) {
        p.px = latest.px;
        p.py = latest.py;
        p.pz = latest.pz;
        p.vx = 0;
        p.vy = 0;
        p.vz = 0;
      } else {
        const dtExtra = clamp((evalTime - latest.t) * 0.001, 0, 0.07);
        const damp = Math.exp(-8.0 * dtExtra);
        const effDt = dtExtra * damp;
        p.px = latest.px + latest.vx * effDt;
        p.py = latest.py + latest.vy * effDt;
        p.pz = latest.pz + latest.vz * effDt;
        p.vx = latest.vx * damp;
        p.vy = latest.vy * damp;
        p.vz = latest.vz * damp;
      }
      p.qx = latest.qx;
      p.qy = latest.qy;
      p.qz = latest.qz;
      p.qw = latest.qw;
      p.steer = latest.steer;
      p.spin = latest.spin;
      return;
    }

    if (evalTime <= snaps[0].t) {
      const s = snaps[0];
      p.px = s.px;
      p.py = s.py;
      p.pz = s.pz;
      p.vx = s.vx;
      p.vy = s.vy;
      p.vz = s.vz;
      p.qx = s.qx;
      p.qy = s.qy;
      p.qz = s.qz;
      p.qw = s.qw;
      p.steer = s.steer;
      p.spin = s.spin;
      return;
    }

    let s0 = snaps[0];
    let s1 = snaps[1];
    for (let i = 0; i < snaps.length - 1; i++) {
      if (snaps[i].t <= evalTime && evalTime <= snaps[i + 1].t) {
        s0 = snaps[i];
        s1 = snaps[i + 1];
        break;
      }
    }

    const spanMs = Math.max(1, s1.t - s0.t);
    const t = clamp((evalTime - s0.t) / spanMs, 0, 1);
    const dtSec = spanMs * 0.001;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;

    p.px = h00 * s0.px + h10 * dtSec * s0.vx + h01 * s1.px + h11 * dtSec * s1.vx;
    p.py = h00 * s0.py + h10 * dtSec * s0.vy + h01 * s1.py + h11 * dtSec * s1.vy;
    p.pz = h00 * s0.pz + h10 * dtSec * s0.vz + h01 * s1.pz + h11 * dtSec * s1.vz;
    p.vx = s0.vx + (s1.vx - s0.vx) * t;
    p.vy = s0.vy + (s1.vy - s0.vy) * t;
    p.vz = s0.vz + (s1.vz - s0.vz) * t;

    this._q0.set(s0.qx, s0.qy, s0.qz, s0.qw);
    this._q1.set(s1.qx, s1.qy, s1.qz, s1.qw);
    this._q0.slerp(this._q1, t);
    p.qx = this._q0.x;
    p.qy = this._q0.y;
    p.qz = this._q0.z;
    p.qw = this._q0.w;

    p.steer = s0.steer + (s1.steer - s0.steer) * t;
    p.spin = s0.spin + (s1.spin - s0.spin) * t;
  }

  updatePhysicsStep(localVehicle = null) {
    const nowMs = performance.now();
    const localPos = localVehicle && localVehicle.rigidBody ? localVehicle.rigidBody.translation() : null;
    for (const proxy of this.remotePlayers.values()) {
      const shouldGhost = proxy.isAway || (proxy.lastRecvMs !== null && nowMs - proxy.lastRecvMs > 450);
      this._setProxyGhosted(proxy, shouldGhost);

      this._evaluatePose(proxy, nowMs, localPos);
      const body = proxy.rigidBody;
      if (!body || proxy.snapshots.length === 0) continue;

      const p = proxy.pose;
      if (shouldGhost) {
        body.setTranslation({ x: p.px, y: p.py, z: p.pz }, true);
        body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }

      const cur = body.translation();
      const dx = p.px - cur.x;
      const dy = p.py - cur.y;
      const dz = p.pz - cur.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist > 10.0) {
        body.setTranslation({ x: p.px, y: p.py, z: p.pz }, true);
        body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        continue;
      }

      const inContact = nowMs - proxy.lastContactMs < 260;
      const kHoriz = inContact ? 4.5 : 30.0;
      const velBlend = inContact ? 0.40 : 1.0;

      const curVel = body.linvel();
      const targetVx = p.vx * velBlend + dx * kHoriz;
      const targetVz = p.vz * velBlend + dz * kHoriz;
      const targetVy = clamp(p.vy + dy * 18.0, -5.0, 5.0);

      const alpha = inContact ? 0.24 : 0.92;
      body.setLinvel(
        {
          x: curVel.x + (targetVx - curVel.x) * alpha,
          y: targetVy,
          z: curVel.z + (targetVz - curVel.z) * alpha,
        },
        true
      );
      body.setRotation({ x: p.qx, y: p.qy, z: p.qz, w: p.qw }, true);
      if (!inContact) {
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }

  postPhysicsStep(localVehicle, onBumpFn) {
    if (!localVehicle || !localVehicle.rigidBody || !localVehicle.chassisCollider) return;
    const nowMs = performance.now();
    const localBody = localVehicle.rigidBody;
    const localPos = localBody.translation();
    const localVel = localBody.linvel();
    let anyContact = false;

    for (const proxy of this.remotePlayers.values()) {
      if (proxy.isGhosted || proxy.isAway) continue;
      const pBody = proxy.rigidBody;
      if (!pBody || !proxy.chassisCollider) continue;

      let touching = false;
      this.world.contactPair(localVehicle.chassisCollider, proxy.chassisCollider, () => {
        touching = true;
      });
      if (!touching && localVehicle.cabinCollider && proxy.cabinCollider) {
        this.world.contactPair(localVehicle.chassisCollider, proxy.cabinCollider, () => {
          touching = true;
        });
      }
      if (!touching && localVehicle.cabinCollider && proxy.chassisCollider) {
        this.world.contactPair(localVehicle.cabinCollider, proxy.chassisCollider, () => {
          touching = true;
        });
      }

      if (!touching) continue;
      anyContact = true;
      proxy.lastContactMs = nowMs;

      if (typeof onBumpFn === 'function' && nowMs - proxy.lastBumpSentMs >= 45) {
        const pPos = pBody.translation();
        const dirX = pPos.x - localPos.x;
        const dirZ = pPos.z - localPos.z;
        const dirLen = Math.hypot(dirX, dirZ) || 1;
        const nx = dirX / dirLen;
        const nz = dirZ / dirLen;

        const relVx = localVel.x - (proxy.pose.vx || 0);
        const relVz = localVel.z - (proxy.pose.vz || 0);
        const approachSpeed = relVx * nx + relVz * nz;

        if (approachSpeed > 0.5) {
          proxy.lastBumpSentMs = nowMs;
          const pushSpeed = clamp(approachSpeed * 0.36, 0.3, 6.8);
          onBumpFn(proxy.netId, nx * pushSpeed, nz * pushSpeed, 0);
        }
      }
    }

    // Keep vehicle tires planted on contact instead of launching/bouncing skyward
    if (anyContact && localVel.y > 1.8) {
      localBody.setLinvel({ x: localVel.x, y: 1.8, z: localVel.z }, true);
    }
  }

  applyLocalBumpImpulse(localVehicle, bump) {
    if (!localVehicle || !localVehicle.rigidBody || !bump) return;
    const body = localVehicle.rigidBody;
    const cur = body.linvel();
    body.setLinvel(
      {
        x: cur.x + clamp(bump.dvx, -7.5, 7.5),
        y: cur.y,
        z: cur.z + clamp(bump.dvz, -7.5, 7.5),
      },
      true
    );
  }

  _applyVisuals(proxy, dt = 0) {
    if (!proxy.rootGroup) return;
    const p = proxy.pose;
    const pos = proxy.rigidBody ? proxy.rigidBody.translation() : p;
    const rot = proxy.rigidBody ? proxy.rigidBody.rotation() : p;

    const targetX = pos.x - proxy.chassisLocalOffset.x;
    const targetY = pos.y - proxy.chassisLocalOffset.y;
    const targetZ = pos.z - proxy.chassisLocalOffset.z;
    const rgPos = proxy.rootGroup.position;
    const snapDistSq =
      (targetX - rgPos.x) * (targetX - rgPos.x) +
      (targetY - rgPos.y) * (targetY - rgPos.y) +
      (targetZ - rgPos.z) * (targetZ - rgPos.z);

    if (dt <= 0 || rgPos.lengthSq() === 0 || snapDistSq > 36.0) {
      rgPos.set(targetX, targetY, targetZ);
      proxy.rootGroup.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    } else {
      const visAlpha = 1 - Math.exp(-42.0 * dt);
      rgPos.x += (targetX - rgPos.x) * visAlpha;
      rgPos.y += (targetY - rgPos.y) * visAlpha;
      rgPos.z += (targetZ - rgPos.z) * visAlpha;
      this._q0.set(rot.x, rot.y, rot.z, rot.w);
      proxy.rootGroup.quaternion.slerp(this._q0, visAlpha);
    }

    for (const w of proxy.wheels) {
      w.mesh.position.copy(w.restPos);
      w.mesh.rotation.y = w.isFront ? p.steer : 0;
      w.mesh.rotation.x = p.spin;
      w.mesh.rotation.z = 0;
    }
  }

  _updateNameplate(proxy, camera) {
    if (!proxy.nameplateEl) return;
    if (!camera || proxy.disposed || proxy.snapshots.length === 0) {
      proxy.nameplateEl.style.display = 'none';
      return;
    }

    const pos = proxy.rootGroup.position;
    this._projVec.set(pos.x, pos.y + proxy.nameHeight, pos.z);
    const dist = camera.position.distanceTo(this._projVec);
    if (dist > 220) {
      proxy.nameplateEl.style.display = 'none';
      return;
    }

    this._projVec.project(camera);
    if (this._projVec.z > 1 || this._projVec.z < -1) {
      proxy.nameplateEl.style.display = 'none';
      return;
    }

    const sx = (this._projVec.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-this._projVec.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < -120 || sx > window.innerWidth + 120 || sy < -60 || sy > window.innerHeight + 60) {
      proxy.nameplateEl.style.display = 'none';
      return;
    }

    const baseOpacity = proxy.isGhosted || proxy.isAway
      ? 0.42
      : clamp(1.0 - Math.max(0, dist - 90) / 140 * 0.45, 0.55, 1.0);
    proxy.nameplateEl.style.display = 'flex';
    proxy.nameplateEl.style.opacity = baseOpacity.toFixed(2);
    proxy.nameplateEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
  }

  updateFrame(dt, localVehicle = null, camera = null) {
    const nowMs = performance.now();
    const brakeLerp = 1 - Math.exp(-20.0 * dt);
    const localPos = localVehicle && localVehicle.rigidBody ? localVehicle.rigidBody.translation() : null;
    for (const proxy of this.remotePlayers.values()) {
      const shouldGhost = proxy.isAway || (proxy.lastRecvMs !== null && nowMs - proxy.lastRecvMs > 450);
      this._setProxyGhosted(proxy, shouldGhost);
      this._evaluatePose(proxy, nowMs, localPos);
      this._applyVisuals(proxy, dt);
      this._updateNameplate(proxy, camera);
      proxy.brakeUniform.value += (proxy.targetBrakeLight - proxy.brakeUniform.value) * brakeLerp;
    }
  }

  placeLocalVehicleNearHost(vehicle, hostState) {
    if (!vehicle || !vehicle.rigidBody || !hostState) return;
    const hostQuat = new THREE.Quaternion(hostState.qx, hostState.qy, hostState.qz, hostState.qw);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(hostQuat);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(hostQuat);

    const targetX = hostState.px + right.x * 4.2 - fwd.x * 2.5;
    const targetZ = hostState.pz + right.z * 4.2 - fwd.z * 2.5;
    let spawnY = hostState.py + 0.5;

    const ray = new this.RAPIER.Ray({ x: targetX, y: hostState.py + 8.0, z: targetZ }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 25.0, true, undefined, (0xFFFF << 16) | 0x0001);
    if (hit && Number.isFinite(hit.timeOfImpact)) {
      spawnY = hostState.py + 8.0 - hit.timeOfImpact + vehicle.chassisLocalOffset.y + 0.25;
    }

    const yaw = Math.atan2(fwd.x, fwd.z);
    vehicle.reset(new THREE.Vector3(targetX, spawnY, targetZ), yaw, 0);
  }

  _destroyProxy(proxy) {
    if (!proxy) return;
    proxy.disposed = true;
    proxy.chassisCollider = null;
    proxy.cabinCollider = null;
    if (proxy.rigidBody && this.world) {
      try {
        this.world.removeRigidBody(proxy.rigidBody);
      } catch (_) {}
      proxy.rigidBody = null;
    }
    if (proxy.rootGroup && proxy.rootGroup.parent) {
      proxy.rootGroup.parent.remove(proxy.rootGroup);
    }
    if (proxy.nameplateEl && proxy.nameplateEl.parentNode) {
      proxy.nameplateEl.parentNode.removeChild(proxy.nameplateEl);
    }
    proxy.nameplateEl = null;
    proxy.nameplatePillEl = null;
    if (proxy.clonedMaterials) {
      for (const mat of proxy.clonedMaterials) {
        mat.dispose();
      }
    }
  }

  clearAll() {
    for (const proxy of this.remotePlayers.values()) {
      this._destroyProxy(proxy);
    }
    this.remotePlayers.clear();
  }
}

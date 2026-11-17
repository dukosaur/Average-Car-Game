import * as THREE from 'three';

/**
 * Raycast Vehicle Physics Controller for Rapier 3D + Three.js
 * ===========================================================
 * Sweet-Spot Tuning:
 * - Balanced steering angle (0.58 rad / ~33°), progressive high-speed reduction (0.020),
 *   and planted rear lateral grip (2.05) so normal cornering carves cleanly without over-rotating
 *   or falsely triggering drift state.
 * - Holding Spacebar (handbrake) drops rear grip to 0.34 and engages drift yaw torque for
 *   controlled on-demand drifts.
 */
export class RaycastVehicleController {
  constructor(RAPIER, world, carParts, config = {}) {
    this.RAPIER = RAPIER;
    this.world = world;

    this.params = {
      mass: 1320,                  // kg
      chassisDims: new THREE.Vector3(1.86, 0.96, 4.36),
      suspensionRestLength: 0.36,  // m
      suspensionMaxTravel: 0.20,   // m (extra travel absorbs high-speed mountain crests & road shoulders)
      suspensionStiffness: 36000,  // N/m (Spring stiffness k)
      dampingCompression: 5400,    // N*s/m
      dampingRelaxation: 6400,     // N*s/m
      maxEngineForce: 9600,        // N total drive force (boosted for steep mountain touge & viaduct climbs)
      maxForwardSpeed: 69,         // m/s top-speed taper ceiling (calibrated per car)
      maxReverseForce: 5200,       // N
      maxBrakeForce: 12500,        // N
      handbrakeForce: 6200,        // N
      maxSteerAngle: 0.54,         // rad (~31 deg smooth Forza-style steering lock)
      highSpeedSteerFactor: 0.018, // Progressive speed-sensitive steering
      steerSpeed: 7.8,             // rad/s smooth, progressive turn-in (no snappy tap-jerks)
      steerReturnSpeed: 15.5,      // rad/s smooth self-centering when releasing A/D
      frontLateralGrip: 2.25,      // Smooth, progressive front bite
      rearLateralGrip: 2.75,       // Planted rear traction (prevents random S-brake/corner slides)
      handbrakeRearGrip: 0.48,     // Controlled rear slip when holding Spacebar (prevents snappy spinouts)
      yawAssistTorque: 750,        // N*m gentle turn-in helper (eliminates artificial snap)
      driftYawTorque: 4200,        // N*m smooth drift rotation without side-to-side snap
      rollingResistance: 160,      // N
      aeroDragCoeff: 0.28,         // Aerodynamic drag
      downforceCoeff: 1.65,        // Balanced GT downforce
      ...config,
    };

    const cornerWeight = (this.params.mass * 9.81) * 0.25;
    this.staticCompression = cornerWeight / this.params.suspensionStiffness;

    // Visual root group in Three.js scene
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = config.rootName || 'Player_Vehicle_Root';

    this.chassisLocalOffset = new THREE.Vector3(0, 0.36, 0);
    this.wheels = [];
    this.currentSteer = 0;
    this.rearGripBlend = 1.0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.speedKmh = 0;
    this.gear = 'N';
    this.rpmNormalized = 0.14;
    this.isDrifting = false;

    this.setCarParts(carParts);
    this._initPhysicsBody();
  }

  applyVehicleStats(stats) {
    if (!stats) return;
    if (Number.isFinite(stats.maxForwardSpeed)) {
      this.params.maxForwardSpeed = stats.maxForwardSpeed;
    }
    if (Number.isFinite(stats.maxEngineForce)) {
      this.params.maxEngineForce = stats.maxEngineForce;
    }
    if (Number.isFinite(stats.mass) && stats.mass > 400) {
      this.params.mass = stats.mass;
      if (this.carBounds) {
        this._rebuildColliders(this.carBounds);
      }
    }
  }

  /**
   * Attaches or hot-swaps the 5 rigged vehicle meshes:
   * Chassis_Body, Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR
   */
  setCarParts(carParts, bounds = null) {
    this.carParts = carParts;
    this.carBounds = bounds;

    while (this.rootGroup.children.length > 0) {
      this.rootGroup.remove(this.rootGroup.children[0]);
    }

    this.chassisMesh = carParts.Chassis_Body;
    this.chassisLocalOffset.copy(this.chassisMesh.position);
    this.rootGroup.add(this.chassisMesh);

    const wheelOrder = [
      { id: 'Wheel_FL', isFront: true, isLeft: true },
      { id: 'Wheel_FR', isFront: true, isLeft: false },
      { id: 'Wheel_RL', isFront: false, isLeft: true },
      { id: 'Wheel_RR', isFront: false, isLeft: false },
    ];

    const prevSpins = this.wheels.map((w) => w.spinAngle);
    const equilibriumSuspLength = this.params.suspensionRestLength - this.staticCompression;

    this.wheels = wheelOrder.map((spec, idx) => {
      const mesh = carParts[spec.id];
      mesh.rotation.order = 'YXZ';
      const restPos = mesh.position.clone();
      this.rootGroup.add(mesh);

      const wheelRadius = Math.max(0.26, restPos.y);

      const hardpointLocal = new THREE.Vector3(
        restPos.x - this.chassisLocalOffset.x,
        (restPos.y - this.chassisLocalOffset.y) + equilibriumSuspLength,
        restPos.z - this.chassisLocalOffset.z
      );

      return {
        id: spec.id,
        isFront: spec.isFront,
        isLeft: spec.isLeft,
        mesh,
        restPos,
        wheelRadius,
        hardpointLocal,
        compression: this.staticCompression,
        suspensionLength: equilibriumSuspLength,
        grounded: true,
        hitPoint: new THREE.Vector3(restPos.x, 0, restPos.z),
        hitNormal: new THREE.Vector3(0, 1, 0),
        steerAngle: 0,
        spinAngle: prevSpins[idx] || 0,
        skidIntensity: 0,
      };
    });

    if (this.rigidBody) {
      if (bounds) {
        this._rebuildColliders(bounds);
      }
      this.syncVisuals();
    }
  }

  _buildColliderDescs(bounds = null) {
    const { RAPIER, params } = this;
    let lowerHull;
    let upperCabin;

    if (bounds && bounds.size && bounds.center) {
      const s = bounds.size;
      const c = bounds.center;
      const rawBottomY = c.y - s.y * 0.5;
      // Keep generous ground clearance + rounded skid-plate bevel so splitters glide over road edges & mountain seams
      const clearedBottomY = Math.max(rawBottomY + 0.22, 0.04);
      const lowerHy = Math.max(0.14, s.y * 0.24);
      const upperHy = Math.max(0.18, s.y * 0.27);
      const bevel = 0.08;

      if (params.isTraffic) {
        lowerHull = RAPIER.ColliderDesc.cuboid(s.x * 0.48, lowerHy, s.z * 0.48)
          .setTranslation(c.x, clearedBottomY + lowerHy, c.z)
          .setMass(params.mass * 0.85)
          .setFriction(0.08)
          .setRestitution(0.0);
      } else {
        lowerHull = RAPIER.ColliderDesc.roundCuboid(
          Math.max(0.2, s.x * 0.49 - bevel),
          Math.max(0.05, lowerHy - bevel),
          Math.max(0.4, s.z * 0.49 - bevel),
          bevel
        )
          .setTranslation(c.x, clearedBottomY + lowerHy, c.z)
          .setMass(params.mass * 0.85)
          .setFriction(0.06)
          .setRestitution(0.0);
      }

      upperCabin = RAPIER.ColliderDesc.cuboid(s.x * 0.44, upperHy, s.z * 0.36)
        .setTranslation(c.x, clearedBottomY + lowerHy * 2.0 + upperHy, c.z - s.z * 0.02)
        .setMass(params.mass * 0.15)
        .setFriction(0.10)
        .setRestitution(0.0);
    } else {
      const bevel = 0.08;
      if (params.isTraffic) {
        lowerHull = RAPIER.ColliderDesc.cuboid(
          params.chassisDims.x * 0.48,
          0.16,
          params.chassisDims.z * 0.48
        )
          .setTranslation(0, 0.14, 0)
          .setMass(params.mass * 0.85)
          .setFriction(0.08)
          .setRestitution(0.0);
      } else {
        lowerHull = RAPIER.ColliderDesc.roundCuboid(
          Math.max(0.2, params.chassisDims.x * 0.49 - bevel),
          0.10,
          Math.max(0.4, params.chassisDims.z * 0.49 - bevel),
          bevel
        )
          .setTranslation(0, 0.18, 0)
          .setMass(params.mass * 0.85)
          .setFriction(0.06)
          .setRestitution(0.0);
      }

      upperCabin = RAPIER.ColliderDesc.cuboid(
        params.chassisDims.x * 0.44,
        0.18,
        params.chassisDims.z * 0.36
      )
        .setTranslation(0, 0.52, -0.08)
        .setMass(params.mass * 0.15)
        .setFriction(0.10)
        .setRestitution(0.0);
    }

    if (params.collisionGroups !== undefined) {
      lowerHull.setCollisionGroups(params.collisionGroups);
      upperCabin.setCollisionGroups(params.collisionGroups);
    }
    return { lowerHull, upperCabin };
  }

  _rebuildColliders(bounds) {
    if (!this.world || !this.rigidBody) return;
    if (this.chassisCollider) {
      this.world.removeCollider(this.chassisCollider, false);
      this.chassisCollider = null;
    }
    if (this.cabinCollider) {
      this.world.removeCollider(this.cabinCollider, false);
      this.cabinCollider = null;
    }
    const { lowerHull, upperCabin } = this._buildColliderDescs(bounds);
    this.chassisCollider = this.world.createCollider(lowerHull, this.rigidBody);
    this.cabinCollider = this.world.createCollider(upperCabin, this.rigidBody);
  }

  _initPhysicsBody() {
    const { RAPIER, world } = this;

    const spawnY = this.chassisLocalOffset.y;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, spawnY, 0)
      .setLinearDamping(0.02)
      .setAngularDamping(1.15) // Natural yaw flow & smooth corner exit
      .setCanSleep(false);
    if (this.params.ccdEnabled) {
      bodyDesc.setCcdEnabled(true);
    }

    this.rigidBody = world.createRigidBody(bodyDesc);

    const { lowerHull, upperCabin } = this._buildColliderDescs(this.carBounds);
    this.chassisCollider = world.createCollider(lowerHull, this.rigidBody);
    this.cabinCollider = world.createCollider(upperCabin, this.rigidBody);
  }

  reset(position = new THREE.Vector3(0, this.chassisLocalOffset.y, 0), yawRad = 0, pitchRad = 0) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchRad, yawRad, 0, 'YXZ'));
    this.rigidBody.resetForces(true);
    this.rigidBody.resetTorques(true);
    this.rigidBody.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.rigidBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.currentSteer = 0;
    for (const w of this.wheels) {
      w.compression = this.staticCompression;
      w.suspensionLength = this.params.suspensionRestLength - this.staticCompression;
      w.steerAngle = 0;
      w.skidIntensity = 0;
    }
  }

  updatePhysicsStep(dt, input) {
    if (dt <= 1e-5) return;

    const { RAPIER, world, rigidBody, params } = this;

    rigidBody.resetForces(true);
    rigidBody.resetTorques(true);

    const pos = rigidBody.translation();
    const rot = rigidBody.rotation();
    const linVel = rigidBody.linvel();
    const angVel = rigidBody.angvel();

    const chassisPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const chassisQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

    const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(chassisQuat).normalize();
    const upDir = new THREE.Vector3(0, 1, 0).applyQuaternion(chassisQuat).normalize();
    const leftDir = new THREE.Vector3(1, 0, 0).applyQuaternion(chassisQuat).normalize();

    const velVec = new THREE.Vector3(linVel.x, linVel.y, linVel.z);
    const angVelVec = new THREE.Vector3(angVel.x, angVel.y, angVel.z);
    this.forwardSpeed = velVec.dot(forwardDir);
    this.lateralSpeed = velVec.dot(leftDir);
    this.speedKmh = Math.abs(this.forwardSpeed) * 3.6;

    // Speed-sensitive steering calculation (supports analog steer for AI alongside digital player keys)
    const rawSteerInput = Number.isFinite(input.steerAnalog)
      ? THREE.MathUtils.clamp(input.steerAnalog, -1, 1)
      : (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const speedFactor = 1 / (1 + Math.abs(this.forwardSpeed) * params.highSpeedSteerFactor);
    // Allow extra steering lock ONLY when actively drifting so normal A/D weaving at high speed stays smooth
    const isInDriftState = input.handbrake || this.rearGripBlend < 0.85;
    const slideLockBoost = isInDriftState && Math.abs(this.lateralSpeed) > 2.5 && Math.abs(this.forwardSpeed) > 4.0
      ? Math.min(0.28, Math.abs(Math.atan2(this.lateralSpeed, Math.abs(this.forwardSpeed))) * 0.55)
      : 0.0;
    const effectiveMaxSteer = Math.min(0.70, params.maxSteerAngle * speedFactor + slideLockBoost);
    const targetSteer = rawSteerInput * effectiveMaxSteer;
    const isReturning = Math.abs(targetSteer) < Math.abs(this.currentSteer) || Math.sign(targetSteer) !== Math.sign(this.currentSteer);
    const activeSteerRate = isReturning ? (params.steerReturnSpeed || 28.0) : params.steerSpeed;
    const steerLerp = 1 - Math.exp(-activeSteerRate * dt);
    this.currentSteer += (targetSteer - this.currentSteer) * steerLerp;
    if (Math.abs(rawSteerInput) < 0.01 && Math.abs(this.currentSteer) < 0.004) {
      this.currentSteer = 0;
    }

    // Ackermann steering geometry for inner vs outer front wheel
    for (const w of this.wheels) {
      if (w.isFront) {
        if (Math.abs(this.currentSteer) > 0.001) {
          const isInner = (this.currentSteer > 0 && w.isLeft) || (this.currentSteer < 0 && !w.isLeft);
          w.steerAngle = this.currentSteer * (isInner ? 1.08 : 0.94);
        } else {
          w.steerAngle = 0;
        }
      } else {
        w.steerAngle = 0;
      }
    }

    // Aerodynamic drag & GT wing downforce
    const speedSq = velVec.lengthSq();
    if (speedSq > 0.1) {
      const dragForce = velVec.clone().normalize().multiplyScalar(-params.aeroDragCoeff * speedSq);
      rigidBody.addForce({ x: dragForce.x, y: dragForce.y, z: dragForce.z }, true);

      const downforce = upDir.clone().multiplyScalar(-params.downforceCoeff * speedSq);
      rigidBody.addForce({ x: downforce.x, y: downforce.y, z: downforce.z }, true);
    }

    let driveInput = 0;
    let brakeInput = 0;

    if (
      Number.isFinite(input.throttleAnalog) ||
      Number.isFinite(input.brakeAnalog) ||
      Number.isFinite(input.reverseAnalog)
    ) {
      const bIn = Number.isFinite(input.brakeAnalog) ? THREE.MathUtils.clamp(input.brakeAnalog, 0, 1) : 0;
      const tIn = Number.isFinite(input.throttleAnalog) ? THREE.MathUtils.clamp(input.throttleAnalog, 0, 1) : 0;
      const rIn = Number.isFinite(input.reverseAnalog) ? THREE.MathUtils.clamp(input.reverseAnalog, 0, 1) : 0;
      brakeInput = bIn;
      if (tIn > 0.01 && bIn < 0.05) {
        if (this.forwardSpeed < -1.0) {
          brakeInput = Math.max(brakeInput, tIn);
        } else {
          driveInput = tIn;
        }
      } else if (rIn > 0.01 && bIn < 0.05) {
        if (this.forwardSpeed > 1.0) {
          brakeInput = Math.max(brakeInput, rIn);
        } else {
          driveInput = -rIn;
        }
      }
    } else if (input.forward && !input.backward) {
      if (this.forwardSpeed < -1.0) {
        brakeInput = 1.0;
      } else {
        driveInput = 1.0;
      }
    } else if (input.backward && !input.forward) {
      if (this.forwardSpeed > 1.0) {
        brakeInput = 1.0;
      } else {
        driveInput = -1.0;
      }
    }

    const minSuspLen = params.suspensionRestLength - params.suspensionMaxTravel;
    const maxSuspLen = params.suspensionRestLength + params.suspensionMaxTravel;
    const rayDir = upDir.clone().negate();

    // Smooth rear-grip blend: Spacebar initiates slide; holding throttle while sliding sustains ("holds") the drift!
    const isCounterSteering =
      (input.handbrake || this.rearGripBlend < 0.85) &&
      Math.abs(rawSteerInput) > 0.05 &&
      Math.abs(this.lateralSpeed) > 2.5 &&
      rawSteerInput * this.lateralSpeed > 0;
    const isHoldingPowerSlide =
      !input.handbrake &&
      driveInput > 0.1 &&
      Math.abs(this.forwardSpeed) > 6.0 &&
      Math.abs(this.lateralSpeed) > 2.8 &&
      this.rearGripBlend < 0.78;
    const targetRearBlend = input.handbrake
      ? 0.0
      : (isHoldingPowerSlide ? (isCounterSteering ? 0.54 : 0.40) : 1.0);
    const rearBlendRate = input.handbrake ? 14.0 : (isHoldingPowerSlide ? 4.0 : 4.5);
    this.rearGripBlend += (targetRearBlend - this.rearGripBlend) * (1 - Math.exp(-rearBlendRate * dt));

    let groundedCount = 0;
    let frontGrounded = 0;
    this.isDrifting = false;

    for (const w of this.wheels) {
      const maxRayDist = maxSuspLen + w.wheelRadius;
      const hardpointWorld = w.hardpointLocal.clone().applyQuaternion(chassisQuat).add(chassisPos);
      const ray = new RAPIER.Ray(
        { x: hardpointWorld.x, y: hardpointWorld.y, z: hardpointWorld.z },
        { x: rayDir.x, y: rayDir.y, z: rayDir.z }
      );

      const hit = world.castRayAndGetNormal(
        ray,
        maxRayDist,
        true,
        undefined,
        (0xFFFF << 16) | 0x0001,
        undefined,
        rigidBody
      );

      if (hit && hit.timeOfImpact <= maxRayDist) {
        w.grounded = true;
        groundedCount++;
        if (w.isFront) frontGrounded++;

        const hitDist = hit.timeOfImpact;
        const suspLen = Math.max(minSuspLen, Math.min(maxSuspLen, hitDist - w.wheelRadius));
        w.compression = params.suspensionRestLength - suspLen;
        w.suspensionLength = suspLen;

        w.hitPoint.copy(hardpointWorld).addScaledVector(rayDir, hitDist);
        w.hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z).normalize();

        const rVec = hardpointWorld.clone().sub(chassisPos);
        const pointVel = velVec.clone().add(new THREE.Vector3().crossVectors(angVelVec, rVec));

        const rawCompVel = -pointVel.dot(w.hitNormal);
        const compressionVel = Math.max(-3.0, Math.min(2.2, rawCompVel));
        const springForce = params.suspensionStiffness * w.compression;
        const damperCoeff = compressionVel >= 0 ? params.dampingCompression : params.dampingRelaxation;
        const damperForce = damperCoeff * compressionVel;

        const maxCornerLoad = params.mass * 9.81 * 2.2;
        const normalLoad = Math.max(0, Math.min(maxCornerLoad, springForce + damperForce));
        const suspForceVec = w.hitNormal.clone().multiplyScalar(normalLoad);

        const forceAppPoint = chassisPos
          .clone()
          .addScaledVector(leftDir, w.hardpointLocal.x * 0.78)
          .addScaledVector(forwardDir, w.hardpointLocal.z * 0.90);

        rigidBody.addForceAtPoint(
          { x: suspForceVec.x, y: suspForceVec.y, z: suspForceVec.z },
          { x: forceAppPoint.x, y: forceAppPoint.y, z: forceAppPoint.z },
          true
        );

        const wheelSteerQuat = new THREE.Quaternion().setFromAxisAngle(upDir, w.steerAngle);
        const wheelForward = forwardDir.clone().applyQuaternion(wheelSteerQuat);
        wheelForward.addScaledVector(w.hitNormal, -wheelForward.dot(w.hitNormal)).normalize();
        const wheelLeft = new THREE.Vector3().crossVectors(w.hitNormal, wheelForward).normalize();

        const wheelForwardVel = pointVel.dot(wheelForward);
        const wheelLateralVel = pointVel.dot(wheelLeft);

        let longForce = -Math.sign(wheelForwardVel) * params.rollingResistance * 0.25;

        if (driveInput > 0) {
          const speedCeiling = (params.maxForwardSpeed || 61.7) * 1.10;
          const speedRatio = Math.abs(this.forwardSpeed) / speedCeiling;
          const topSpeedTaper = speedRatio < 0.72
            ? 1.0
            : Math.max(0, 1.0 - (speedRatio - 0.72) / 0.28);
          const torqueShare = w.isFront ? 0.18 : 0.32;
          longForce += driveInput * params.maxEngineForce * torqueShare * topSpeedTaper;
        } else if (driveInput < 0) {
          const revTaper = Math.max(0, 1 - Math.abs(this.forwardSpeed) / 18);
          const torqueShare = w.isFront ? 0.22 : 0.28;
          longForce += driveInput * params.maxReverseForce * torqueShare * revTaper;
        }

        if (brakeInput > 0) {
          const brakeBias = w.isFront ? 0.30 : 0.20;
          const brakeSign = Math.abs(wheelForwardVel) > 0.1 ? -Math.sign(wheelForwardVel) : 0;
          longForce += brakeSign * params.maxBrakeForce * brakeBias * brakeInput;
        }

        if (input.handbrake && !w.isFront) {
          const hbSign = Math.abs(wheelForwardVel) > 0.1 ? -Math.sign(wheelForwardVel) : 0;
          const hbScale = driveInput > 0 ? 0.32 : 0.50;
          longForce += hbSign * params.handbrakeForce * hbScale;
        }

        // Balanced front & rear lateral grip with smooth handbrake blend (no sudden snap on drift transitions)
        const blendedRearGrip =
          params.handbrakeRearGrip +
          (params.rearLateralGrip - params.handbrakeRearGrip) * this.rearGripBlend;
        const gripMultiplier = w.isFront ? params.frontLateralGrip : blendedRearGrip;

        const maxLatForce = Math.max(1800, normalLoad * gripMultiplier);
        const corneringStiffness = (params.mass * 0.25) * (w.isFront ? 27.0 : 28.0);
        // Soft-saturation curve (Forza-style progressive slip rather than harsh binary rail/ice)
        const rawLatForce = -wheelLateralVel * corneringStiffness;
        const latForce = maxLatForce * Math.tanh(rawLatForce / maxLatForce);

        const tireForceVec = wheelForward
          .clone()
          .multiplyScalar(longForce)
          .addScaledVector(wheelLeft, latForce);

        const zLever = w.isFront ? w.hardpointLocal.z * 0.98 : w.hardpointLocal.z * 0.94;
        const tireForcePoint = chassisPos
          .clone()
          .addScaledVector(leftDir, w.hardpointLocal.x * 0.65)
          .addScaledVector(upDir, 0.14)
          .addScaledVector(forwardDir, zLever);

        rigidBody.addForceAtPoint(
          { x: tireForceVec.x, y: tireForceVec.y, z: tireForceVec.z },
          { x: tireForcePoint.x, y: tireForcePoint.y, z: tireForcePoint.z },
          true
        );

        // Register drift/skidmarks when handbrake is engaged OR when tires have noticeable lateral slip
        const slipRatio = Math.abs(wheelLateralVel) / (Math.abs(wheelForwardVel) + 2.5);
        if (input.handbrake && !w.isFront && Math.abs(this.forwardSpeed) > 2.0) {
          w.skidIntensity = 1.0;
          this.isDrifting = true;
        } else if (!w.isFront && Math.abs(wheelLateralVel) > 4.6 && slipRatio > 0.42) {
          w.skidIntensity = Math.min(1, (slipRatio - 0.36) * 2.0);
          this.isDrifting = true;
        } else {
          w.skidIntensity = 0;
        }

        const effectiveForwardVel =
          input.handbrake && !w.isFront ? wheelForwardVel * 0.15 : wheelForwardVel;
        w.spinAngle += (effectiveForwardVel / w.wheelRadius) * dt;
      } else {
        w.grounded = false;
        w.compression = 0;
        w.suspensionLength = params.suspensionRestLength;
        w.skidIntensity = 0;
        w.spinAngle += (this.forwardSpeed / w.wheelRadius) * dt;
      }
    }

    // Subtle steering yaw assist (boosted during counter-steering so holding the opposite key catches/flips drifts reliably)
    if (frontGrounded > 0 && Math.abs(this.currentSteer) > 0.001 && Math.abs(this.forwardSpeed) > 0.5) {
      const dirSign = this.forwardSpeed >= 0 ? 1 : -1;
      const speedRatio = Math.min(1.0, Math.abs(this.forwardSpeed) / 8.0);
      const steerNorm = Math.tanh((this.currentSteer / params.maxSteerAngle) * 1.35) / Math.tanh(1.35);
      let activeYawTorque =
        params.driftYawTorque +
        (params.yawAssistTorque - params.driftYawTorque) * this.rearGripBlend;
      if (isCounterSteering) {
        const csStrength = Math.min(1.0, Math.max(0.0, (Math.abs(this.lateralSpeed) - 2.5) / 6.0));
        activeYawTorque = Math.max(activeYawTorque, 1800 + csStrength * 2000);
      }
      const baseYaw = steerNorm * dirSign * speedRatio * activeYawTorque;
      const yawVec = upDir.clone().multiplyScalar(baseYaw);
      rigidBody.addTorque({ x: yawVec.x, y: yawVec.y, z: yawVec.z }, true);
    }

    // Drift-hold yaw damper: stabilizes spinouts when not actively counter-steering
    if (!input.handbrake && !isCounterSteering && this.rearGripBlend < 0.75 && Math.abs(this.lateralSpeed) > 2.5 && groundedCount >= 2) {
      const yawRate = angVelVec.dot(upDir);
      if (Math.abs(yawRate) > 0.05) {
        const driftDamp = upDir.clone().multiplyScalar(-yawRate * params.mass * 0.85);
        rigidBody.addTorque({ x: driftDamp.x, y: driftDamp.y, z: driftDamp.z }, true);
      }
    }

    // Left-Right Anti-Roll Bars (front & rear sway bars resist body roll without stiffening bumps)
    if (this.wheels.length >= 4) {
      const swayStiffness = params.suspensionStiffness * 0.65;
      const frontDiff = (this.wheels[0].grounded || this.wheels[1].grounded)
        ? (this.wheels[0].compression - this.wheels[1].compression)
        : 0;
      const rearDiff = (this.wheels[2].grounded || this.wheels[3].grounded)
        ? (this.wheels[2].compression - this.wheels[3].compression)
        : 0;
      const swayTorqueMag = (frontDiff + rearDiff) * swayStiffness * 0.85;
      if (Math.abs(swayTorqueMag) > 1.0) {
        const swayVec = forwardDir.clone().multiplyScalar(swayTorqueMag);
        rigidBody.addTorque({ x: swayVec.x, y: swayVec.y, z: swayVec.z }, true);
      }
    }

    // Anti-roll bar & uprighting stabilizer so hitting sloped road shoulders or hard corners won't flip the car
    {
      const worldUp = new THREE.Vector3(0, 1, 0);
      const tiltAxis = new THREE.Vector3().crossVectors(upDir, worldUp);
      const tiltSin = Math.min(1.0, tiltAxis.length());
      if (tiltSin > 0.01) {
        tiltAxis.normalize();
        // Progressive uprighting torque: planted in corners, strong resistance past ~15 deg
        const uprightStrength = groundedCount >= 1
          ? params.mass * (6.5 + 24.0 * tiltSin * tiltSin)
          : params.mass * 2.5;
        const rollVelDamp = angVelVec.dot(forwardDir) * params.mass * (groundedCount >= 1 ? 3.8 : 1.6);
        const uprightTorque = tiltAxis
          .multiplyScalar(tiltSin * uprightStrength)
          .addScaledVector(forwardDir, -rollVelDamp);
        rigidBody.addTorque(
          { x: uprightTorque.x, y: uprightTorque.y, z: uprightTorque.z },
          true
        );
      }
    }

    // Gentle low-speed full-stop settle when idle or actively holding brakes near rest
    const isIdleOrStoppedBraking =
      (!input.forward && !input.backward && driveInput === 0 && (brakeInput === 0 || Math.abs(this.forwardSpeed) < 0.45));
    if (isIdleOrStoppedBraking && Math.abs(this.forwardSpeed) < 0.4 && groundedCount >= 2) {
      rigidBody.setLinvel(
        { x: linVel.x * 0.9, y: linVel.y * 0.9, z: linVel.z * 0.9 },
        true
      );
    }

    this._updateTelemetry(driveInput);
  }

  syncVisuals() {
    const pos = this.rigidBody.translation();
    const rot = this.rigidBody.rotation();
    const chassisQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);

    this.rootGroup.position.set(
      pos.x - this.chassisLocalOffset.x,
      pos.y - this.chassisLocalOffset.y,
      pos.z - this.chassisLocalOffset.z
    );
    this.rootGroup.quaternion.copy(chassisQuat);

    for (const w of this.wheels) {
      const verticalOffset = w.compression - this.staticCompression;
      w.mesh.position.set(
        w.restPos.x,
        w.restPos.y + verticalOffset,
        w.restPos.z
      );
      w.mesh.rotation.y = w.steerAngle;
      w.mesh.rotation.x = w.spinAngle;
      w.mesh.rotation.z = 0;
    }
  }

  update(dt, input) {
    this.updatePhysicsStep(dt, input);
    this.syncVisuals();
  }

  destroy() {
    if (this.rigidBody && this.world) {
      this.world.removeRigidBody(this.rigidBody);
      this.rigidBody = null;
      this.chassisCollider = null;
      this.cabinCollider = null;
    }
    if (this.rootGroup && this.rootGroup.parent) {
      this.rootGroup.parent.remove(this.rootGroup);
    }
  }

  _updateTelemetry(driveInput) {
    if (this.forwardSpeed < -0.8) {
      this.gear = 'R';
      this.rpmNormalized = Math.min(1, 0.2 + Math.abs(this.forwardSpeed) / 18);
      return;
    }
    if (this.speedKmh < 1.5 && driveInput === 0) {
      this.gear = 'N';
      this.rpmNormalized = 0.14;
      return;
    }
    const gearSpeeds = [0, 38, 74, 112, 152, 190, 230];
    let g = 1;
    for (let i = 1; i < gearSpeeds.length; i++) {
      if (this.speedKmh >= gearSpeeds[i - 1]) {
        g = i;
      }
    }
    this.gear = String(g);
    const low = gearSpeeds[g - 1] * 0.7;
    const high = gearSpeeds[g];
    const ratio = (this.speedKmh - low) / Math.max(1, high - low);
    this.rpmNormalized = Math.max(0.18, Math.min(0.98, ratio));
  }
}

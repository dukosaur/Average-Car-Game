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
      suspensionRestLength: 0.34,  // m
      suspensionMaxTravel: 0.16,   // m
      suspensionStiffness: 36000,  // N/m (Spring stiffness k)
      dampingCompression: 5400,    // N*s/m
      dampingRelaxation: 6400,     // N*s/m
      maxEngineForce: 9600,        // N total drive force (boosted for steep mountain touge & viaduct climbs)
      maxReverseForce: 5200,       // N
      maxBrakeForce: 12500,        // N
      handbrakeForce: 6200,        // N
      maxSteerAngle: 0.58,         // rad (~33.2 deg sweet spot)
      highSpeedSteerFactor: 0.020, // Balanced speed-sensitive reduction (agile low speed, stable high speed)
      steerSpeed: 9.5,             // rad/s smooth & responsive steering feel
      frontLateralGrip: 2.10,      // Strong front turn-in grip
      rearLateralGrip: 2.05,       // Planted rear grip during normal driving (no accidental spin/drift)
      handbrakeRearGrip: 0.34,     // Loose rear tail when holding Spacebar for intentional drifts
      yawAssistTorque: 2600,       // N*m subtle turn-in assist (sweet spot between 0 and 6800)
      driftYawTorque: 8200,        // N*m yaw kick only when Spacebar handbrake is held
      rollingResistance: 160,      // N
      aeroDragCoeff: 0.44,         // Aerodynamic drag
      downforceCoeff: 1.35,        // GT wing downforce
      ...config,
    };

    const cornerWeight = (this.params.mass * 9.81) * 0.25;
    this.staticCompression = cornerWeight / this.params.suspensionStiffness;

    // Visual root group in Three.js scene
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'Player_Vehicle_Root';

    this.chassisLocalOffset = new THREE.Vector3(0, 0.36, 0);
    this.wheels = [];
    this.currentSteer = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.speedKmh = 0;
    this.gear = 'N';
    this.rpmNormalized = 0.14;
    this.isDrifting = false;

    this.setCarParts(carParts);
    this._initPhysicsBody();
  }

  /**
   * Attaches or hot-swaps the 5 rigged vehicle meshes:
   * Chassis_Body, Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR
   */
  setCarParts(carParts) {
    this.carParts = carParts;

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
      this.syncVisuals();
    }
  }

  _initPhysicsBody() {
    const { RAPIER, world, params } = this;

    const spawnY = this.chassisLocalOffset.y;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, spawnY, 0)
      .setLinearDamping(0.12)
      .setAngularDamping(1.15) // Sweet-spot yaw damping: turns crisply and settles cleanly when centering
      .setCanSleep(false);

    this.rigidBody = world.createRigidBody(bodyDesc);

    const lowerHull = RAPIER.ColliderDesc.cuboid(
      params.chassisDims.x * 0.48,
      0.16,
      params.chassisDims.z * 0.48
    )
      .setTranslation(0, 0.11, 0)
      .setMass(params.mass * 0.85)
      .setFriction(0.3)
      .setRestitution(0.0);

    const upperCabin = RAPIER.ColliderDesc.cuboid(
      params.chassisDims.x * 0.42,
      0.20,
      params.chassisDims.z * 0.25
    )
      .setTranslation(0, 0.44, -0.15)
      .setMass(params.mass * 0.15)
      .setFriction(0.3)
      .setRestitution(0.0);

    this.chassisCollider = world.createCollider(lowerHull, this.rigidBody);
    this.cabinCollider = world.createCollider(upperCabin, this.rigidBody);
  }

  reset(position = new THREE.Vector3(0, this.chassisLocalOffset.y, 0), yawRad = 0) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad);
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

    // Speed-sensitive steering calculation
    const rawSteerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const speedFactor = 1 / (1 + Math.abs(this.forwardSpeed) * params.highSpeedSteerFactor);
    const targetSteer = rawSteerInput * params.maxSteerAngle * speedFactor;
    const steerLerp = 1 - Math.exp(-params.steerSpeed * dt);
    this.currentSteer += (targetSteer - this.currentSteer) * steerLerp;

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

    if (input.forward && !input.backward) {
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

        const maxCornerLoad = params.mass * 9.81 * 1.6;
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
          const topSpeedTaper = Math.max(0, 1 - Math.abs(this.forwardSpeed) / 62);
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
          longForce += hbSign * params.handbrakeForce * 0.5;
        }

        // Balanced front & rear lateral grip so car tracks cleanly without accidental sliding
        let gripMultiplier = w.isFront ? params.frontLateralGrip : params.rearLateralGrip;
        if (input.handbrake && !w.isFront) {
          gripMultiplier = params.handbrakeRearGrip;
        }

        const maxLatForce = Math.max(1600, normalLoad * gripMultiplier);
        const corneringStiffness = (params.mass * 0.25) * (w.isFront ? 25.0 : 24.0);
        const rawLatForce = -wheelLateralVel * corneringStiffness;
        const latForce = Math.max(-maxLatForce, Math.min(maxLatForce, rawLatForce));

        const tireForceVec = wheelForward
          .clone()
          .multiplyScalar(longForce)
          .addScaledVector(wheelLeft, latForce);

        const zLever = w.isFront ? w.hardpointLocal.z * 0.98 : w.hardpointLocal.z * 0.94;
        const tireForcePoint = chassisPos
          .clone()
          .addScaledVector(leftDir, w.hardpointLocal.x * 0.65)
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
        } else if (!w.isFront && Math.abs(wheelLateralVel) > 3.2 && slipRatio > 0.30) {
          w.skidIntensity = Math.min(1, (slipRatio - 0.25) * 2.2);
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

    // Sweet-spot steering yaw assist (moderate during normal steering, strong kick on Spacebar drift)
    if (frontGrounded > 0 && Math.abs(this.currentSteer) > 0.001 && Math.abs(this.forwardSpeed) > 0.5) {
      const dirSign = this.forwardSpeed >= 0 ? 1 : -1;
      const speedRatio = Math.min(1.0, Math.abs(this.forwardSpeed) / 8.0);
      const activeYawTorque = input.handbrake ? params.driftYawTorque : params.yawAssistTorque;
      const baseYaw =
        (this.currentSteer / params.maxSteerAngle) *
        dirSign *
        speedRatio *
        activeYawTorque;
      const yawVec = upDir.clone().multiplyScalar(baseYaw);
      rigidBody.addTorque({ x: yawVec.x, y: yawVec.y, z: yawVec.z }, true);
    }

    // Anti-roll bar & uprighting stabilizer so hitting sloped road shoulders at speed won't flip the car
    if (groundedCount >= 1) {
      const worldUp = new THREE.Vector3(0, 1, 0);
      const tiltAxis = new THREE.Vector3().crossVectors(upDir, worldUp);
      const tiltSin = Math.min(1.0, tiltAxis.length());
      if (tiltSin > 0.01) {
        tiltAxis.normalize();
        // Progressive uprighting torque: gentle at small lean, strong resistance past ~20 deg
        const uprightStrength = params.mass * (3.2 + 12.0 * tiltSin * tiltSin);
        const rollVelDamp = angVelVec.dot(forwardDir) * params.mass * 2.4;
        const uprightTorque = tiltAxis
          .multiplyScalar(tiltSin * uprightStrength)
          .addScaledVector(forwardDir, -rollVelDamp);
        rigidBody.addTorque(
          { x: uprightTorque.x, y: uprightTorque.y, z: uprightTorque.z },
          true
        );
      }
    }

    // Gentle low-speed full-stop settle when idle
    if (!input.forward && !input.backward && Math.abs(this.forwardSpeed) < 0.4 && groundedCount >= 2) {
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

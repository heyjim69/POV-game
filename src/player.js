/* =============================================================
   RIVER VILLAGE — player.js
   First-person controller: acceleration-based movement, capsule
   collision, sprinting, jumping, swimming with a breath meter,
   head bob, landing dip and directional damage tracking.
   ============================================================= */
(function (RV) {
  'use strict';

  var P = RV.player = {};
  var C = RV.col3;

  var EYE = 1.62;
  var RADIUS = 0.34;
  var HEIGHT = 1.74;

  P.pos = new THREE.Vector3(0, 3, 0);
  P.vel = new THREE.Vector3();
  P.yaw = 0;
  P.pitch = 0;
  P.health = 100;
  P.maxHealth = 100;
  P.breath = 1;
  P.grounded = false;
  P.inWater = false;
  P.submerged = false;
  P.sprinting = false;
  P.speed = 0;
  P.alive = true;
  P.damageDirs = [];       // for the on-screen hit indicators
  P.lastDamage = -99;
  P.surfaceMat = 'wood';

  var camera = null;
  var bobT = 0, bobAmt = 0;
  var landDip = 0, landDipVel = 0;
  var stepAccum = 0;
  var coyote = 0, jumpBuffer = 0;
  var wasInWater = false;
  var camRoll = 0;
  var bubbleTimer = 0;
  var lastSurfaceY = 0;
  var recoilPitch = 0, recoilYaw = 0;   // how much of the view offset is recoil
  var lastFireTime = -99;
  P.notifyFired = function () { lastFireTime = RV.now(); };

  var WALK = 4.3, SPRINT = 7.0, SWIM = 3.0, AIR_CONTROL = 0.28;

  P.init = function (cam) {
    camera = cam;
    P.camera = cam;
  };

  P.reset = function (startPos, yaw) {
    P.pos.copy(startPos);
    P.vel.set(0, 0, 0);
    P.yaw = yaw || 0;
    P.pitch = 0;
    P.health = P.maxHealth;
    P.breath = 1;
    P.alive = true;
    P.damageDirs.length = 0;
    P.lastDamage = -99;
    bobT = 0; bobAmt = 0; landDip = 0; landDipVel = 0;
    camRoll = 0;
    recoilPitch = 0; recoilYaw = 0; lastFireTime = -99;
  };

  P.hurt = function (amount, fromPos) {
    if (!P.alive) return;
    P.health -= amount;
    P.lastDamage = RV.now();
    if (fromPos) {
      // remember where it came from so the HUD can point at it
      var a = Math.atan2(fromPos.x - P.pos.x, fromPos.z - P.pos.z);
      P.damageDirs.push({ angle: a, t: 1.0 });
      if (P.damageDirs.length > 6) P.damageDirs.shift();
    }
    RV.audio.play('hurt');
    if (P.health <= 0) {
      P.health = 0;
      P.alive = false;
      RV.audio.play('die');
    }
  };

  P.heal = function (n) {
    P.health = Math.min(P.maxHealth, P.health + n);
  };

  /* =============================================================
     UPDATE
     ============================================================= */
  P.update = function (dt, input, time) {
    var i;

    /* ---- look ---- */
    P.yaw -= input.mouseDX;
    P.pitch -= input.mouseDY;

    /* Weapon recoil pushes the view up, then most of it settles back —
       without the recovery a full magazine walks you into the sky. */
    var kick = RV.weapon.consumeCameraKick();
    recoilPitch += kick.x;
    recoilYaw += kick.y;
    recoilPitch = RV.clamp(recoilPitch, 0, 0.42);
    recoilYaw = RV.clamp(recoilYaw, -0.12, 0.12);
    P.pitch += kick.x;
    P.yaw += kick.y;

    // recover slowly while the trigger is down, quickly once it is released
    var firing = RV.now() - lastFireTime < 0.14;
    var lambda = firing ? 2.6 : 8.0;
    var backP = recoilPitch * (1 - Math.exp(-lambda * dt));
    var backY = recoilYaw * (1 - Math.exp(-lambda * dt));
    recoilPitch -= backP; recoilYaw -= backY;
    P.pitch -= backP; P.yaw -= backY;

    // a deliberate downward drag counts against the pending recoil
    if (input.mouseDY > 0) recoilPitch = Math.max(0, recoilPitch - input.mouseDY);

    P.pitch = RV.clamp(P.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);

    if (!P.alive) {
      // slump to the deck
      landDip = RV.damp(landDip, -0.95, 3, dt);
      camRoll = RV.damp(camRoll, 0.55, 3, dt);
      applyCamera(dt, time);
      return;
    }

    /* ---- wish direction in world space ---- */
    var fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    var rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    var wx = fx * input.forward + rx * input.right;
    var wz = fz * input.forward + rz * input.right;
    var wlen = Math.sqrt(wx * wx + wz * wz);
    if (wlen > 1e-4) { wx /= wlen; wz /= wlen; } else { wx = wz = 0; }
    var wishing = wlen > 1e-4;

    var waterLevel = RV.water.LEVEL + RV.water.height(P.pos.x, P.pos.z, time);
    var feetInWater = P.pos.y < waterLevel - 0.05;
    var eyeY = P.pos.y + EYE;
    P.submerged = eyeY < waterLevel - 0.02;

    /* ---- water entry ---- */
    if (feetInWater && !wasInWater) {
      var impact = RV.clamp(-P.vel.y / 9, 0.3, 1.7);
      RV.fx.splash(P.pos.x, waterLevel, P.pos.z, impact);
      RV.audio.play('splash', P.pos, impact);
      P.vel.y *= 0.30;
      P.vel.x *= 0.6; P.vel.z *= 0.6;
    } else if (!feetInWater && wasInWater && P.vel.y > 1.5) {
      RV.fx.splash(P.pos.x, waterLevel, P.pos.z, 0.6);
    }
    wasInWater = feetInWater;
    P.inWater = feetInWater;

    /* =============================================================
       SWIMMING
       ============================================================= */
    if (feetInWater) {
      P.sprinting = false;
      var swimSpeed = SWIM * (input.sprint ? 1.35 : 1.0);

      // steering follows where you're looking when submerged
      var tx = wx * swimSpeed, tz = wz * swimSpeed;
      var ty = 0;
      if (P.submerged && wishing) {
        var pitchDir = Math.sin(P.pitch) * input.forward;
        ty += pitchDir * swimSpeed;
        var flat = Math.cos(P.pitch);
        tx *= Math.abs(flat); tz *= Math.abs(flat);
      }
      if (input.jump) ty += swimSpeed * 0.85;
      if (input.crouch) ty -= swimSpeed * 0.85;

      // buoyancy pulls you up to a floating waterline
      var floatY = waterLevel - 1.30;
      if (!input.crouch) {
        var buoy = RV.clamp((floatY - P.pos.y) * 2.6, -1.2, 2.4);
        ty += buoy;
      }

      P.vel.x = RV.damp(P.vel.x, tx, 5.5, dt);
      P.vel.z = RV.damp(P.vel.z, tz, 5.5, dt);
      P.vel.y = RV.damp(P.vel.y, ty, 4.5, dt);
      P.grounded = false;
      coyote = 0;

      /* ---- breath ---- */
      if (P.submerged) {
        P.breath -= dt / 13.0;
        bubbleTimer -= dt;
        if (bubbleTimer <= 0) {
          bubbleTimer = RV.randRange(0.25, 0.7);
          RV.fx.bubbles(P.pos.x + fx * 0.3, eyeY - 0.1, P.pos.z + fz * 0.3, RV.randInt(1, 3));
        }
        if (P.breath < 0) {
          P.breath = 0;
          P.drownTick = (P.drownTick || 0) + dt;
          if (P.drownTick > 0.9) { P.drownTick = 0; P.hurt(9, null); }
        }
      } else {
        P.breath = Math.min(1, P.breath + dt / 2.2);
        P.drownTick = 0;
      }
    } else {
      /* =============================================================
         WALKING
         ============================================================= */
      P.breath = Math.min(1, P.breath + dt / 2.2);
      P.drownTick = 0;

      P.sprinting = input.sprint && input.forward > 0.1 && P.grounded && !RV.weapon.ads;
      var maxSpeed = P.sprinting ? SPRINT : WALK;
      if (input.ads) maxSpeed *= 0.55;
      if (!P.grounded) maxSpeed *= 1.0;

      var accel = P.grounded ? 52 : 52 * AIR_CONTROL;
      var targetX = wx * maxSpeed, targetZ = wz * maxSpeed;

      if (wishing) {
        P.vel.x += (targetX - P.vel.x) * Math.min(1, accel * dt / maxSpeed);
        P.vel.z += (targetZ - P.vel.z) * Math.min(1, accel * dt / maxSpeed);
      } else if (P.grounded) {
        var fr = Math.exp(-11 * dt);
        P.vel.x *= fr; P.vel.z *= fr;
      }

      /* ---- jump ---- */
      if (input.jump) jumpBuffer = 0.14; else jumpBuffer = Math.max(0, jumpBuffer - dt);
      if (jumpBuffer > 0 && coyote > 0) {
        P.vel.y = 6.5;
        coyote = 0; jumpBuffer = 0;
        P.grounded = false;
        RV.audio.play('jump', P.pos);
      }

      P.vel.y -= 22 * dt;
      if (P.vel.y < -55) P.vel.y = -55;
    }

    /* ---- integrate + collide ---- */
    var prevY = P.pos.y;
    var prevVelY = P.vel.y;
    P.pos.x += P.vel.x * dt;
    P.pos.y += P.vel.y * dt;
    P.pos.z += P.vel.z * dt;

    // riverbed floor
    var bed = RV.water.bedY(P.pos.x, P.pos.z);
    if (P.pos.y < bed) { P.pos.y = bed; if (P.vel.y < 0) P.vel.y = 0; }

    var res = C.resolve(P.pos, RADIUS, HEIGHT, prevY, 0.45);
    var wasGrounded = P.grounded;
    P.grounded = res.ground && !feetInWater;
    P.surfaceMat = res.mat;

    if (res.ground) {
      if (P.vel.y < 0) P.vel.y = 0;
      if (!wasGrounded && prevVelY < -3.5) {
        // landing
        landDipVel -= RV.clamp(-prevVelY / 9, 0.1, 1.0) * 3.4;
        RV.audio.play('land', P.pos);
        if (prevVelY < -13.5) {
          P.hurt(RV.clamp((-prevVelY - 13.5) * 4.0, 3, 60), null);
        }
      }
      coyote = 0.12;
      lastSurfaceY = res.groundY;
    } else {
      coyote = Math.max(0, coyote - dt);
    }
    if (res.ceiling && P.vel.y > 0) P.vel.y = 0;

    P.speed = Math.sqrt(P.vel.x * P.vel.x + P.vel.z * P.vel.z);

    /* ---- footsteps ---- */
    if (P.grounded && P.speed > 0.9) {
      stepAccum += P.speed * dt;
      var stride = P.sprinting ? 2.35 : 1.85;
      if (stepAccum > stride) {
        stepAccum = 0;
        RV.audio.play('step', P.pos, P.sprinting ? 'run' : '');
      }
    } else if (feetInWater && P.speed > 0.7) {
      stepAccum += P.speed * dt;
      if (stepAccum > 2.6) {
        stepAccum = 0;
        RV.audio.play('step', P.pos, 'water');
      }
    } else {
      stepAccum = Math.max(0, stepAccum - dt * 0.5);
    }

    /* ---- health regen ---- */
    if (RV.now() - P.lastDamage > 8.0 && P.health < P.maxHealth) {
      P.health = Math.min(P.maxHealth, P.health + dt * 4.5);
    }

    /* ---- damage indicators fade ---- */
    for (i = P.damageDirs.length - 1; i >= 0; i--) {
      P.damageDirs[i].t -= dt / 1.6;
      if (P.damageDirs[i].t <= 0) P.damageDirs.splice(i, 1);
    }

    /* ---- camera shaping ---- */
    var moving = P.speed > 0.6 && (P.grounded || feetInWater);
    bobAmt = RV.damp(bobAmt, moving ? RV.clamp(P.speed / SPRINT, 0, 1) : 0, 7, dt);
    bobT += dt * (P.sprinting ? 12.4 : 9.0) * RV.clamp(P.speed / 3.2, 0, 1.5);

    // roll into strafes
    var strafe = (P.vel.x * rx + P.vel.z * rz) / Math.max(WALK, 0.001);
    camRoll = RV.damp(camRoll, RV.clamp(-strafe, -1, 1) * 0.028, 7, dt);

    // landing dip spring
    landDipVel += (-landDip * 150 - landDipVel * 18) * dt;
    landDip += landDipVel * dt;
    landDip = RV.clamp(landDip, -0.55, 0.25);

    applyCamera(dt, time);
  };

  function applyCamera(dt, time) {
    var bobScale = RV.lerp(1, 0.32, RV.weapon.adsT);
    var bobY = Math.abs(Math.sin(bobT)) * 0.055 * bobAmt * bobScale;
    var bobX = Math.sin(bobT * 0.5) * 0.032 * bobAmt * bobScale;
    var bobRoll = Math.sin(bobT * 0.5) * 0.012 * bobAmt * bobScale;

    // gentle sway while treading water
    var swim = P.inWater ? Math.sin(time * 1.6) * 0.035 : 0;

    var breathe = Math.sin(time * 1.15) * 0.006 * (1 - bobAmt);

    camera.position.set(
      P.pos.x + bobX,
      P.pos.y + EYE + bobY + landDip + swim + breathe,
      P.pos.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = P.yaw;
    camera.rotation.x = P.pitch;
    camera.rotation.z = camRoll + bobRoll;
  }

  P.eyeY = function () { return P.pos.y + EYE; };
  P.RADIUS = RADIUS;
  P.HEIGHT = HEIGHT;
  P.EYE = EYE;

})(window.RV);

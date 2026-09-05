/* =============================================================
   RIVER VILLAGE — enemies.js
   Infected villagers: procedurally built emaciated bodies, hand
   animated walk/run/lunge cycles, edge-aware pathing so they follow
   the docks and bridges, per-zone hitboxes and a staged death fall.
   ============================================================= */
(function (RV) {
  'use strict';

  var E = RV.enemies = {};
  var C = RV.col3;
  var list = [];
  var scene = null, bodyMat = null;
  var geoCache = null;

  E.list = list;
  E.killCount = 0;

  var STATE = { IDLE: 0, ALERT: 1, CHASE: 2, ATTACK: 3, DEAD: 4 };
  E.STATE = STATE;

  /* skin lives in the left half of the atlas, cloth in the right */
  function remapUV(geo, u0, u1) {
    var uv = geo.attributes.uv;
    for (var i = 0; i < uv.count; i++) {
      var u = uv.getX(i), v = uv.getY(i);
      u = u - Math.floor(u);
      v = v - Math.floor(v);
      uv.setXY(i, u0 + u * (u1 - u0), v);
    }
    return geo;
  }
  function skin(geo) { return remapUV(geo, 0.02, 0.48); }
  function cloth(geo) { return remapUV(geo, 0.52, 0.98); }

  /* =============================================================
     BODY — built once, then cloned per enemy
     ============================================================= */
  function buildBodyGeometry() {
    var white = new THREE.Color(1, 1, 1);
    var g = {};

    /* --- core: pelvis, ribcage, shoulders, neck, head --- */
    var core = [];
    var pelvis = cloth(RV.boxGeo(0.30, 0.20, 0.19, 1.0, white));
    RV.place(pelvis, 0, 0.10, 0);
    core.push(pelvis);

    // emaciated torso — narrow waist, visible ribs
    var waist = skin(RV.boxGeo(0.26, 0.20, 0.16, 1.0, white));
    RV.place(waist, 0, 0.30, 0);
    core.push(waist);
    var chest = skin(RV.boxGeo(0.33, 0.26, 0.19, 1.0, white));
    RV.place(chest, 0, 0.53, -0.005);
    core.push(chest);
    for (var rib = 0; rib < 4; rib++) {
      var rg = skin(RV.boxGeo(0.30 - rib * 0.012, 0.022, 0.20, 1.0, new THREE.Color(0.86, 0.86, 0.84)));
      RV.place(rg, 0, 0.40 + rib * 0.055, 0.005);
      core.push(rg);
    }
    // hunched shoulders
    var shoulders = skin(RV.boxGeo(0.40, 0.13, 0.18, 1.0, white));
    RV.place(shoulders, 0, 0.685, -0.015, -0.16, 0, 0);
    core.push(shoulders);
    var neck = skin(RV.boxGeo(0.10, 0.10, 0.10, 1.0, white));
    RV.place(neck, 0, 0.755, 0.01);
    core.push(neck);

    // head: skull-like, jaw slightly open
    var head = skin(RV.boxGeo(0.175, 0.20, 0.19, 1.0, white));
    RV.place(head, 0, 0.865, 0.015);
    core.push(head);
    var jaw = skin(RV.boxGeo(0.135, 0.06, 0.15, 1.0, new THREE.Color(0.9, 0.88, 0.86)));
    RV.place(jaw, 0, 0.775, 0.045, 0.22, 0, 0);
    core.push(jaw);
    // sunken eye sockets
    for (var ey = -1; ey <= 1; ey += 2) {
      var eg = skin(RV.boxGeo(0.045, 0.035, 0.03, 1.0, new THREE.Color(0.18, 0.16, 0.16)));
      RV.place(eg, ey * 0.042, 0.885, 0.105);
      core.push(eg);
    }
    // matted hair
    var hair = skin(RV.boxGeo(0.185, 0.075, 0.20, 1.0, new THREE.Color(0.30, 0.26, 0.22)));
    RV.place(hair, 0, 0.955, 0.005);
    core.push(hair);
    g.core = RV.merge(core);

    /* --- arm: upper + forearm merged with a fixed elbow bend --- */
    function arm(side) {
      var parts = [];
      var upper = skin(RV.boxGeo(0.085, 0.30, 0.088, 1.0, white));
      RV.place(upper, 0, -0.15, 0);
      parts.push(upper);
      var fore = skin(RV.boxGeo(0.072, 0.28, 0.075, 1.0, white));
      RV.place(fore, 0, -0.425, 0.06, -0.42, 0, 0);
      parts.push(fore);
      var hand = skin(RV.boxGeo(0.078, 0.10, 0.055, 1.0, new THREE.Color(0.92, 0.9, 0.88)));
      RV.place(hand, 0, -0.565, 0.115, -0.42, 0, 0);
      parts.push(hand);
      // clawed fingers
      for (var f = 0; f < 3; f++) {
        var fg = skin(RV.boxGeo(0.016, 0.055, 0.016, 1.0, new THREE.Color(0.86, 0.84, 0.82)));
        RV.place(fg, (f - 1) * 0.024, -0.625, 0.135, -0.7, 0, 0);
        parts.push(fg);
      }
      return RV.merge(parts);
    }
    g.armL = arm(-1);
    g.armR = arm(1);

    /* --- legs --- */
    var thigh = cloth(RV.boxGeo(0.135, 0.42, 0.145, 1.0, white));
    RV.place(thigh, 0, -0.21, 0);
    // ragged hem
    var hem = cloth(RV.boxGeo(0.145, 0.06, 0.152, 1.0, new THREE.Color(0.7, 0.7, 0.7)));
    RV.place(hem, 0, -0.40, 0);
    g.thigh = RV.merge([thigh, hem]);

    var shin = skin(RV.boxGeo(0.105, 0.40, 0.105, 1.0, white));
    RV.place(shin, 0, -0.20, 0);
    var foot = skin(RV.boxGeo(0.11, 0.07, 0.22, 1.0, new THREE.Color(0.8, 0.78, 0.76)));
    RV.place(foot, 0, -0.425, 0.05);
    g.shin = RV.merge([shin, foot]);

    return g;
  }

  /* =============================================================
     SPAWN
     ============================================================= */
  E.init = function (sc, mat) {
    scene = sc;
    bodyMat = mat;
    geoCache = buildBodyGeometry();
    list.length = 0;
    E.killCount = 0;
  };

  function makeMesh(geo) {
    var m = new THREE.Mesh(geo, bodyMat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  E.spawn = function (pos) {
    var root = new THREE.Group();
    var body = new THREE.Group();          // scaled + leaned; animation lives here
    root.add(body);

    var hipY = 0.92;
    var hips = new THREE.Group();
    hips.position.y = hipY;
    body.add(hips);

    var core = makeMesh(geoCache.core);
    hips.add(core);

    var shoulderY = 0.66;
    var armL = new THREE.Group(); armL.position.set(-0.215, shoulderY, -0.01);
    var armR = new THREE.Group(); armR.position.set(0.215, shoulderY, -0.01);
    armL.add(makeMesh(geoCache.armL));
    armR.add(makeMesh(geoCache.armR));
    hips.add(armL); hips.add(armR);

    var thighL = new THREE.Group(); thighL.position.set(-0.095, 0.02, 0);
    var thighR = new THREE.Group(); thighR.position.set(0.095, 0.02, 0);
    thighL.add(makeMesh(geoCache.thigh));
    thighR.add(makeMesh(geoCache.thigh));
    hips.add(thighL); hips.add(thighR);

    var shinL = new THREE.Group(); shinL.position.set(0, -0.44, 0);
    var shinR = new THREE.Group(); shinR.position.set(0, -0.44, 0);
    shinL.add(makeMesh(geoCache.shin));
    shinR.add(makeMesh(geoCache.shin));
    thighL.add(shinL); thighR.add(shinR);

    var scale = RV.randRange(0.93, 1.07);
    body.scale.setScalar(scale);

    var e = {
      root: root, body: body, hips: hips, core: core,
      armL: armL, armR: armR,
      thighL: thighL, thighR: thighR, shinL: shinL, shinR: shinR,
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      vel: new THREE.Vector3(),
      yaw: RV.rand() * 6.28,
      state: STATE.IDLE,
      health: 100,
      radius: 0.30,
      height: 1.72 * scale,
      scale: scale,
      grounded: false,
      inWater: false,
      speed: 0,
      animT: RV.rand() * 6.28,
      stateT: 0,
      attackT: -99,
      attackPhase: 0,
      flinch: 0,
      growlT: RV.randRange(2, 9),
      wanderYaw: RV.rand() * 6.28,
      wanderT: RV.randRange(1, 4),
      deathT: 0,
      deathDir: 1,
      deathTilt: 0,
      alive: true,
      lastStep: 0,
      stepFlip: 1,
      aggroRange: RV.randRange(24, 34),
      runSpeed: RV.randRange(3.3, 4.3),
      walkSpeed: RV.randRange(1.25, 1.75)
    };
    root.position.copy(e.pos);
    scene.add(root);
    list.push(e);
    return e;
  };

  E.clear = function () {
    for (var i = 0; i < list.length; i++) scene.remove(list[i].root);
    list.length = 0;
  };

  /* =============================================================
     HITBOXES
     A stack of spheres approximating a capsule per body section.
     The heights are taken straight from the geometry above: the hips
     group sits at 0.92, the head at a further 0.865, and so on — so a
     round that visually strikes the skull actually registers as one.
     ============================================================= */
  var HITBOXES = [
    { y: 1.790, r: 0.170, zone: 'head' },
    { y: 1.480, r: 0.200, zone: 'body' },   // chest
    { y: 1.220, r: 0.185, zone: 'body' },   // waist
    { y: 1.010, r: 0.195, zone: 'body' },   // pelvis
    { y: 0.740, r: 0.175, zone: 'legs' },   // thighs
    { y: 0.360, r: 0.150, zone: 'legs' }    // shins
  ];

  function hitSpheres(e, out) {
    var s = e.scale;
    for (var i = 0; i < HITBOXES.length; i++) {
      var h = HITBOXES[i];
      out[i].set(e.pos.x, e.pos.y + h.y * s, e.pos.z);
      out[i].r = h.r * s;
      out[i].zone = h.zone;
    }
    return out;
  }

  var _sph = [];
  for (var _i = 0; _i < HITBOXES.length; _i++) { _sph.push(new THREE.Vector3()); _sph[_i].r = 0; }

  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    var mx = ox - cx, my = oy - cy, mz = oz - cz;
    var b = mx * dx + my * dy + mz * dz;
    var c = mx * mx + my * my + mz * mz - r * r;
    if (c > 0 && b > 0) return -1;
    var disc = b * b - c;
    if (disc < 0) return -1;
    var t = -b - Math.sqrt(disc);
    return t < 0 ? 0 : t;
  }

  /**
   * Nearest enemy hit along a ray.
   * @returns {object|null} {enemy, dist, zone, point}
   */
  var _hitRes = { enemy: null, dist: 0, zone: '', x: 0, y: 0, z: 0 };
  E.raycast = function (ox, oy, oz, dx, dy, dz, maxDist) {
    var best = null, bestT = maxDist;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e.alive) continue;
      // cheap reject: is the body anywhere along this ray at all?
      var toX = e.pos.x - ox, toY = e.pos.y + 0.95 * e.scale - oy, toZ = e.pos.z - oz;
      var along = toX * dx + toY * dy + toZ * dz;
      if (along < -1.2 || along > bestT + 1.2) continue;
      var perp2 = (toX * toX + toY * toY + toZ * toZ) - along * along;
      if (perp2 > 1.4 * 1.4) continue;
      hitSpheres(e, _sph);
      for (var s = 0; s < _sph.length; s++) {
        var sp = _sph[s];
        var t = raySphere(ox, oy, oz, dx, dy, dz, sp.x, sp.y, sp.z, sp.r);
        if (t >= 0 && t < bestT) {
          bestT = t; best = e;
          _hitRes.zone = sp.zone;
        }
      }
    }
    if (!best) return null;
    _hitRes.enemy = best;
    _hitRes.dist = bestT;
    _hitRes.x = ox + dx * bestT;
    _hitRes.y = oy + dy * bestT;
    _hitRes.z = oz + dz * bestT;
    return _hitRes;
  };

  /* =============================================================
     DAMAGE & DEATH
     ============================================================= */
  E.damage = function (e, amount, dirX, dirZ) {
    if (!e.alive) return false;
    e.health -= amount;
    e.flinch = 0.18;
    // getting shot always gets their attention
    if (e.state === STATE.IDLE) { e.state = STATE.ALERT; e.stateT = 0; }
    if (e.health <= 0) {
      kill(e, dirX, dirZ);
      return true;
    }
    return false;
  };

  function kill(e, dirX, dirZ) {
    e.alive = false;
    e.state = STATE.DEAD;
    e.deathT = 0;
    e.health = 0;
    // fall away from the shot
    var localFwd = Math.cos(e.yaw) * dirZ + Math.sin(e.yaw) * dirX;
    e.deathDir = localFwd > 0 ? 1 : -1;
    e.deathSide = RV.randRange(-0.4, 0.4);
    E.killCount++;
    RV.audio.play('death', e.pos);
    RV.fx.blood({ x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z }, dirX, 0.3, dirZ, 1.4);
  }

  /* =============================================================
     PERCEPTION & STEERING
     ============================================================= */
  E.alertAll = function (pos, radius) {
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e.alive || e.state !== STATE.IDLE) continue;
      var dx = e.pos.x - pos.x, dz = e.pos.z - pos.z, dy = e.pos.y - pos.y;
      if (dx * dx + dy * dy + dz * dz < radius * radius) {
        e.state = STATE.ALERT;
        e.stateT = RV.randRange(0, 0.35);
      }
    }
  };

  function canSee(e, target) {
    var ex = e.pos.x, ey = e.pos.y + 1.55, ez = e.pos.z;
    return !C.losBlocked(ex, ey, ez, target.x, target.y, target.z);
  }

  /** Is there footing at (x,z) near height y? */
  function footing(x, z, y) {
    var g = C.groundAt(x, z, y + 0.45, 1.35, 0.22);
    if (g) return g.y1;
    // shallow water / riverbed counts as waadable
    var bed = RV.water.bedY(x, z);
    if (bed > -1.35) return bed;
    return null;
  }

  /** Pick a heading that keeps the enemy on solid footing. */
  var OFFSETS = [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0];
  function steer(e, wantX, wantZ) {
    var baseAng = Math.atan2(wantX, wantZ);
    for (var i = 0; i < OFFSETS.length; i++) {
      var a = baseAng + OFFSETS[i];
      var sx = Math.sin(a), sz = Math.cos(a);
      var probe = 0.85;
      var f = footing(e.pos.x + sx * probe, e.pos.z + sz * probe, e.pos.y);
      if (f !== null && f - e.pos.y < 0.75) return a;
    }
    return null;
  }

  /* =============================================================
     UPDATE
     ============================================================= */
  E.update = function (dt, player, time) {
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.state === STATE.DEAD) { updateDead(e, dt, i); continue; }
      updateAlive(e, dt, player, time);
    }
  };

  function updateAlive(e, dt, player, time) {
    var px = player.pos.x, py = player.pos.y, pz = player.pos.z;
    var dx = px - e.pos.x, dy = py - e.pos.y, dz = pz - e.pos.z;
    var distSq = dx * dx + dz * dz;
    var dist = Math.sqrt(distSq);
    e.stateT += dt;
    if (e.flinch > 0) e.flinch -= dt;

    /* ---- state machine ---- */
    var moveX = 0, moveZ = 0, wantSpeed = 0;

    if (e.state === STATE.IDLE) {
      e.wanderT -= dt;
      if (e.wanderT <= 0) {
        e.wanderT = RV.randRange(2.5, 6.5);
        e.wanderYaw = RV.rand() * 6.28;
        e.wanderMoving = RV.chance(0.55);
      }
      if (e.wanderMoving) {
        moveX = Math.sin(e.wanderYaw); moveZ = Math.cos(e.wanderYaw);
        wantSpeed = e.walkSpeed * 0.45;
      }
      // notice the player
      if (dist < e.aggroRange && Math.abs(dy) < 6 && canSee(e, player.pos)) {
        e.state = STATE.ALERT; e.stateT = 0;
      } else if (dist < 7 && Math.abs(dy) < 3) {
        e.state = STATE.ALERT; e.stateT = 0;
      }
    } else if (e.state === STATE.ALERT) {
      // a beat of recognition, then the charge
      if (e.stateT < 0.05) RV.audio.play('growl', e.pos);
      wantSpeed = 0;
      if (e.stateT > 0.55) { e.state = STATE.CHASE; e.stateT = 0; RV.audio.play('scream', e.pos); }
    } else if (e.state === STATE.CHASE) {
      moveX = dx; moveZ = dz;
      var inv = 1 / Math.max(dist, 0.001);
      moveX *= inv; moveZ *= inv;
      wantSpeed = e.runSpeed;
      if (e.inWater) wantSpeed *= 0.45;
      if (dist < 1.75 && Math.abs(dy) < 1.9) {
        e.state = STATE.ATTACK; e.stateT = 0; e.attackPhase = 0;
      }
      // lost track of them
      if (dist > e.aggroRange * 1.9) { e.state = STATE.IDLE; e.stateT = 0; }
      e.growlT -= dt;
      if (e.growlT <= 0) { e.growlT = RV.randRange(1.8, 4.5); RV.audio.play('growl', e.pos); }
    } else if (e.state === STATE.ATTACK) {
      wantSpeed = 0;
      // slow lean-in during the wind-up
      if (e.stateT < 0.38) {
        moveX = dx; moveZ = dz;
        var inv2 = 1 / Math.max(dist, 0.001);
        moveX *= inv2; moveZ *= inv2;
        wantSpeed = 0.9;
      }
      if (e.attackPhase === 0 && e.stateT >= 0.38) {
        e.attackPhase = 1;
        if (dist < 2.25 && Math.abs(dy) < 2.0) {
          player.hurt(RV.randRange(11, 16), e.pos);
        }
      }
      if (e.stateT > 1.15) {
        e.state = dist < 1.9 ? STATE.ATTACK : STATE.CHASE;
        e.stateT = 0; e.attackPhase = 0;
      }
    }

    /* ---- steering that respects the edges of the decks ---- */
    if (wantSpeed > 0.05) {
      var ang = steer(e, moveX, moveZ);
      if (ang === null) {
        wantSpeed = 0;
        if (e.state === STATE.IDLE) e.wanderT = 0;   // pick a new direction
      } else {
        moveX = Math.sin(ang); moveZ = Math.cos(ang);
        var targetYaw = ang;
        e.yaw += RV.angleDelta(e.yaw, targetYaw) * Math.min(1, dt * 7);
      }
    } else if (e.state === STATE.ATTACK || e.state === STATE.ALERT) {
      // always face the player while attacking
      var fy = Math.atan2(dx, dz);
      e.yaw += RV.angleDelta(e.yaw, fy) * Math.min(1, dt * 9);
    }

    /* ---- integrate ---- */
    var accel = e.grounded ? 22 : 4;
    e.vel.x = RV.damp(e.vel.x, moveX * wantSpeed, accel, dt);
    e.vel.z = RV.damp(e.vel.z, moveZ * wantSpeed, accel, dt);
    e.vel.y -= 24 * dt;

    var bed = RV.water.bedY(e.pos.x, e.pos.z);
    var wasWater = e.inWater;
    e.inWater = e.pos.y < RV.water.LEVEL - 0.15;
    if (e.inWater) {
      // wade / paddle — they float at roughly chest height
      var targetY = RV.water.LEVEL - 0.95;
      e.vel.y = RV.damp(e.vel.y, (targetY - e.pos.y) * 3.4, 6, dt);
      e.vel.x *= 0.92; e.vel.z *= 0.92;
      if (!wasWater) {
        RV.fx.splash(e.pos.x, RV.water.LEVEL, e.pos.z, 1.0);
        RV.audio.play('splash', e.pos, 1.0);
      }
    }

    var prevY = e.pos.y;
    e.pos.x += e.vel.x * dt;
    e.pos.y += e.vel.y * dt;
    e.pos.z += e.vel.z * dt;

    // don't sink through the riverbed
    if (e.pos.y < bed) { e.pos.y = bed; e.vel.y = 0; }

    var res = C.resolve(e.pos, e.radius, e.height, prevY, 0.5);
    e.grounded = res.ground;
    if (res.ground) e.vel.y = Math.max(0, e.vel.y);

    e.speed = Math.sqrt(e.vel.x * e.vel.x + e.vel.z * e.vel.z);

    /* ---- footsteps ---- */
    if (e.grounded && e.speed > 0.8) {
      e.lastStep -= dt * e.speed;
      if (e.lastStep <= 0) {
        e.lastStep = 1.15;
        RV.audio.play('step', e.pos, e.inWater ? 'water' : '');
      }
    }

    e.root.position.copy(e.pos);
    e.root.rotation.y = e.yaw;
    animate(e, dt);
  }

  /* =============================================================
     ANIMATION
     ============================================================= */
  function animate(e, dt) {
    var b = e.body, h = e.hips;
    var moving = e.speed > 0.25;
    var cycleSpeed = e.state === STATE.CHASE ? 7.4 : 4.2;
    e.animT += dt * (moving ? cycleSpeed * RV.clamp(e.speed / 2.5, 0.5, 1.6) : 1.6);
    var t = e.animT;

    var running = e.state === STATE.CHASE && moving;
    var swing = moving ? (running ? 1.05 : 0.62) : 0.0;

    // permanent hunch, deeper at a run
    var lean = running ? 0.34 : 0.20;
    b.rotation.x = RV.damp(b.rotation.x, lean + (e.flinch > 0 ? -0.22 : 0), 10, dt);
    b.rotation.z = RV.damp(b.rotation.z, Math.sin(t * 0.5) * (moving ? 0.05 : 0.02), 6, dt);

    // hips bob and sway
    var bobY = moving ? Math.abs(Math.sin(t)) * (running ? 0.075 : 0.045) : Math.sin(t * 0.6) * 0.012;
    h.position.y = 0.92 * e.scale + bobY;
    h.rotation.y = Math.sin(t) * (moving ? 0.14 : 0.04);
    h.rotation.z = Math.sin(t) * (moving ? 0.06 : 0.02);

    // legs
    var lp = Math.sin(t) * swing;
    var rp = Math.sin(t + Math.PI) * swing;
    e.thighL.rotation.x = lp;
    e.thighR.rotation.x = rp;
    // knees bend on the back swing
    e.shinL.rotation.x = Math.max(0, -Math.sin(t - 0.8)) * swing * 1.25;
    e.shinR.rotation.x = Math.max(0, -Math.sin(t + Math.PI - 0.8)) * swing * 1.25;

    /* arms — attack overrides the walk cycle */
    var atkL = 0, atkR = 0, atkFwd = 0;
    if (e.state === STATE.ATTACK) {
      var at = e.stateT;
      if (at < 0.38) {
        // wind up: arms back and high
        var w = at / 0.38;
        atkFwd = -1.6 * w;
        atkL = atkR = -0.5 * w;
      } else if (at < 0.62) {
        // the swipe
        var s = (at - 0.38) / 0.24;
        atkFwd = RV.lerp(-1.6, 1.5, s * s);
        atkL = atkR = RV.lerp(-0.5, 0.7, s);
      } else {
        var r2 = RV.clamp((at - 0.62) / 0.5, 0, 1);
        atkFwd = RV.lerp(1.5, 0, r2);
        atkL = atkR = RV.lerp(0.7, 0, r2);
      }
      e.armL.rotation.x = RV.damp(e.armL.rotation.x, atkFwd, 22, dt);
      e.armR.rotation.x = RV.damp(e.armR.rotation.x, atkFwd * 0.9, 22, dt);
      e.armL.rotation.z = RV.damp(e.armL.rotation.z, 0.35 + atkL, 18, dt);
      e.armR.rotation.z = RV.damp(e.armR.rotation.z, -0.35 - atkR, 18, dt);
    } else if (running) {
      // arms up and reaching while charging
      e.armL.rotation.x = RV.damp(e.armL.rotation.x, -1.15 + Math.sin(t) * 0.22, 12, dt);
      e.armR.rotation.x = RV.damp(e.armR.rotation.x, -1.15 + Math.sin(t + Math.PI) * 0.22, 12, dt);
      e.armL.rotation.z = RV.damp(e.armL.rotation.z, 0.24, 10, dt);
      e.armR.rotation.z = RV.damp(e.armR.rotation.z, -0.24, 10, dt);
    } else {
      // limp, swinging arms
      e.armL.rotation.x = RV.damp(e.armL.rotation.x, rp * 0.55, 10, dt);
      e.armR.rotation.x = RV.damp(e.armR.rotation.x, lp * 0.55, 10, dt);
      e.armL.rotation.z = RV.damp(e.armL.rotation.z, 0.14 + Math.sin(t * 0.7) * 0.05, 8, dt);
      e.armR.rotation.z = RV.damp(e.armR.rotation.z, -0.14 - Math.sin(t * 0.7) * 0.05, 8, dt);
    }
  }

  /* =============================================================
     DEATH — the body folds, topples, then sinks away
     ============================================================= */
  function updateDead(e, dt, index) {
    e.deathT += dt;
    var t = e.deathT;

    if (t < 0.85) {
      // topple about the feet, limbs going slack
      var k = RV.smoothstep(0, 0.75, t);
      e.body.rotation.x = RV.lerp(0.2, e.deathDir * 1.62, k);
      e.body.rotation.z = RV.lerp(0, e.deathSide, k);
      e.hips.position.y = RV.lerp(0.92 * e.scale, 0.42 * e.scale, k);
      var limp = 1 - k;
      e.armL.rotation.x = RV.damp(e.armL.rotation.x, e.deathDir * -0.8, 6, dt);
      e.armR.rotation.x = RV.damp(e.armR.rotation.x, e.deathDir * -0.9, 6, dt);
      e.armL.rotation.z = RV.damp(e.armL.rotation.z, 0.7, 5, dt);
      e.armR.rotation.z = RV.damp(e.armR.rotation.z, -0.65, 5, dt);
      e.thighL.rotation.x = RV.damp(e.thighL.rotation.x, -0.35 * limp, 5, dt);
      e.thighR.rotation.x = RV.damp(e.thighR.rotation.x, 0.30 * limp, 5, dt);
      e.shinL.rotation.x = RV.damp(e.shinL.rotation.x, 0.5, 5, dt);
      e.shinR.rotation.x = RV.damp(e.shinR.rotation.x, 0.45, 5, dt);

      // settle onto whatever is underneath
      e.vel.y -= 24 * dt;
      e.pos.y += e.vel.y * dt;
      var g = C.groundAt(e.pos.x, e.pos.z, e.pos.y + 0.3, 2.2, 0.3);
      if (g && e.pos.y <= g.y1) { e.pos.y = g.y1; e.vel.y = 0; }
      var bed = RV.water.bedY(e.pos.x, e.pos.z);
      if (e.pos.y < bed) { e.pos.y = bed; e.vel.y = 0; }
      e.root.position.copy(e.pos);

      if (!e.bled && t > 0.55) {
        e.bled = true;
        var gg = C.groundAt(e.pos.x, e.pos.z, e.pos.y + 0.3, 1.0, 0.3);
        if (gg) RV.fx.bloodDecal(e.pos.x, gg.y1, e.pos.z, 0, 1, 0, RV.randRange(0.55, 0.95));
      }
    } else if (t > 14) {
      // sink out of sight and recycle
      var s = (t - 14) / 3.0;
      e.root.position.y = e.pos.y - s * 1.6;
      e.body.scale.setScalar(e.scale * Math.max(0.01, 1 - s));
      if (s >= 1) {
        scene.remove(e.root);
        list.splice(index, 1);
      }
    }
  }

  E.aliveCount = function () {
    var n = 0;
    for (var i = 0; i < list.length; i++) if (list[i].alive) n++;
    return n;
  };

})(window.RV);

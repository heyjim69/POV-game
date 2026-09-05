/* =============================================================
   RIVER VILLAGE — weapon.js
   An AK-pattern rifle built out of primitives, rendered in its own
   scene so it never clips into the world. Handles sway, bob, ADS,
   a recoil spring and a staged reload animation.
   ============================================================= */
(function (RV) {
  'use strict';

  var G = RV.weapon = {};

  /* ---- tuning ---- */
  var RPM = 620;
  var SHOT_INTERVAL = 60 / RPM;
  var MAG_SIZE = 30;

  G.magSize = MAG_SIZE;
  G.ammo = MAG_SIZE;
  G.reserve = 120;
  G.reloading = false;
  G.reloadT = 0;
  G.RELOAD_TIME = 2.35;
  G.ads = false;
  G.adsT = 0;                 // 0 hip .. 1 sighted
  G.spread = 0.006;           // radians, current cone
  G.lastShot = -99;
  G.cameraKick = { x: 0, y: 0 };
  G.muzzleWorld = new THREE.Vector3();
  G.shotsInBurst = 0;

  /* The model is authored at 1:1 scale, then shrunk a little so the
     stock doesn't swallow the corner of the screen. SIGHT_H is how far
     the iron sights sit above the bore — the ADS pose is derived from
     it so the sights land exactly on the crosshair. */
  var SCALE = 0.86;
  var SIGHT_H = 0.0455;

  var POSE = {
    hip:    { p: new THREE.Vector3(0.186, -0.118, -0.395), r: new THREE.Euler(0.018, -0.068, -0.055) },
    ads:    { p: new THREE.Vector3(0.000, -SIGHT_H * SCALE, -0.045), r: new THREE.Euler(0, 0, 0) },
    sprint: { p: new THREE.Vector3(0.235, -0.200, -0.330), r: new THREE.Euler(0.30, 0.66, -0.36) },
    swim:   { p: new THREE.Vector3(0.240, -0.245, -0.360), r: new THREE.Euler(0.55, 0.30, -0.20) }
  };

  var root, gunGroup, bodyMesh, magMesh, boltMesh, flashSprite, flashLight;
  var sway = { x: 0, y: 0, tx: 0, ty: 0 };
  var bobT = 0, bobAmt = 0;
  var recoil = { pz: 0, rx: 0, ry: 0, rz: 0, vz: 0, vrx: 0, vry: 0, vrz: 0 };
  var loosePos = new THREE.Vector3(), looseRot = new THREE.Euler();
  var flashTimer = 0;
  var boltOffset = 0;

  /* =============================================================
     GEOMETRY
     Laid out along -Z (muzzle forward), bore axis at local y = 0.
     Sights sit 0.0455 above the bore, which is what the ADS pose
     offset is derived from.
     ============================================================= */
  function buildGeometry() {
    var metal = [], wood = [], mag = [], bolt = [];
    var mCol = new THREE.Color(1, 1, 1);

    function M(g) { metal.push(g); }
    function Wd(g) { wood.push(g); }

    // --- barrel & muzzle ---
    var barrel = RV.cylGeo(0.0105, 0.0105, 0.34, 10, 0.1, mCol);
    RV.place(barrel, 0, 0, -0.415, Math.PI / 2, 0, 0);
    M(barrel);
    var brake = RV.cylGeo(0.0165, 0.0155, 0.055, 10, 0.08, mCol);
    RV.place(brake, 0, 0, -0.598, Math.PI / 2, 0, 0);
    M(brake);
    // slant cut on the brake
    var slant = RV.boxGeo(0.034, 0.016, 0.03, 0.08, mCol);
    RV.place(slant, 0.004, 0.008, -0.612, 0, 0, -0.5);
    M(slant);

    // --- gas tube above the barrel ---
    var gas = RV.cylGeo(0.0125, 0.0125, 0.20, 8, 0.1, mCol);
    RV.place(gas, 0, 0.0295, -0.395, Math.PI / 2, 0, 0);
    M(gas);
    var gasBlock = RV.boxGeo(0.028, 0.052, 0.05, 0.1, mCol);
    RV.place(gasBlock, 0, 0.014, -0.505);
    M(gasBlock);

    // --- front sight tower + hood ---
    var fsBase = RV.boxGeo(0.030, 0.040, 0.036, 0.1, mCol);
    RV.place(fsBase, 0, 0.020, -0.572);
    M(fsBase);
    var fsPost = RV.cylGeo(0.0028, 0.0032, 0.020, 6, 0.05, mCol);
    RV.place(fsPost, 0, 0.0435, -0.572);
    M(fsPost);
    for (var fs = -1; fs <= 1; fs += 2) {          // protective ears
      var ear = RV.boxGeo(0.005, 0.030, 0.030, 0.06, mCol);
      RV.place(ear, fs * 0.0135, 0.045, -0.572);
      M(ear);
    }
    var earTop = RV.boxGeo(0.032, 0.005, 0.030, 0.06, mCol);
    RV.place(earTop, 0, 0.059, -0.572);
    M(earTop);

    // --- rear sight leaf ---
    var rsBase = RV.boxGeo(0.030, 0.016, 0.055, 0.1, mCol);
    RV.place(rsBase, 0, 0.0265, -0.268);
    M(rsBase);
    var rsLeaf = RV.boxGeo(0.030, 0.020, 0.012, 0.06, mCol);
    RV.place(rsLeaf, 0, 0.0395, -0.252);
    M(rsLeaf);
    for (var rs = -1; rs <= 1; rs += 2) {          // notch shoulders
      var sh = RV.boxGeo(0.010, 0.012, 0.013, 0.06, mCol);
      RV.place(sh, rs * 0.0098, 0.0475, -0.252);
      M(sh);
    }

    // --- receiver ---
    var rec = RV.boxGeo(0.052, 0.070, 0.235, 0.14, mCol);
    RV.place(rec, 0, -0.007, -0.145);
    M(rec);
    var dust = RV.boxGeo(0.050, 0.028, 0.215, 0.12, mCol);
    RV.place(dust, 0, 0.0335, -0.150);
    M(dust);
    // pressed ribs along the top cover
    for (var rb = -1; rb <= 1; rb += 2) {
      var rib = RV.boxGeo(0.007, 0.010, 0.190, 0.08, mCol);
      RV.place(rib, rb * 0.016, 0.0475, -0.150);
      M(rib);
    }
    var ribC = RV.boxGeo(0.009, 0.008, 0.190, 0.08, mCol);
    RV.place(ribC, 0, 0.0485, -0.150);
    M(ribC);
    // sling loop under the handguard
    var sling = RV.boxGeo(0.006, 0.026, 0.007, 0.05, mCol);
    RV.place(sling, -0.026, -0.048, -0.318);
    M(sling);
    // rivets
    for (var rv = 0; rv < 5; rv++) {
      var riv = RV.cylGeo(0.0035, 0.0035, 0.056, 6, 0.05, mCol);
      RV.place(riv, 0, -0.018, -0.235 + rv * 0.045, 0, 0, Math.PI / 2);
      M(riv);
    }
    // trunnion / front of receiver
    var trun = RV.boxGeo(0.046, 0.058, 0.05, 0.1, mCol);
    RV.place(trun, 0, -0.004, -0.272);
    M(trun);

    // --- selector lever & charging handle (right side) ---
    var sel = RV.boxGeo(0.008, 0.058, 0.030, 0.06, mCol);
    RV.place(sel, 0.030, 0.004, -0.135, 0, 0, 0.12);
    M(sel);

    // --- trigger group ---
    var tg = RV.boxGeo(0.020, 0.030, 0.058, 0.06, mCol);
    RV.place(tg, 0, -0.052, -0.088);
    M(tg);
    var trig = RV.boxGeo(0.006, 0.026, 0.010, 0.04, mCol);
    RV.place(trig, 0, -0.055, -0.090, 0.25, 0, 0);
    M(trig);

    // --- wood: lower handguard, upper handguard, grip, stock ---
    var lower = RV.boxGeo(0.050, 0.050, 0.175, 0.12, mCol);
    RV.place(lower, 0, -0.019, -0.375, -0.02, 0, 0);
    Wd(lower);
    var lowerLip = RV.boxGeo(0.056, 0.020, 0.050, 0.1, mCol);
    RV.place(lowerLip, 0, -0.020, -0.300);
    Wd(lowerLip);
    var upper = RV.boxGeo(0.042, 0.030, 0.145, 0.1, mCol);
    RV.place(upper, 0, 0.041, -0.372, 0.03, 0, 0);
    Wd(upper);

    var grip = RV.boxGeo(0.030, 0.105, 0.048, 0.09, mCol);
    RV.place(grip, 0, -0.098, -0.038, 0.30, 0, 0);
    Wd(grip);

    var stockNeck = RV.boxGeo(0.040, 0.048, 0.115, 0.1, mCol);
    RV.place(stockNeck, 0, -0.028, 0.048, 0.10, 0, 0);
    Wd(stockNeck);
    var stock = RV.boxGeo(0.044, 0.075, 0.175, 0.12, mCol);
    RV.place(stock, 0, -0.048, 0.170, 0.055, 0, 0);
    Wd(stock);
    var buttPlate = RV.boxGeo(0.046, 0.090, 0.014, 0.08, mCol);
    RV.place(buttPlate, 0, -0.058, 0.258, 0.055, 0, 0);
    M(buttPlate);

    // --- curved magazine (segmented so it banana-curves) ---
    var segs = 5;
    for (var i = 0; i < segs; i++) {
      var t = i / (segs - 1);
      var ang = 0.14 + t * 0.36;
      var g = RV.boxGeo(0.030, 0.050, 0.044, 0.08, mCol);
      var yy = -0.055 - t * 0.165;
      var zz = -0.118 - Math.sin(ang) * t * 0.085;
      RV.place(g, 0, yy, zz, ang * 0.9, 0, 0);
      mag.push(g);
    }
    var magFloor = RV.boxGeo(0.030, 0.012, 0.045, 0.06, mCol);
    RV.place(magFloor, 0, -0.232, -0.196, 0.46, 0, 0);
    mag.push(magFloor);

    // --- charging handle + bolt carrier (animates on reload) ---
    var ch = RV.boxGeo(0.020, 0.014, 0.030, 0.05, mCol);
    RV.place(ch, 0.032, 0.030, -0.212);
    bolt.push(ch);
    var chStem = RV.boxGeo(0.030, 0.012, 0.014, 0.05, mCol);
    RV.place(chStem, 0.020, 0.030, -0.212);
    bolt.push(chStem);

    return {
      metal: RV.merge(metal),
      wood: RV.merge(wood),
      mag: RV.merge(mag),
      bolt: RV.merge(bolt)
    };
  }

  /* =============================================================
     BUILD
     ============================================================= */
  G.build = function (viewScene, mats, sprites) {
    var geo = buildGeometry();

    root = new THREE.Group();
    gunGroup = new THREE.Group();
    gunGroup.scale.setScalar(SCALE);
    root.add(gunGroup);

    bodyMesh = new THREE.Mesh(geo.metal, mats.gunMetal);
    var woodMesh = new THREE.Mesh(geo.wood, mats.gunWood);
    magMesh = new THREE.Mesh(geo.mag, mats.gunMetal);
    boltMesh = new THREE.Mesh(geo.bolt, mats.gunMetal);
    [bodyMesh, woodMesh, magMesh, boltMesh].forEach(function (m) {
      m.frustumCulled = false;
      gunGroup.add(m);
    });
    G.woodMesh = woodMesh;

    // muzzle flash lives on the gun so it tracks perfectly
    var fm = new THREE.SpriteMaterial({
      map: sprites.flash, blending: THREE.AdditiveBlending,
      depthTest: false, depthWrite: false, transparent: true,
      color: 0xffffff, opacity: 0
    });
    flashSprite = new THREE.Sprite(fm);
    flashSprite.position.set(0, 0, -0.645);
    flashSprite.scale.set(0.34, 0.34, 0.34);
    flashSprite.frustumCulled = false;
    gunGroup.add(flashSprite);

    viewScene.add(root);
    G.root = root;
    G.group = gunGroup;
    return root;
  };

  /* =============================================================
     FIRING
     ============================================================= */
  G.canFire = function (t) {
    return !G.reloading && G.ammo > 0 && (t - G.lastShot) >= SHOT_INTERVAL;
  };

  G.fire = function (t) {
    G.ammo--;
    G.lastShot = t;
    G.shotsInBurst++;

    // recoil impulse into the spring
    var up = 0.055 + Math.min(G.shotsInBurst, 12) * 0.0045;
    recoil.vz += 3.2;
    recoil.vrx -= up * 12;
    recoil.vry += (RV.rand() - 0.5) * 4.5;
    recoil.vrz += (RV.rand() - 0.5) * 3.0;

    // camera kick — climbs the longer you hold it, with a wandering
    // horizontal component. The player recovers most of this back.
    var adsScale = RV.lerp(1.0, 0.6, G.adsT);
    G.cameraKick.x += (0.016 + Math.min(G.shotsInBurst, 22) * 0.0018) * adsScale;
    G.cameraKick.y += ((RV.rand() - 0.5) * 0.011
                      + Math.sin(G.shotsInBurst * 0.55) * 0.0045) * adsScale;

    // cone grows while you hold the trigger
    G.spread = Math.min(G.spread + 0.0042, 0.052);

    flashTimer = 0.045;
    boltOffset = 1;
    return true;
  };

  G.startReload = function () {
    if (G.reloading || G.ammo >= MAG_SIZE || G.reserve <= 0) return false;
    G.reloading = true;
    G.reloadT = 0;
    return true;
  };

  G.finishReload = function () {
    var need = MAG_SIZE - G.ammo;
    var take = Math.min(need, G.reserve);
    G.ammo += take;
    G.reserve -= take;
    G.reloading = false;
  };

  G.addAmmo = function (n) {
    G.reserve += n;
    return n;
  };

  /** Consume accumulated camera recoil (the player applies it to look). */
  G.consumeCameraKick = function () {
    var k = { x: G.cameraKick.x, y: G.cameraKick.y };
    G.cameraKick.x = 0; G.cameraKick.y = 0;
    return k;
  };

  /* =============================================================
     PER-FRAME
     ============================================================= */
  G.update = function (dt, st) {
    if (!root) return;

    /* ---- reload timeline ---- */
    var magY = 0, magRotX = 0, magVis = true;
    var extraRot = { x: 0, y: 0, z: 0 };
    var extraPos = { x: 0, y: 0, z: 0 };

    if (G.reloading) {
      G.reloadT += dt;
      var r = G.reloadT / G.RELOAD_TIME;
      if (G.reloadT >= G.RELOAD_TIME) G.finishReload();

      // tilt the rifle over so the magwell is visible
      var tilt = RV.smoothstep(0, 0.18, r) * (1 - RV.smoothstep(0.86, 1.0, r));
      extraRot.z = tilt * 0.42;
      extraRot.x = tilt * 0.30;
      extraRot.y = tilt * -0.22;
      extraPos.y = tilt * -0.045;
      extraPos.x = tilt * -0.030;

      if (r < 0.14) {                         // catch released
        magY = 0; magRotX = 0;
      } else if (r < 0.42) {                  // mag rocks out and drops away
        var f = (r - 0.14) / 0.28;
        magY = -f * f * 0.55;
        magRotX = -f * 0.9;
      } else if (r < 0.50) {
        magVis = false;
      } else if (r < 0.78) {                  // fresh mag comes up
        var f2 = (r - 0.50) / 0.28;
        magY = -(1 - f2) * (1 - f2) * 0.50;
        magRotX = -(1 - f2) * 0.75;
      } else if (r < 0.86) {                  // rocked into the well
        var f3 = (r - 0.78) / 0.08;
        magY = 0; magRotX = -(1 - f3) * 0.12;
        extraRot.x += f3 * 0.05;
      }
      // charging handle at the end
      if (r > 0.80 && r < 0.94) {
        var f4 = (r - 0.80) / 0.14;
        boltOffset = Math.sin(f4 * Math.PI);
        extraPos.z = Math.sin(f4 * Math.PI) * 0.012;
      }
    } else {
      G.reloadT = 0;
    }
    magMesh.visible = magVis;
    magMesh.position.y = magY;
    magMesh.rotation.x = magRotX;
    boltMesh.position.z = boltOffset * 0.055;
    boltOffset = Math.max(0, boltOffset - dt * 14);

    /* ---- ADS blend ---- */
    var wantAds = st.ads && !G.reloading && !st.sprinting && !st.underwater;
    G.adsT = RV.damp(G.adsT, wantAds ? 1 : 0, 14, dt);
    G.ads = G.adsT > 0.5;

    /* ---- pose selection ---- */
    var target = POSE.hip, blend2 = null, blend2Amt = 0;
    if (st.underwater) { target = POSE.swim; }
    else if (st.sprinting && st.moveSpeed > 1.5) { target = POSE.sprint; }
    else { target = POSE.hip; blend2 = POSE.ads; blend2Amt = G.adsT; }

    var px = target.p.x, py = target.p.y, pz = target.p.z;
    var rx = target.r.x, ry = target.r.y, rz = target.r.z;
    if (blend2) {
      px = RV.lerp(px, blend2.p.x, blend2Amt);
      py = RV.lerp(py, blend2.p.y, blend2Amt);
      pz = RV.lerp(pz, blend2.p.z, blend2Amt);
      rx = RV.lerp(rx, blend2.r.x, blend2Amt);
      ry = RV.lerp(ry, blend2.r.y, blend2Amt);
      rz = RV.lerp(rz, blend2.r.z, blend2Amt);
    }

    /* ---- sway from mouse movement (lags behind the camera) ---- */
    var swayScale = RV.lerp(1.0, 0.28, G.adsT);
    sway.tx = RV.clamp(-st.mouseDX * 0.9, -0.035, 0.035) * swayScale;
    sway.ty = RV.clamp(st.mouseDY * 0.9, -0.030, 0.030) * swayScale;
    sway.x = RV.damp(sway.x, sway.tx, 9, dt);
    sway.y = RV.damp(sway.y, sway.ty, 9, dt);

    /* ---- walk bob ---- */
    var speed = st.moveSpeed;
    var targetBob = st.grounded ? RV.clamp(speed / 5.5, 0, 1) : 0;
    if (st.underwater) targetBob = RV.clamp(speed / 3.0, 0, 1) * 0.6;
    bobAmt = RV.damp(bobAmt, targetBob, 7, dt);
    bobT += dt * (st.sprinting ? 11.5 : 8.2) * RV.clamp(speed / 3.0, 0, 1.4);
    var bobScale = RV.lerp(1.0, 0.35, G.adsT);
    var bobX = Math.sin(bobT) * 0.017 * bobAmt * bobScale;
    var bobY = (Math.abs(Math.cos(bobT)) - 0.5) * 0.020 * bobAmt * bobScale;
    var bobR = Math.sin(bobT * 0.5) * 0.020 * bobAmt * bobScale;

    /* ---- idle breathing ---- */
    var bt = st.time === undefined ? RV.now() : st.time;
    var breathe = RV.lerp(1.0, 0.35, G.adsT) * (1 - bobAmt);
    var brX = Math.sin(bt * 1.1) * 0.0035 * breathe;
    var brY = Math.sin(bt * 1.7 + 1.2) * 0.0030 * breathe;

    /* ---- recoil spring (critically damped-ish) ---- */
    var stiff = 190, damp = 22;
    recoil.vz += (-recoil.pz * stiff - recoil.vz * damp) * dt;
    recoil.pz += recoil.vz * dt;
    recoil.vrx += (-recoil.rx * stiff - recoil.vrx * damp) * dt;
    recoil.rx += recoil.vrx * dt;
    recoil.vry += (-recoil.ry * stiff * 0.7 - recoil.vry * damp) * dt;
    recoil.ry += recoil.vry * dt;
    recoil.vrz += (-recoil.rz * stiff * 0.7 - recoil.vrz * damp) * dt;
    recoil.rz += recoil.vrz * dt;

    /* ---- compose ---- */
    loosePos.set(
      px + sway.x + bobX + brX + extraPos.x,
      py + sway.y + bobY + brY + extraPos.y,
      pz + recoil.pz * 0.016 + extraPos.z
    );
    looseRot.set(
      rx + recoil.rx * 0.016 - sway.y * 1.1 + extraRot.x,
      ry + recoil.ry * 0.010 + sway.x * 1.4 + extraRot.y,
      rz + recoil.rz * 0.012 + bobR + extraRot.z
    );

    gunGroup.position.lerp(loosePos, 1 - Math.exp(-26 * dt));
    gunGroup.rotation.x = RV.damp(gunGroup.rotation.x, looseRot.x, 26, dt);
    gunGroup.rotation.y = RV.damp(gunGroup.rotation.y, looseRot.y, 26, dt);
    gunGroup.rotation.z = RV.damp(gunGroup.rotation.z, looseRot.z, 26, dt);

    /* ---- muzzle flash ---- */
    if (flashTimer > 0) {
      flashTimer -= dt;
      var f = RV.clamp(flashTimer / 0.045, 0, 1);
      flashSprite.material.opacity = f;
      flashSprite.material.rotation = RV.rand() * 6.28;
      var s = (0.26 + RV.rand() * 0.14) * (0.6 + f * 0.7);
      flashSprite.scale.set(s, s, s);
      flashSprite.visible = true;
    } else {
      flashSprite.visible = false;
      flashSprite.material.opacity = 0;
    }

    /* ---- spread recovery ---- */
    var baseSpread = RV.lerp(0.0075, 0.0016, G.adsT);
    var moveSpread = RV.clamp(speed / 6, 0, 1) * (st.sprinting ? 0.030 : 0.014);
    var floor = baseSpread + moveSpread + (st.grounded ? 0 : 0.020);
    G.spread = Math.max(floor, G.spread - dt * 0.085);
    var gt = st.time === undefined ? G.lastShot : st.time;
    if (gt - G.lastShot > 0.22) G.shotsInBurst = Math.max(0, G.shotsInBurst - dt * 16);

    /* ---- world-space muzzle position (for casings / lights) ---- */
    if (st.camera) {
      G.muzzleWorld.set(
        gunGroup.position.x,
        gunGroup.position.y,
        gunGroup.position.z - 0.63 * SCALE
      );
      G.muzzleWorld.applyMatrix4(st.camera.matrixWorld);
    }
  };

  G.reset = function () {
    G.ammo = MAG_SIZE;
    G.reserve = 120;
    G.reloading = false;
    G.reloadT = 0;
    G.spread = 0.006;
    G.shotsInBurst = 0;
    G.cameraKick.x = G.cameraKick.y = 0;
    recoil.pz = recoil.rx = recoil.ry = recoil.rz = 0;
    recoil.vz = recoil.vrx = recoil.vry = recoil.vrz = 0;
    if (magMesh) { magMesh.visible = true; magMesh.position.y = 0; magMesh.rotation.x = 0; }
  };

})(window.RV);

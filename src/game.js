/* =============================================================
   RIVER VILLAGE — game.js
   Boots the renderer, builds the environment, wires input and HUD,
   and runs the frame loop.
   ============================================================= */
(function (RV) {
  'use strict';

  var GAME = RV.game = {};

  /* =============================================================
     ENVIRONMENT MOOD
     ============================================================= */
  var env = {
    fogColor: RV.col(0x8fa8a4),
    fogDensity: 0.0285,
    skyTop: RV.col(0x6f8f96),
    skyHorizon: RV.col(0x9db4ae),
    sunColor: RV.col(0xffe6c4),
    sunDir: new THREE.Vector3(-0.42, 0.40, 0.81).normalize(),
    ambient: RV.col(0x51686a)
  };
  GAME.env = env;

  var renderer, scene, camera, viewScene, viewCamera;
  var sun, sunTarget, hemi, lanternLights = [];
  var textures = {}, mats = {}, sprites = {};
  var envMap = null;
  var clock = { last: 0, time: 0 };
  var running = false, started = false, paused = false;
  var pickups = [];
  var hud = {};
  var fadeT = 0;

  /* game state */
  var S = {
    kills: 0,
    wave: 1,
    spawnTimer: 3.0,
    hitMarker: 0,
    headMarker: false,
    flash: 0,
    message: '',
    messageT: 0,
    deathT: 0,
    fps: 0, fpsAccum: 0, fpsFrames: 0,
    lowAmmoWarned: false
  };
  GAME.state = S;

  var input = {
    forward: 0, right: 0, jump: false, crouch: false, sprint: false,
    fire: false, ads: false,
    mouseDX: 0, mouseDY: 0,
    rawDX: 0, rawDY: 0
  };
  var keys = {};
  var sensitivity = 0.0022;
  var usingPointerLock = null;    // null = unknown, false = unavailable

  function beginPlay() {
    started = true; paused = false;
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('pause-screen').classList.add('hidden');
    RV.audio.resume();
  }

  /* =============================================================
     BOOT — staged so the loading bar can actually move
     ============================================================= */
  GAME.boot = function () {
    var canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: true, powerPreference: 'high-performance',
      stencil: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.autoClear = false;
    // tone mapping and encoding are handled by our own post pass
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputEncoding = THREE.LinearEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    GAME.renderer = renderer;

    var steps = [
      ['Weathering the timber', function () {
        textures.dock = RV.tex.buildDockWood();
        textures.house = RV.tex.buildHouseWood();
      }],
      ['Thatching the roofs', function () {
        textures.thatch = RV.tex.buildThatch();
        textures.rope = RV.tex.buildRope();
      }],
      ['Growing the moss', function () {
        textures.rock = RV.tex.buildRock();
        textures.dirt = RV.tex.buildDirt();
      }],
      ['Oiling the rifle', function () {
        textures.gunMetal = RV.tex.buildGunMetal();
        textures.gunWood = RV.tex.buildGunWood();
      }],
      ['Waking the villagers', function () {
        textures.infected = RV.tex.buildInfectedAtlas();
        textures.cloth = RV.tex.buildCloth();
      }],
      ['Filling the river', function () {
        textures.waterNormal = RV.tex.buildWaterNormal();
        textures.foam = RV.tex.buildFoam();
        textures.leaf = RV.tex.buildLeaf();
        sprites = RV.tex.buildSprites();
        RV.tex.setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
      }],
      ['Rolling in the fog', function () { buildScene(); }],
      ['Raising the village', function () { buildWorld(); }],
      ['Loading the magazine', function () { buildActors(); }]
    ];

    var i = 0;
    function step() {
      if (i >= steps.length) { finishLoad(); return; }
      var s = steps[i];
      setLoad(s[0], i / steps.length);
      // let the browser paint the progress bar before the heavy work
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try { s[1](); }
          catch (err) { showFatal(err); return; }
          i++;
          step();
        });
      });
    }
    step();
  };

  function setLoad(label, frac) {
    var el = document.getElementById('load-label');
    var bar = document.getElementById('load-bar-fill');
    if (el) el.textContent = label + '…';
    if (bar) bar.style.width = Math.round(frac * 100) + '%';
  }

  function showFatal(err) {
    var el = document.getElementById('loading');
    if (el) {
      el.innerHTML = '<div class="panel"><h1>Something went wrong</h1><pre style="text-align:left;white-space:pre-wrap;font-size:12px;opacity:.8">'
        + String(err && err.stack ? err.stack : err) + '</pre></div>';
    }
    console.error(err);
  }

  /* =============================================================
     SCENE, SKY, LIGHTS
     ============================================================= */
  function buildScene() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(env.fogColor.getHex(), env.fogDensity);
    scene.fog.color.copy(env.fogColor);
    scene.background = env.fogColor.clone();
    GAME.scene = scene;

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 400);
    camera.rotation.order = 'YXZ';
    GAME.camera = camera;

    viewScene = new THREE.Scene();
    viewCamera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.005, 3);
    GAME.viewScene = viewScene;

    /* ---- sky dome ---- */
    var skyGeo = new THREE.SphereGeometry(300, 32, 20);
    var skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: env.skyTop.clone() },
        uHorizon: { value: env.skyHorizon.clone() },
        uFog: { value: env.fogColor.clone() },
        uSunDir: { value: env.sunDir.clone() },
        uSunColor: { value: env.sunColor.clone() }
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uFog;',
        'uniform vec3 uSunDir; uniform vec3 uSunColor;',
        'varying vec3 vDir;',
        'void main(){',
        '  float h = clamp(vDir.y, -1.0, 1.0);',
        '  vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, h));',
        // the fog swallows everything near the horizon
        '  col = mix(uFog, col, smoothstep(0.0, 0.42, h));',
        // a soft sun bloom burning through the mist
        '  float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);',
        '  col += uSunColor * pow(sd, 22.0) * 1.6;',
        '  col += uSunColor * pow(sd, 3.0) * 0.22;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n'),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    var sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    scene.add(sky);
    GAME.sky = sky;

    /* ---- distant ridgelines ---- */
    var bands = [
      { r: 250, h: 105, seed: 11, rough: 0.95, tree: 0.0, col: 0xa9bcb6, o: 0.85, y: -12 },
      { r: 205, h: 78, seed: 27, rough: 0.80, tree: 0.2, col: 0x94aaa6, o: 0.9, y: -10 },
      { r: 160, h: 56, seed: 43, rough: 0.62, tree: 0.9, col: 0x7d938f, o: 0.95, y: -8 }
    ];
    bands.forEach(function (b) {
      var tex = RV.tex.buildRidgeline(b.seed, b.rough, b.tree);
      tex.repeat.set(3, 1);
      var g = new THREE.CylinderGeometry(b.r, b.r, b.h, 48, 1, true);
      var m = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.BackSide,
        depthWrite: false, color: RV.col(b.col), opacity: b.o, fog: false
      });
      var mesh = new THREE.Mesh(g, m);
      mesh.position.y = b.y + b.h / 2;
      mesh.renderOrder = -90;
      mesh.frustumCulled = false;
      scene.add(mesh);
    });

    /* ---- lights ---- */
    hemi = new THREE.HemisphereLight(env.skyTop.getHex(), 0x2b2f24, 0.62);
    hemi.color.copy(env.skyTop);
    hemi.groundColor.copy(RV.col(0x33362a));
    scene.add(hemi);

    var amb = new THREE.AmbientLight(0xffffff, 0.10);
    amb.color.copy(env.ambient);
    scene.add(amb);

    sun = new THREE.DirectionalLight(0xffffff, 1.45);
    sun.color.copy(env.sunColor);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 140;
    sun.shadow.camera.left = -26;
    sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26;
    sun.shadow.camera.bottom = -26;
    sun.shadow.bias = -0.0007;
    sun.shadow.normalBias = 0.035;
    sunTarget = new THREE.Object3D();
    scene.add(sunTarget);
    sun.target = sunTarget;
    scene.add(sun);

    // four roaming point lights stand in for all the village lanterns
    for (var i = 0; i < 4; i++) {
      var pl = new THREE.PointLight(0xffb367, 0, 11, 2);
      pl.color.copy(RV.col(0xffb367));
      scene.add(pl);
      lanternLights.push(pl);
    }

    /* ---- viewmodel lighting ---- */
    var vAmb = new THREE.AmbientLight(0xffffff, 0.55);
    vAmb.color.copy(RV.col(0x9fb2b0));
    viewScene.add(vAmb);
    var vKey = new THREE.DirectionalLight(0xffffff, 1.7);
    vKey.color.copy(env.sunColor);
    vKey.position.set(-0.5, 1.0, 0.6);
    viewScene.add(vKey);
    var vFill = new THREE.DirectionalLight(0xffffff, 0.45);
    vFill.color.copy(RV.col(0x7f9aa0));
    vFill.position.set(0.8, -0.3, -0.7);
    viewScene.add(vFill);

    /* ---- image-based lighting generated from our own sky ---- */
    try {
      var pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      var skyScene = new THREE.Scene();
      var skyClone = new THREE.Mesh(skyGeo.clone(), skyMat.clone());
      skyClone.material.side = THREE.BackSide;
      skyScene.add(skyClone);
      envMap = pmrem.fromScene(skyScene, 0, 0.1, 500).texture;
      scene.environment = envMap;
      viewScene.environment = envMap;
      pmrem.dispose();
    } catch (e) {
      console.warn('Environment map unavailable, falling back to direct lighting.', e);
    }

    RV.postfx.init(renderer, window.innerWidth, window.innerHeight);
  }

  /* =============================================================
     MATERIALS
     ============================================================= */
  function std(set, opts) {
    opts = opts || {};
    var m = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      roughnessMap: set.roughnessMap,
      vertexColors: opts.vertexColors !== false,
      metalness: opts.metalness === undefined ? 0.0 : opts.metalness,
      roughness: opts.roughness === undefined ? 1.0 : opts.roughness,
      envMapIntensity: opts.envMapIntensity === undefined ? 0.6 : opts.envMapIntensity,
      side: opts.side || THREE.FrontSide
    });
    if (opts.normalScale) m.normalScale.set(opts.normalScale, opts.normalScale);
    if (opts.color) m.color.copy(opts.color);
    return m;
  }

  function buildWorld() {
    mats.dock = std(textures.dock, { normalScale: 1.0, envMapIntensity: 0.7 });
    mats.house = std(textures.house, { normalScale: 0.9 });
    mats.thatch = std(textures.thatch, { normalScale: 1.3, envMapIntensity: 0.35 });
    mats.rope = std(textures.rope, { normalScale: 1.1, envMapIntensity: 0.3 });
    mats.rock = std(textures.rock, { normalScale: 1.1, envMapIntensity: 0.45 });
    mats.dirt = std(textures.dirt, { normalScale: 1.0, envMapIntensity: 0.35 });
    mats.cloth = std(textures.cloth, { normalScale: 0.8, envMapIntensity: 0.25, side: THREE.DoubleSide });
    mats.infected = std(textures.infected, { normalScale: 0.9, envMapIntensity: 0.4, vertexColors: true });
    mats.gunMetal = std(textures.gunMetal, { metalness: 0.82, roughness: 1.0, normalScale: 0.7, envMapIntensity: 1.6 });
    mats.gunWood = std(textures.gunWood, { metalness: 0.0, roughness: 1.0, normalScale: 0.8, envMapIntensity: 0.5 });
    mats.env = env;
    GAME.mats = mats;

    // river surface
    scene.add(RV.water.build(env, textures.waterNormal));

    // the village
    RV.world.build(scene, mats, textures);

    // lantern props at the marked positions
    var lg = [];
    var lanternMat = new THREE.MeshStandardMaterial({
      color: RV.col(0x2a2520), emissive: RV.col(0xffa94d), emissiveIntensity: 2.4,
      roughness: 0.6, metalness: 0.2
    });
    RV.world.data.lanterns.forEach(function (p) {
      var body = RV.sphereGeo(0.13, 8, 6, new THREE.Color(1, 1, 1));
      RV.place(body, p.x, p.y, p.z);
      lg.push(body);
      var cap = RV.boxGeo(0.18, 0.05, 0.18, 1, new THREE.Color(1, 1, 1));
      RV.place(cap, p.x, p.y + 0.15, p.z);
      lg.push(cap);
    });
    if (lg.length) {
      var lm = new THREE.Mesh(RV.merge(lg), lanternMat);
      lm.frustumCulled = false;
      scene.add(lm);
    }

    // hanging rope from each lantern up into the fog
    RV.fx.init(scene, env, sprites);

    // shafts of light breaking through the canopy and the roof gaps
    RV.fx.buildGodRays([
      { x: -6, y: 15, z: 22, w: 3.4, h: 17, o: 0.40 },
      { x: 5, y: 16, z: 15, w: 4.0, h: 19, o: 0.34 },
      { x: -2, y: 14, z: 4, w: 2.8, h: 15, o: 0.42 },
      { x: 8, y: 17, z: 28, w: 3.6, h: 20, o: 0.30 },
      { x: -12, y: 15, z: 10, w: 3.0, h: 17, o: 0.36 },
      { x: 3, y: 18, z: -16, w: 5.0, h: 22, o: 0.30 },
      { x: -7, y: 16, z: -28, w: 3.8, h: 19, o: 0.34 },
      { x: 6, y: 16, z: -44, w: 3.4, h: 18, o: 0.36 },
      { x: -13, y: 15, z: -50, w: 3.0, h: 17, o: 0.32 },
      { x: 22, y: 18, z: -48, w: 4.2, h: 20, o: 0.28 }
    ], env.sunDir);
  }

  /* =============================================================
     ACTORS & PICKUPS
     ============================================================= */
  function buildActors() {
    RV.player.init(camera);
    RV.weapon.build(viewScene, mats, sprites);
    RV.enemies.init(scene, mats.infected);
    buildPickups();
    buildHUD();
    resetGame();
  }

  var pickupGeo = {}, pickupMats = {};
  function buildPickups() {
    // ammo: a small crate with a glowing band
    var ammoParts = [];
    ammoParts.push(RV.boxGeo(0.34, 0.20, 0.24, 0.35, new THREE.Color(1, 1, 1)));
    pickupGeo.ammo = RV.merge(ammoParts);
    pickupGeo.ammoBand = RV.boxGeo(0.36, 0.05, 0.26, 1, new THREE.Color(1, 1, 1));
    pickupGeo.health = RV.merge([RV.boxGeo(0.28, 0.20, 0.20, 0.4, new THREE.Color(1, 1, 1))]);
    pickupGeo.healthCross = RV.merge([
      RV.place(RV.boxGeo(0.16, 0.045, 0.03, 1, new THREE.Color(1, 1, 1)), 0, 0, 0.105),
      RV.place(RV.boxGeo(0.045, 0.13, 0.03, 1, new THREE.Color(1, 1, 1)), 0, 0, 0.105)
    ]);

    pickupMats.ammoBox = new THREE.MeshStandardMaterial({
      map: textures.house.map, normalMap: textures.house.normalMap,
      color: RV.col(0x6f6350), roughness: 0.85, metalness: 0.05, envMapIntensity: 0.5
    });
    pickupMats.ammoBand = new THREE.MeshStandardMaterial({
      color: RV.col(0x1d2a22), emissive: RV.col(0x6fe0a8), emissiveIntensity: 1.6, roughness: 0.5
    });
    pickupMats.healthBox = new THREE.MeshStandardMaterial({
      color: RV.col(0xd8d2c4), roughness: 0.7, metalness: 0.0, envMapIntensity: 0.5
    });
    pickupMats.healthCross = new THREE.MeshStandardMaterial({
      color: RV.col(0x3a1010), emissive: RV.col(0xff5a4a), emissiveIntensity: 1.8, roughness: 0.5
    });

    RV.world.data.ammoSpots.forEach(function (p) { addPickup('ammo', p); });
    RV.world.data.healthSpots.forEach(function (p) { addPickup('health', p); });
  }

  function addPickup(kind, p) {
    var g = new THREE.Group();
    if (kind === 'ammo') {
      g.add(new THREE.Mesh(pickupGeo.ammo, pickupMats.ammoBox));
      var band = new THREE.Mesh(pickupGeo.ammoBand, pickupMats.ammoBand);
      band.position.y = 0.06;
      g.add(band);
    } else {
      g.add(new THREE.Mesh(pickupGeo.health, pickupMats.healthBox));
      g.add(new THREE.Mesh(pickupGeo.healthCross, pickupMats.healthCross));
    }
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
    g.position.copy(p);
    scene.add(g);
    pickups.push({ obj: g, kind: kind, base: p.clone(), active: true, respawn: 0, phase: RV.rand() * 6.28 });
  }

  /* =============================================================
     HUD
     ============================================================= */
  function buildHUD() {
    hud.ammo = document.getElementById('hud-ammo');
    hud.reserve = document.getElementById('hud-reserve');
    hud.ammoWrap = document.getElementById('hud-ammo-wrap');
    hud.health = document.getElementById('hud-health-fill');
    hud.healthNum = document.getElementById('hud-health-num');
    hud.breathWrap = document.getElementById('hud-breath');
    hud.breath = document.getElementById('hud-breath-fill');
    hud.kills = document.getElementById('hud-kills');
    hud.wave = document.getElementById('hud-wave');
    hud.crosshair = document.getElementById('crosshair');
    hud.chLines = [
      document.getElementById('ch-up'), document.getElementById('ch-down'),
      document.getElementById('ch-left'), document.getElementById('ch-right')
    ];
    hud.hitmarker = document.getElementById('hitmarker');
    hud.message = document.getElementById('hud-message');
    hud.damage = document.getElementById('damage-indicators');
    hud.reloadBar = document.getElementById('reload-bar');
    hud.reloadFill = document.getElementById('reload-bar-fill');
    hud.fps = document.getElementById('hud-fps');
    hud.enemies = document.getElementById('hud-enemies');
  }

  function message(text, dur) {
    S.message = text;
    S.messageT = dur || 2.2;
  }

  /* =============================================================
     RESET / START
     ============================================================= */
  function resetGame() {
    RV.enemies.clear();
    RV.weapon.reset();
    RV.player.reset(RV.world.data.playerStart, RV.world.data.playerYaw);
    if (RV.fx.clearTransient) RV.fx.clearTransient();
    S.kills = 0; S.wave = 1; S.spawnTimer = 2.5;
    S.hitMarker = 0; S.flash = 0; S.deathT = 0;
    S.lowAmmoWarned = false;
    fadeT = 0;
    pickups.forEach(function (p) { p.active = true; p.respawn = 0; p.obj.visible = true; });
    // a welcoming committee, already in the village
    var pts = RV.world.data.spawnPoints;
    for (var i = 0; i < 5; i++) {
      var p = pts[RV.randInt(0, pts.length - 1)];
      if (p.distanceTo(RV.player.pos) < 16) continue;
      RV.enemies.spawn(p);
    }
    message('Clear the village. WASD to move, left click to fire.', 5.0);
  }
  GAME.resetGame = resetGame;

  function finishLoad() {
    setLoad('Ready', 1);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('start-screen').classList.remove('hidden');
    bindInput();
    running = true;
    clock.last = performance.now();
    requestAnimationFrame(frame);
  }

  /* =============================================================
     INPUT
     ============================================================= */
  function bindInput() {
    var canvas = renderer.domElement;

    document.addEventListener('keydown', function (e) {
      keys[e.code] = true;
      if (e.code === 'KeyR') RV.weapon.startReload() && RV.audio.play('reload', RV.player.pos);
      if (e.code === 'KeyH') toggleHelp();
      if (e.code === 'Escape') { /* pointer lock exits on its own */ }
      if (e.code === 'Enter' && !RV.player.alive) restart();
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'Tab'].indexOf(e.code) >= 0) e.preventDefault();
    });
    document.addEventListener('keyup', function (e) { keys[e.code] = false; });

    function looking() {
      if (document.pointerLockElement === canvas) return true;
      // some embeds/browsers refuse pointer lock — stay playable anyway
      return usingPointerLock === false && started && !paused;
    }
    document.addEventListener('mousemove', function (e) {
      if (!looking()) return;
      input.rawDX += e.movementX || 0;
      input.rawDY += e.movementY || 0;
    });
    document.addEventListener('mousedown', function (e) {
      if (!looking()) return;
      if (e.button === 0) input.fire = true;
      if (e.button === 2) input.ads = true;
    });
    document.addEventListener('mouseup', function (e) {
      if (e.button === 0) input.fire = false;
      if (e.button === 2) input.ads = false;
    });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    function lock() {
      if (!RV.player.alive) { restart(); return; }
      RV.audio.resume();
      try { canvas.requestPointerLock(); } catch (e) { /* fall through */ }
      // if the lock never engages, start anyway rather than stranding the player
      setTimeout(function () {
        if (document.pointerLockElement !== canvas) {
          usingPointerLock = false;
          beginPlay();
        }
      }, 350);
    }
    document.getElementById('start-button').addEventListener('click', lock);
    document.getElementById('resume-button').addEventListener('click', lock);
    document.getElementById('restart-button').addEventListener('click', restart);
    canvas.addEventListener('click', function () {
      if (!paused && started && RV.player.alive) return;
      if (RV.player.alive) lock();
    });

    document.addEventListener('pointerlockchange', function () {
      var locked = document.pointerLockElement === canvas;
      if (locked) {
        usingPointerLock = true;
        beginPlay();
      } else if (usingPointerLock && started && RV.player.alive) {
        paused = true;
        document.getElementById('pause-screen').classList.remove('hidden');
      }
    });

    window.addEventListener('resize', onResize);
    window.addEventListener('blur', function () {
      input.fire = false; input.ads = false;
      for (var k in keys) keys[k] = false;
    });

    var sens = document.getElementById('sens-slider');
    if (sens) {
      sens.addEventListener('input', function () {
        sensitivity = 0.0006 + (parseFloat(sens.value) / 100) * 0.0045;
        var lbl = document.getElementById('sens-value');
        if (lbl) lbl.textContent = sens.value;
      });
    }
  }

  function toggleHelp() {
    var el = document.getElementById('help-panel');
    if (el) el.classList.toggle('collapsed');
  }

  function restart() {
    resetGame();
    document.getElementById('death-screen').classList.add('hidden');
    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('pause-screen').classList.add('hidden');
    renderer.domElement.requestPointerLock();
    RV.audio.resume();
  }

  function readInput(dt) {
    input.forward = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
    input.right = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
    input.jump = !!keys['Space'];
    input.crouch = !!(keys['ControlLeft'] || keys['KeyC']);
    input.sprint = !!(keys['ShiftLeft'] || keys['ShiftRight']);

    input.mouseDX = input.rawDX * sensitivity;
    input.mouseDY = input.rawDY * sensitivity;
    input.rawDX = 0; input.rawDY = 0;

    if (paused || !started) {
      input.forward = input.right = 0;
      input.jump = input.sprint = false;
      input.mouseDX = input.mouseDY = 0;
    }
  }

  /* =============================================================
     SHOOTING
     ============================================================= */
  var _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  var _origin = new THREE.Vector3();

  function shoot(time) {
    RV.weapon.fire(time);
    RV.player.notifyFired();
    RV.audio.play('shot', RV.player.pos);

    camera.getWorldDirection(_dir);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _origin.copy(camera.position);

    // scatter inside the current cone
    var sp = RV.weapon.spread;
    var a = RV.rand() * Math.PI * 2;
    var r = Math.sqrt(RV.rand()) * sp;
    _dir.addScaledVector(_right, Math.cos(a) * r);
    _dir.addScaledVector(_up, Math.sin(a) * r);
    _dir.normalize();

    var maxD = 180;
    var eHit = RV.enemies.raycast(_origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, maxD);
    var wHit = RV.col3.raycast(_origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, maxD);

    var hitDist = maxD;
    if (eHit && (!wHit || eHit.dist < wHit.dist)) hitDist = eHit.dist;
    else if (wHit) hitDist = wHit.dist;

    // does the round hit the river before anything else?
    var waterT = Infinity;
    if (_dir.y < -0.0001) {
      var t = (RV.water.LEVEL - _origin.y) / _dir.y;
      if (t > 0) waterT = t;
    }

    if (waterT < hitDist) {
      var wx = _origin.x + _dir.x * waterT, wz = _origin.z + _dir.z * waterT;
      RV.fx.splash(wx, RV.water.LEVEL, wz, 0.55);
      RV.audio.play('impact', new THREE.Vector3(wx, 0, wz), 'water');
    } else if (eHit && (!wHit || eHit.dist < wHit.dist)) {
      var dmg = eHit.zone === 'head' ? 130 : (eHit.zone === 'legs' ? 22 : 36);
      var e = eHit.enemy;
      RV.fx.blood({ x: eHit.x, y: eHit.y, z: eHit.z }, _dir.x, _dir.y, _dir.z, eHit.zone === 'head' ? 1.6 : 1.0);
      RV.audio.play('impact', new THREE.Vector3(eHit.x, eHit.y, eHit.z), 'flesh');
      var killed = RV.enemies.damage(e, dmg, _dir.x, _dir.z);
      RV.enemies.alertAll(e.pos, 22);
      S.hitMarker = 0.14;
      S.headMarker = eHit.zone === 'head';
      RV.audio.play(eHit.zone === 'head' ? 'headshot' : 'hitmark');
      if (killed) {
        S.kills++;
        if (S.kills % 8 === 0) { S.wave++; message('Wave ' + S.wave, 2.0); }
      }
    } else if (wHit) {
      RV.fx.impact({ x: wHit.x, y: wHit.y, z: wHit.z }, wHit.nx, wHit.ny, wHit.nz, wHit.mat);
      RV.audio.play('impact', new THREE.Vector3(wHit.x, wHit.y, wHit.z), wHit.mat);
    }

    // occasional tracer so you can read where the rounds go
    if (RV.rand() < 0.34) {
      var d2 = Math.min(hitDist, 60);
      RV.fx.spark.spawn({
        x: RV.weapon.muzzleWorld.x, y: RV.weapon.muzzleWorld.y, z: RV.weapon.muzzleWorld.z,
        vx: _dir.x * 220, vy: _dir.y * 220, vz: _dir.z * 220,
        life: d2 / 220, s0: 0.05, s1: 0.03,
        a0: 0.55, a1: 0.0, r: 1.0, g: 0.82, b: 0.5,
        grav: 0, drag: 0
      });
    }

    RV.fx.muzzle(RV.weapon.muzzleWorld, _dir);
    // eject a case to the player's right
    RV.fx.casing(
      RV.weapon.muzzleWorld.x - _dir.x * 0.35 + _right.x * 0.06,
      RV.weapon.muzzleWorld.y - _dir.y * 0.35 - 0.06,
      RV.weapon.muzzleWorld.z - _dir.z * 0.35 + _right.z * 0.06,
      _right.x, _right.y, _right.z, _dir.x, _dir.y, _dir.z
    );

    // gunfire carries — everything nearby comes looking
    RV.enemies.alertAll(RV.player.pos, 46);
    S.flash = Math.min(S.flash + 0.05, 0.09);
  }

  /* =============================================================
     SPAWNING & PICKUPS
     ============================================================= */
  function updateSpawning(dt) {
    var target = Math.min(4 + S.wave, 13);
    if (RV.enemies.aliveCount() >= target) return;
    S.spawnTimer -= dt;
    if (S.spawnTimer > 0) return;
    S.spawnTimer = Math.max(0.9, 2.6 - S.wave * 0.12);

    var pts = RV.world.data.spawnPoints;
    var best = null, bestScore = -1;
    for (var i = 0; i < 10; i++) {
      var p = pts[RV.randInt(0, pts.length - 1)];
      var d = p.distanceTo(RV.player.pos);
      if (d < 14) continue;
      // prefer spots that are out of sight, in the fog
      var hidden = RV.col3.losBlocked(p.x, p.y + 1.5, p.z, camera.position.x, camera.position.y, camera.position.z);
      var score = (hidden ? 40 : 0) + (60 - Math.abs(d - 34));
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best) RV.enemies.spawn(best);
  }

  function updatePickups(dt, time) {
    for (var i = 0; i < pickups.length; i++) {
      var p = pickups[i];
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) { p.active = true; p.obj.visible = true; }
        continue;
      }
      p.obj.rotation.y = time * 0.9 + p.phase;
      p.obj.position.y = p.base.y + 0.14 + Math.sin(time * 1.7 + p.phase) * 0.055;

      var dx = p.obj.position.x - RV.player.pos.x;
      var dy = p.obj.position.y - (RV.player.pos.y + 0.9);
      var dz = p.obj.position.z - RV.player.pos.z;
      if (dx * dx + dy * dy + dz * dz > 2.0 * 2.0) continue;

      if (p.kind === 'ammo') {
        if (RV.weapon.reserve >= 240) continue;
        RV.weapon.addAmmo(45);
        message('+45 rounds', 1.6);
      } else {
        if (RV.player.health >= RV.player.maxHealth - 0.5) continue;
        RV.player.heal(40);
        message('+40 health', 1.6);
      }
      RV.audio.play('pickup');
      p.active = false;
      p.obj.visible = false;
      p.respawn = 30;
    }
  }

  /* =============================================================
     HUD UPDATE
     ============================================================= */
  function updateHUD(dt) {
    var w = RV.weapon, p = RV.player;

    hud.ammo.textContent = w.ammo;
    hud.reserve.textContent = w.reserve;
    var low = w.ammo <= 6;
    hud.ammoWrap.classList.toggle('low', low);
    hud.ammoWrap.classList.toggle('empty', w.ammo === 0);
    if (low && !S.lowAmmoWarned) { S.lowAmmoWarned = true; RV.audio.play('lowammo'); }
    if (!low) S.lowAmmoWarned = false;

    var hp = Math.max(0, Math.round(p.health));
    hud.health.style.width = (p.health / p.maxHealth * 100) + '%';
    hud.healthNum.textContent = hp;
    hud.health.classList.toggle('critical', p.health < 35);

    if (p.breath < 0.999) {
      hud.breathWrap.classList.remove('hidden');
      hud.breath.style.width = (p.breath * 100) + '%';
    } else {
      hud.breathWrap.classList.add('hidden');
    }

    hud.kills.textContent = S.kills;
    hud.wave.textContent = S.wave;
    hud.enemies.textContent = RV.enemies.aliveCount();

    // crosshair opens up with the bullet cone
    var px = Math.tan(w.spread) * (window.innerHeight / 2) / Math.tan((camera.fov * Math.PI / 180) / 2);
    var gap = RV.clamp(px, 3, 60);
    hud.chLines[0].style.transform = 'translate(-50%,-50%) translateY(' + (-gap - 7) + 'px)';
    hud.chLines[1].style.transform = 'translate(-50%,-50%) translateY(' + (gap + 7) + 'px)';
    hud.chLines[2].style.transform = 'translate(-50%,-50%) translateX(' + (-gap - 7) + 'px)';
    hud.chLines[3].style.transform = 'translate(-50%,-50%) translateX(' + (gap + 7) + 'px)';
    hud.crosshair.style.opacity = w.adsT > 0.65 ? 0 : (1 - w.adsT * 0.9);

    // hit marker
    if (S.hitMarker > 0) {
      S.hitMarker -= dt;
      hud.hitmarker.style.opacity = RV.clamp(S.hitMarker / 0.14, 0, 1);
      hud.hitmarker.classList.toggle('head', S.headMarker);
    } else hud.hitmarker.style.opacity = 0;

    // reload progress
    if (w.reloading) {
      hud.reloadBar.classList.remove('hidden');
      hud.reloadFill.style.width = (w.reloadT / w.RELOAD_TIME * 100) + '%';
    } else hud.reloadBar.classList.add('hidden');

    // messages
    if (S.messageT > 0) {
      S.messageT -= dt;
      hud.message.textContent = S.message;
      hud.message.style.opacity = RV.clamp(S.messageT, 0, 1);
    } else hud.message.style.opacity = 0;

    // directional damage arrows
    var html = '';
    for (var i = 0; i < p.damageDirs.length; i++) {
      var d = p.damageDirs[i];
      var rel = (d.angle - p.yaw) * 180 / Math.PI;
      html += '<div class="dmg-arrow" style="transform:rotate(' + rel + 'deg);opacity:' + d.t.toFixed(2) + '"></div>';
    }
    hud.damage.innerHTML = html;
  }

  /* =============================================================
     ADAPTIVE QUALITY
     Two graceful step-downs if the machine can't hold a decent frame
     rate, so the game stays playable on modest hardware.
     ============================================================= */
  var qualityLevel = 0, slowSamples = 0, fastSamples = 0;
  GAME.qualityLevel = function () { return qualityLevel; };

  function considerQuality() {
    if (!started || paused) return;
    if (S.fps > 0 && S.fps < 38) { slowSamples++; fastSamples = 0; } else { fastSamples++; slowSamples = 0; }
    if (slowSamples >= 6 && qualityLevel < 2) {
      qualityLevel++;
      slowSamples = 0;
      applyQuality();
      message(qualityLevel === 1 ? 'Lowering detail to keep things smooth'
                                 : 'Shadows off — performance mode', 2.6);
    }
  }

  function applyQuality() {
    if (qualityLevel >= 1) {
      renderer.setPixelRatio(1);
      sun.shadow.mapSize.set(1024, 1024);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      RV.postfx.resize(renderer, window.innerWidth, window.innerHeight);
    }
    if (qualityLevel >= 2) {
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
      scene.traverse(function (o) { if (o.isMesh) o.castShadow = false; });
    }
  }

  /* =============================================================
     RESIZE
     ============================================================= */
  function onResize() {
    var w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    viewCamera.aspect = w / h;
    viewCamera.updateProjectionMatrix();
    renderer.setSize(w, h);
    RV.postfx.resize(renderer, w, h);
  }

  /* =============================================================
     FRAME
     ============================================================= */
  function frame(now) {
    requestAnimationFrame(frame);
    if (!running) return;

    var realDt = (now - clock.last) / 1000;
    clock.last = now;
    var dt = realDt;
    if (dt > 0.1) dt = 0.1;          // never let a hitch teleport anybody
    if (dt <= 0) dt = 1 / 120;

    // FPS must be measured against the wall clock, not the clamped step
    S.fpsAccum += realDt; S.fpsFrames++;
    if (S.fpsAccum > 0.5) {
      S.fps = Math.round(S.fpsFrames / S.fpsAccum);
      S.fpsAccum = 0; S.fpsFrames = 0;
      if (hud.fps) hud.fps.textContent = S.fps;
      considerQuality();
    }

    readInput(dt);
    var active = started && !paused;
    if (active) clock.time += dt;
    var time = clock.time;
    GAME.time = time;

    if (active) {
      RV.player.update(dt, input, time);

      // firing
      if (RV.player.alive) {
        if (input.fire && !RV.player.sprinting) {
          if (RV.weapon.canFire(time)) shoot(time);
          else if (RV.weapon.ammo === 0 && !RV.weapon.reloading && time - RV.weapon.lastShot > 0.25) {
            RV.weapon.lastShot = time;
            RV.audio.play('dryfire', RV.player.pos);
            if (RV.weapon.reserve > 0 && RV.weapon.startReload()) RV.audio.play('reload', RV.player.pos);
          }
        }
        // auto-reload the moment the mag runs dry
        if (RV.weapon.ammo === 0 && !RV.weapon.reloading && RV.weapon.reserve > 0) {
          if (RV.weapon.startReload()) RV.audio.play('reload', RV.player.pos);
        }
      }

      RV.weapon.update(dt, {
        moveSpeed: RV.player.speed,
        grounded: RV.player.grounded,
        sprinting: RV.player.sprinting,
        ads: input.ads,
        underwater: RV.player.submerged,
        mouseDX: input.mouseDX,
        mouseDY: input.mouseDY,
        camera: camera,
        time: time
      });

      RV.enemies.update(dt, RV.player, time);
      updateSpawning(dt);
      updatePickups(dt, time);
      RV.world.update(time);
      RV.water.update(time, RV.player.submerged);
      RV.water.updateRapids(time);
      RV.fx.update(dt, camera, time);

      // death sequence
      if (!RV.player.alive) {
        S.deathT += dt;
        if (S.deathT > 1.4 && document.getElementById('death-screen').classList.contains('hidden')) {
          document.getElementById('death-screen').classList.remove('hidden');
          document.getElementById('death-kills').textContent = S.kills;
          document.getElementById('death-wave').textContent = S.wave;
          if (document.pointerLockElement) document.exitPointerLock();
        }
      }
    }

    /* ---- sun & shadow follow the player ---- */
    var pp = RV.player.pos;
    sun.position.set(pp.x + env.sunDir.x * 55, pp.y + env.sunDir.y * 55, pp.z + env.sunDir.z * 55);
    sunTarget.position.copy(pp);
    sunTarget.updateMatrixWorld();

    /* ---- keep the four lantern lights near the player ---- */
    var lps = RV.world.data.lanterns;
    if (lps.length) {
      var sorted = lps.map(function (l) { return { l: l, d: l.distanceToSquared(pp) }; })
        .sort(function (a, b) { return a.d - b.d; });
      for (var li = 0; li < lanternLights.length; li++) {
        var src = sorted[li];
        if (src && src.d < 40 * 40) {
          lanternLights[li].position.copy(src.l);
          lanternLights[li].intensity = 3.6 + Math.sin(time * 7 + li * 2.1) * 0.35
            + Math.sin(time * 17.3 + li) * 0.15;
        } else lanternLights[li].intensity = 0;
      }
    }

    /* ---- audio listener + underwater muffle ---- */
    RV.audio.setListener(camera.position, camera.quaternion);
    RV.audio.setUnderwater(RV.player.submerged);
    RV.audio.setRapids(RV.water.rapidsProximity(RV.player.pos));

    /* ---- fog swaps to a murky green underwater ---- */
    if (RV.player.submerged) {
      scene.fog.density = 0.105;
      scene.fog.color.copy(RV.col(0x123f3c));
      scene.background = scene.fog.color;
    } else {
      scene.fog.density = env.fogDensity;
      scene.fog.color.copy(env.fogColor);
      scene.background = env.fogColor;
    }

    /* ---- ADS zoom ---- */
    var targetFov = RV.lerp(75, 54, RV.weapon.adsT);
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
    var targetVFov = RV.lerp(58, 46, RV.weapon.adsT);
    if (Math.abs(viewCamera.fov - targetVFov) > 0.01) {
      viewCamera.fov = targetVFov;
      viewCamera.updateProjectionMatrix();
    }

    /* ---- post uniforms ---- */
    S.flash = Math.max(0, S.flash - dt * 0.7);
    var dmg = RV.clamp(1 - RV.player.health / 55, 0, 1);
    var recent = RV.clamp(1 - (RV.now() - RV.player.lastDamage) / 0.85, 0, 1);
    fadeT = RV.damp(fadeT, RV.player.alive ? 1 : 0.25, 2.2, dt);
    RV.postfx.set('uTime', time);
    RV.postfx.set('uUnder', RV.player.submerged ? 1 : 0);
    RV.postfx.set('uDamage', Math.max(dmg * 0.55, recent * 0.75));
    RV.postfx.set('uFlash', S.flash);
    RV.postfx.set('uLow', dmg);
    RV.postfx.set('uFade', fadeT);

    if (RV.player.health < 30 && RV.player.alive) {
      S.hbTimer = (S.hbTimer || 0) - dt;
      if (S.hbTimer <= 0) { S.hbTimer = RV.lerp(0.55, 1.1, RV.player.health / 30); RV.audio.play('heartbeat'); }
    }

    updateHUD(dt);

    /* ---- render: world, then viewmodel on a cleared depth buffer ---- */
    renderer.setRenderTarget(RV.postfx.target);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(viewScene, viewCamera);
    renderer.setRenderTarget(null);
    renderer.clear(true, true, true);
    RV.postfx.render(renderer);
  }

  window.addEventListener('DOMContentLoaded', function () {
    try { GAME.boot(); }
    catch (e) { showFatal(e); }
  });

})(window.RV);

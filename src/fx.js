/* =============================================================
   RIVER VILLAGE — fx.js
   Batched billboard particles (one draw call per blend mode),
   world-space decals, ejected shell casings, water ripples, drifting
   mist and the volumetric light shafts.
   ============================================================= */
(function (RV) {
  'use strict';

  var FX = RV.fx = {};
  var scene = null, env = null, sprites = null;
  var systems = [], decalFields = [], ripples = null;
  var casings = null, casingData = [], casingHead = 0;
  var shafts = [];

  /* =============================================================
     BATCHED BILLBOARD PARTICLES
     ============================================================= */
  var PART_VERT = [
    'attribute vec3 aCenter;',
    'attribute vec2 aCorner;',
    'attribute float aSize;',
    'attribute float aAngle;',
    'attribute vec3 aColor;',
    'attribute float aAlpha;',
    'varying vec2 vUv;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying float vFogDepth;',
    'void main(){',
    '  vUv = aCorner * 0.5 + 0.5;',
    '  vColor = aColor;',
    '  vAlpha = aAlpha;',
    '  vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);',
    '  float c = cos(aAngle), s = sin(aAngle);',
    '  vec2 off = vec2(aCorner.x*c - aCorner.y*s, aCorner.x*s + aCorner.y*c) * aSize;',
    '  mv.xy += off;',
    '  vFogDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  function partFrag(additive) {
    return [
      'uniform sampler2D uMap;',
      'uniform vec3 uFogColor;',
      'uniform float uFogDensity;',
      'varying vec2 vUv;',
      'varying vec3 vColor;',
      'varying float vAlpha;',
      'varying float vFogDepth;',
      'void main(){',
      '  vec4 t = texture2D(uMap, vUv);',
      '  float a = t.a * vAlpha;',
      '  if (a < 0.004) discard;',
      '  vec3 col = t.rgb * vColor;',
      '  float fd = uFogDensity * vFogDepth;',
      '  float fog = clamp(1.0 - exp(-fd*fd), 0.0, 1.0);',
      additive
        ? '  a *= (1.0 - fog);'
        : '  col = mix(col, uFogColor, fog);',
      '  gl_FragColor = vec4(col, a);',
      '}'
    ].join('\n');
  }

  function ParticleSystem(tex, max, additive, renderOrder) {
    this.max = max;
    this.additive = additive;
    this.parts = [];
    this.head = 0;
    this.live = 0;

    var geo = new THREE.BufferGeometry();
    this.aCenter = new Float32Array(max * 4 * 3);
    this.aCorner = new Float32Array(max * 4 * 2);
    this.aSize = new Float32Array(max * 4);
    this.aAngle = new Float32Array(max * 4);
    this.aColor = new Float32Array(max * 4 * 3);
    this.aAlpha = new Float32Array(max * 4);
    var idx = new Uint32Array(max * 6);
    var corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    for (var i = 0; i < max; i++) {
      for (var v = 0; v < 4; v++) {
        this.aCorner[(i * 4 + v) * 2] = corners[v * 2];
        this.aCorner[(i * 4 + v) * 2 + 1] = corners[v * 2 + 1];
      }
      idx[i * 6] = i * 4; idx[i * 6 + 1] = i * 4 + 1; idx[i * 6 + 2] = i * 4 + 2;
      idx[i * 6 + 3] = i * 4; idx[i * 6 + 4] = i * 4 + 2; idx[i * 6 + 5] = i * 4 + 3;
      this.parts.push({ life: 0 });
    }
    geo.setAttribute('aCenter', new THREE.BufferAttribute(this.aCenter, 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(this.aCorner, 2));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1));
    geo.setAttribute('aAngle', new THREE.BufferAttribute(this.aAngle, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1));
    geo.setAttribute('position', new THREE.BufferAttribute(this.aCenter, 3)); // required by three
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uFogColor: { value: env.fogColor.clone() },
        uFogDensity: { value: env.fogDensity }
      },
      vertexShader: PART_VERT,
      fragmentShader: partFrag(additive),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder || 10;
    this.geo = geo;
    scene.add(this.mesh);
    systems.push(this);
  }

  ParticleSystem.prototype.spawn = function (o) {
    var i = this.head;
    this.head = (this.head + 1) % this.max;
    var p = this.parts[i];
    p.i = i;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = o.life; p.maxLife = o.life;
    p.s0 = o.s0; p.s1 = o.s1 === undefined ? o.s0 : o.s1;
    p.a0 = o.a0 === undefined ? 1 : o.a0;
    p.a1 = o.a1 === undefined ? 0 : o.a1;
    p.r = o.r === undefined ? 1 : o.r;
    p.g = o.g === undefined ? 1 : o.g;
    p.b = o.b === undefined ? 1 : o.b;
    p.grav = o.grav || 0;
    p.drag = o.drag === undefined ? 0.6 : o.drag;
    p.ang = o.ang === undefined ? RV.rand() * 6.28 : o.ang;
    p.angVel = o.angVel || 0;
    p.water = !!o.water;      // dies (and ripples) on hitting the river
    p.fade = o.fade || 'lin';
    return p;
  };

  ParticleSystem.prototype.update = function (dt) {
    var C = this.aCenter, S = this.aSize, A = this.aAngle, CO = this.aColor, AL = this.aAlpha;
    this.live = 0;
    for (var i = 0; i < this.max; i++) {
      var p = this.parts[i];
      var base4 = i * 4;
      if (p.life <= 0) {
        // collapse the quad so it draws nothing
        for (var z = 0; z < 4; z++) { S[base4 + z] = 0; AL[base4 + z] = 0; }
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) { for (var z2 = 0; z2 < 4; z2++) { S[base4 + z2] = 0; AL[base4 + z2] = 0; } continue; }

      p.vy -= p.grav * dt;
      var d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.ang += p.angVel * dt;

      if (p.water && p.y <= RV.water.LEVEL && p.vy < 0) {
        FX.ripple(p.x, p.z, 0.25 + RV.rand() * 0.4);
        p.life = 0;
        for (var z3 = 0; z3 < 4; z3++) { S[base4 + z3] = 0; AL[base4 + z3] = 0; }
        continue;
      }

      var t = 1 - p.life / p.maxLife;
      var size = RV.lerp(p.s0, p.s1, t);
      var alpha = RV.lerp(p.a0, p.a1, p.fade === 'quad' ? t * t : t);
      this.live++;
      for (var v = 0; v < 4; v++) {
        var k = base4 + v;
        C[k * 3] = p.x; C[k * 3 + 1] = p.y; C[k * 3 + 2] = p.z;
        S[k] = size; A[k] = p.ang;
        CO[k * 3] = p.r; CO[k * 3 + 1] = p.g; CO[k * 3 + 2] = p.b;
        AL[k] = alpha;
      }
    }
    this.geo.attributes.aCenter.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAngle.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  };

  /* =============================================================
     DECALS — world-oriented quads (bullet holes, blood splats)
     ============================================================= */
  var DECAL_VERT = [
    'attribute float aAlpha;',
    'varying vec2 vUv;',
    'varying float vAlpha;',
    'varying float vFogDepth;',
    'void main(){',
    '  vUv = uv; vAlpha = aAlpha;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  vFogDepth = -mv.z;',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var DECAL_FRAG = [
    'uniform sampler2D uMap;',
    'uniform vec3 uFogColor;',
    'uniform float uFogDensity;',
    'uniform vec3 uTint;',
    'varying vec2 vUv;',
    'varying float vAlpha;',
    'varying float vFogDepth;',
    'void main(){',
    '  vec4 t = texture2D(uMap, vUv);',
    '  float a = t.a * vAlpha;',
    '  if (a < 0.004) discard;',
    '  float fd = uFogDensity * vFogDepth;',
    '  float fog = clamp(1.0 - exp(-fd*fd), 0.0, 1.0);',
    '  vec3 col = mix(t.rgb * uTint, uFogColor, fog);',
    '  gl_FragColor = vec4(col, a);',
    '}'
  ].join('\n');

  function DecalField(tex, max, tint, renderOrder) {
    this.max = max; this.head = 0;
    this.items = [];
    var geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.uv = new Float32Array(max * 4 * 2);
    this.alpha = new Float32Array(max * 4);
    var idx = new Uint32Array(max * 6);
    var uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    for (var i = 0; i < max; i++) {
      for (var v = 0; v < 4; v++) {
        this.uv[(i * 4 + v) * 2] = uvs[v * 2];
        this.uv[(i * 4 + v) * 2 + 1] = uvs[v * 2 + 1];
      }
      idx[i * 6] = i * 4; idx[i * 6 + 1] = i * 4 + 1; idx[i * 6 + 2] = i * 4 + 2;
      idx[i * 6 + 3] = i * 4; idx[i * 6 + 4] = i * 4 + 2; idx[i * 6 + 5] = i * 4 + 3;
      this.items.push({ life: 0 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uTint: { value: tint || new THREE.Color(1, 1, 1) },
        uFogColor: { value: env.fogColor.clone() },
        uFogDensity: { value: env.fogDensity }
      },
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder || 6;
    this.geo = geo;
    scene.add(this.mesh);
    decalFields.push(this);
  }

  var _u = new THREE.Vector3(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _tmp = new THREE.Vector3();
  DecalField.prototype.place = function (x, y, z, nx, ny, nz, size, life) {
    var i = this.head;
    this.head = (this.head + 1) % this.max;
    var it = this.items[i];
    it.life = life; it.maxLife = life; it.i = i;

    _n.set(nx, ny, nz).normalize();
    // pick any vector not parallel to the normal to build a basis
    _tmp.set(0, 1, 0);
    if (Math.abs(_n.y) > 0.92) _tmp.set(1, 0, 0);
    _u.crossVectors(_tmp, _n).normalize();
    _v.crossVectors(_n, _u).normalize();
    var rot = RV.rand() * 6.28, cs = Math.cos(rot), sn = Math.sin(rot);
    var ux = (_u.x * cs + _v.x * sn) * size, uy = (_u.y * cs + _v.y * sn) * size, uz = (_u.z * cs + _v.z * sn) * size;
    var vx = (-_u.x * sn + _v.x * cs) * size, vy = (-_u.y * sn + _v.y * cs) * size, vz = (-_u.z * sn + _v.z * cs) * size;
    // lift slightly off the surface to beat z-fighting
    var ox = x + _n.x * 0.012, oy = y + _n.y * 0.012, oz = z + _n.z * 0.012;
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (var c = 0; c < 4; c++) {
      var a = corners[c][0], b = corners[c][1];
      var k = (i * 4 + c) * 3;
      this.pos[k] = ox + ux * a + vx * b;
      this.pos[k + 1] = oy + uy * a + vy * b;
      this.pos[k + 2] = oz + uz * a + vz * b;
    }
    this.geo.attributes.position.needsUpdate = true;
  };

  DecalField.prototype.update = function (dt) {
    var changed = false;
    for (var i = 0; i < this.max; i++) {
      var it = this.items[i];
      if (it.life <= 0) continue;
      it.life -= dt;
      var a = it.life <= 0 ? 0 : RV.clamp(it.life / Math.min(it.maxLife, 6), 0, 1);
      for (var v = 0; v < 4; v++) this.alpha[i * 4 + v] = a;
      changed = true;
    }
    if (changed) this.geo.attributes.aAlpha.needsUpdate = true;
  };

  /* =============================================================
     INIT
     ============================================================= */
  FX.init = function (sc, environment, spriteSet) {
    scene = sc; env = environment; sprites = spriteSet;
    systems.length = 0; decalFields.length = 0; shafts.length = 0;

    FX.smoke = new ParticleSystem(sprites.smoke, 280, false, 11);
    FX.soft = new ParticleSystem(sprites.soft, 340, false, 12);
    FX.spark = new ParticleSystem(sprites.spark, 220, true, 13);

    FX.holes = new DecalField(sprites.hole, 64, new THREE.Color(1, 1, 1), 6);
    FX.bloodDecals = new DecalField(sprites.blood, 48, new THREE.Color(1, 1, 1), 7);
    ripples = new DecalField(sprites.ring, 40, RV.col(0xbfe8e0), 8);
    FX.rippleField = ripples;

    /* shell casings — instanced, with simple bouncing physics */
    var cg = RV.cylGeo(0.0055, 0.0055, 0.039, 6, 1, new THREE.Color(1, 1, 1));
    var cm = new THREE.MeshStandardMaterial({
      color: RV.col(0xc9a13f), metalness: 0.95, roughness: 0.32
    });
    casings = new THREE.InstancedMesh(cg, cm, 26);
    casings.frustumCulled = false;
    casings.castShadow = false;
    casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    var hideM = new THREE.Matrix4().makeScale(0, 0, 0);
    for (var i = 0; i < 26; i++) {
      casings.setMatrixAt(i, hideM);
      casingData.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0 });
    }
    casings.instanceMatrix.needsUpdate = true;
    scene.add(casings);

    FX.startMist();
  };

  /* =============================================================
     EFFECT RECIPES
     ============================================================= */

  /** Muzzle smoke and sparks at the world-space muzzle. */
  FX.muzzle = function (pos, dir) {
    var i;
    for (i = 0; i < 3; i++) {
      FX.smoke.spawn({
        x: pos.x + dir.x * 0.12, y: pos.y + dir.y * 0.12, z: pos.z + dir.z * 0.12,
        vx: dir.x * RV.randRange(1.2, 3.0) + RV.randRange(-0.4, 0.4),
        vy: dir.y * RV.randRange(1.2, 3.0) + RV.randRange(-0.1, 0.5),
        vz: dir.z * RV.randRange(1.2, 3.0) + RV.randRange(-0.4, 0.4),
        life: RV.randRange(0.45, 0.9), s0: 0.05, s1: RV.randRange(0.28, 0.5),
        a0: 0.34, a1: 0, r: 0.72, g: 0.71, b: 0.68,
        grav: -0.35, drag: 2.4, angVel: RV.randRange(-2, 2), fade: 'quad'
      });
    }
    for (i = 0; i < 5; i++) {
      FX.spark.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dir.x * RV.randRange(3, 9) + RV.randRange(-1.6, 1.6),
        vy: dir.y * RV.randRange(3, 9) + RV.randRange(-1.0, 1.6),
        vz: dir.z * RV.randRange(3, 9) + RV.randRange(-1.6, 1.6),
        life: RV.randRange(0.05, 0.16), s0: 0.05, s1: 0.012,
        a0: 1, a1: 0, r: 1.0, g: 0.78, b: 0.35,
        grav: 5, drag: 3.5
      });
    }
  };

  /** Bullet impact against a surface. */
  FX.impact = function (pos, nx, ny, nz, matName) {
    var i, col = { r: 0.55, g: 0.45, b: 0.34 };
    var sparky = false;
    if (matName === 'rock') { col = { r: 0.62, g: 0.62, b: 0.60 }; sparky = true; }
    else if (matName === 'metal') { col = { r: 0.7, g: 0.7, b: 0.72 }; sparky = true; }
    else if (matName === 'thatch') col = { r: 0.62, g: 0.55, b: 0.34 };
    else if (matName === 'dirt') col = { r: 0.40, g: 0.32, b: 0.23 };

    // dust puff
    for (i = 0; i < 4; i++) {
      FX.smoke.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: nx * RV.randRange(0.6, 2.2) + RV.randRange(-0.7, 0.7),
        vy: ny * RV.randRange(0.6, 2.2) + RV.randRange(0.1, 1.0),
        vz: nz * RV.randRange(0.6, 2.2) + RV.randRange(-0.7, 0.7),
        life: RV.randRange(0.35, 0.8), s0: 0.06, s1: RV.randRange(0.30, 0.55),
        a0: 0.42, a1: 0, r: col.r, g: col.g, b: col.b,
        grav: -0.2, drag: 2.6, angVel: RV.randRange(-2.5, 2.5), fade: 'quad'
      });
    }
    // debris chips
    for (i = 0; i < 7; i++) {
      FX.soft.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: nx * RV.randRange(1, 5) + RV.randRange(-2.6, 2.6),
        vy: ny * RV.randRange(1, 5) + RV.randRange(0.5, 3.4),
        vz: nz * RV.randRange(1, 5) + RV.randRange(-2.6, 2.6),
        life: RV.randRange(0.4, 1.1), s0: RV.randRange(0.012, 0.03), s1: 0.008,
        a0: 0.95, a1: 0.2, r: col.r * 0.8, g: col.g * 0.8, b: col.b * 0.8,
        grav: 12, drag: 0.5, water: true
      });
    }
    if (sparky) {
      for (i = 0; i < 8; i++) {
        FX.spark.spawn({
          x: pos.x, y: pos.y, z: pos.z,
          vx: nx * RV.randRange(1, 5) + RV.randRange(-3.5, 3.5),
          vy: ny * RV.randRange(1, 5) + RV.randRange(0.5, 4),
          vz: nz * RV.randRange(1, 5) + RV.randRange(-3.5, 3.5),
          life: RV.randRange(0.12, 0.42), s0: 0.045, s1: 0.010,
          a0: 1, a1: 0, r: 1.0, g: 0.72, b: 0.28,
          grav: 11, drag: 0.9
        });
      }
    }
    FX.holes.place(pos.x, pos.y, pos.z, nx, ny, nz, RV.randRange(0.045, 0.075), 22);
  };

  /** Blood burst when a round connects. */
  FX.blood = function (pos, dx, dy, dz, amount) {
    var n = Math.round(8 * amount);
    for (var i = 0; i < n; i++) {
      FX.soft.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dx * RV.randRange(1, 4.5) + RV.randRange(-1.8, 1.8),
        vy: dy * RV.randRange(1, 4.5) + RV.randRange(0.4, 2.8),
        vz: dz * RV.randRange(1, 4.5) + RV.randRange(-1.8, 1.8),
        life: RV.randRange(0.35, 0.95), s0: RV.randRange(0.02, 0.05), s1: 0.012,
        a0: 0.95, a1: 0.25, r: 0.42, g: 0.045, b: 0.03,
        grav: 13, drag: 0.7, water: true
      });
    }
    // fine mist
    for (var j = 0; j < Math.round(4 * amount); j++) {
      FX.smoke.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: dx * RV.randRange(0.5, 2) + RV.randRange(-0.5, 0.5),
        vy: dy * RV.randRange(0.5, 2) + RV.randRange(0, 0.8),
        vz: dz * RV.randRange(0.5, 2) + RV.randRange(-0.5, 0.5),
        life: RV.randRange(0.25, 0.5), s0: 0.06, s1: RV.randRange(0.22, 0.4),
        a0: 0.5, a1: 0, r: 0.38, g: 0.05, b: 0.04,
        grav: -0.5, drag: 3.0, fade: 'quad'
      });
    }
  };

  /** Blood pooling under a corpse / splatter on the deck. */
  FX.bloodDecal = function (x, y, z, nx, ny, nz, size) {
    FX.bloodDecals.place(x, y, z, nx, ny, nz, size, 40);
  };

  /** Water entry: crown of droplets plus a ring. */
  FX.splash = function (x, y, z, strength) {
    var n = Math.round(RV.clamp(strength, 0.3, 2) * 16);
    for (var i = 0; i < n; i++) {
      var a = RV.rand() * 6.28;
      var sp = RV.randRange(1.0, 4.2) * strength;
      FX.soft.spawn({
        x: x + Math.cos(a) * RV.randRange(0, 0.35), y: y + 0.05, z: z + Math.sin(a) * RV.randRange(0, 0.35),
        vx: Math.cos(a) * sp * 0.55, vy: RV.randRange(1.5, 4.5) * strength, vz: Math.sin(a) * sp * 0.55,
        life: RV.randRange(0.4, 1.0), s0: RV.randRange(0.03, 0.09), s1: 0.02,
        a0: 0.9, a1: 0.15, r: 0.80, g: 0.93, b: 0.90,
        grav: 12, drag: 0.55, water: true
      });
    }
    // low mist over the impact
    for (var j = 0; j < 4; j++) {
      FX.smoke.spawn({
        x: x, y: y + 0.1, z: z,
        vx: RV.randRange(-0.7, 0.7), vy: RV.randRange(0.3, 1.0), vz: RV.randRange(-0.7, 0.7),
        life: RV.randRange(0.5, 1.1), s0: 0.15, s1: RV.randRange(0.6, 1.1),
        a0: 0.30 * strength, a1: 0, r: 0.85, g: 0.95, b: 0.93,
        grav: -0.4, drag: 2.0, fade: 'quad'
      });
    }
    FX.ripple(x, z, 0.7 * strength + 0.4);
    FX.ripple(x, z, 0.35 * strength + 0.2);
  };

  /** Rising bubbles while submerged. */
  FX.bubbles = function (x, y, z, n) {
    for (var i = 0; i < n; i++) {
      FX.soft.spawn({
        x: x + RV.randRange(-0.25, 0.25), y: y + RV.randRange(-0.3, 0.1), z: z + RV.randRange(-0.25, 0.25),
        vx: RV.randRange(-0.15, 0.15), vy: RV.randRange(0.5, 1.5), vz: RV.randRange(-0.15, 0.15),
        life: RV.randRange(0.6, 1.6), s0: RV.randRange(0.012, 0.045), s1: RV.randRange(0.02, 0.06),
        a0: 0.55, a1: 0.1, r: 0.85, g: 0.97, b: 0.95,
        grav: -1.2, drag: 0.9
      });
    }
  };

  FX.ripple = function (x, z, size) {
    ripples.place(x, RV.water.LEVEL + 0.03, z, 0, 1, 0, size, 1.6);
    var it = ripples.items[(ripples.head - 1 + ripples.max) % ripples.max];
    it.grow = size;
  };

  /** Eject a spent case from the world-space muzzle/ejection port. */
  FX.casing = function (x, y, z, rx, ry, rz, fx, fy, fz) {
    var d = casingData[casingHead];
    d.i = casingHead;
    casingHead = (casingHead + 1) % casingData.length;
    d.life = 6.0;
    d.x = x; d.y = y; d.z = z;
    // out to the right and slightly up/forward, like a real ejection
    d.vx = rx * RV.randRange(2.4, 3.8) + fx * 0.6 + RV.randRange(-0.3, 0.3);
    d.vy = RV.randRange(1.4, 2.4);
    d.vz = rz * RV.randRange(2.4, 3.8) + fz * 0.6 + RV.randRange(-0.3, 0.3);
    d.rx = RV.rand() * 6.28; d.ry = RV.rand() * 6.28; d.rz = RV.rand() * 6.28;
    d.wx = RV.randRange(-22, 22); d.wy = RV.randRange(-14, 14); d.wz = RV.randRange(-22, 22);
    d.bounced = 0;
  };

  /* ---------- ambient mist ---------- */
  var mistTimer = 0;
  FX.startMist = function () { mistTimer = 0; };
  FX.mistTick = function (dt, camPos) {
    mistTimer -= dt;
    if (mistTimer > 0) return;
    mistTimer = 0.14;
    // drifting wisps just above the water, around the player
    var a = RV.rand() * 6.28, r = RV.randRange(6, 30);
    var x = camPos.x + Math.cos(a) * r, z = camPos.z + Math.sin(a) * r;
    FX.smoke.spawn({
      x: x, y: RV.water.LEVEL + RV.randRange(0.05, 1.8), z: z,
      vx: RV.randRange(0.05, 0.4), vy: RV.randRange(-0.02, 0.06), vz: RV.randRange(-0.2, 0.2),
      life: RV.randRange(7, 14), s0: RV.randRange(2.0, 4.5), s1: RV.randRange(4.0, 8.0),
      a0: 0.0, a1: 0.0, r: 0.80, g: 0.87, b: 0.85,
      grav: 0, drag: 0.02, angVel: RV.randRange(-0.08, 0.08)
    });
    // ease it in and out by hand (spawn() only lerps a0->a1)
    var p = FX.smoke.parts[(FX.smoke.head - 1 + FX.smoke.max) % FX.smoke.max];
    p.a0 = 0.16; p.a1 = 0.0; p.fade = 'quad';
  };

  /* ---------- god rays ---------- */
  FX.buildGodRays = function (positions, sunDir) {
    var mat = new THREE.MeshBasicMaterial({
      map: sprites.shaft, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, opacity: 0.5,
      color: RV.col(0xcfe6d8)
    });
    for (var i = 0; i < positions.length; i++) {
      var p = positions[i];
      var h = p.h || 16;
      var geo = new THREE.PlaneGeometry(p.w || 3.2, h);
      geo.translate(0, -h / 2, 0);
      var m = new THREE.Mesh(geo, mat.clone());
      m.position.set(p.x, p.y, p.z);
      // lean the shaft along the sun direction
      m.rotation.z = Math.atan2(-sunDir.x, sunDir.y) * 0.8;
      m.renderOrder = 9;
      m.frustumCulled = false;
      m.userData.phase = RV.rand() * 6.28;
      m.userData.base = p.o === undefined ? 0.42 : p.o;
      scene.add(m);
      shafts.push(m);
    }
  };

  /* =============================================================
     UPDATE
     ============================================================= */
  var _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _s4 = new THREE.Vector3(1, 1, 1), _p4 = new THREE.Vector3();
  var _hideM = new THREE.Matrix4().makeScale(0, 0, 0);

  FX.update = function (dt, camera, time) {
    var i;
    for (i = 0; i < systems.length; i++) systems[i].update(dt);
    for (i = 0; i < decalFields.length; i++) decalFields[i].update(dt);

    // ripples expand as they fade
    for (i = 0; i < ripples.max; i++) {
      var r = ripples.items[i];
      if (r.life <= 0 || !r.grow) continue;
      // re-place the quad a little larger each frame
      var t = 1 - r.life / r.maxLife;
      var k = i * 4 * 3;
      var cx = 0, cz = 0;
      for (var v = 0; v < 4; v++) { cx += ripples.pos[k + v * 3]; cz += ripples.pos[k + v * 3 + 2]; }
      cx /= 4; cz /= 4;
      var s = r.grow * (1 + t * 2.4);
      var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (var c = 0; c < 4; c++) {
        ripples.pos[k + c * 3] = cx + corners[c][0] * s;
        ripples.pos[k + c * 3 + 1] = RV.water.LEVEL + 0.03;
        ripples.pos[k + c * 3 + 2] = cz + corners[c][1] * s;
      }
      ripples.geo.attributes.position.needsUpdate = true;
    }

    // shell casings
    var anyCasing = false;
    for (i = 0; i < casingData.length; i++) {
      var d = casingData[i];
      if (d.life <= 0) continue;
      anyCasing = true;
      d.life -= dt;
      if (d.life <= 0) { casings.setMatrixAt(i, _hideM); continue; }
      d.vy -= 22 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.rx += d.wx * dt; d.ry += d.wy * dt; d.rz += d.wz * dt;
      // bounce off whatever is underneath
      if (d.bounced < 3) {
        var g = RV.col3.groundAt(d.x, d.z, d.y + 0.4, 1.2, 0.04);
        if (g && d.y <= g.y1 + 0.012 && d.vy < 0) {
          d.y = g.y1 + 0.012;
          d.vy = -d.vy * 0.34;
          d.vx *= 0.55; d.vz *= 0.55;
          d.wx *= 0.4; d.wy *= 0.4; d.wz *= 0.4;
          d.bounced++;
          if (Math.abs(d.vy) < 0.4) { d.vy = 0; d.wx = d.wy = d.wz = 0; d.bounced = 3; }
        }
      }
      if (d.y < RV.water.LEVEL) {
        if (d.life > 0.1) { FX.ripple(d.x, d.z, 0.16); }
        d.life = 0; casings.setMatrixAt(i, _hideM); continue;
      }
      _p4.set(d.x, d.y, d.z);
      _e4.set(d.rx, d.ry, d.rz);
      _q4.setFromEuler(_e4);
      _m4.compose(_p4, _q4, _s4);
      casings.setMatrixAt(i, _m4);
    }
    if (anyCasing) casings.instanceMatrix.needsUpdate = true;

    // shafts shimmer and always turn their face towards the camera
    for (i = 0; i < shafts.length; i++) {
      var sh = shafts[i];
      var dx = camera.position.x - sh.position.x, dz = camera.position.z - sh.position.z;
      sh.rotation.y = Math.atan2(dx, dz);
      var ph = sh.userData.phase;
      sh.material.opacity = sh.userData.base * (0.72 + Math.sin(time * 0.35 + ph) * 0.28);
    }

    FX.mistTick(dt, camera.position);
  };

  FX.clearTransient = function () {
    for (var s = 0; s < systems.length; s++) {
      for (var i = 0; i < systems[s].max; i++) systems[s].parts[i].life = 0;
    }
    for (var d = 0; d < decalFields.length; d++) {
      for (var j = 0; j < decalFields[d].max; j++) decalFields[d].items[j].life = 0;
    }
    for (var c = 0; c < casingData.length; c++) casingData[c].life = 0;
  };

})(window.RV);

/* =============================================================
   RIVER VILLAGE — util.js
   Math, seeded noise, geometry builders and a geometry merger.
   Everything the rest of the game is built out of.
   ============================================================= */
window.RV = window.RV || {};
(function (RV) {
  'use strict';

  RV.TAU = Math.PI * 2;
  RV.DEG = Math.PI / 180;

  /* ---------- scalar math ---------- */
  RV.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  RV.lerp = function (a, b, t) { return a + (b - a) * t; };
  RV.smoothstep = function (e0, e1, x) {
    var t = RV.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // frame-rate independent exponential approach
  RV.damp = function (a, b, lambda, dt) { return RV.lerp(a, b, 1 - Math.exp(-lambda * dt)); };
  // shortest signed angular difference
  RV.angleDelta = function (a, b) {
    var d = (b - a) % RV.TAU;
    if (d > Math.PI) d -= RV.TAU;
    if (d < -Math.PI) d += RV.TAU;
    return d;
  };

  /* ---------- seeded RNG (mulberry32) ---------- */
  RV.makeRNG = function (seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  var _rng = RV.makeRNG(20260905);
  RV.rand = function () { return _rng(); };
  RV.randRange = function (a, b) { return a + _rng() * (b - a); };
  RV.randInt = function (a, b) { return Math.floor(a + _rng() * (b - a + 1)); };
  RV.randSign = function () { return _rng() < 0.5 ? -1 : 1; };
  RV.chance = function (p) { return _rng() < p; };
  RV.pick = function (arr) { return arr[Math.floor(_rng() * arr.length) % arr.length]; };
  RV.reseed = function (s) { _rng = RV.makeRNG(s); };

  /* ---------- value noise / fbm (used by texture generation) ---------- */
  function hash2(x, y, s) {
    var h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1013904223);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  RV.hash2 = hash2;

  // tileable value noise: period p on both axes so textures wrap seamlessly
  RV.noise2 = function (x, y, seed, p) {
    seed = seed || 0;
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
    if (p) { x0 = ((x0 % p) + p) % p; x1 = ((x1 % p) + p) % p; y0 = ((y0 % p) + p) % p; y1 = ((y1 % p) + p) % p; }
    var a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
    var c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
    return RV.lerp(RV.lerp(a, b, u), RV.lerp(c, d, u), v);
  };

  RV.fbm = function (x, y, oct, seed, period) {
    var sum = 0, amp = 0.5, freq = 1, norm = 0, p = period || 0;
    for (var i = 0; i < oct; i++) {
      sum += amp * RV.noise2(x * freq, y * freq, seed + i * 17, p ? p * freq : 0);
      norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };

  // ridged noise — good for wood grain and rock striations
  RV.ridge = function (x, y, oct, seed, period) {
    var sum = 0, amp = 0.5, freq = 1, norm = 0, p = period || 0;
    for (var i = 0; i < oct; i++) {
      var n = Math.abs(RV.noise2(x * freq, y * freq, seed + i * 31, p ? p * freq : 0) * 2 - 1);
      sum += amp * (1 - n); norm += amp; amp *= 0.5; freq *= 2;
    }
    return sum / norm;
  };

  /* ---------- colour ---------- */
  // Authoring colours as sRGB hex while the renderer works in linear space.
  RV.col = function (hex) { return new THREE.Color(hex).convertSRGBToLinear(); };

  /* =============================================================
     GEOMETRY
     Custom builders emit world-scaled UVs so one texture tiles at a
     consistent density no matter how big the box is.
     ============================================================= */

  function pushQuad(P, N, U, C, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
                    nx, ny, nz, u0, v0, u1, v1, col) {
    // two triangles: a-b-c, a-c-d
    var vs = [ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz];
    var uvs = [u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1];
    for (var i = 0; i < 6; i++) {
      P.push(vs[i * 3], vs[i * 3 + 1], vs[i * 3 + 2]);
      N.push(nx, ny, nz);
      U.push(uvs[i * 2], uvs[i * 2 + 1]);
      C.push(col[0], col[1], col[2]);
    }
  }

  /**
   * Box with per-face UVs scaled to world units.
   * @param {number} w,h,d   dimensions
   * @param {number} us      world units per texture repeat
   * @param {THREE.Color} c  vertex tint (variation without extra materials)
   */
  RV.boxGeo = function (w, h, d, us, c) {
    us = us || 1;
    var col = c ? [c.r, c.g, c.b] : [1, 1, 1];
    var x = w / 2, y = h / 2, z = d / 2;
    var P = [], N = [], U = [], C = [];
    var sw = w / us, sh = h / us, sd = d / us;
    // +X
    pushQuad(P, N, U, C, x, -y, z, x, -y, -z, x, y, -z, x, y, z, 1, 0, 0, 0, 0, sd, sh, col);
    // -X
    pushQuad(P, N, U, C, -x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z, -1, 0, 0, 0, 0, sd, sh, col);
    // +Y (top)
    pushQuad(P, N, U, C, -x, y, z, x, y, z, x, y, -z, -x, y, -z, 0, 1, 0, 0, 0, sw, sd, col);
    // -Y (bottom)
    pushQuad(P, N, U, C, -x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z, 0, -1, 0, 0, 0, sw, sd, col);
    // +Z
    pushQuad(P, N, U, C, -x, -y, z, x, -y, z, x, y, z, -x, y, z, 0, 0, 1, 0, 0, sw, sh, col);
    // -Z
    pushQuad(P, N, U, C, x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z, 0, 0, -1, 0, 0, sw, sh, col);
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    return g;
  };

  /** Cylinder (stilt, rope, barrel) with UVs scaled along its length. */
  RV.cylGeo = function (rTop, rBot, h, seg, us, c) {
    var g = new THREE.CylinderGeometry(rTop, rBot, h, seg || 8, 1, false).toNonIndexed();
    var uv = g.attributes.uv;
    var circ = Math.PI * (rTop + rBot);
    for (var i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (circ / (us || 1)), uv.getY(i) * (h / (us || 1)));
    }
    RV.tint(g, c);
    return g;
  };

  RV.sphereGeo = function (r, ws, hs, c) {
    var g = new THREE.SphereGeometry(r, ws || 10, hs || 8).toNonIndexed();
    RV.tint(g, c);
    return g;
  };

  /** Give a geometry a vertex-colour attribute (required before merging). */
  RV.tint = function (g, c) {
    var n = g.attributes.position.count;
    var arr = new Float32Array(n * 3);
    var r = c ? c.r : 1, gg = c ? c.g : 1, b = c ? c.b : 1;
    for (var i = 0; i < n; i++) { arr[i * 3] = r; arr[i * 3 + 1] = gg; arr[i * 3 + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };

  /** Multiply an existing vertex-colour attribute (per-vertex dirt/wear). */
  RV.shadeGeo = function (g, fn) {
    var p = g.attributes.position, c = g.attributes.color;
    if (!c) { RV.tint(g); c = g.attributes.color; }
    for (var i = 0; i < p.count; i++) {
      var m = fn(p.getX(i), p.getY(i), p.getZ(i));
      c.setXYZ(i, c.getX(i) * m, c.getY(i) * m, c.getZ(i) * m);
    }
    return g;
  };

  var _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

  /** Position / rotate a geometry in place. rot = {x,y,z} radians. */
  RV.place = function (g, x, y, z, rx, ry, rz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _m.compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
    return g;
  };

  /** Orient a geometry (built along +Y) to span from point a to point b. */
  RV.span = function (g, ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    var up = new THREE.Vector3(0, 1, 0);
    var dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    _q.setFromUnitVectors(up, dir);
    _m.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(_m);
    return g;
  };

  /**
   * Merge many geometries into one. All inputs must carry position/normal/uv;
   * missing colour attributes default to white. Sources are disposed.
   * This is what keeps the whole village at a handful of draw calls.
   */
  RV.merge = function (geos) {
    var list = [], i, g;
    for (i = 0; i < geos.length; i++) {
      g = geos[i];
      if (!g) continue;
      list.push(g.index ? g.toNonIndexed() : g);
    }
    if (!list.length) return new THREE.BufferGeometry();
    var total = 0;
    for (i = 0; i < list.length; i++) total += list[i].attributes.position.count;
    var P = new Float32Array(total * 3), N = new Float32Array(total * 3);
    var U = new Float32Array(total * 2), C = new Float32Array(total * 3);
    var o3 = 0, o2 = 0;
    for (i = 0; i < list.length; i++) {
      g = list[i];
      var cnt = g.attributes.position.count;
      P.set(g.attributes.position.array, o3);
      if (g.attributes.normal) N.set(g.attributes.normal.array, o3);
      if (g.attributes.uv) U.set(g.attributes.uv.array, o2);
      if (g.attributes.color) C.set(g.attributes.color.array, o3);
      else C.fill(1, o3, o3 + cnt * 3);
      o3 += cnt * 3; o2 += cnt * 2;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    out.setAttribute('color', new THREE.BufferAttribute(C, 3));
    out.computeBoundingSphere();
    for (i = 0; i < list.length; i++) if (list[i] !== geos[i]) list[i].dispose();
    for (i = 0; i < geos.length; i++) if (geos[i]) geos[i].dispose();
    return out;
  };

  /* ---------- misc ---------- */
  RV.now = function () { return performance.now() / 1000; };

})(window.RV);

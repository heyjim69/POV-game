/* =============================================================
   RIVER VILLAGE — textures.js
   Every texture in the game is generated procedurally at load time:
   albedo + normal + roughness for each surface. No image files,
   nothing to download, no CORS, works straight off the disk.
   ============================================================= */
(function (RV) {
  'use strict';

  var TEX = RV.tex = {};
  var _aniso = 4;
  var _all = [];

  function finish(t, srgb, repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = _aniso;
    if (srgb) t.encoding = THREE.sRGBEncoding;
    if (repeat) t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    _all.push(t);
    return t;
  }

  TEX.setAnisotropy = function (n) {
    _aniso = n;
    for (var i = 0; i < _all.length; i++) { _all[i].anisotropy = n; _all[i].needsUpdate = true; }
  };

  /* ---------------------------------------------------------------
     Core generator: one pass produces albedo, height and roughness so
     the (expensive) noise is only evaluated once per texel.
     --------------------------------------------------------------- */
  function gen(size, fn) {
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(size, size);
    var d = img.data;
    var H = new Float32Array(size * size);
    var R = new Float32Array(size * size);
    var o = { r: 0.5, g: 0.5, b: 0.5, h: 0.5, rough: 0.8 };
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        o.r = o.g = o.b = 0.5; o.h = 0.5; o.rough = 0.8;
        fn(x / size, y / size, o);
        var i = y * size + x, k = i * 4;
        d[k] = o.r * 255; d[k + 1] = o.g * 255; d[k + 2] = o.b * 255; d[k + 3] = 255;
        H[i] = o.h; R[i] = o.rough;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, H: H, R: R, size: size };
  }

  /** Sobel the height field into a tangent-space normal map. */
  function normalMap(res, strength) {
    var s = res.size, H = res.H;
    var cv = document.createElement('canvas'); cv.width = cv.height = s;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(s, s), d = img.data;
    var at = function (x, y) { return H[(((y % s) + s) % s) * s + (((x % s) + s) % s)]; };
    for (var y = 0; y < s; y++) {
      for (var x = 0; x < s; x++) {
        var dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        var dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        var nx = -dx, ny = -dy, nz = 1.0;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        var k = (y * s + x) * 4;
        d[k] = (nx / len * 0.5 + 0.5) * 255;
        d[k + 1] = (ny / len * 0.5 + 0.5) * 255;
        d[k + 2] = (nz / len * 0.5 + 0.5) * 255;
        d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(new THREE.CanvasTexture(cv), false);
  }

  function grayMap(res, arr) {
    var s = res.size;
    var cv = document.createElement('canvas'); cv.width = cv.height = s;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(s, s), d = img.data;
    for (var i = 0; i < s * s; i++) {
      var v = RV.clamp(arr[i], 0, 1) * 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return finish(new THREE.CanvasTexture(cv), false);
  }

  /** Build a complete PBR set from one generator function. */
  function pbr(size, normalStrength, fn) {
    var res = gen(size, fn);
    return {
      map: finish(new THREE.CanvasTexture(res.canvas), true),
      normalMap: normalMap(res, normalStrength),
      roughnessMap: grayMap(res, res.R)
    };
  }

  /* small helpers used inside the generators */
  function tri(x) { return Math.abs((x % 1 + 1) % 1 * 2 - 1); }
  function mixc(o, r, g, b, t) {
    o.r = RV.lerp(o.r, r, t); o.g = RV.lerp(o.g, g, t); o.b = RV.lerp(o.b, b, t);
  }

  /* =============================================================
     SURFACES
     ============================================================= */

  /** Wet dock planking. 1 texture tile == 1 metre, ~4 planks across. */
  TEX.buildDockWood = function () {
    return pbr(512, 3.2, function (u, v, o) {
      var planks = 4;
      var pf = v * planks;
      var pi = Math.floor(pf);
      var pl = pf - pi;                                  // 0..1 across the plank
      var jitter = RV.hash2(pi, 7, 91);                  // per-plank variation
      // lengthwise break so planks aren't infinitely long
      var seg = Math.floor(u * 2 + jitter * 2);
      var id = pi * 31 + seg * 7;
      var tone = RV.hash2(id, 3, 12);

      // base timber colour, varying plank to plank
      var r = RV.lerp(0.255, 0.355, tone), g = RV.lerp(0.215, 0.290, tone), b = RV.lerp(0.170, 0.222, tone);

      // grain running along the plank (u axis)
      var grain = RV.ridge(u * 26 + id, v * 90, 3, 5, 26);
      var gm = 0.72 + grain * 0.5;
      r *= gm; g *= gm; b *= gm;

      // broad weathering blotches
      var blot = RV.fbm(u * 2, v * 2, 4, 21, 2);
      var wm = 0.86 + blot * 0.26;
      r *= wm; g *= wm; b *= wm;

      var h = 0.55 + grain * 0.10 + blot * 0.05;
      var rough = 0.80 - grain * 0.12;

      // gap between planks
      var edge = Math.min(pl, 1 - pl);
      if (edge < 0.045) {
        var t = 1 - edge / 0.045;
        mixc(o, 0.06, 0.055, 0.045, t * 0.9);
        h -= t * 0.35; rough += t * 0.15;
        o.r = RV.lerp(r, o.r, t * 0.9); o.g = RV.lerp(g, o.g, t * 0.9); o.b = RV.lerp(b, o.b, t * 0.9);
      } else { o.r = r; o.g = g; o.b = b; }

      // cross-cut end seam
      var su = Math.abs(tri(u * 2 + jitter) - 1);
      if (su > 0.992) { var ts = (su - 0.992) / 0.008; mixc(o, 0.10, 0.09, 0.075, ts * 0.35); h -= ts * 0.12; }

      // damp moss creeping out of the gaps
      var moss = RV.fbm(u * 7 + 3, v * 14, 4, 55, 7);
      var mossAmt = RV.smoothstep(0.60, 0.86, moss) * RV.smoothstep(0.20, 0.05, edge);
      mixc(o, 0.115, 0.165, 0.095, mossAmt * 0.85);
      rough = RV.lerp(rough, 0.95, mossAmt);

      // standing water — the wet-shine the brief asks for
      var wet = RV.fbm(u * 2.2 + 11, v * 2.2, 4, 77, 2);
      var wetAmt = RV.smoothstep(0.58, 0.86, wet);
      o.r *= RV.lerp(1, 0.80, wetAmt); o.g *= RV.lerp(1, 0.83, wetAmt); o.b *= RV.lerp(1, 0.88, wetAmt);
      rough = RV.lerp(rough, 0.16, wetAmt);

      o.h = h; o.rough = RV.clamp(rough, 0.08, 1);
    });
  };

  /** Weathered vertical wall boarding for the houses. */
  TEX.buildHouseWood = function () {
    return pbr(512, 2.8, function (u, v, o) {
      var boards = 5;
      var bf = u * boards, bi = Math.floor(bf), bl = bf - bi;
      var tone = RV.hash2(bi, 13, 44);
      var r = RV.lerp(0.245, 0.335, tone), g = RV.lerp(0.222, 0.300, tone), b = RV.lerp(0.192, 0.252, tone);

      var grain = RV.ridge(u * 80 + bi * 3, v * 20, 3, 9, 20);
      var gm = 0.74 + grain * 0.46; r *= gm; g *= gm; b *= gm;

      // sun-bleached silvering towards the top of the boards
      var bleach = RV.smoothstep(0.25, 0.95, v) * (0.4 + RV.fbm(u * 4, v * 4, 3, 31, 4) * 0.6);
      r = RV.lerp(r, 0.335, bleach * 0.42); g = RV.lerp(g, 0.340, bleach * 0.42); b = RV.lerp(b, 0.325, bleach * 0.42);

      var rough = 0.88 - grain * 0.10;
      var h = 0.55 + grain * 0.12;

      var edge = Math.min(bl, 1 - bl);
      if (edge < 0.035) {
        var t = 1 - edge / 0.035;
        r = RV.lerp(r, 0.07, t * 0.85); g = RV.lerp(g, 0.06, t * 0.85); b = RV.lerp(b, 0.05, t * 0.85);
        h -= t * 0.30;
      }

      // rot and mould near the bottom (splash zone)
      var rot = RV.fbm(u * 6, v * 6 + 2, 4, 63, 6) * RV.smoothstep(0.55, 0.0, v);
      r = RV.lerp(r, 0.105, rot * 0.78); g = RV.lerp(g, 0.125, rot * 0.78); b = RV.lerp(b, 0.090, rot * 0.78);

      // nail heads
      var nx = Math.abs(tri(u * boards) - 0.5), ny = Math.abs(tri(v * 3) - 0.5);
      if (nx < 0.06 && ny < 0.035) { r *= 0.5; g *= 0.5; b *= 0.55; h -= 0.12; rough = 0.45; }

      o.r = r; o.g = g; o.b = b; o.h = h;
      o.rough = RV.clamp(rough + rot * 0.08, 0.1, 1);
    });
  };

  /** Thatched palm roofing — layered straw courses. */
  TEX.buildThatch = function () {
    return pbr(512, 5.5, function (u, v, o) {
      var courses = 7;
      var cf = v * courses, ci = Math.floor(cf), cl = cf - ci;
      // individual straws
      var straw = RV.hash2(Math.floor(u * 210 + ci * 17), ci, 71);
      var strand = tri(u * 210 + straw * 3);
      var base = 0.235 + straw * 0.185;
      var r = base * 1.00, g = base * 0.90, b = base * 0.615;

      var dirt = RV.fbm(u * 3, v * 3, 4, 88, 3);
      var dm = 0.70 + dirt * 0.42; r *= dm; g *= dm; b *= dm;

      // olive-green algae on the shaded lower courses
      var alg = RV.smoothstep(0.55, 0.9, RV.fbm(u * 8, v * 8 + 5, 4, 24, 8));
      r = RV.lerp(r, 0.135, alg * 0.62); g = RV.lerp(g, 0.160, alg * 0.62); b = RV.lerp(b, 0.090, alg * 0.62);

      var h = 0.45 + strand * 0.18 + straw * 0.1;
      // deep shadow line where each course overlaps the one below
      var lip = RV.smoothstep(0.0, 0.16, cl);
      var shade = RV.lerp(0.42, 1.0, lip);
      r *= shade; g *= shade; b *= shade;
      h += (1 - lip) * -0.30 + RV.smoothstep(0.75, 1.0, cl) * 0.22;

      o.r = r; o.g = g; o.b = b; o.h = h;
      o.rough = RV.clamp(0.94 - strand * 0.06, 0.6, 1);
    });
  };

  /** Twisted hemp rope for the suspension bridges. */
  TEX.buildRope = function () {
    return pbr(256, 4.0, function (u, v, o) {
      var twist = tri((v * 6 + u));         // diagonal strands
      var fib = RV.fbm(u * 40, v * 40, 3, 15, 40);
      var base = 0.235 + twist * 0.165 + fib * 0.09;
      o.r = base * 1.02; o.g = base * 0.90; o.b = base * 0.655;
      var dirt = RV.fbm(u * 4, v * 4, 3, 66, 4);
      o.r *= 0.7 + dirt * 0.5; o.g *= 0.7 + dirt * 0.5; o.b *= 0.7 + dirt * 0.5;
      o.h = 0.4 + twist * 0.45;
      o.rough = 0.95;
    });
  };

  /** Mossy river rock / cliff face. */
  TEX.buildRock = function () {
    return pbr(512, 3.6, function (u, v, o) {
      var strat = RV.ridge(u * 4, v * 9, 5, 3, 4);          // striations
      var rough2 = RV.fbm(u * 14, v * 14, 5, 41, 14);
      var base = 0.115 + strat * 0.125 + rough2 * 0.10;
      o.r = base * 0.98; o.g = base * 1.02; o.b = base * 1.00;

      // cracks
      var crack = RV.ridge(u * 7 + 2, v * 7, 3, 84, 7);
      if (crack > 0.86) { var ct = (crack - 0.86) / 0.14; o.r *= 1 - ct * 0.7; o.g *= 1 - ct * 0.7; o.b *= 1 - ct * 0.7; }

      var h = 0.4 + strat * 0.35 + rough2 * 0.2 - (crack > 0.86 ? 0.3 : 0);

      // moss gathers in the low, damp areas
      var moss = RV.fbm(u * 5 + 7, v * 5, 4, 19, 5) * (0.5 + (1 - strat) * 0.9);
      var mAmt = RV.smoothstep(0.52, 0.80, moss);
      o.r = RV.lerp(o.r, 0.085, mAmt); o.g = RV.lerp(o.g, 0.135, mAmt); o.b = RV.lerp(o.b, 0.070, mAmt);
      h += mAmt * 0.10;

      var wet = RV.smoothstep(0.6, 0.85, RV.fbm(u * 3, v * 3 + 9, 3, 52, 3));
      o.r *= RV.lerp(1, 0.7, wet); o.g *= RV.lerp(1, 0.72, wet); o.b *= RV.lerp(1, 0.78, wet);

      o.h = h;
      o.rough = RV.clamp(RV.lerp(0.9, 0.3, wet) + mAmt * 0.1, 0.15, 1);
    });
  };

  /** Wet dirt path with pebbles. */
  TEX.buildDirt = function () {
    return pbr(256, 2.6, function (u, v, o) {
      var n = RV.fbm(u * 8, v * 8, 5, 27, 8);
      var base = 0.16 + n * 0.20;
      o.r = base * 1.15; o.g = base * 0.94; o.b = base * 0.70;
      // pebbles
      var pc = RV.noise2(u * 22, v * 22, 61, 22);
      if (pc > 0.78) { var t = (pc - 0.78) / 0.22; o.r = RV.lerp(o.r, 0.30, t); o.g = RV.lerp(o.g, 0.30, t); o.b = RV.lerp(o.b, 0.29, t); }
      var moss = RV.smoothstep(0.62, 0.85, RV.fbm(u * 6 + 4, v * 6, 4, 35, 6));
      o.r = RV.lerp(o.r, 0.12, moss); o.g = RV.lerp(o.g, 0.20, moss); o.b = RV.lerp(o.b, 0.09, moss);
      o.h = 0.45 + n * 0.3 + (pc > 0.78 ? 0.22 : 0);
      o.rough = 0.9 - (pc > 0.78 ? 0.25 : 0);
    });
  };

  /** Blued steel — rifle receiver and barrel. */
  TEX.buildGunMetal = function () {
    return pbr(512, 1.4, function (u, v, o) {
      var base = 0.215 + RV.fbm(u * 30, v * 30, 3, 12, 30) * 0.075;
      o.r = base; o.g = base * 1.03; o.b = base * 1.14;
      // machining lines
      var mach = tri(v * 200) * 0.055;
      o.r += mach; o.g += mach; o.b += mach;
      var rough = 0.42 + RV.fbm(u * 12, v * 12, 3, 90, 12) * 0.18;
      // scratches down to bright metal
      var sc = RV.ridge(u * 3 + v * 11, v * 2, 3, 44, 0);
      if (sc > 0.92) { var t = (sc - 0.92) / 0.08; o.r += t * 0.28; o.g += t * 0.28; o.b += t * 0.30; rough -= t * 0.22; }
      // wear on the edges / holster rub
      var wear = RV.smoothstep(0.6, 0.9, RV.fbm(u * 5, v * 5 + 3, 4, 8, 5));
      o.r += wear * 0.14; o.g += wear * 0.14; o.b += wear * 0.15; rough -= wear * 0.12;
      o.h = 0.5 + mach * 2 + (sc > 0.92 ? -0.1 : 0);
      o.rough = RV.clamp(rough, 0.12, 0.9);
    });
  };

  /** Orange-red laminate stock and handguard. */
  TEX.buildGunWood = function () {
    return pbr(512, 2.0, function (u, v, o) {
      var grain = RV.ridge(u * 8, v * 60, 4, 6, 8);
      var lam = tri(v * 7) * 0.18;                       // laminate layers
      var base = 0.175 + grain * 0.215 + lam * 0.7;
      o.r = base * 1.26; o.g = base * 0.70; o.b = base * 0.40;
      var dirt = RV.fbm(u * 6, v * 6, 3, 71, 6);
      var dm = 0.82 + dirt * 0.3; o.r *= dm; o.g *= dm; o.b *= dm;
      // dings
      var d = RV.noise2(u * 18, v * 18, 33, 18);
      var ding = d > 0.86 ? (d - 0.86) / 0.14 : 0;
      o.r *= 1 - ding * 0.4; o.g *= 1 - ding * 0.4; o.b *= 1 - ding * 0.4;
      o.h = 0.55 + grain * 0.16 - ding * 0.4;
      o.rough = RV.clamp(0.40 + grain * 0.16 + ding * 0.3, 0.2, 0.95);
    });
  };

  /** Filthy tattered cloth for the villagers' trousers. */
  TEX.buildCloth = function () {
    return pbr(256, 2.2, function (u, v, o) {
      var weave = (tri(u * 90) * 0.5 + tri(v * 90) * 0.5);
      var n = RV.fbm(u * 7, v * 7, 4, 23, 7);
      var base = 0.16 + weave * 0.08 + n * 0.14;
      o.r = base * 1.05; o.g = base * 0.98; o.b = base * 0.85;
      var stain = RV.smoothstep(0.55, 0.85, RV.fbm(u * 4 + 3, v * 4, 4, 82, 4));
      o.r = RV.lerp(o.r, 0.10, stain * 0.8); o.g = RV.lerp(o.g, 0.09, stain * 0.8); o.b = RV.lerp(o.b, 0.07, stain * 0.8);
      o.h = 0.5 + weave * 0.3;
      o.rough = 0.95;
    });
  };

  /**
   * Skin + cloth in one atlas: skin occupies u < 0.5, tattered cloth
   * u >= 0.5. Lets every infected villager render with one material.
   */
  TEX.buildInfectedAtlas = function () {
    return pbr(512, 1.9, function (u, v, o) {
      if (u < 0.5) {
        var su = u * 2.0;
        var n = RV.fbm(su * 10, v * 10, 4, 5, 10);
        var base = 0.275 + n * 0.165;
        o.r = base * 1.02; o.g = base * 1.0; o.b = base * 0.94;
        var bl = RV.smoothstep(0.52, 0.80, RV.fbm(su * 5 + 2, v * 5, 4, 47, 5));
        o.r = RV.lerp(o.r, 0.26, bl * 0.8); o.g = RV.lerp(o.g, 0.30, bl * 0.8); o.b = RV.lerp(o.b, 0.25, bl * 0.8);
        var vein = RV.ridge(su * 6, v * 6, 4, 93, 6);
        if (vein > 0.88) { var t = (vein - 0.88) / 0.12; o.r = RV.lerp(o.r, 0.16, t); o.g = RV.lerp(o.g, 0.14, t); o.b = RV.lerp(o.b, 0.18, t); }
        var gr = RV.smoothstep(0.70, 0.92, RV.fbm(su * 8 + 6, v * 8, 4, 66, 8));
        o.r = RV.lerp(o.r, 0.22, gr * 0.7); o.g = RV.lerp(o.g, 0.10, gr * 0.7); o.b = RV.lerp(o.b, 0.08, gr * 0.7);
        o.h = 0.5 + n * 0.25 - (vein > 0.88 ? 0.15 : 0);
        o.rough = RV.clamp(0.62 + n * 0.2, 0.4, 0.95);
      } else {
        var cu = (u - 0.5) * 2.0;
        var weave = (tri(cu * 90) * 0.5 + tri(v * 90) * 0.5);
        var n2 = RV.fbm(cu * 7, v * 7, 4, 23, 7);
        var b2 = 0.085 + weave * 0.045 + n2 * 0.085;
        o.r = b2 * 1.08; o.g = b2 * 1.00; o.b = b2 * 0.84;
        var stain = RV.smoothstep(0.55, 0.85, RV.fbm(cu * 4 + 3, v * 4, 4, 82, 4));
        o.r = RV.lerp(o.r, 0.10, stain * 0.8); o.g = RV.lerp(o.g, 0.09, stain * 0.8); o.b = RV.lerp(o.b, 0.07, stain * 0.8);
        o.h = 0.5 + weave * 0.3;
        o.rough = 0.95;
      }
    });
  };

  /* ---------------------------------------------------------------
     RGBA generators — cut-out foliage, foam, sprites
     --------------------------------------------------------------- */
  function genRGBA(size, fn) {
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    var img = ctx.createImageData(size, size), d = img.data;
    var o = { r: 0, g: 0, b: 0, a: 0 };
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
      o.r = o.g = o.b = 0; o.a = 0;
      fn(x / size, y / size, o);
      var k = (y * size + x) * 4;
      d[k] = o.r * 255; d[k + 1] = o.g * 255; d[k + 2] = o.b * 255; d[k + 3] = o.a * 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /** A cluster of jungle leaves on a transparent card. */
  TEX.buildLeaf = function () {
    var s = 256;
    var cv = document.createElement('canvas'); cv.width = cv.height = s;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, s, s);
    RV.reseed(4242);
    // draw a fan of tapered fronds from the bottom centre
    for (var i = 0; i < 18; i++) {
      var ang = (-Math.PI / 2) + RV.randRange(-1.15, 1.15);
      var len = RV.randRange(0.42, 0.96) * s;
      var wid = RV.randRange(0.030, 0.075) * s;
      var x0 = s * 0.5 + RV.randRange(-0.14, 0.14) * s, y0 = s * 0.99;
      var cx = x0 + Math.cos(ang) * len * 0.55, cy = y0 + Math.sin(ang) * len * 0.55;
      var x1 = x0 + Math.cos(ang + RV.randRange(-0.35, 0.35)) * len;
      var y1 = y0 + Math.sin(ang + RV.randRange(-0.35, 0.35)) * len;
      var dark = RV.randRange(0.35, 1.0);
      var gY = Math.round(RV.lerp(38, 96, dark));
      ctx.strokeStyle = 'rgb(' + Math.round(gY * 0.55) + ',' + gY + ',' + Math.round(gY * 0.48) + ')';
      ctx.lineCap = 'round';
      // taper by stroking a few times with shrinking width
      for (var t = 0; t < 5; t++) {
        var f = t / 5;
        ctx.lineWidth = wid * (1 - f * 0.85);
        ctx.beginPath();
        ctx.moveTo(RV.lerp(x0, x1, f * 0.0), RV.lerp(y0, y1, f * 0.0));
        ctx.quadraticCurveTo(cx, cy, RV.lerp(x0, x1, 1 - f * 0.12), RV.lerp(y0, y1, 1 - f * 0.12));
        ctx.stroke();
      }
    }
    var t2 = finish(new THREE.CanvasTexture(cv), true);
    t2.wrapS = t2.wrapT = THREE.ClampToEdgeWrapping;
    return t2;
  };

  /** Animated river foam / whitewater. */
  TEX.buildFoam = function () {
    var cv = genRGBA(256, function (u, v, o) {
      // low frequency across the flow, high along it => streaky foam
      var n = RV.fbm(u * 9, v * 3, 5, 13, 3);
      var n2 = RV.fbm(u * 20 + 3, v * 7, 4, 57, 7);
      var a = RV.smoothstep(0.44, 0.80, n * 0.68 + n2 * 0.42);
      o.r = 0.92; o.g = 0.97; o.b = 0.96; o.a = a;
    });
    return finish(new THREE.CanvasTexture(cv), true);
  };

  /** Two-scale wave normal map for the water surface. */
  TEX.buildWaterNormal = function () {
    var res = gen(256, function (u, v, o) {
      var h = RV.fbm(u * 4, v * 4, 4, 101, 4) * 0.6 + RV.fbm(u * 11, v * 11, 3, 202, 11) * 0.4;
      o.r = o.g = o.b = 0.5; o.h = h; o.rough = 0.1;
    });
    return normalMap(res, 2.2);
  };

  /* ---------------------------------------------------------------
     Sprites (particles, decals, HUD-ish billboards)
     --------------------------------------------------------------- */
  function spriteCanvas(size, draw) {
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    draw(ctx, size);
    var t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    _all.push(t);
    return t;
  }

  TEX.buildSprites = function () {
    var S = {};

    // soft round puff — smoke, mist, blood mist
    S.soft = spriteCanvas(128, function (c, s) {
      var g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
    });

    // billowing smoke puff with internal structure
    S.smoke = spriteCanvas(128, function (c, s) {
      var img = c.createImageData(s, s), d = img.data;
      for (var y = 0; y < s; y++) for (var x = 0; x < s; x++) {
        var u = x / s, v = y / s;
        var dx = u - 0.5, dy = v - 0.5;
        var r = Math.sqrt(dx * dx + dy * dy) * 2;
        var n = RV.fbm(u * 4, v * 4, 4, 3, 0);
        var a = RV.clamp((1 - r) * 1.4, 0, 1);
        a = RV.clamp(a * (0.45 + n * 0.9) - 0.06, 0, 1);
        a = a * a;
        var k = (y * s + x) * 4;
        d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = a * 255;
      }
      c.putImageData(img, 0, 0);
    });

    // hot muzzle flash star
    S.flash = spriteCanvas(128, function (c, s) {
      c.translate(s / 2, s / 2);
      var g = c.createRadialGradient(0, 0, 0, 0, 0, s / 2);
      g.addColorStop(0, 'rgba(255,255,240,1)');
      g.addColorStop(0.18, 'rgba(255,225,150,0.95)');
      g.addColorStop(0.45, 'rgba(255,150,40,0.45)');
      g.addColorStop(1, 'rgba(255,90,10,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(0, 0, s / 2, 0, Math.PI * 2); c.fill();
      // star spikes
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgba(255,235,190,0.85)';
      for (var i = 0; i < 6; i++) {
        c.rotate(Math.PI / 3);
        c.beginPath(); c.moveTo(0, 0);
        c.lineTo(s * 0.46, s * 0.035); c.lineTo(s * 0.46, -s * 0.035); c.closePath(); c.fill();
      }
    });

    // impact spark streak
    S.spark = spriteCanvas(64, function (c, s) {
      var g = c.createLinearGradient(0, s / 2, s, s / 2);
      g.addColorStop(0, 'rgba(255,255,220,0)');
      g.addColorStop(0.5, 'rgba(255,235,170,1)');
      g.addColorStop(1, 'rgba(255,120,20,0)');
      c.fillStyle = g; c.fillRect(0, s * 0.42, s, s * 0.16);
    });

    // blood droplet / splatter decal
    S.blood = spriteCanvas(128, function (c, s) {
      c.clearRect(0, 0, s, s);
      RV.reseed(777);
      c.fillStyle = 'rgba(78,10,8,0.92)';
      c.beginPath();
      for (var i = 0; i <= 26; i++) {
        var a = i / 26 * Math.PI * 2;
        var r = s * 0.32 * (0.7 + RV.rand() * 0.55);
        var x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.closePath(); c.fill();
      for (var j = 0; j < 20; j++) {
        var aa = RV.rand() * Math.PI * 2, rr = s * (0.30 + RV.rand() * 0.19);
        c.beginPath();
        c.arc(s / 2 + Math.cos(aa) * rr, s / 2 + Math.sin(aa) * rr, s * (0.012 + RV.rand() * 0.035), 0, Math.PI * 2);
        c.fill();
      }
    });

    // bullet hole decal
    S.hole = spriteCanvas(64, function (c, s) {
      c.clearRect(0, 0, s, s);
      var g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(8,7,6,0.95)');
      g.addColorStop(0.35, 'rgba(20,17,14,0.7)');
      g.addColorStop(0.65, 'rgba(40,34,28,0.28)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); c.fill();
    });

    // expanding ripple ring on the water
    S.ring = spriteCanvas(128, function (c, s) {
      c.clearRect(0, 0, s, s);
      c.strokeStyle = 'rgba(230,255,250,0.85)';
      c.lineWidth = s * 0.045;
      c.beginPath(); c.arc(s / 2, s / 2, s * 0.40, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = 'rgba(200,240,235,0.35)';
      c.lineWidth = s * 0.02;
      c.beginPath(); c.arc(s / 2, s / 2, s * 0.30, 0, Math.PI * 2); c.stroke();
    });

    // light shaft gradient (god rays)
    S.shaft = spriteCanvas(128, function (c, s) {
      var g = c.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
      // soften the horizontal edges
      c.globalCompositeOperation = 'destination-in';
      var h = c.createLinearGradient(0, 0, s, 0);
      h.addColorStop(0, 'rgba(0,0,0,0)');
      h.addColorStop(0.5, 'rgba(0,0,0,1)');
      h.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = h; c.fillRect(0, 0, s, s);
    });

    return S;
  };

  /* ---------------------------------------------------------------
     Distant misty mountain / treeline silhouette bands
     --------------------------------------------------------------- */
  TEX.buildRidgeline = function (seed, roughness, treeAmt) {
    var w = 1024, h = 256;
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var x = 0; x <= w; x += 2) {
      var u = x / w;
      var e = RV.fbm(u * 3, 0.5, 5, seed, 3) * roughness + RV.fbm(u * 9, 1.5, 4, seed + 5, 9) * roughness * 0.35;
      var y = h - (0.18 + e * 0.72) * h;
      // spiky tree canopy on the crest
      if (treeAmt > 0) {
        y -= Math.abs(Math.sin(u * 240 + RV.noise2(u * 60, 0, seed, 0) * 6)) * treeAmt * h * 0.05;
      }
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    var t = new THREE.CanvasTexture(cv);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.encoding = THREE.sRGBEncoding;
    t.needsUpdate = true;
    _all.push(t);
    return t;
  };

})(window.RV);

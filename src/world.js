/* =============================================================
   RIVER VILLAGE — world.js
   Builds the whole village procedurally: stilt houses, plank decks,
   rope suspension bridges, cliffs, boulders, foliage and props.
   Geometry is merged per-material so the entire village renders in
   roughly a dozen draw calls.
   ============================================================= */
(function (RV) {
  'use strict';

  var W = RV.world = {};
  var C = RV.col3;

  // buckets: geometry accumulates here, then gets merged once
  var B = {};
  function bucket(name) { if (!B[name]) B[name] = []; return B[name]; }
  function push(name, geo) { bucket(name).push(geo); }

  function woodTint(v) {
    var k = 0.82 + RV.rand() * 0.34;
    return new THREE.Color(k * v, k * v, k * v);
  }

  W.data = {
    playerStart: new THREE.Vector3(0, 2.35, 36),
    playerYaw: 0,                // looking down the river towards the village
    spawnPoints: [],
    ammoSpots: [],
    healthSpots: [],
    lanterns: [],
    boats: [],
    godrays: []
  };

  /* =============================================================
     PRIMITIVE BUILDERS
     ============================================================= */

  /** Plank deck slab (+ collision). */
  function deck(cx, cz, w, d, y, mat) {
    var th = 0.18;
    var g = RV.boxGeo(w, th, d, 1.0, woodTint(1));
    RV.place(g, cx, y - th / 2, cz);
    // broad damp/dry variation across the deck breaks up the texture repeat
    RV.shadeGeo(g, function (x, y2, z) {
      return 0.72 + RV.fbm(x * 0.045 + 5, z * 0.045, 3, 12, 0) * 0.55;
    });
    push(mat || 'dock', g);
    C.add(cx - w / 2, y - th, cz - d / 2, cx + w / 2, y, cz + d / 2, 'wood');

    // a few proud planks so the silhouette isn't a perfect slab
    var n = Math.max(1, Math.floor((w * d) / 26));
    for (var i = 0; i < n; i++) {
      var pw = RV.randRange(0.22, 0.3);
      var pl = RV.randRange(1.2, Math.min(d * 0.7, 3.4));
      var g2 = RV.boxGeo(pw, 0.05, pl, 1.0, woodTint(0.95));
      RV.place(g2, cx + RV.randRange(-w / 2 + 0.4, w / 2 - 0.4), y + 0.025,
        cz + RV.randRange(-d / 2 + pl / 2, d / 2 - pl / 2));
      push(mat || 'dock', g2);
    }
  }

  /** Stilt / post from the riverbed (or given base) up to yTop. */
  function post(x, z, yTop, r, baseY) {
    var b = baseY !== undefined ? baseY : RV.water.bedY(x, z) - 0.3;
    var h = yTop - b;
    if (h <= 0.1) return;
    var g = RV.cylGeo(r, r * 1.16, h, 7, 0.8, woodTint(0.86));
    RV.place(g, x, b + h / 2, z, RV.randRange(-0.03, 0.03), RV.rand() * 6.28, RV.randRange(-0.03, 0.03));
    push('house', g);
    C.add(x - r, b, z - r, x + r, yTop, z + r, 'wood', true);
  }

  /** Row of stilts under a deck, plus cross bracing. */
  function stiltsUnder(cx, cz, w, d, y) {
    var stepX = Math.max(2.6, w / Math.max(1, Math.round(w / 3.2)));
    var stepZ = Math.max(2.6, d / Math.max(1, Math.round(d / 3.2)));
    var prev = null;
    for (var x = cx - w / 2 + 0.5; x <= cx + w / 2 - 0.4; x += stepX) {
      for (var z = cz - d / 2 + 0.5; z <= cz + d / 2 - 0.4; z += stepZ) {
        post(x, z, y - 0.14, RV.randRange(0.10, 0.14));
        if (prev && RV.chance(0.45)) {
          var g = RV.boxGeo(0.09, 0.09, 1, 1, woodTint(0.8));
          var y1 = RV.water.bedY(prev.x, prev.z) + RV.randRange(0.8, 1.6);
          RV.span(g, prev.x, y1, prev.z, x, y - RV.randRange(0.3, 1.0), z);
          push('house', g);
        }
        prev = { x: x, z: z };
      }
    }
  }

  /** Low rope-and-post railing along one edge. */
  function railing(x0, z0, x1, z1, y, height) {
    height = height || 0.95;
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.sqrt(dx * dx + dz * dz);
    var n = Math.max(2, Math.round(len / 1.8));
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var px = x0 + dx * t, pz = z0 + dz * t;
      var g = RV.boxGeo(0.09, height, 0.09, 0.6, woodTint(0.9));
      RV.place(g, px, y + height / 2, pz, RV.randRange(-0.05, 0.05), 0, RV.randRange(-0.05, 0.05));
      push('house', g);
    }
    // two rope courses with a little sag between posts
    for (var k = 0; k < 2; k++) {
      var ry = y + height * (k ? 0.55 : 0.98);
      var segs = n * 3;
      for (var j = 0; j < segs; j++) {
        var t0 = j / segs, t1 = (j + 1) / segs;
        var sag = function (t) {
          var local = (t * n) % 1;
          return -Math.sin(local * Math.PI) * 0.045;
        };
        var g2 = RV.cylGeo(0.022, 0.022, 1, 5, 0.35, woodTint(1));
        RV.span(g2, x0 + dx * t0, ry + sag(t0), z0 + dz * t0, x0 + dx * t1, ry + sag(t1), z0 + dz * t1);
        push('rope', g2);
      }
    }
    // knee-height lip so you don't slide off by accident (jumpable)
    var pad = 0.14;
    C.add(Math.min(x0, x1) - pad, y, Math.min(z0, z1) - pad,
      Math.max(x0, x1) + pad, y + 0.36, Math.max(z0, z1) + pad, 'wood', true);
  }

  /** Axis-aligned walkway between two points. */
  function walkway(x0, z0, x1, z1, width, y, rails) {
    var cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    var alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    var w = alongX ? Math.abs(x1 - x0) : width;
    var d = alongX ? width : Math.abs(z1 - z0);
    deck(cx, cz, w, d, y);
    stiltsUnder(cx, cz, w, d, y);
    if (rails !== false) {
      if (alongX) {
        railing(x0, cz - width / 2, x1, cz - width / 2, y);
        railing(x0, cz + width / 2, x1, cz + width / 2, y);
      } else {
        railing(cx - width / 2, z0, cx - width / 2, z1, y);
        railing(cx + width / 2, z0, cx + width / 2, z1, y);
      }
    }
  }

  /** Wall panel with rectangular openings cut out of it. */
  function wall(cx, cz, len, height, thick, alongX, y, openings) {
    openings = openings || [];

    // emit one solid slab of wall between two points along its length
    function emit(a, b, y0, y1) {
      if (b - a < 0.02 || y1 - y0 < 0.02) return;
      var w = alongX ? (b - a) : thick;
      var d = alongX ? thick : (b - a);
      var px = alongX ? cx + (a + b) / 2 : cx;
      var pz = alongX ? cz : cz + (a + b) / 2;
      var g = RV.boxGeo(w, y1 - y0, d, 1.0, woodTint(1));
      RV.place(g, px, y + (y0 + y1) / 2, pz);
      push('house', g);
      C.add(px - w / 2, y + y0, pz - d / 2, px + w / 2, y + y1, pz + d / 2, 'wood', true);
    }

    // sort openings and emit the solid pieces between/above/below them
    var ops = openings.slice().sort(function (p, q) { return p.at - q.at; });
    var cursor = -len / 2;
    for (var k = 0; k < ops.length; k++) {
      var o = ops[k];
      var oa = o.at - o.w / 2, ob = o.at + o.w / 2;
      emit(cursor, oa, 0, height);
      if (o.y0 > 0) emit(oa, ob, 0, o.y0);
      if (o.y1 < height) emit(oa, ob, o.y1, height);
      cursor = ob;
    }
    emit(cursor, len / 2, 0, height);
  }

  /** Gabled thatch roof over a rectangular footprint. */
  function roof(cx, cz, w, d, y, pitch, alongX) {
    var over = 0.55;
    var W2 = (alongX ? d : w) / 2 + over;
    var L = (alongX ? w : d) + over * 2;
    var rise = W2 * pitch;
    var slope = Math.sqrt(W2 * W2 + rise * rise);
    var ang = Math.atan2(rise, W2);
    var th = 0.30;

    for (var s = -1; s <= 1; s += 2) {
      // one slab per pitch, rotated down from the ridge
      var g = RV.boxGeo(alongX ? L : slope, th, alongX ? slope : L, 1.1, woodTint(1));
      var offA = (W2 / 2) * s;
      var offY = y + rise / 2;
      if (alongX) RV.place(g, cx, offY, cz + offA, -s * ang, 0, 0);
      else RV.place(g, cx + offA, offY, cz, 0, 0, s * ang);
      push('thatch', g);
    }
    // ridge beam
    var rg = RV.boxGeo(alongX ? L : 0.22, 0.22, alongX ? 0.22 : L, 0.6, woodTint(0.8));
    RV.place(rg, cx, y + rise + 0.06, cz);
    push('house', rg);

    // gable ends (stack of boards approximating the triangle)
    for (var e = -1; e <= 1; e += 2) {
      var steps = 5;
      for (var i = 0; i < steps; i++) {
        var t = i / steps;
        var hw = W2 * (1 - t) * 0.94;
        var hh = rise / steps;
        var gg = RV.boxGeo(alongX ? 0.12 : hw * 2, hh, alongX ? hw * 2 : 0.12, 0.9, woodTint(0.92));
        var ex = alongX ? cx + e * (L / 2 - 0.1) : cx;
        var ez = alongX ? cz : cz + e * (L / 2 - 0.1);
        RV.place(gg, ex, y + hh / 2 + i * hh, ez);
        push('house', gg);
      }
    }
    // coarse collision volume for the roof
    var rw = alongX ? L : W2 * 2, rd = alongX ? W2 * 2 : L;
    C.add(cx - rw / 2, y, cz - rd / 2, cx + rw / 2, y + rise + 0.2, cz + rd / 2, 'thatch', true);
  }

  /** A stilt house you can walk into. */
  function house(opts) {
    var cx = opts.x, cz = opts.z, y = opts.y;
    var w = opts.w, d = opts.d, h = opts.h || 2.7;
    var alongX = opts.alongX !== false;
    var th = 0.14;

    // platform: floor plus a veranda strip on the entry side
    var pw = w + (opts.porch ? 0 : 0.8), pd = d + 1.6;
    deck(cx, cz + (opts.porchZ || 0), pw, pd, y);
    stiltsUnder(cx, cz, pw, pd, y);

    var doorAt = opts.doorAt === undefined ? 0 : opts.doorAt;
    // walls (door on the +Z side, windows elsewhere)
    wall(cx, cz + d / 2, w, h, th, true, y, [{ at: doorAt, w: 1.15, y0: 0, y1: 2.15 }]);
    wall(cx, cz - d / 2, w, h, th, true, y, [{ at: RV.randRange(-w * 0.2, w * 0.2), w: 1.0, y0: 1.05, y1: 1.95 }]);
    wall(cx - w / 2, cz, d, h, th, false, y, [{ at: RV.randRange(-d * 0.2, d * 0.2), w: 1.2, y0: 1.05, y1: 1.95 }]);
    wall(cx + w / 2, cz, d, h, th, false, y, opts.sideDoor
      ? [{ at: 0, w: 1.15, y0: 0, y1: 2.15 }]
      : [{ at: RV.randRange(-d * 0.2, d * 0.2), w: 1.0, y0: 1.10, y1: 1.90 }]);

    // corner posts
    for (var sx = -1; sx <= 1; sx += 2) for (var sz = -1; sz <= 1; sz += 2) {
      var g = RV.boxGeo(0.16, h + 0.25, 0.16, 0.8, woodTint(0.85));
      RV.place(g, cx + sx * w / 2, y + (h + 0.25) / 2, cz + sz * d / 2);
      push('house', g);
    }

    roof(cx, cz, w, d, y + h, 0.62, alongX);

    // --- interior dressing ---
    if (RV.chance(0.8)) crate(cx + RV.randRange(-w / 2 + 0.7, w / 2 - 0.7), y, cz + RV.randRange(-d / 2 + 0.7, d / 2 - 0.7));
    if (RV.chance(0.6)) barrel(cx + RV.randRange(-w / 2 + 0.6, w / 2 - 0.6), y, cz + RV.randRange(-d / 2 + 0.6, d / 2 - 0.6));
    // sleeping mat
    var mg = RV.boxGeo(1.7, 0.06, 0.9, 1.0, RV.col(0x6d6350));
    RV.place(mg, cx + RV.randRange(-0.6, 0.6), y + 0.03, cz + RV.randRange(-0.6, 0.6), 0, RV.rand() * 3, 0);
    push('house', mg);

    // veranda railing on the door side, with a gap for the doorway
    railing(cx - w / 2, cz + pd / 2 - 0.1, cx + doorAt - 0.9, cz + pd / 2 - 0.1, y);
    railing(cx + doorAt + 0.9, cz + pd / 2 - 0.1, cx + w / 2, cz + pd / 2 - 0.1, y);

    // loot lives inside and on the veranda
    W.data.ammoSpots.push(new THREE.Vector3(cx + RV.randRange(-w / 3, w / 3), y + 0.25, cz + RV.randRange(-d / 3, d / 3)));
    if (RV.chance(0.45)) W.data.healthSpots.push(new THREE.Vector3(cx + RV.randRange(-w / 3, w / 3), y + 0.25, cz - d / 4));
    W.data.spawnPoints.push(new THREE.Vector3(cx, y + 0.1, cz + pd / 2 - 0.6));

    // hanging cloth in the doorway
    var cg = RV.boxGeo(1.0, 1.5, 0.03, 1.0, RV.col(0x7a6f5c));
    RV.place(cg, cx + doorAt, y + h - 0.75, cz + d / 2 + 0.02, 0, 0, RV.randRange(-0.05, 0.05));
    push('cloth', cg);
  }

  /* ---------- props ---------- */
  function crate(x, y, z) {
    var s = RV.randRange(0.55, 0.85);
    var g = RV.boxGeo(s, s * 0.85, s * 0.9, 0.45, woodTint(1.05));
    RV.place(g, x, y + s * 0.425, z, 0, RV.rand() * 3.14, 0);
    push('house', g);
    C.addBox(x, y + s * 0.425, z, s, s * 0.85, s * 0.9, 'wood');
  }

  function barrel(x, y, z) {
    var h = RV.randRange(0.7, 0.95), r = RV.randRange(0.26, 0.34);
    var g = RV.cylGeo(r, r * 1.08, h, 10, 0.5, woodTint(0.95));
    RV.place(g, x, y + h / 2, z);
    push('house', g);
    // iron hoops
    for (var i = 0; i < 2; i++) {
      var hg = RV.cylGeo(r * 1.06, r * 1.06, 0.055, 10, 0.4, RV.col(0x3a352e));
      RV.place(hg, x, y + h * (i ? 0.76 : 0.24), z);
      push('house', hg);
    }
    C.addBox(x, y + h / 2, z, r * 2, h, r * 2, 'wood');
  }

  function boulder(x, y, z, s) {
    var g = RV.sphereGeo(s, 8, 6, woodTint(1));
    // squash and jitter so it isn't an obvious sphere
    g.scale(RV.randRange(0.8, 1.3), RV.randRange(0.55, 0.85), RV.randRange(0.8, 1.3));
    var pos = g.attributes.position;
    for (var i = 0; i < pos.count; i++) {
      var n = RV.fbm(pos.getX(i) * 1.2 + 10, pos.getZ(i) * 1.2, 3, 7, 0);
      var k = 0.82 + n * 0.4;
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    RV.place(g, x, y, z, RV.rand(), RV.rand() * 6, RV.rand());
    push('rock', g);
    C.addBox(x, y, z, s * 1.6, s * 1.2, s * 1.6, 'rock');
  }

  /** Wooden staircase (each step is its own collider). */
  function stairs(x, z, y0, y1, dirX, dirZ, width, run) {
    var steps = Math.max(2, Math.round((y1 - y0) / 0.26));
    var rise = (y1 - y0) / steps;
    var tread = run / steps;
    for (var i = 0; i < steps; i++) {
      var px = x + dirX * (i + 0.5) * tread;
      var pz = z + dirZ * (i + 0.5) * tread;
      var sy = y0 + (i + 1) * rise;
      var w = dirX ? tread * 1.02 : width;
      var d = dirX ? width : tread * 1.02;
      var g = RV.boxGeo(w, 0.12, d, 0.8, woodTint(1));
      RV.place(g, px, sy - 0.06, pz);
      push('dock', g);
      C.add(px - w / 2, sy - 0.24, pz - d / 2, px + w / 2, sy, pz + d / 2, 'wood');
      // stringer support
      if (i % 2 === 0) post(px, pz, sy - 0.12, 0.08, RV.water.bedY(px, pz) - 0.2);
    }
  }

  /* =============================================================
     ROPE SUSPENSION BRIDGE — the set-piece
     ============================================================= */
  function ropeBridge(x0, y0, z0, x1, y1, z1, width, sag) {
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.sqrt(dx * dx + dz * dz);
    var alongZ = Math.abs(dz) > Math.abs(dx);
    var planks = Math.max(8, Math.round(len / 0.32));

    function pointAt(t) {
      return {
        x: x0 + dx * t,
        y: RV.lerp(y0, y1, t) - Math.sin(t * Math.PI) * sag,
        z: z0 + dz * t
      };
    }

    // --- deck planks (each one is a collider) ---
    for (var i = 0; i < planks; i++) {
      var t = (i + 0.5) / planks;
      var p = pointAt(t);
      var pw = alongZ ? width : 0.26;
      var pd = alongZ ? 0.26 : width;
      var missing = RV.chance(0.045) && i > 3 && i < planks - 4;   // a couple of broken boards
      if (missing) continue;
      var g = RV.boxGeo(pw, 0.08, pd, 0.7, woodTint(0.95));
      RV.place(g, p.x, p.y - 0.04, p.z, alongZ ? RV.randRange(-0.03, 0.03) : 0, 0, alongZ ? 0 : RV.randRange(-0.03, 0.03));
      push('dock', g);
      C.add(p.x - pw / 2, p.y - 0.12, p.z - pd / 2, p.x + pw / 2, p.y, p.z + pd / 2, 'wood');
    }

    // --- main cables (deck level + handrail level) and the hangers ---
    var segs = planks;
    for (var side = -1; side <= 1; side += 2) {
      var ox = alongZ ? side * width / 2 : 0;
      var oz = alongZ ? 0 : side * width / 2;
      for (var lvl = 0; lvl < 2; lvl++) {
        var hOff = lvl === 0 ? -0.06 : 1.02;
        var extraSag = lvl === 0 ? 0 : -0.12;
        for (var s = 0; s < segs; s++) {
          var ta = s / segs, tb = (s + 1) / segs;
          var pa = pointAt(ta), pb = pointAt(tb);
          var g2 = RV.cylGeo(lvl ? 0.035 : 0.045, lvl ? 0.035 : 0.045, 1, 5, 0.4, woodTint(1));
          RV.span(g2, pa.x + ox, pa.y + hOff + extraSag * Math.sin(ta * Math.PI),
            pa.z + oz, pb.x + ox, pb.y + hOff + extraSag * Math.sin(tb * Math.PI), pb.z + oz);
          push('rope', g2);
        }
      }
      // vertical hangers tying the handrail down to the deck
      for (var hIdx = 0; hIdx <= 14; hIdx++) {
        var th = hIdx / 14;
        var ph = pointAt(th);
        var g3 = RV.cylGeo(0.018, 0.018, 1.08, 4, 0.4, woodTint(1));
        RV.place(g3, ph.x + ox, ph.y + 0.48, ph.z + oz);
        push('rope', g3);
      }
      // edge lip: keeps you on the bridge unless you deliberately jump off
      C.add(
        alongZ ? x0 + ox - 0.10 : Math.min(x0, x1),
        Math.min(y0, y1) - sag - 0.2,
        alongZ ? Math.min(z0, z1) : z0 + oz - 0.10,
        alongZ ? x0 + ox + 0.10 : Math.max(x0, x1),
        Math.max(y0, y1) + 0.34,
        alongZ ? Math.max(z0, z1) : z0 + oz + 0.10,
        'wood', true);
    }

    // --- towers at each end ---
    [[x0, y0, z0], [x1, y1, z1]].forEach(function (e) {
      for (var sx = -1; sx <= 1; sx += 2) {
        var px = alongZ ? e[0] + sx * width / 2 : e[0];
        var pz = alongZ ? e[2] : e[2] + sx * width / 2;
        var g = RV.boxGeo(0.24, 2.6, 0.24, 0.8, woodTint(0.88));
        RV.place(g, px, e[1] + 1.3, pz);
        push('house', g);
        C.addBox(px, e[1] + 1.3, pz, 0.3, 2.6, 0.3, 'wood', true);
      }
      // cross beam
      var cw = alongZ ? width + 0.5 : 0.2;
      var cd = alongZ ? 0.2 : width + 0.5;
      var cg = RV.boxGeo(cw, 0.2, cd, 0.8, woodTint(0.88));
      RV.place(cg, e[0], e[1] + 2.5, e[2]);
      push('house', cg);
    });

    // enemies patrol the bridge — that's the shooting gallery
    for (var sp = 0; sp < 4; sp++) {
      var tp = 0.18 + sp * 0.21;
      var pp = pointAt(tp);
      W.data.spawnPoints.push(new THREE.Vector3(pp.x, pp.y + 0.1, pp.z));
    }
    W.data.ammoSpots.push(new THREE.Vector3(pointAt(0.5).x, pointAt(0.5).y + 0.2, pointAt(0.5).z));

    // hanging vines off the cables
    for (var v = 0; v < 10; v++) {
      var tv = RV.rand();
      var pv = pointAt(tv);
      var vg = RV.cylGeo(0.014, 0.010, RV.randRange(0.6, 2.2), 4, 0.4, woodTint(0.9));
      RV.place(vg, pv.x + (alongZ ? RV.randSign() * width / 2 : 0), pv.y + 0.9 - 0.6, pv.z + (alongZ ? 0 : RV.randSign() * width / 2));
      push('rope', vg);
    }
    return pointAt;
  }

  /* =============================================================
     LONGBOATS — moored, and they bob on the swell
     ============================================================= */
  function longboat(x, z, rot, matWood) {
    var grp = new THREE.Group();
    var geos = [];
    var L = RV.randRange(4.6, 6.4), Wd = RV.randRange(0.85, 1.15);
    var sections = 9;
    for (var i = 0; i < sections; i++) {
      var t = i / (sections - 1);
      // taper towards both ends, more at the bow
      var taper = Math.sin(t * Math.PI);
      var w = Wd * (0.25 + taper * 0.85);
      var h = 0.45 + taper * 0.22;
      var zc = (t - 0.5) * L;
      var g = RV.boxGeo(w, h, L / sections + 0.03, 0.7, woodTint(0.95));
      RV.place(g, 0, h / 2 - 0.28 + (1 - taper) * 0.16, zc, (0.5 - t) * 0.18, 0, 0);
      geos.push(g);
    }
    // gunwale strips
    for (var s = -1; s <= 1; s += 2) {
      var gg = RV.boxGeo(0.07, 0.10, L * 0.86, 0.7, woodTint(0.85));
      RV.place(gg, s * Wd * 0.5, 0.2, 0);
      geos.push(gg);
    }
    // thwarts
    for (var k = -1; k <= 1; k++) {
      var tg = RV.boxGeo(Wd * 1.02, 0.06, 0.24, 0.7, woodTint(1.05));
      RV.place(tg, 0, 0.16, k * L * 0.24);
      geos.push(tg);
    }
    // a pole laid along the hull
    var pg = RV.cylGeo(0.035, 0.03, L * 0.8, 5, 0.5, woodTint(0.9));
    RV.place(pg, Wd * 0.28, 0.22, 0, Math.PI / 2, 0, 0);
    geos.push(pg);

    var mesh = new THREE.Mesh(RV.merge(geos), matWood);
    mesh.castShadow = true; mesh.receiveShadow = true;
    grp.add(mesh);
    grp.position.set(x, 0, z);
    grp.rotation.y = rot;
    W.data.boats.push({ obj: grp, phase: RV.rand() * 6.28, x: x, z: z });
    // you can stand in a boat
    C.addBox(x, -0.15, z, Math.abs(Math.cos(rot)) * Wd * 2 + Math.abs(Math.sin(rot)) * L * 0.8,
      0.3, Math.abs(Math.sin(rot)) * Wd * 2 + Math.abs(Math.cos(rot)) * L * 0.8, 'wood');
    return grp;
  }

  /* =============================================================
     CLIFFS, BANKS, FOLIAGE
     ============================================================= */
  function cliffWall(side) {
    var xBase = side * 46;
    for (var z = -95; z < 70; z += RV.randRange(3.5, 6.0)) {
      var layers = RV.randInt(4, 7);
      for (var l = 0; l < layers; l++) {
        var yy = RV.randRange(-3, 22);
        var w = RV.randRange(5, 13), h = RV.randRange(4, 12), d = RV.randRange(5, 12);
        var x = xBase + side * RV.randRange(-4, 9) + (yy * side * 0.18);
        var g = RV.boxGeo(w, h, d, 3.0, woodTint(1));
        RV.place(g, x, yy, z + RV.randRange(-2, 2),
          RV.randRange(-0.25, 0.25), RV.rand() * 3.14, RV.randRange(-0.25, 0.25));
        push('rock', g);
      }
    }
    // one clean collision wall rather than hundreds of rock boxes
    C.add(side > 0 ? 40 : -80, -8, -110, side > 0 ? 80 : -40, 30, 85, 'rock', true);
  }

  function backCliff() {
    for (var x = -46; x < 46; x += RV.randRange(4, 7)) {
      var layers = RV.randInt(3, 5);
      for (var l = 0; l < layers; l++) {
        var g = RV.boxGeo(RV.randRange(6, 14), RV.randRange(5, 14), RV.randRange(6, 12), 3.0, woodTint(1));
        RV.place(g, x + RV.randRange(-3, 3), RV.randRange(-2, 20), -78 + RV.randRange(-5, 4),
          RV.randRange(-0.2, 0.2), RV.rand() * 3.14, RV.randRange(-0.2, 0.2));
        push('rock', g);
      }
    }
    C.add(-90, -8, -95, 90, 32, -70, 'rock', true);
  }

  /** Instanced leaf cards scattered over the banks and cliffs. */
  function foliage(scene, leafTex, count) {
    var geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    var mat = new THREE.MeshStandardMaterial({
      map: leafTex, alphaTest: 0.42, transparent: false,
      side: THREE.DoubleSide, roughness: 0.85, metalness: 0.0,
      color: RV.col(0x8fb27a)
    });
    var inst = new THREE.InstancedMesh(geo, mat, count);
    inst.castShadow = false; inst.receiveShadow = true;
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    var pos = new THREE.Vector3(), scl = new THREE.Vector3();
    var placed = 0, guard = 0;
    while (placed < count && guard < count * 24) {
      guard++;
      var x, z, y;
      if (RV.chance(0.55)) {
        // clinging to the cliff faces
        x = RV.randSign() * RV.randRange(36, 52);
        z = RV.randRange(-88, 62);
        y = RV.randRange(0.4, 16);
      } else if (RV.chance(0.5)) {
        // the far bank / back wall
        x = RV.randRange(-44, 44);
        z = RV.randRange(-76, -60);
        y = RV.randRange(0.2, 12);
      } else {
        // shoreline shrubs where the bed comes near the surface
        x = RV.randSign() * RV.randRange(24, 40);
        z = RV.randRange(-70, 55);
        y = Math.max(0.1, RV.water.bedY(x, z) + 0.2);
        if (y > 3) continue;
      }
      var s = RV.randRange(1.6, 4.2);
      pos.set(x, y, z);
      e.set(0, RV.rand() * 6.28, RV.randRange(-0.18, 0.18));
      q.setFromEuler(e);
      scl.set(s * RV.randRange(0.8, 1.2), s, s);
      m.compose(pos, q, scl);
      inst.setMatrixAt(placed, m);
      placed++;
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    scene.add(inst);
    return inst;
  }

  /* =============================================================
     BUILD EVERYTHING
     ============================================================= */
  W.build = function (scene, mats, textures) {
    RV.reseed(90210);
    C.clear();
    B = {};
    var d = W.data;

    /* ---------- riverbed ---------- */
    var bed = new THREE.PlaneGeometry(300, 320, 90, 96);
    bed.rotateX(-Math.PI / 2);
    var bp = bed.attributes.position;
    for (var i = 0; i < bp.count; i++) {
      var x = bp.getX(i), z = bp.getZ(i);
      var y = RV.water.bedY(x, z) + RV.fbm(x * 0.09, z * 0.09, 4, 3, 0) * 0.9 - 0.4;
      bp.setY(i, y);
    }
    bed.computeVertexNormals();
    RV.tint(bed, new THREE.Color(1, 1, 1));
    var bedMesh = new THREE.Mesh(bed, mats.dirt);
    bedMesh.receiveShadow = true;
    scene.add(bedMesh);

    /* ---------- ZONE A: starting dock ---------- */
    deck(0, 34, 15, 13, 2.2);
    stiltsUnder(0, 34, 15, 13, 2.2);
    railing(-7.5, 40.5, 7.5, 40.5, 2.2);
    railing(-7.5, 27.5, -3.2, 27.5, 2.2);
    railing(3.2, 27.5, 7.5, 27.5, 2.2);
    railing(-7.5, 27.5, -7.5, 40.5, 2.2);
    railing(7.5, 27.5, 7.5, 40.5, 2.2);
    crate(-5.4, 2.2, 38.2); crate(-4.6, 2.2, 37.2); barrel(5.6, 2.2, 38.6);
    crate(6.1, 2.2, 30.0); barrel(-6.2, 2.2, 31.5);
    d.ammoSpots.push(new THREE.Vector3(-5.0, 2.45, 36.4));
    d.ammoSpots.push(new THREE.Vector3(5.4, 2.45, 31.0));
    d.healthSpots.push(new THREE.Vector3(6.0, 2.45, 37.0));
    d.lanterns.push(new THREE.Vector3(-6.5, 4.4, 33.0));

    // mooring posts and boats along the dock
    for (var mp = 0; mp < 4; mp++) {
      post(-8.4, 30 + mp * 3.4, 2.9, 0.14, 2.2 - 0.2);
      post(8.4, 30 + mp * 3.4, 2.9, 0.14, 2.2 - 0.2);
    }
    scene.add(longboat(-10.6, 33.5, 0.08, mats.house));
    scene.add(longboat(10.4, 36.0, -0.05, mats.house));
    scene.add(longboat(11.2, 29.5, 0.22, mats.house));

    /* ---------- ZONE B: main village cluster ---------- */
    walkway(0, 27.5, 0, 4, 3.0, 2.2);              // spine
    walkway(-9, 20, 0, 20, 2.4, 2.2, false);       // branch to H1
    walkway(0, 22, 9, 22, 2.4, 2.2, false);        // branch to H2
    walkway(-9.5, 10, 0, 10, 2.4, 2.2, false);     // branch to H3
    walkway(0, 12, 9.5, 12, 2.4, 2.6, false);      // branch to H4 (a step up)

    house({ x: -10.5, z: 19.0, y: 2.2, w: 6.2, d: 5.0, h: 2.8, doorAt: 0.6, porchZ: 0 });
    house({ x: 10.0, z: 23.0, y: 2.2, w: 5.6, d: 4.6, h: 2.7, doorAt: -0.4 });
    house({ x: -11.0, z: 8.6, y: 2.2, w: 6.6, d: 5.6, h: 2.9, doorAt: 0.3, sideDoor: true });
    house({ x: 11.0, z: 11.0, y: 2.6, w: 6.0, d: 5.2, h: 2.8, doorAt: 0.0 });
    house({ x: 0.0, z: 0.5, y: 2.2, w: 5.4, d: 4.6, h: 2.9, doorAt: 0.0, sideDoor: true });

    d.lanterns.push(new THREE.Vector3(-7.6, 4.3, 20.0));
    d.lanterns.push(new THREE.Vector3(7.4, 4.3, 12.5));

    scene.add(longboat(-15.5, 14.0, 0.5, mats.house));
    scene.add(longboat(15.0, 17.5, -0.4, mats.house));
    scene.add(longboat(-16.5, 25.0, 1.1, mats.house));

    // the spine steps up onto the bridge head
    deck(0, -2.2, 5.0, 5.0, 2.6);
    stiltsUnder(0, -2.2, 5.0, 5.0, 2.6);
    stairs(0, 1.6, 2.2, 2.6, 0, -1, 3.0, 1.4);
    railing(-2.5, -4.7, 2.5, -4.7, 2.6);
    d.spawnPoints.push(new THREE.Vector3(0, 2.7, -3.0));

    /* ---------- ZONE C: the long suspension bridge ---------- */
    var bridgePt = ropeBridge(0, 3.0, -4.6, 0, 4.9, -38.0, 2.2, 1.9);
    W.data.bridgePath = bridgePt;
    scene.add(RV.water.buildRapids(mats.env, textures.foam, 0, -21, 30, 32));

    // rocks breaking the surface in the rapids
    for (var r = 0; r < 14; r++) {
      var rx = RV.randRange(-13, 13), rz = RV.randRange(-36, -7);
      if (Math.abs(rx) < 2.0) rx += RV.randSign() * 2.6;
      boulder(rx, RV.randRange(-0.4, 0.5), rz, RV.randRange(0.7, 1.9));
    }

    /* ---------- ZONE D: far cluster and the cliff path ---------- */
    deck(0, -41.5, 11, 7.5, 4.9);
    stiltsUnder(0, -41.5, 11, 7.5, 4.9);
    railing(-5.5, -45.2, 5.5, -45.2, 4.9);
    railing(-5.5, -37.8, -1.4, -37.8, 4.9);
    railing(1.4, -37.8, 5.5, -37.8, 4.9);
    d.spawnPoints.push(new THREE.Vector3(0, 5.0, -43.5));
    d.ammoSpots.push(new THREE.Vector3(-3.6, 5.15, -43.8));
    d.healthSpots.push(new THREE.Vector3(3.8, 5.15, -40.2));
    d.lanterns.push(new THREE.Vector3(-4.6, 7.1, -41.0));

    walkway(-10.5, -46, 0, -46, 2.4, 4.9, false);
    walkway(0, -46, 10.0, -46, 2.4, 4.9, false);
    walkway(0, -45.5, 0, -54, 2.6, 4.9);

    house({ x: -12.0, z: -49.0, y: 4.9, w: 6.0, d: 5.0, h: 2.8, doorAt: 0.2 });
    house({ x: 11.5, z: -49.5, y: 4.9, w: 6.4, d: 5.4, h: 2.9, doorAt: -0.3, sideDoor: true });
    house({ x: -5.0, z: -58.0, y: 4.9, w: 5.8, d: 5.0, h: 2.8, doorAt: 0.0 });

    scene.add(longboat(-17.0, -44.0, 0.9, mats.house));
    scene.add(longboat(16.5, -41.0, -0.7, mats.house));

    // stairs up to a rock ledge, then the second (shorter) rope bridge
    stairs(6.0, -55.5, 4.9, 9.4, 1, 0, 2.4, 6.5);
    deck(15.0, -55.5, 6.0, 5.0, 9.4);
    for (var pp = 0; pp < 4; pp++) {
      post(13.0 + (pp % 2) * 4, -57.2 + Math.floor(pp / 2) * 3.4, 9.26, 0.18, -1.5);
    }
    railing(12.0, -58.0, 18.0, -58.0, 9.4);
    railing(18.0, -58.0, 18.0, -53.0, 9.4);
    d.spawnPoints.push(new THREE.Vector3(15.0, 9.5, -55.5));
    d.ammoSpots.push(new THREE.Vector3(15.6, 9.65, -54.2));
    boulder(19.5, 7.4, -56.0, 3.2); boulder(22.0, 6.0, -52.0, 2.6);
    boulder(17.0, 5.0, -60.0, 2.9);

    ropeBridge(18.0, 9.2, -55.0, 32.0, 10.4, -45.0, 1.9, 1.0);
    deck(33.5, -44.0, 6.0, 6.0, 10.4);
    boulder(35.0, 8.0, -44.0, 3.6); boulder(31.0, 7.0, -40.0, 3.0);
    boulder(37.0, 6.5, -48.0, 3.4);
    railing(30.8, -47.0, 36.5, -47.0, 10.4);
    d.spawnPoints.push(new THREE.Vector3(33.5, 10.5, -44.0));
    d.ammoSpots.push(new THREE.Vector3(33.5, 10.65, -42.5));
    d.healthSpots.push(new THREE.Vector3(34.6, 10.65, -45.4));
    d.lanterns.push(new THREE.Vector3(32.0, 12.2, -44.0));

    /* ---------- shoreline, cliffs, scatter ---------- */
    cliffWall(1); cliffWall(-1); backCliff();

    for (var b2 = 0; b2 < 46; b2++) {
      var bx = RV.randSign() * RV.randRange(22, 42);
      var bz = RV.randRange(-72, 58);
      var by = RV.water.bedY(bx, bz) + RV.randRange(0.2, 1.6);
      boulder(bx, by, bz, RV.randRange(1.0, 3.4));
    }
    for (var b3 = 0; b3 < 12; b3++) {
      boulder(RV.randRange(-20, 20), RV.randRange(-5.5, -3.0), RV.randRange(-60, 45), RV.randRange(1.2, 2.6));
    }

    // extra spawn points spread through the walkways
    d.spawnPoints.push(new THREE.Vector3(0, 2.3, 24));
    d.spawnPoints.push(new THREE.Vector3(0, 2.3, 14));
    d.spawnPoints.push(new THREE.Vector3(-6.5, 2.3, 20));
    d.spawnPoints.push(new THREE.Vector3(6.5, 2.3, 22));
    d.spawnPoints.push(new THREE.Vector3(0, 2.3, 6));
    d.spawnPoints.push(new THREE.Vector3(-6.0, 5.0, -46));
    d.spawnPoints.push(new THREE.Vector3(6.0, 5.0, -46));
    d.spawnPoints.push(new THREE.Vector3(0, 5.0, -52));

    /* ---------- merge each bucket into a single mesh ---------- */
    var meshes = {};
    var pairs = [
      ['dock', mats.dock], ['house', mats.house], ['thatch', mats.thatch],
      ['rope', mats.rope], ['rock', mats.rock], ['cloth', mats.cloth]
    ];
    for (var pi = 0; pi < pairs.length; pi++) {
      var nm = pairs[pi][0];
      if (!B[nm] || !B[nm].length) continue;
      var mesh = new THREE.Mesh(RV.merge(B[nm]), pairs[pi][1]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      meshes[nm] = mesh;
    }
    B = {};

    foliage(scene, textures.leaf, 900);

    W.meshes = meshes;
    return meshes;
  };

  /** Boats ride the swell. */
  W.update = function (t) {
    var boats = W.data.boats;
    for (var i = 0; i < boats.length; i++) {
      var b = boats[i];
      b.obj.position.y = RV.water.height(b.x, b.z, t) - 0.06;
      b.obj.rotation.z = Math.sin(t * 0.7 + b.phase) * 0.035;
      b.obj.rotation.x = Math.cos(t * 0.55 + b.phase * 1.3) * 0.028;
    }
  };

})(window.RV);

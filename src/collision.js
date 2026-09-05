/* =============================================================
   RIVER VILLAGE — collision.js
   Every solid in the village is registered as an axis-aligned box in
   a uniform grid. Player movement, enemy footing and bullet traces
   all query this one structure.
   ============================================================= */
(function (RV) {
  'use strict';

  var C = RV.col3 = {};
  var CELL = 4;
  var boxes = [];
  var grid = new Map();
  var stamp = 0;

  C.boxes = boxes;

  function key(ix, iz) { return ix * 100003 + iz; }

  C.clear = function () { boxes.length = 0; grid.clear(); };

  /**
   * Register a solid box.
   * @param {string} mat  surface type: wood, rock, thatch, metal, dirt
   * @param {boolean} noClimb  enemies won't treat the top as walkable
   */
  C.add = function (x0, y0, z0, x1, y1, z1, mat, noClimb) {
    var b = {
      x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1),
      x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1),
      mat: mat || 'wood', walk: !noClimb, i: boxes.length, s: -1
    };
    boxes.push(b);
    var ix0 = Math.floor(b.x0 / CELL), ix1 = Math.floor(b.x1 / CELL);
    var iz0 = Math.floor(b.z0 / CELL), iz1 = Math.floor(b.z1 / CELL);
    for (var ix = ix0; ix <= ix1; ix++) {
      for (var iz = iz0; iz <= iz1; iz++) {
        var k = key(ix, iz);
        var cell = grid.get(k);
        if (!cell) { cell = []; grid.set(k, cell); }
        cell.push(b);
      }
    }
    return b;
  };

  /** Convenience: add a box from centre + size. */
  C.addBox = function (cx, cy, cz, w, h, d, mat, noClimb) {
    return C.add(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, mat, noClimb);
  };

  /** Collect boxes overlapping an AABB into `out`. */
  C.query = function (x0, y0, z0, x1, y1, z1, out) {
    out.length = 0;
    stamp++;
    var ix0 = Math.floor(x0 / CELL), ix1 = Math.floor(x1 / CELL);
    var iz0 = Math.floor(z0 / CELL), iz1 = Math.floor(z1 / CELL);
    for (var ix = ix0; ix <= ix1; ix++) {
      for (var iz = iz0; iz <= iz1; iz++) {
        var cell = grid.get(key(ix, iz));
        if (!cell) continue;
        for (var i = 0; i < cell.length; i++) {
          var b = cell[i];
          if (b.s === stamp) continue;
          b.s = stamp;
          if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1 || b.z1 < z0 || b.z0 > z1) continue;
          out.push(b);
        }
      }
    }
    return out;
  };

  /**
   * Highest walkable surface at (x,z) that sits at or below `fromY`.
   * Returns null if nothing is under the point.
   */
  var _q = [];
  C.groundAt = function (x, z, fromY, maxDrop, radius) {
    var r = radius === undefined ? 0.05 : radius;
    C.query(x - r, fromY - maxDrop, z - r, x + r, fromY + 0.01, z + r, _q);
    var best = null;
    for (var i = 0; i < _q.length; i++) {
      var b = _q[i];
      if (b.y1 > fromY + 0.01) continue;
      if (best === null || b.y1 > best.y1) best = b;
    }
    return best;
  };

  /* -------------------------------------------------------------
     Ray casting — slab test, walked across the grid so long shots
     stay cheap.
     ------------------------------------------------------------- */
  var _hit = { hit: false, dist: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, mat: '', box: null };

  function slab(b, ox, oy, oz, dx, dy, dz, maxD) {
    var tmin = 0, tmax = maxD, t1, t2, axis = -1, sign = 1;
    // X
    if (Math.abs(dx) < 1e-8) { if (ox < b.x0 || ox > b.x1) return -1; }
    else {
      t1 = (b.x0 - ox) / dx; t2 = (b.x1 - ox) / dx;
      var s = 1;
      if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; s = -1; }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Y
    if (Math.abs(dy) < 1e-8) { if (oy < b.y0 || oy > b.y1) return -1; }
    else {
      t1 = (b.y0 - oy) / dy; t2 = (b.y1 - oy) / dy;
      var s2 = 1;
      if (t1 > t2) { var t3 = t1; t1 = t2; t2 = t3; s2 = -1; }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = s2; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    // Z
    if (Math.abs(dz) < 1e-8) { if (oz < b.z0 || oz > b.z1) return -1; }
    else {
      t1 = (b.z0 - oz) / dz; t2 = (b.z1 - oz) / dz;
      var s3 = 1;
      if (t1 > t2) { var t4 = t1; t1 = t2; t2 = t4; s3 = -1; }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = s3; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    if (tmin < 0 || tmin > maxD) return -1;
    slab.axis = axis; slab.sign = sign;
    return tmin;
  }

  C.raycast = function (ox, oy, oz, dx, dy, dz, maxD) {
    _hit.hit = false; _hit.dist = maxD; _hit.box = null;
    stamp++;
    var step = CELL * 0.9;
    var travelled = 0;
    var bestT = maxD, bestBox = null, bestAxis = -1, bestSign = 1;
    while (travelled <= maxD + step) {
      var px = ox + dx * travelled, pz = oz + dz * travelled;
      var ix0 = Math.floor((px - CELL) / CELL), ix1 = Math.floor((px + CELL) / CELL);
      var iz0 = Math.floor((pz - CELL) / CELL), iz1 = Math.floor((pz + CELL) / CELL);
      for (var ix = ix0; ix <= ix1; ix++) {
        for (var iz = iz0; iz <= iz1; iz++) {
          var cell = grid.get(key(ix, iz));
          if (!cell) continue;
          for (var i = 0; i < cell.length; i++) {
            var b = cell[i];
            if (b.s === stamp) continue;
            b.s = stamp;
            var t = slab(b, ox, oy, oz, dx, dy, dz, bestT);
            if (t >= 0 && t < bestT) { bestT = t; bestBox = b; bestAxis = slab.axis; bestSign = slab.sign; }
          }
        }
      }
      if (bestBox && bestT < travelled) break;   // nothing closer can exist
      travelled += step;
    }
    if (!bestBox) return null;
    _hit.hit = true;
    _hit.dist = bestT;
    _hit.x = ox + dx * bestT; _hit.y = oy + dy * bestT; _hit.z = oz + dz * bestT;
    _hit.nx = _hit.ny = _hit.nz = 0;
    if (bestAxis === 0) _hit.nx = bestSign;
    else if (bestAxis === 1) _hit.ny = bestSign;
    else if (bestAxis === 2) _hit.nz = bestSign;
    else _hit.ny = 1;
    _hit.mat = bestBox.mat;
    _hit.box = bestBox;
    return _hit;
  };

  /** Cheap boolean line-of-sight test. */
  C.losBlocked = function (ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.001) return false;
    var h = C.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.15);
    return !!h;
  };

  /* -------------------------------------------------------------
     Capsule (cylinder) resolution used by the player and enemies.
     Axis-separated push-out with a step-up allowance so plank edges
     and stairs don't stop you dead.
     ------------------------------------------------------------- */
  var _list = [];

  /**
   * Resolve a vertical cylinder against the world.
   * @param {object} body  {pos:Vector3, radius, height}  pos = feet
   * @returns {object} flags {ground:bool, groundY, ceiling:bool, mat}
   */
  C.resolve = function (pos, radius, height, prevY, stepUp) {
    var res = { ground: false, groundY: 0, ceiling: false, mat: 'wood', wall: false };
    var i, b;

    // ---- vertical ----
    C.query(pos.x - radius, pos.y - 0.02, pos.z - radius, pos.x + radius, pos.y + height, pos.z + radius, _list);
    for (i = 0; i < _list.length; i++) {
      b = _list[i];
      var feet = pos.y, head = pos.y + height;
      if (feet < b.y1 && head > b.y0) {
        var upPen = b.y1 - feet;          // how far to push up to stand on it
        var downPen = head - b.y0;        // how far to push down to duck under
        if (upPen <= downPen && upPen < height * 0.6) {
          pos.y = b.y1;
          res.ground = true; res.groundY = b.y1; res.mat = b.mat;
        } else if (downPen < upPen) {
          pos.y = b.y0 - height;
          res.ceiling = true;
        }
      }
    }

    // ---- horizontal (X then Z, with step-up) ----
    var su = stepUp === undefined ? 0.42 : stepUp;
    for (var pass = 0; pass < 2; pass++) {
      C.query(pos.x - radius, pos.y + 0.06, pos.z - radius, pos.x + radius, pos.y + height, pos.z + radius, _list);
      var moved = false;
      for (i = 0; i < _list.length; i++) {
        b = _list[i];
        // already resolved vertically?
        if (pos.y + 0.06 >= b.y1 || pos.y + height <= b.y0) continue;
        var cx = RV.clamp(pos.x, b.x0, b.x1);
        var cz = RV.clamp(pos.z, b.z0, b.z1);
        var dx = pos.x - cx, dz = pos.z - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;

        // low enough to just step onto?
        if (b.walk && b.y1 - pos.y > 0 && b.y1 - pos.y <= su) {
          pos.y = b.y1;
          res.ground = true; res.groundY = b.y1; res.mat = b.mat;
          moved = true;
          continue;
        }
        var d = Math.sqrt(d2);
        if (d > 1e-5) {
          var push = (radius - d) / d;
          pos.x += dx * push; pos.z += dz * push;
        } else {
          // dead centre — push out along the shallowest axis
          var px0 = pos.x - b.x0, px1 = b.x1 - pos.x;
          var pz0 = pos.z - b.z0, pz1 = b.z1 - pos.z;
          var m = Math.min(px0, px1, pz0, pz1);
          if (m === px0) pos.x = b.x0 - radius;
          else if (m === px1) pos.x = b.x1 + radius;
          else if (m === pz0) pos.z = b.z0 - radius;
          else pos.z = b.z1 + radius;
        }
        res.wall = true;
        moved = true;
      }
      if (!moved) break;
    }

    // ---- settle onto a surface directly underfoot ----
    if (!res.ground) {
      var g = C.groundAt(pos.x, pos.z, pos.y + 0.02, 0.16, radius * 0.8);
      if (g && pos.y - g.y1 < 0.12 && prevY >= g.y1 - 0.02) {
        pos.y = g.y1;
        res.ground = true; res.groundY = g.y1; res.mat = g.mat;
      }
    }
    return res;
  };

})(window.RV);

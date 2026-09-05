/* =============================================================
   RIVER VILLAGE — audio.js
   All sound is synthesized live with the WebAudio API: gunfire,
   reload mechanics, footsteps, water, and the infected. No audio
   files to load, and every shot is slightly different.
   ============================================================= */
(function (RV) {
  'use strict';

  var A = RV.audio = {};
  var ctx = null, master = null, muffle = null, comp = null;
  var noiseBuf = null, brownBuf = null;
  var listenPos = new THREE.Vector3();
  var listenRight = new THREE.Vector3(1, 0, 0);
  var ambientNodes = [];
  var rapidsGain = null;
  var started = false;
  A.enabled = true;
  A.ready = false;

  function makeNoise(seconds, brown) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
      else d[i] = w;
    }
    return buf;
  }

  A.init = function () {
    if (ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { A.enabled = false; return; }
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 26;
    comp.ratio.value = 9; comp.attack.value = 0.003; comp.release.value = 0.22;
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = 20000;
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(muffle); muffle.connect(comp); comp.connect(ctx.destination);
    noiseBuf = makeNoise(2, false);
    brownBuf = makeNoise(4, true);
    A.ready = true;
  };

  A.resume = function () {
    if (!ctx) A.init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (ctx && !started) { started = true; startAmbience(); }
  };

  A.setVolume = function (v) { if (master) master.gain.value = v; };

  /** Muffle everything when the camera goes under the river. */
  A.setUnderwater = function (under) {
    if (!muffle) return;
    var t = ctx.currentTime;
    muffle.frequency.cancelScheduledValues(t);
    muffle.frequency.setTargetAtTime(under ? 420 : 20000, t, 0.08);
  };

  A.setListener = function (pos, quat) {
    listenPos.copy(pos);
    listenRight.set(1, 0, 0).applyQuaternion(quat);
  };

  A.setRapids = function (amount) {
    if (rapidsGain) rapidsGain.gain.setTargetAtTime(amount * 0.55, ctx.currentTime, 0.3);
  };

  /* ---- routing helper: 3D-ish gain + stereo pan from world position ---- */
  function out(pos, refDist, maxDist) {
    var g = ctx.createGain();
    if (!pos) { g.connect(master); return { node: g, gain: 1 }; }
    var dx = pos.x - listenPos.x, dy = pos.y - listenPos.y, dz = pos.z - listenPos.z;
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    refDist = refDist || 4; maxDist = maxDist || 90;
    var att = refDist / Math.max(refDist, dist);
    att *= RV.clamp(1 - dist / maxDist, 0, 1);
    if (att < 0.004) return null;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      var p = (dx * listenRight.x + dy * listenRight.y + dz * listenRight.z) / Math.max(dist, 0.001);
      pan.pan.value = RV.clamp(p, -1, 1) * 0.85;
      g.connect(pan); pan.connect(master);
    } else g.connect(master);
    // distant sounds lose their highs
    if (dist > 12) {
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = RV.lerp(9000, 900, RV.clamp((dist - 12) / 70, 0, 1));
      g.disconnect();
      g.connect(lp);
      if (pan) lp.connect(pan); else lp.connect(master);
    }
    return { node: g, gain: att };
  }

  function noiseSrc(brown) {
    var s = ctx.createBufferSource();
    s.buffer = brown ? brownBuf : noiseBuf;
    s.loop = true;
    s.playbackRate.value = 0.85 + Math.random() * 0.3;
    return s;
  }

  function env(param, t0, peak, attack, decay, curve) {
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    if (curve === 'lin') param.linearRampToValueAtTime(0.0001, t0 + attack + decay);
    else param.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /* =============================================================
     ONE-SHOTS
     ============================================================= */

  function gunshot(pos) {
    var o = out(pos, 6, 260); if (!o) return;
    var t = ctx.currentTime;
    var vol = o.gain;

    // 1. the crack — bright noise transient
    var n = noiseSrc(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(3200 + Math.random() * 700, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.16);
    var ng = ctx.createGain();
    env(ng.gain, t, 1.0 * vol, 0.0012, 0.16);
    n.connect(bp); bp.connect(ng); ng.connect(o.node);
    n.start(t); n.stop(t + 0.25);

    // 2. body — low thump from the muzzle blast
    var osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150 + Math.random() * 30, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.13);
    var og = ctx.createGain();
    env(og.gain, t, 0.85 * vol, 0.002, 0.14);
    osc.connect(og); og.connect(o.node);
    osc.start(t); osc.stop(t + 0.2);

    // 3. tail — the report slapping back off the cliffs and water
    var n2 = noiseSrc(false);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(280, t + 0.9);
    var g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.16 * vol, t + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    n2.connect(lp); lp.connect(g2); g2.connect(o.node);
    n2.start(t + 0.035); n2.stop(t + 1.15);

    // 4. mechanical action clatter
    click(o.node, t + 0.02, 0.35 * vol, 2400, 0.03);
    click(o.node, t + 0.075, 0.22 * vol, 1500, 0.04);
  }

  function click(dest, t, vol, freq, dur) {
    var n = noiseSrc(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 5.5;
    bp.frequency.value = freq * (0.9 + Math.random() * 0.2);
    var g = ctx.createGain();
    env(g.gain, t, vol, 0.001, dur);
    n.connect(bp); bp.connect(g); g.connect(dest);
    n.start(t); n.stop(t + dur + 0.05);
  }

  function thunk(dest, t, vol, freq, dur) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + dur);
    var g = ctx.createGain();
    env(g.gain, t, vol, 0.002, dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* The full AK reload: mag release, mag out, fresh mag in, slap home,
     then the charging handle. Timed to match the viewmodel animation. */
  function reload(pos) {
    var o = out(pos, 3, 30); if (!o) return;
    var t = ctx.currentTime, v = o.gain;
    click(o.node, t + 0.06, 0.5 * v, 1800, 0.03);   // catch released
    click(o.node, t + 0.30, 0.4 * v, 900, 0.05);    // mag rocks out
    thunk(o.node, t + 0.34, 0.30 * v, 180, 0.09);
    click(o.node, t + 1.05, 0.45 * v, 700, 0.05);   // fresh mag offered up
    thunk(o.node, t + 1.42, 0.55 * v, 150, 0.13);   // rocked in
    click(o.node, t + 1.46, 0.6 * v, 2100, 0.04);   // catch snaps
    click(o.node, t + 1.90, 0.55 * v, 2600, 0.05);  // handle back
    click(o.node, t + 2.05, 0.6 * v, 3000, 0.05);   // bolt slams forward
    thunk(o.node, t + 2.06, 0.35 * v, 220, 0.08);
  }

  function footstep(pos, wet, running) {
    var o = out(pos, 2.5, 30); if (!o) return;
    var t = ctx.currentTime, v = o.gain * (running ? 1.0 : 0.62);
    var n = noiseSrc(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = wet ? 1.2 : 2.4;
    bp.frequency.value = (wet ? 900 : 380) * (0.8 + Math.random() * 0.45);
    var g = ctx.createGain();
    env(g.gain, t, 0.30 * v, 0.002, wet ? 0.13 : 0.075);
    n.connect(bp); bp.connect(g); g.connect(o.node);
    n.start(t); n.stop(t + 0.25);
    // hollow boom of a plank deck over water
    if (!wet) thunk(o.node, t, 0.22 * v, 105 + Math.random() * 30, 0.11);
  }

  function splash(pos, size) {
    var o = out(pos, 5, 70); if (!o) return;
    var t = ctx.currentTime, v = o.gain * RV.clamp(size, 0.2, 1.6);
    var n = noiseSrc(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.06);
    bp.frequency.exponentialRampToValueAtTime(320, t + 0.55);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5 * v, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    n.connect(bp); bp.connect(g); g.connect(o.node);
    n.start(t); n.stop(t + 0.7);
    // a few bubbles chasing the splash
    for (var i = 0; i < 4; i++) {
      var bt = t + 0.05 + Math.random() * 0.35;
      var ob = ctx.createOscillator();
      ob.type = 'sine';
      var f = 400 + Math.random() * 900;
      ob.frequency.setValueAtTime(f, bt);
      ob.frequency.exponentialRampToValueAtTime(f * 2.1, bt + 0.05);
      var gb = ctx.createGain();
      env(gb.gain, bt, 0.10 * v, 0.004, 0.05);
      ob.connect(gb); gb.connect(o.node);
      ob.start(bt); ob.stop(bt + 0.12);
    }
  }

  function impact(pos, kind) {
    var o = out(pos, 4, 60); if (!o) return;
    var t = ctx.currentTime, v = o.gain;
    var n = noiseSrc(false);
    var bp = ctx.createBiquadFilter();
    if (kind === 'rock') { bp.type = 'bandpass'; bp.Q.value = 1.8; bp.frequency.value = 2600 + Math.random() * 900; }
    else if (kind === 'flesh') { bp.type = 'lowpass'; bp.frequency.value = 700 + Math.random() * 400; }
    else if (kind === 'water') { bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.value = 1400; }
    else { bp.type = 'bandpass'; bp.Q.value = 1.1; bp.frequency.value = 1100 + Math.random() * 600; }
    var g = ctx.createGain();
    env(g.gain, t, (kind === 'flesh' ? 0.5 : 0.34) * v, 0.001, kind === 'flesh' ? 0.10 : 0.07);
    n.connect(bp); bp.connect(g); g.connect(o.node);
    n.start(t); n.stop(t + 0.2);
    if (kind === 'flesh') thunk(o.node, t, 0.28 * v, 130, 0.10);
  }

  /* Infected vocals: a detuned growl pushed through vocal-ish formants. */
  function voice(pos, kind) {
    var o = out(pos, 5, 55); if (!o) return;
    var t = ctx.currentTime, v = o.gain;
    var dur = kind === 'death' ? 1.1 : (kind === 'scream' ? 0.85 : 0.6);
    var base = kind === 'scream' ? 190 : (kind === 'death' ? 120 : 95);
    base *= 0.8 + Math.random() * 0.45;

    var mix = ctx.createGain();
    env(mix.gain, t, (kind === 'scream' ? 0.55 : 0.36) * v, 0.05, dur);
    mix.connect(o.node);

    for (var i = 0; i < 2; i++) {
      var osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      var f0 = base * (i ? 1.008 : 1);
      osc.frequency.setValueAtTime(f0, t);
      if (kind === 'scream') {
        osc.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.18);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + dur);
      } else {
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + dur);
      }
      // formant shaping
      var f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass'; f1.Q.value = 4; f1.frequency.value = 520 + Math.random() * 180;
      var f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass'; f2.Q.value = 6; f2.frequency.value = 1300 + Math.random() * 400;
      var gg = ctx.createGain(); gg.gain.value = 0.55;
      osc.connect(f1); f1.connect(f2); f2.connect(gg); gg.connect(mix);
      osc.start(t); osc.stop(t + dur + 0.1);
    }
    // rasping breath on top
    var n = noiseSrc(false);
    var nb = ctx.createBiquadFilter();
    nb.type = 'bandpass'; nb.Q.value = 1.4; nb.frequency.value = 900;
    var ng = ctx.createGain();
    env(ng.gain, t, 0.13 * v, 0.06, dur * 0.9);
    n.connect(nb); nb.connect(ng); ng.connect(o.node);
    n.start(t); n.stop(t + dur + 0.1);
  }

  function beep(freqA, freqB, dur, vol, type) {
    var o = out(null); if (!o) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(freqB, t + dur);
    var g = ctx.createGain();
    env(g.gain, t, vol, 0.003, dur);
    osc.connect(g); g.connect(o.node);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  function heartbeat() {
    var o = out(null); if (!o) return;
    var t = ctx.currentTime;
    thunk(o.node, t, 0.30, 62, 0.16);
    thunk(o.node, t + 0.20, 0.20, 55, 0.19);
  }

  /* =============================================================
     AMBIENCE — continuous bed + scheduled one-shots
     ============================================================= */
  function startAmbience() {
    if (!ctx) return;
    var t = ctx.currentTime;

    // low wind through the valley
    var wind = noiseSrc(true);
    var wf = ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 320;
    var wg = ctx.createGain(); wg.gain.value = 0.0;
    wg.gain.setTargetAtTime(0.20, t, 2.0);
    wind.connect(wf); wf.connect(wg); wg.connect(master);
    wind.start(t);
    // slow swell
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    var lg = ctx.createGain(); lg.gain.value = 0.09;
    lfo.connect(lg); lg.connect(wg.gain); lfo.start(t);
    ambientNodes.push(wind, lfo);

    // water lapping against the stilts
    var wat = noiseSrc(true);
    var wbf = ctx.createBiquadFilter();
    wbf.type = 'bandpass'; wbf.Q.value = 0.8; wbf.frequency.value = 620;
    var wag = ctx.createGain(); wag.gain.value = 0.0;
    wag.gain.setTargetAtTime(0.13, t, 2.0);
    wat.connect(wbf); wbf.connect(wag); wag.connect(master);
    wat.start(t);
    var lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.23;
    var lg2 = ctx.createGain(); lg2.gain.value = 0.055;
    lfo2.connect(lg2); lg2.connect(wag.gain); lfo2.start(t);
    ambientNodes.push(wat, lfo2);

    // rapids bed — gain is driven by how close the player is to them
    var rap = noiseSrc(true);
    var rf = ctx.createBiquadFilter();
    rf.type = 'bandpass'; rf.Q.value = 0.5; rf.frequency.value = 1500;
    rapidsGain = ctx.createGain(); rapidsGain.gain.value = 0;
    rap.connect(rf); rf.connect(rapidsGain); rapidsGain.connect(master);
    rap.start(t);
    ambientNodes.push(rap);

    scheduleCritters();
  }

  // occasional birds and insects, so the valley never feels dead
  function scheduleCritters() {
    if (!ctx) return;
    var delay = 3 + Math.random() * 9;
    setTimeout(function () {
      if (!A.enabled || !ctx) return;
      var o = out(null);
      if (o) {
        var t = ctx.currentTime;
        var kind = Math.random();
        if (kind < 0.45) {
          // distant bird call: 2-4 chirps
          var n = 2 + Math.floor(Math.random() * 3);
          var f = 1400 + Math.random() * 1400;
          for (var i = 0; i < n; i++) {
            var ti = t + i * (0.10 + Math.random() * 0.09);
            var osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f, ti);
            osc.frequency.exponentialRampToValueAtTime(f * (1.3 + Math.random() * 0.5), ti + 0.06);
            var g = ctx.createGain();
            env(g.gain, ti, 0.035, 0.008, 0.07);
            var lp = ctx.createBiquadFilter();
            lp.type = 'lowpass'; lp.frequency.value = 3000;
            osc.connect(g); g.connect(lp); lp.connect(o.node);
            osc.start(ti); osc.stop(ti + 0.15);
          }
        } else if (kind < 0.8) {
          // insect trill
          var nn = noiseSrc(false);
          var bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.Q.value = 14; bp.frequency.value = 4200 + Math.random() * 1800;
          var gg = ctx.createGain(); gg.gain.value = 0;
          var dur = 0.6 + Math.random() * 1.2;
          gg.gain.setValueAtTime(0.0001, t);
          gg.gain.linearRampToValueAtTime(0.022, t + 0.15);
          gg.gain.setValueAtTime(0.022, t + dur - 0.2);
          gg.gain.linearRampToValueAtTime(0.0001, t + dur);
          var trem = ctx.createOscillator();
          trem.frequency.value = 22 + Math.random() * 14;
          var tg = ctx.createGain(); tg.gain.value = 0.014;
          trem.connect(tg); tg.connect(gg.gain); trem.start(t); trem.stop(t + dur);
          nn.connect(bp); bp.connect(gg); gg.connect(o.node);
          nn.start(t); nn.stop(t + dur + 0.1);
        } else {
          // a plank creaking somewhere in the village
          var c = ctx.createOscillator();
          c.type = 'sawtooth';
          var cf = 150 + Math.random() * 180;
          c.frequency.setValueAtTime(cf, t);
          c.frequency.linearRampToValueAtTime(cf * (0.8 + Math.random() * 0.5), t + 0.7);
          var cbp = ctx.createBiquadFilter();
          cbp.type = 'bandpass'; cbp.Q.value = 9; cbp.frequency.value = 700;
          var cg = ctx.createGain();
          env(cg.gain, t, 0.05, 0.2, 0.6);
          c.connect(cbp); cbp.connect(cg); cg.connect(o.node);
          c.start(t); c.stop(t + 0.9);
        }
      }
      scheduleCritters();
    }, delay * 1000);
  }

  /* =============================================================
     PUBLIC API
     ============================================================= */
  A.play = function (name, pos, arg) {
    if (!A.enabled || !ctx || ctx.state !== 'running') return;
    try {
      switch (name) {
        case 'shot': gunshot(pos); break;
        case 'reload': reload(pos); break;
        case 'dryfire': { var o = out(pos, 3, 25); if (o) click(o.node, ctx.currentTime, 0.5 * o.gain, 2600, 0.035); break; }
        case 'step': footstep(pos, arg === 'water', arg === 'run'); break;
        case 'land': { var o2 = out(pos, 3, 30); if (o2) { thunk(o2.node, ctx.currentTime, 0.4 * o2.gain, 90, 0.16); click(o2.node, ctx.currentTime, 0.25 * o2.gain, 500, 0.06); } break; }
        case 'jump': { var o3 = out(pos, 3, 25); if (o3) click(o3.node, ctx.currentTime, 0.18 * o3.gain, 700, 0.05); break; }
        case 'splash': splash(pos, arg || 1); break;
        case 'impact': impact(pos, arg); break;
        case 'growl': voice(pos, 'growl'); break;
        case 'scream': voice(pos, 'scream'); break;
        case 'death': voice(pos, 'death'); break;
        case 'hitmark': beep(1500, 1050, 0.05, 0.16, 'square'); break;
        case 'headshot': beep(2100, 1300, 0.09, 0.20, 'square'); break;
        case 'pickup': beep(700, 1350, 0.10, 0.16, 'sine'); break;
        case 'hurt': { var o4 = out(null); if (o4) { thunk(o4.node, ctx.currentTime, 0.35, 160, 0.18); click(o4.node, ctx.currentTime, 0.2, 500, 0.09); } break; }
        case 'heartbeat': heartbeat(); break;
        case 'lowammo': beep(900, 640, 0.06, 0.09, 'triangle'); break;
        case 'die': { var o5 = out(null); if (o5) { thunk(o5.node, ctx.currentTime, 0.5, 110, 0.9); } break; }
      }
    } catch (e) { /* audio must never break the game loop */ }
  };

})(window.RV);

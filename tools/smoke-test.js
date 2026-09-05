/* =============================================================
   River Village — headless smoke test  (development only)

   Drives the game in a real browser and asserts that the systems
   actually work: bullet raycasts and hitbox zones, kills, enemy
   melee, bridge pathing, ammo pickups, reloading, death and restart.

   Not needed to play the game. To run it:
       npm install -D playwright && npx playwright install chromium
       node tools/smoke-test.js

   Timed checks wait on *simulated* time rather than the wall clock,
   so the suite still passes on a software renderer crawling along at
   a couple of frames a second.
   ============================================================= */
const { chromium } = require('playwright');
const path = require('path');
let fails = 0;
function check(name, cond, extra) { console.log((cond?'  PASS  ':'  FAIL  ')+name+(extra!==undefined?'   '+JSON.stringify(extra):'')); if(!cond) fails++; }

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl']
  });
  const page = await browser.newPage({ viewport: { width: 420, height: 280 } });
  const errs=[]; page.on('pageerror', e => errs.push(e.stack||e.message));
  page.on('console', m => { if(m.type()==='error') errs.push('console: '+m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html'), { waitUntil: 'load' });
  for (let i=0;i<90;i++){ await page.waitForTimeout(1000);
    if (await page.evaluate(()=>{const s=document.getElementById('start-screen');return s&&!s.classList.contains('hidden');})) break; }
  await page.evaluate(()=>document.getElementById('start-button').click());
  await page.waitForTimeout(3000);
  console.log('sim fps =', await page.evaluate(()=>RV.game.state.fps));

  // Wait for N seconds of *simulated* time; the software renderer is slow,
  // so real-time waits would otherwise under-run every timed system.
  async function simWait(seconds, capMs) {
    const t0 = await page.evaluate(()=>RV.game.time);
    const deadline = Date.now() + (capMs || 120000);
    for (;;) {
      await page.waitForTimeout(250);
      const t = await page.evaluate(()=>RV.game.time);
      if (t - t0 >= seconds) return t - t0;
      if (Date.now() > deadline) return t - t0;
    }
  }

  // ---- 1. raycast hits a body we are aiming at ----
  const rc = await page.evaluate(() => {
    RV.enemies.clear();
    RV.player.pos.set(0, 2.4, 36); RV.player.vel.set(0,0,0);
    const e = RV.enemies.spawn(new THREE.Vector3(0, 2.3, 32));
    e.state = RV.enemies.STATE.IDLE; e.aggroRange = 0;
    const eye = RV.player.pos.y + RV.player.EYE;
    const torso = e.pos.y + 1.15;
    RV.player.yaw = 0;
    RV.player.pitch = Math.atan2(torso - eye, 4);
    RV.game.camera.rotation.order='YXZ';
    RV.game.camera.position.set(0, eye, 36);
    RV.game.camera.rotation.set(RV.player.pitch, 0, 0);
    RV.game.camera.updateMatrixWorld(true);
    const d = new THREE.Vector3(); RV.game.camera.getWorldDirection(d);
    const h = RV.enemies.raycast(0, eye, 36, d.x, d.y, d.z, 60);
    return h ? { zone: h.zone, dist: +h.dist.toFixed(2) } : null;
  });
  check('enemy raycast registers a torso hit', rc && rc.zone === 'body', rc);

  // ---- 1b. hitboxes line up with the body from head to shins ----
  const zones = await page.evaluate(() => {
    RV.enemies.clear();
    const e = RV.enemies.spawn(new THREE.Vector3(0, 2.3, 32));
    e.state = RV.enemies.STATE.IDLE; e.aggroRange = 0;
    const eye = RV.player.pos.y + RV.player.EYE;
    const out = {};
    // fire a flat ray at a series of heights up the body
    [['skull',1.85],['head',1.79],['chest',1.48],['pelvis',1.01],['thigh',0.74],['shin',0.36],
     ['aboveHead',2.15],['belowFeet',-0.2]].forEach(([name, h]) => {
      const ty = e.pos.y + h;
      const d = new THREE.Vector3(0, ty - eye, -4).normalize();
      const hit = RV.enemies.raycast(0, eye, 36, d.x, d.y, d.z, 60);
      out[name] = hit ? hit.zone : null;
    });
    return out;
  });
  check('top of the skull is a headshot', zones.skull === 'head', zones);
  check('head centre is a headshot', zones.head === 'head', zones);
  check('chest and pelvis read as body', zones.chest === 'body' && zones.pelvis === 'body', zones);
  check('thigh and shin read as legs', zones.thigh === 'legs' && zones.shin === 'legs', zones);
  check('shots over the head and under the feet miss', zones.aboveHead === null && zones.belowFeet === null, zones);

  // ---- 2. a burst actually kills ----
  const before = await page.evaluate(()=>RV.game.state.kills);
  await page.mouse.down({button:'left'});
  await simWait(2.2);
  await page.mouse.up({button:'left'});
  await simWait(0.6);
  const kills = await page.evaluate(()=>({k:RV.game.state.kills, ammo:RV.weapon.ammo,
    hp: RV.enemies.list.length ? Math.round(RV.enemies.list[0].health) : -1}));
  check('holding fire lands rounds on the target', kills.ammo < 30, kills);
  check('a sustained burst kills the target', kills.k > before, kills);

  // ---- 3. headshot is a one-shot kill ----
  const hs = await page.evaluate(() => {
    RV.enemies.clear();
    const e = RV.enemies.spawn(new THREE.Vector3(0, 2.3, 32));
    e.state = RV.enemies.STATE.IDLE; e.aggroRange = 0;
    const killed = RV.enemies.damage(e, 130, 0, -1);
    return { killed: killed, alive: e.alive, state: e.state };
  });
  check('headshot drops an infected instantly', hs.killed === true && hs.alive === false, hs);

  // ---- 4. an enemy in melee range hurts the player ----
  await page.evaluate(() => {
    RV.enemies.clear();
    RV.player.reset(new THREE.Vector3(0, 2.4, 36), 0);
    const e = RV.enemies.spawn(new THREE.Vector3(0, 2.3, 34.9));
    e.state = RV.enemies.STATE.CHASE; e.aggroRange = 90;
  });
  await simWait(3.0);
  const dmg = await page.evaluate(()=>({ hp: Math.round(RV.player.health), dirs: RV.player.damageDirs.length }));
  check('infected melee damages the player', dmg.hp < 100, dmg);
  check('damage direction indicator recorded', dmg.dirs > 0, dmg);

  // ---- 5. enemies keep their footing on the bridge ----
  await page.evaluate(() => {
    RV.enemies.clear();
    RV.player.reset(new THREE.Vector3(0, 3.1, -6), 0);
    const e = RV.enemies.spawn(new THREE.Vector3(0, 3.4, -30));
    e.state = RV.enemies.STATE.CHASE; e.aggroRange = 90;
    e.__z0 = e.pos.z;
  });
  await simWait(5.0);
  const bridge = await page.evaluate(()=>{ const e = RV.enemies.list[0];
    return { moved: +(e.pos.z - e.__z0).toFixed(2), y: +e.pos.y.toFixed(2),
             grounded: e.grounded, inWater: e.inWater, alive: e.alive }; });
  check('enemy walks the bridge toward the player', bridge.moved > 3, bridge);
  check('enemy stays on the bridge deck (not in the river)', bridge.inWater === false && bridge.y > 1.0, bridge);

  // ---- 6. ammo pickup ----
  await page.evaluate(() => {
    RV.enemies.clear(); RV.weapon.reserve = 10;
    const spot = RV.world.data.ammoSpots[0];
    RV.player.reset(new THREE.Vector3(spot.x, spot.y + 0.2, spot.z), 0);
  });
  await simWait(1.2);
  const pick = await page.evaluate(()=>({ reserve: RV.weapon.reserve }));
  check('walking over a crate restocks ammo', pick.reserve > 10, pick);

  // ---- 7. reload refills the magazine ----
  await page.evaluate(() => { RV.weapon.ammo = 3; RV.weapon.reserve = 90; RV.weapon.startReload(); });
  await simWait(3.0);
  const rel = await page.evaluate(()=>({ ammo: RV.weapon.ammo, reserve: RV.weapon.reserve }));
  check('reload tops the magazine back up', rel.ammo === 30 && rel.reserve === 63, rel);

  // ---- 8. drowning / death + death screen ----
  await page.evaluate(() => { RV.enemies.clear(); RV.player.hurt(999, null); });
  await simWait(2.2);
  const death = await page.evaluate(()=>({
    alive: RV.player.alive,
    screen: !document.getElementById('death-screen').classList.contains('hidden')
  }));
  check('player dies and the death screen appears', death.alive === false && death.screen === true, death);

  // ---- 9. restart puts everything back ----
  await page.evaluate(()=>document.getElementById('restart-button').click());
  await simWait(1.0);
  const rs = await page.evaluate(()=>({
    hp: Math.round(RV.player.health), ammo: RV.weapon.ammo, kills: RV.game.state.kills,
    alive: RV.player.alive, dead: document.getElementById('death-screen').classList.contains('hidden'),
    pos: RV.player.pos.toArray().map(v=>+v.toFixed(1))
  }));
  check('restart resets health, ammo and score', rs.hp===100 && rs.ammo===30 && rs.kills===0 && rs.alive, rs);

  // ---- 10. swimming / breath ----
  await page.evaluate(() => { RV.player.reset(new THREE.Vector3(0, -3, 20), 0); });
  await simWait(3.0);
  const swim = await page.evaluate(()=>({
    inWater: RV.player.inWater, y: +RV.player.pos.y.toFixed(2), breath: +RV.player.breath.toFixed(2) }));
  check('player floats back to the surface', swim.inWater === true && swim.y > -2.0, swim);

  console.log('\nruntime errors: ' + errs.length);
  errs.slice(0,10).forEach(e=>console.log('  '+e.slice(0,300)));
  console.log(fails === 0 ? '\nALL FUNCTIONAL CHECKS PASSED' : '\n' + fails + ' CHECK(S) FAILED');
  await browser.close();
  process.exit(fails || errs.length ? 1 : 0);
})();

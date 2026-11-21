// Drives the real spaSHial sandbox page in headless Chrome and measures what the engine does,
// from INSIDE the sandboxed preview iframe (opaque origin, the same attributes as the production
// preview): resting heights, the touch verbs, the API's assignment forms, error reporting with line
// numbers, keyboard input, and that every example runs clean and draws.
//
//   CHROMIUM_PATH=/path/to/chrome node tests/browser.test.mjs
//
// Physics itself is covered in Node by tests/physics.test.mjs. This file covers what only a browser
// can: the wasm loading under CORS, three.js, the sketch API on top.
//
// Headless Chrome here draws with software GL, so frame RATE means nothing and no test asserts on
// it. Tests wait on the sketch's own frameCount, never on wall-clock time.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { start, reporter } from './launch.mjs';

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'spashial-shots');
fs.mkdirSync(SHOTS, { recursive: true });
console.log('screenshots ->', SHOTS);

const { section, check, near, done } = reporter('browser: the sandbox page and the engine in a real browser');
let checks = 0;
const chk = (name, ok, detail) => { checks++; check(name, !!ok, detail); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const T = 90000;
const T0 = Date.now();
const env = await start();
const { base } = env;
const URL = `${base}/sandbox.html`;

const runner = (page) => page.frames().find((f) => f.url().includes('runner.html')) || null;

/** Put `code` in the editor, press Run, wait until the sketch has stepped `frames` times. */
async function run(page, code, frames = 1, timeout = T) {
  await page.fill('#code', code);
  await page.click('#run');
  await page.waitForFunction("document.getElementById('log').innerText.length > 0", null, { timeout });
  // The sandbox points the iframe at about:blank and then at the runner; the log can fill a moment
  // before Playwright sees the runner's frame, so wait for it rather than finding null.
  const f = await runnerFrame(page, timeout);
  if ((await page.innerText('#log')).includes('running') && frames) {
    await f.waitForFunction(`window.frameCount >= ${frames}`, null, { timeout });
  }
  return f;
}
async function runnerFrame(page, timeout = T) {
  const end = Date.now() + timeout;
  for (;;) {
    const f = runner(page);
    if (f) return f;
    if (Date.now() > end) throw new Error('the runner frame never appeared');
    await page.waitForTimeout(50);
  }
}
const log = (page) => page.innerText('#log');
const waitLine = (page, text = 'line', timeout = 20000) =>
  page.waitForFunction(`document.getElementById('log').innerText.includes(${JSON.stringify(text)})`, null, { timeout });

let exitCode = 0;
try {
  const page = await env.page();
  await page.goto(URL);
  await page.evaluate(() => window.examplesReady);

  // distinct colours of a 160x90 downscale of a PNG, counted in a throwaway page
  const scratch = await env.page();
  await scratch.setContent('<canvas id="c" width="160" height="90"></canvas>');
  const countColours = (png) => scratch.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
    const c = document.getElementById('c'), g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.clearRect(0, 0, 160, 90);
    g.drawImage(img, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data, set = new Set();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    return set.size;
  }, png.toString('base64'));

  section("the page and the sandbox");
  let f = await run(page, "function setup() { world.gravity.y = -10; new Floor(); new Cube(0, 4, 0); }", 5);
  chk("the engine starts (Jolt wasm loads under the sandbox's CORS rules)", (await log(page)).includes('running'), await log(page));
  const proof = await f.evaluate(() => ({ origin: self.origin, storage: (() => { try { void localStorage.length; return false; } catch { return true; } })() }));
  chk("the preview really is an opaque origin", proof.origin === 'null' && proof.storage === true, proof);
  const sbx = await page.getAttribute('#frame', 'sandbox');
  chk("the iframe has the production sandbox attributes", sbx === 'allow-scripts allow-downloads allow-modals', sbx);

  section("falling and resting (the default example)");
  f = await run(page, await page.evaluate(() => EXAMPLES['Falling cubes']), 300);
  const ys = await f.evaluate(() => [...__spashial.solids].filter(a => a._shape !== 'box' || a._rec.def.w < 30).map(a => [a._shape, a._rec.def.h, a._cur.p[1]]));
  chk("the cubes and the sphere come to rest on the floor", ys.length === 3 && ys.every(([, h, y]) => near(y, h / 2, 0.08)), ys);

  section("the touch verbs");
  f = await run(page, `
window.__t = { collides: 0, colliding: 0, collided: 0, group: 0, overlaps: 0, overlapped: 0, zoneBlocked: false, cb: null };
let box, floor, zone, ball, g;
function setup() {
  world.gravity.y = -10;
  floor = new Floor();
  box = new Cube(0, 3, 0); box.bounciness = 0;
  g = new Group(); g.add(box);
  zone = new Cube(6, 2, 0, 4, 1, 4, 'none');
  ball = new Sphere(6, 5, 0, 0.6);
  window.__ball = ball;
}
function update() {
  if (box.collides(floor, (a, b) => { __t.cb = [a === box, b === floor]; })) __t.collides++;
  __t.colliding = Math.max(__t.colliding, box.colliding(floor));
  if (box.collided(floor)) __t.collided++;
  if (g.collides(floor)) __t.group++;
  if (ball.overlaps(zone)) __t.overlaps++;
  if (ball.overlapped(zone)) __t.overlapped++;
  if (ball.collides(zone)) __t.zoneBlocked = true;
}`, 300);
  const t = await f.evaluate(() => window.__t);
  chk("collides is true on exactly one frame", t.collides === 1, t);
  chk("colliding counts frames while resting", t.colliding > 120, t);
  chk("collided has not fired while still touching", t.collided === 0, t);
  chk("a Group answers collides for any member", t.group === 1, t);
  chk("the callback gets (self, other)", eq(t.cb, [true, true]), t);
  chk("a ball overlaps a sensor zone for several frames", t.overlaps > 5, t);
  chk("overlapped fires once, when it leaves", t.overlapped === 1, t);
  chk("a sensor is never a physical collision", t.zoneBlocked === false, t);
  const ballY = await f.evaluate(() => __ball._cur.p[1]);
  chk("and the ball fell straight through it", near(ballY, 0.3, 0.08), ballY);

  section("the API's assignment forms (units per frame, degrees)");
  f = await run(page, `
window.__r = {};
function setup() {
  world.gravity = [0, 0, 0];
  const a = new Cube(1, 2, 3);
  a.pos = [4, 5, 6]; a.pos.y += 1;
  __r.pos = [a.x, a.y, a.z];
  a.pos.set(1, 1, 1); __r.pos2 = [a.pos.x, a.pos.y, a.pos.z];
  a.vel.x = 0.1; __r.vel = a.vel.x;
  window.__a = a;
  const b = new Cube(10, 0, 0);
  b.rotation.y = 90; __r.rotY = b.rotation.y;
  b.rotation = [0, 45, 0]; __r.rotY2 = b.rotation.y;
  const s = new Sphere(0, 0, 0, 2); __r.sphere = [s.w, s.h, s.d, s.diameter];
  s.w = 3; __r.sphere2 = [s.w, s.h, s.d];
  __r.cone = (c => [c.w, c.h, c.d])(new Cone(0, 0, 0, 2));
  __r.capsule = (c => [c.w, c.h])(new Capsule(0, 0, 0, 1));
  __r.torus = (c => [c.w, c.h, c.d])(new Torus(0, 0, 0, 2));
  __r.mass = [new Cube(0, 0, 0, 1).mass, new Cube(0, 0, 0, 2).mass];
  const k = new Cube(0, 0, 0, 1, 'static'); __r.static = [k.collider, k.mass];
  const sh = new Cube(0, 0, 0); sh.shape = 'sphere'; __r.shape = sh.shape;
  __r.dist = new Cube(0, 0, 0).distanceTo(3, 4, 0);
  b.color = 'gold';
  const cl = b.clone(); __r.clone = [cl.x === b.x, cl.color === b.color, cl !== b];
  cl.remove(); // a clone is made on top of its original, and two solid bodies there push apart
  const r = new Cube(0, 0, 0); r.remove(); __r.removed = r.removed;
  __r.count = allSolids.length;
  __r.gravity = [world.gravity.x, world.gravity.y, world.gravity.z];
}
function update() { if (frameCount === 60) __r.x60 = __a.x; }`, 62);
  let r = await f.evaluate(() => window.__r);
  chk("pos accepts an array and a live component (4,5,6 then y += 1)", eq(r.pos, [4, 6, 6]), r.pos);
  chk("pos.set moves all three", eq(r.pos2, [1, 1, 1]), r.pos2);
  chk("vel is units per frame and reads back what was set", near(r.vel, 0.1, 1e-6), r.vel);
  chk("setting vel.x = 0.1 moves a body about 0.1 per frame (1 -> ~6.9 in 60 frames)", near(r.x60, 6.9, 0.2), r.x60);
  chk("rotation is degrees and assignable as an array", near(r.rotY, 90, 0.01) && near(r.rotY2, 45, 0.01), [r.rotY, r.rotY2]);
  chk("a sphere has one size", eq(r.sphere, [2, 2, 2, 2]) && eq(r.sphere2, [3, 3, 3]), [r.sphere, r.sphere2]);
  chk("cone, capsule and torus default sizes", eq(r.cone, [2, 2, 2]) && eq(r.capsule, [1, 2]) && near(r.torus[1], 0.7, 1e-9), [r.cone, r.capsule, r.torus]);
  chk("mass follows volume (1 m cube = 1 kg, 2 m cube = 8 kg)", near(r.mass[0], 1, 0.01) && near(r.mass[1], 8, 0.05), r.mass);
  chk("a static body has no mass", eq(r.static, ['static', 0]), r.static);
  chk("shape can be changed", r.shape === 'sphere', r.shape);
  chk("distanceTo", near(r.dist, 5, 1e-6), r.dist);
  chk("clone copies the look and is a new body", eq(r.clone, [true, true, true]), r.clone);
  chk("remove() marks it removed", r.removed === true, r.removed);
  chk("every solid is in allSolids", r.count >= 10, r.count);
  chk("world.gravity can be assigned as an array", eq(r.gravity, [0, 0, 0]), r.gravity);

  section("mistakes are reported in plain words, with a line number");
  await run(page, "function setup() {\n  new Cube(1, 2);\n}", 0);
  await waitLine(page);
  let l = await log(page);
  chk("a wrong argument list explains itself", l.includes('takes x, y, z'), l);
  chk("and names line 2", l.includes('line 2'), l);
  await run(page, "function setup() {\n  world.gravty.y = 1;\n}", 0);
  await waitLine(page);
  l = await log(page);
  chk("a typo points at its line", l.includes('line 2') && l.includes('TypeError'), l);
  await run(page, "function setup() {\n  const a = new Cube(0, 0, 0);\n  a.collider = 'bouncy';\n}", 0);
  await waitLine(page);
  l = await log(page);
  chk("a bad collider lists the choices", l.includes("'dynamic', 'static', 'kinematic' or 'none'"), l);
  await run(page, "function setup() { quality = 'ultra'; }", 0);
  await waitLine(page);
  l = await log(page);
  chk("a bad quality lists the choices", l.includes("quality must be 'auto', 'low', 'medium' or 'high'"), l);
  await run(page, "function setup() { new Torus(0, 0, 0, 1, 2, 1); }", 0);
  await waitLine(page);
  l = await log(page);
  chk("a torus thicker than it is wide is refused", l.includes('torus needs h'), l);
  f = await run(page, "let n = 0;\nfunction update() { n++; if (n === 3) throw new Error('boom'); }", 1);
  await waitLine(page, 'boom');
  const fcA = await f.evaluate(() => window.frameCount);
  await page.waitForTimeout(600);
  const fcB = await f.evaluate(() => window.frameCount);
  chk("an error in update() stops the loop (no 60-a-second flood)", fcA === fcB, [fcA, fcB]);

  section("the keyboard");
  f = await run(page, "window.__k = { w: 0, space: 0 };\nfunction update() { if (kb.pressing('w')) __k.w++; if (kb.presses('space')) __k.space++; }", 5);
  await page.click('#frame');
  const kbase = await f.evaluate(() => window.frameCount);
  await page.keyboard.down('w');
  await f.waitForFunction(`window.frameCount >= ${kbase + 40}`, null, { timeout: 60000 });
  await page.keyboard.up('w');
  await page.keyboard.press('Space');
  await f.waitForFunction(`window.frameCount >= ${kbase + 60}`, null, { timeout: 60000 });
  const k = await f.evaluate(() => window.__k);
  chk("holding W counts frames", k.w >= 20, k);
  chk("Space presses exactly once", k.space === 1, k);

  section("quality and the performance panel");
  f = await run(page, "function setup() { showPerf(true); quality = 'low'; }", 10);
  let s = await f.evaluate(() => ({ scale: __spashial.renderScale, perf: __spashial.perf, mode: quality }));
  chk("quality = 'low' fixes the render scale at 0.5", s.scale === 0.5 && s.mode === 'low' && s.perf === true, s);
  f = await run(page, "function setup() { new Floor(); new Cube(0, 1, 0); quality = 'high'; }", 10);
  chk("quality = 'high' is 1 and never above (integrated graphics)", (await f.evaluate(() => __spashial.renderScale)) === 1, '');
  chk("three.js reports draw calls", (await f.evaluate(() => __spashial.renderer.info.render.calls)) > 0, '');

  section("sharpness (no blur)");
  // Auto quality must not lower the scale for start-up spikes or a lone long frame, only for a sustained run.
  f = await run(page, "function setup() { quality = 'auto'; }", 3);
  const a = await f.evaluate(() => { const S = __spashial; const out = {};
    S.renderScale = 1; S.frames = 0; S.lastDt = 100;
    for (let i = 0; i < 100; i++) S.autoQuality();            // still warming up: ignored
    out.warm = S.renderScale;
    S.frames = 500; S.lastDt = 16;
    for (let i = 0; i < 20; i++) S.autoQuality();
    S.lastDt = 100; S.autoQuality(); S.lastDt = 16;           // one spike amid normal frames
    for (let i = 0; i < 200; i++) S.autoQuality();
    out.spike = S.renderScale;
    S.lastDt = 40;
    for (let i = 0; i < 40; i++) S.autoQuality();             // a sustained run of slow frames
    out.sustained = S.renderScale;
    S.lastDt = 40;
    for (let i = 0; i < 2000; i++) S.autoQuality();
    out.floor = S.renderScale;
    return out; });
  chk("auto quality ignores start-up frames", a.warm === 1, a);
  chk("auto quality ignores a single long frame", a.spike === 1, a);
  chk("auto quality does lower the scale for a sustained slow run", a.sustained < 1, a);
  chk("auto quality never goes below 0.7", a.floor >= 0.7 - 1e-9, a);
  // On a sharp screen the canvas is drawn at the screen's own density, and so is the HUD.
  const ctx2 = await env.browser.newContext({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
  const page2 = await ctx2.newPage();
  await page2.goto(URL);
  let f2 = await run(page2, "function setup() { new Floor(); new Cube(0, 1, 0); quality = 'high'; }", 10);
  const d = await f2.evaluate(() => { const c = document.getElementById('canvas'), h = document.getElementById('hud'); return { dpr: devicePixelRatio, cw: c.width, ch: c.clientWidth, hw: h.width, hh: h.clientWidth, ratio: __spashial.hudRatio }; });
  chk("on a 2x screen the 3D canvas has about twice the pixels of its CSS size", d.ch > 0 && 1.5 <= d.cw / d.ch && d.cw / d.ch <= 2.01, d);
  chk("and the HUD canvas matches it, so text stays sharp", d.hh > 0 && Math.abs(d.hw / d.hh - d.cw / d.ch) < 0.02, d);
  f2 = await run(page2, "function setup() { quality = 'high'; } function drawTop() { fill('#ffffff'); rect(10, 10, 20, 20); }", 10);
  const px = await f2.evaluate(() => { const h = document.getElementById('hud'), r = __spashial.hudRatio; return Array.from(h.getContext('2d').getImageData(Math.round(20 * r), Math.round(20 * r), 1, 1).data); });
  chk("HUD drawing lands in CSS pixels at that density (a 20 px square at 10,10 covers 20,20)", px[3] === 255 && px[0] === 255, px);
  await ctx2.close();

  const result = async (code, frames) => {
    const fr = await run(page, code, frames);
    await fr.waitForFunction('window.__r !== undefined', null, { timeout: 90000 });
    return fr.evaluate(() => window.__r);
  };
  const isClean = async () => { const t2 = await log(page); return t2.includes('running') && !t2.replace('running', '').includes('rror'); };

  section("what is drawn is the real shape (not a bounding box)");
  r = await result(`let g, m, c; function setup() {
    g = new Hull(0, 2, 0, [[0, 1.1, 0], [0, -1.1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]], 'static');
    m = new TriangleMesh(5, 0, 0, [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2], [0, 1.5, 0]], [[0, 2, 1], [0, 3, 2], [0, 4, 1], [1, 4, 2], [2, 4, 3], [3, 4, 0]], 'static');
    c = g.clone(); const n = (x) => x._mesh.geometry.getAttribute('position').count;
    const corner = (x) => { const a = x._mesh.geometry.getAttribute('position'); let w = 0; for (let i = 0; i < a.count; i++) w = Math.max(w, Math.min(Math.abs(a.getX(i)), Math.abs(a.getZ(i)))); return w; };
    window.__r = { hullCorner: corner(g), cloneCorner: corner(c), hullDrawn: n(g), hullReal: __spashial.phys.triangles(g._rec).length / 3, meshDrawn: n(m), meshReal: m.triangles.length * 3, cloneDrawn: n(c), box: new Cube(0, 0, 0)._mesh.geometry.getAttribute('position').count }; }`, 3);
  // a box and an octahedron both have 24 vertices; only the box has corners (|x| and |z| both 1)
  chk("a Hull is drawn from its real triangles (an octahedron: no box corners)", r.hullDrawn === r.hullReal && r.hullReal === 24 && r.hullCorner < 0.01, r);
  chk("so is its clone", r.cloneDrawn === r.hullReal && r.cloneCorner < 0.01, r);
  chk("a TriangleMesh is drawn from its triangles, one for one", r.meshDrawn === r.meshReal && r.meshReal === 18, r);

  r = await result(`function setup() { const a = new Cube(0, 0, 0); const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
    window.__r = { fr: t(() => { a.friction = 'slippery'; }), fr2: t(() => { a.friction = -1; }), bo: t(() => { a.bounciness = 'x'; }), de: t(() => { a.density = 0; }), ma: t(() => { a.mass = 'heavy'; }),
      op: t(() => { a.opacity = 'half'; }), me: t(() => { a.metalness = null; }), fov: t(() => { camera.fov = 'wide'; }), fov2: t(() => { camera.fov = 200; }), li: t(() => { sunLight.intensity = 'bright'; }),
      ok: (a.opacity = 5, a.opacity) }; }`, 2);
  chk("numeric properties that were accepted silently now explain themselves",
    ['fr', 'bo', 'ma', 'op', 'me', 'fov', 'li'].every((k) => r[k].includes('must be a number')) && r.fr2.includes('cannot be below 0') && r.de.includes('must be above 0') && r.fov2.includes('between 0 and 180'), r);
  chk("opacity above 1 is still held at 1", r.ok === 1, r);

  section("shadows");
  f = await run(page, "function setup() { new Floor(); sunLight.shadows = true; sunLight.direction = [0, -1, 0]; camera.lookAt(120, 0, -40); }", 5);
  const sh = await f.evaluate(() => { const S = __spashial; return { on: sunLight.shadows, map: S.renderer.shadowMap.enabled, t: S.sun.target.position.toArray(), p: S.sun.position.toArray() }; });
  chk("sunLight.shadows turns the shadow map on", sh.on === true && sh.map === true, sh);
  chk("the shadow box follows what the camera looks at (a point 120 away is still covered)",
    eq(sh.t, [120, 0, -40]) && sh.p[0] === 120 && sh.p[1] === 30 && sh.p[2] === -40, sh);
  const f3 = await run(page, "function setup() { }", 2);
  chk("shadows start off", (await f3.evaluate(() => sunLight.shadows)) === false, "");

  section("a moving character stays steady in the view (camera.follow)");
  // The camera aims at the pose the solid is DRAWN at (interpolated), every drawn frame. Aimed at the raw
  // physics pose once per step it was off by up to a step of travel, which read as shaking.
  f = await run(page, `function setup() { world.gravity.y = -10; new Floor(); window.__p = new Cube(0, 0.5, 0);
    __p.lockRotation = true; __p.friction = 0; camera.follow(__p, { distance: 9, height: 5 }); }
    function update() { __p.vel.x = 0.12; }`, 30);
  const worst = await f.evaluate(async () => { const S = __spashial; let worst = 0; const x0 = __p.x;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const m = __p._mesh.position, t = S.camTarget;
      worst = Math.max(worst, Math.hypot(m.x - t[0], m.y - t[1], m.z - t[2]));
    }
    return { worst, travelled: __p.x - x0 }; });
  chk("the character is moving", worst.travelled > 0.5, worst);
  chk("the camera aims exactly at where the character is drawn (no step-sized offset)", worst.worst < 1e-5, worst);

  section("the rest of the physics API");
  r = await result(`function setup() { const a = new Cube(0, 5, 0); window.__r = { drag: a.drag, rd: a.rotationDrag, gs: a.gravityScale, fast: a.isSuperFast,
    maxSpeed: a.maxSpeed, maxSpin: a.maxSpin, sleep: a.allowSleeping, group: a.collisionGroup, com: a.centerOfMass.y };
    a.drag = 0.4; a.rotationDrag = 0.3; a.gravityScale = 0.5; a.isSuperFast = true; a.maxSpeed = 2; a.maxSpin = 90; a.collisionGroup = 'x'; a.allowSleeping = false;
    window.__r.after = { drag: a.drag, rd: a.rotationDrag, gs: a.gravityScale, fast: a.isSuperFast, maxSpeed: a.maxSpeed, maxSpin: a.maxSpin, group: a.collisionGroup, sleep: a.allowSleeping };
    const errs = []; const t = (f) => { try { f(); errs.push(''); } catch (e) { errs.push(e.name + ': ' + e.message); } };
    t(() => { a.drag = 'x'; }); t(() => { a.drag = -1; }); t(() => { a.collisionGroup = 5; }); t(() => { a.maxSpeed = 0; });
    window.__r.errs = errs; }`, 2);
  let dd = r;
  chk("properties start at their defaults (drag 0.05, gravityScale 1, no speed limit, sleeping allowed)",
    near(dd.drag, 0.05, 1e-6) && dd.gs === 1 && dd.fast === false && dd.maxSpeed === Infinity && dd.maxSpin === Infinity && dd.sleep === true && dd.group === null, dd);
  const a_ = dd.after;
  chk("they can be set and read back (maxSpeed and maxSpin in per-frame units)",
    near(a_.drag, 0.4, 1e-6) && near(a_.rd, 0.3, 1e-6) && a_.gs === 0.5 && a_.fast === true && near(a_.maxSpeed, 2, 1e-4) && near(a_.maxSpin, 90, 1e-3) && a_.group === 'x' && a_.sleep === false, a_);
  let e = dd.errs;
  chk("wrong values explain themselves", e[0].includes('drag must be a number') && e[1].includes('cannot be below 0') && e[2].includes('collisionGroup must be a name') && e[3].includes('must be above 0'), e);

  r = await result(`function setup() { const g = new Group(); const s = g.newSolid(1, 2, 3); g.amount = 3; window.__r = { n: g.length, kind: s instanceof Solid, y: s.y, old: typeof g.newMesh, oldNames: [typeof Asset, typeof Mesh] }; }`, 2);
  chk("Group.newSolid makes a Solid and amount fills a group; no old names (Asset, Mesh, newMesh) are left",
    r.n === 3 && r.kind === true && r.y === 2 && r.old === 'undefined' && eq(r.oldNames, ['undefined', 'undefined']), r);

  r = await result(`let a, b, c, d; function setup() { world.gravity.y = -10; new Floor();
    a = new Sphere(-4, 3, 0, 1); a.gravityScale = 0; b = new Sphere(0, 3, 0, 1); c = new Sphere(4, 3, 0, 1); c.gravityScale = 2; d = new Sphere(8, 0.5, 0, 1); d.maxSpeed = 0.1; d.gravityScale = 0; }
    function update() { if (frameCount === 1) d.vel.x = 1; if (frameCount === 20) window.__r = { a: a.y, b: b.y, c: c.y, dv: d.vel.x, dmax: d.maxSpeed }; }`, 22);
  chk("gravityScale 0 hangs and 2 falls faster", near(r.a, 3, 0.01) && r.c < r.b - 0.05, r);
  chk("maxSpeed caps vel (units per frame)", r.dv <= 0.1001, r);

  r = await result(`let light, heavy; function setup() { new Floor(); light = new Cube(-3, 5, 0, 1); heavy = new Cube(3, 5, 0, 2); light.collider = heavy.collider = 'dynamic'; world.gravity.y = 0; }
    function update() { if (frameCount === 1) { light.applyForceScaled(0, 10, 0); heavy.applyForceScaled(0, 10, 0); } if (frameCount === 10) window.__r = { l: light.vel.y, h: heavy.vel.y, mass: [light.mass, heavy.mass] }; }`, 12);
  chk("applyForceScaled: heavy and light speed up the same", r.l > 0 && near(r.l, r.h, r.l * 0.05), r);

  r = await result(`let a, b; function setup() { world.gravity.y = 0; a = new Cube(0, 5, 0); b = new Cube(5, 5, 0); }
    function update() { if (frameCount === 1) { a.applyImpulseAt(0, 5, 0, 0, 5, 0); b.applyImpulseAt(0, 5, 0, 5.4, 5, 0); } if (frameCount === 5) window.__r = { a: a.angularVelocity.mag(), b: b.angularVelocity.mag() }; }`, 7);
  chk("applyImpulseAt: through the middle does not spin it, off-centre does", r.a < 0.01 && r.b > 1, r);

  r = await result(`let p, rider; function setup() { new Floor(); p = new Cube(0, 1, 0, 4, 0.2, 4, 'kinematic'); p.friction = 1; rider = new Cube(0, 1.7, 0); rider.friction = 1; world.gravity.y = -10;
    const t = (f) => { try { f(); return ''; } catch (e) { return e.message; } }; window.__e = t(() => rider.moveTo(0, 0, 0)); }
    function update() { if (frameCount > 30 && frameCount <= 90) p.moveTo(Math.min(p.x + 0.05, 3), 1, 0); if (frameCount === 140) window.__r = { px: p.x, rx: rider.x, err: window.__e }; }`, 141);
  chk("moveTo glides a kinematic solid, carries its rider and stops", near(r.px, 3, 0.03) && r.rx > 2.2, r);
  chk("moveTo on a dynamic solid explains itself", r.err.includes("moveTo is for 'kinematic'"), r);

  r = await result(`let h, count0; function setup() { world.gravity.y = -10; new Floor(); count0 = allSolids.length;
    h = new Hull(0, 3, 0, [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, 1, 0]]); h.friction = 0.6;
    const t = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
    window.__e = { few: t(() => new Hull(0, 0, 0, [[0, 0, 0], [1, 0, 0], [0, 1, 0]])), flat: t(() => new Hull(0, 0, 0, [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]])),
      size: t(() => { h.w = 2; }), shape: t(() => { h.shape = 'pyramid'; }), left: allSolids.length - count0 }; }
    function update() { if (frameCount === 150) { const c = h.clone(); window.__r = { y: h.y, shape: h.shape, size: [h.w, h.h, h.d], mass: h.mass, pts: h.points.length, cloneShape: c.shape, cloneMass: c.mass, e: window.__e }; } }`, 152);
  chk("a Hull falls and rests on its base", near(r.y, 0, 0.1) && r.shape === 'hull' && near(r.size[1], 1, 1e-6), r);
  chk("a Hull has a mass, a points list and clones with its points", r.mass > 0.1 && r.pts === 5 && r.cloneShape === 'hull' && r.cloneMass > 0.1, r);
  e = r.e;
  chk("bad hulls and sizes explain themselves and leave nothing behind",
    e.few.includes('at least 4 points') && e.flat.includes('flat plane') && e.size.includes('size comes from its points') && e.shape.includes('new Hull()') && e.left === 1, e);
  chk("a hull draws and the sketch stayed clean", await isClean(), await log(page));

  r = await result(`let m, c; function setup() { world.gravity.y = -10;
    m = new TriangleMesh(0, 0, 0, [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]], [[0, 2, 1], [0, 3, 2]]); c = new Cube(0, 3, 0); c.friction = 0.6;
    const t = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
    window.__e = { dyn: t(() => new TriangleMesh(0, 0, 0, [[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]], 'dynamic')), bad: t(() => new TriangleMesh(0, 0, 0, [[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 7]])),
      set: t(() => { m.collider = 'dynamic'; }), alive: !m.removed, n: allSolids.length }; }
    function update() { if (frameCount === 150) window.__r = { y: c.y, collider: m.collider, e: window.__e, verts: m.vertices.length, tris: m.triangles.length }; }`, 152);
  chk("a TriangleMesh is a floor a cube rests on, static by default", near(r.y, 0.5, 0.08) && r.collider === 'static' && r.verts === 4 && r.tris === 2, r);
  e = r.e;
  chk("bad triangle solids explain themselves and leave nothing behind",
    e.dyn.includes("cannot be 'dynamic'") && e.bad.includes('position of a vertex') && e.set.includes("cannot be 'dynamic'") && e.alive && e.n === 2, e);
  chk("a triangle mesh draws and the sketch stayed clean", await isClean(), await log(page));

  r = await result(`let pin, arm, hinge, ball2, rod, rope, slideBase, car, slide, g1, g2, glue; function setup() { world.gravity.y = -10; world.sleepDelay = 5;
    pin = new Cube(0, 8, 0, 0.2, 0.2, 0.2, 'static'); arm = new Sphere(2, 8, 0, 0.5); arm.drag = 0; arm.rotationDrag = 0; hinge = new HingeJoint(pin, arm, { anchor: [0, 8, 0], axis: [0, 0, 1] });
    const pin2 = new Cube(8, 8, 0, 0.2, 0.2, 0.2, 'static'), arm2 = new Sphere(10, 8, 0, 0.5); arm2.drag = 0; limited = new HingeJoint(pin2, arm2, { anchor: [8, 8, 0], axis: [0, 0, 1], lowerLimit: -20, upperLimit: 20 }); window.limited = limited; window.arm2 = arm2;
    const pin3 = new Cube(-8, 8, 0, 0.2, 0.2, 0.2, 'static'), arm3 = new Sphere(-8, 6, 0, 0.5); arm3.drag = 0; rope = new DistanceJoint(pin3, arm3, { length: 3, rope: true }); window.rope = rope; window.arm3 = arm3; window.pin3 = pin3;
    slideBase = new Cube(0, 4, -9, 0.2, 0.2, 0.2, 'static'); car = new Cube(0, 4, -6, 1, 1, 1); slide = new SliderJoint(slideBase, car, { axis: [1, 0, 0], lowerLimit: -1, upperLimit: 1.5 }); window.slide = slide; window.car = car; car.applyImpulse(20, 0, 0);
    g1 = new Cube(-4, 10, -6, 1, 1, 1); g2 = new Cube(-2.8, 10, -6, 1, 1, 1); glue = new GlueJoint(g1, g2); window.g1 = g1; window.g2 = g2;
    const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
    window.__e = { args: t(() => new HingeJoint(1, 2)), same: t(() => new HingeJoint(pin, pin)), opt: t(() => new HingeJoint(pin, arm, { speed: 3 })),
      limit: t(() => { hinge.lowerLimit = 10; }), statics: t(() => new GlueJoint(pin, slideBase)), spring: t(() => new DistanceJoint(pin, arm, { spring: { hz: 0 } })) };
    window.__lists = { a: arm.joints.length, w: world.joints.length }; }
    function update() { if (frameCount === 1) window.__start = { r: arm.pos.dist([0, 8, 0]), z0: 0 };
      if (frameCount > 1 && frameCount <= 100) { window.__rad = Math.max(window.__rad || 0, Math.abs(arm.pos.dist([0, 8, 0]) - 2)); window.__z = Math.max(window.__z || 0, Math.abs(arm.z)); }
      if (frameCount === 100) window.__r = { rad: window.__rad, z: window.__z, angle: hinge.angle, lim: window.limited.angle, limMin: window.limited.lowerLimit, limMax: window.limited.upperLimit,
        rope: window.rope.distance, ropeLen: window.rope.length, slide: window.slide.position, slideY: window.car.y, glue: window.g1.pos.dist(window.g2.pos), e: window.__e, lists: window.__lists }; }`, 102);
  chk("HingeJoint: the arm swings in one plane at a fixed radius", r.rad < 0.06 && r.z < 0.03, r);
  chk("HingeJoint: angle is read in degrees, and limits hold", Math.abs(r.angle) > 30 && near(r.lim, -20, 3) && r.limMin === -20 && r.limMax === 20, r);
  chk("DistanceJoint: a rope keeps within its length", r.rope <= r.ropeLen + 0.06 && r.ropeLen === 3, r);
  chk("SliderJoint: moves along its axis only, up to its limit", near(r.slide, 1.5, 0.08) && near(r.slideY, 4, 0.06), r);
  chk("GlueJoint: two solids stay the same distance apart", near(r.glue, 1.2, 0.05), r);
  e = r.e;
  chk("joint mistakes explain themselves",
    e.args.includes('joins two live Solids') && e.same.includes('two different Solids') && e.opt.includes("no option 'speed'") && e.limit.includes('between -180 and 0')
    && e.statics.includes("two 'static' bodies") && e.spring.includes('hz above 0'), e);
  chk("solid.joints and world.joints list them", r.lists.a === 1 && r.lists.w >= 5, r.lists);

  r = await result(`let a, b, j; function setup() { a = new Cube(0, 5, 0, 'static'); b = new Sphere(2, 5, 0); j = new DistanceJoint(a, b, { length: 2 }); world.gravity.y = -10;
    const before = [a.joints.length, world.joints.length]; j.remove(); const after = [a.joints.length, world.joints.length, j.removed];
    const j2 = new BallJoint(a, b, { anchor: [0, 5, 0] }); b.remove(); window.__r = { before, after, gone: [a.joints.length, world.joints.length, j2.removed] }; }`, 2);
  chk("joint.remove() and solid.remove() take joints away", eq(r.before, [1, 1]) && eq(r.after, [0, 0, true]) && eq(r.gone, [0, 0, true]), r);

  r = await result(`let x, y, z; function setup() { world.gravity.y = -10; const floor = new Floor(); world.ignoreCollisions('ghost', 'solid');
    x = new Sphere(0, 2, 0, 1); x.collisionGroup = 'ghost'; y = new Sphere(4, 2, 0, 1); y.collisionGroup = 'solid'; z = new Sphere(8, 2, 0, 1);
    floor.collisionGroup = 'solid';
    const g = new Group(); g.add(x); g.add(y); g.drag = 0.7; g.gravityScale = 0.9; window.__g = [x.drag, y.drag, x.gravityScale]; }
    function update() { if (frameCount === 90) window.__r = { x: x.y, y: y.y, z: z.y, g: window.__g, ss: world.sleepSpeed, mb: world.minBounceSpeed, st: world.solverSteps, sd: world.sleepDelay }; }`, 92);
  chk("ignoreCollisions: those two groups pass through each other, others do not", r.x < -1 && r.z > 0.3 && r.y > 0.3, r);
  chk("a Group sets these on every member", eq(r.g, [0.7, 0.7, 0.9]), r.g);
  chk("world tuning: defaults in per-frame units", near(r.ss, 0.0005, 1e-5) && near(r.mb, 1 / 60, 1e-4) && r.st === 10 && near(r.sd, 0.5, 1e-6), r);
  chk("the whole set of new API runs without errors", await isClean(), await log(page));

  section("every example runs clean and draws something");
  const names = await page.evaluate(() => Object.keys(EXAMPLES));
  for (const name of names) {
    await page.selectOption('#examples', { label: name });
    await page.waitForFunction("document.getElementById('log').innerText.length > 0", null, { timeout: 90000 });
    const fr = runner(page);
    await fr.waitForFunction('window.frameCount >= 200', null, { timeout: 120000 });
    const lg = await log(page);
    const ok = lg.includes('running') && !lg.includes('Error') && !lg.replace('running', '').toLowerCase().includes('error');
    chk(`'${name}' runs without errors`, ok, lg);
    const png = await page.locator('#frame').screenshot();
    const colors = await countColours(png);
    const safe = [...name].map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : '-')).join('');
    fs.writeFileSync(path.join(SHOTS, safe + '.png'), png);
    chk(`'${name}' draws a real picture (not blank)`, colors > 12, `${colors} colours`);
  }

  section("the shapes settle at their own half-height");
  f = await run(page, await page.evaluate(() => EXAMPLES['All the shapes']), 420);
  const rest = await f.evaluate(() => [...__spashial.solids].filter(a => a._collider === 'dynamic').map(a => [a._shape, a._rec.def.h / 2, a._cur.p[1]]));
  chk("all six shapes rest on the floor", rest.length === 6 && rest.every(([, h2, y]) => near(y, h2, 0.1)), rest);

  section("the walking example can jump only from the ground");
  f = await run(page, await page.evaluate(() => EXAMPLES['Walk and jump (WASD + Space)']), 120);
  await page.click('#frame');
  const y0 = await f.evaluate(() => [...__spashial.solids].find(a => a._rec.def.lockRotation)._cur.p[1]);
  await page.keyboard.press('Space');
  await f.waitForFunction('window.frameCount >= 140', null, { timeout: 60000 });
  const y1 = await f.evaluate(() => [...__spashial.solids].find(a => a._rec.def.lockRotation)._cur.p[1]);
  chk("Space on the ground makes the player jump", y1 > y0 + 0.4, [y0, y1]);
} catch (err) {
  console.log('\nERROR  ' + (err && err.stack || err));
  checks++; check('the test ran to completion', false, String(err && err.message || err));
} finally {
  await env.close();
}

console.log(`\n${checks} checks in ${((Date.now() - T0) / 1000).toFixed(0)} s`);
done();

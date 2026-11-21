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
  // Wait for the run's own outcome ('running', or an error), not just any text: messages the PREVIOUS
  // sketch posted late (e.g. three.js warnings after a bad texture) land in the cleared log too, and
  // would otherwise be taken for this run having started.
  await page.waitForFunction("(() => { const t = document.getElementById('log').innerText; return t.includes('running') || /rror|\\(line \\d+\\)/.test(t); })()", null, { timeout });
  // The sandbox points the iframe at about:blank and then at the runner; the log can fill a moment
  // before Playwright sees the runner's frame, so wait for it rather than finding null.
  let f = await runnerFrame(page, timeout);
  if ((await page.innerText('#log')).includes('running') && frames) {
    // Also wait for the engine global: right after a re-point, Playwright can briefly hand back the
    // frame the log message came from before its document is the new runner (seen once as
    // "__spashial is not defined"). Retry against the current runner frame until it is live.
    const end = Date.now() + timeout;
    for (;;) {
      try {
        f = await runnerFrame(page, timeout);
        await f.waitForFunction(`window.__spashial && window.frameCount >= ${frames}`, null, { timeout: Math.max(1000, end - Date.now()) });
        break;
      } catch (err) {
        if (Date.now() > end) throw err;
        await page.waitForTimeout(100);
      }
    }
  }
  return f;
}
async function runnerFrame(page, timeout = T) {
  // The runner frame of the CURRENT Run: the sandbox gives each Run its own ?r=<serial> url in the
  // iframe's src attribute (about:blank first, then the runner), and after a re-point Playwright can
  // still list the previous run's frame, so match on the exact url rather than "contains runner.html".
  const end = Date.now() + timeout;
  for (;;) {
    const src = await page.getAttribute('#frame', 'src');
    const f = page.frames().find((fr) => fr !== page.mainFrame() && src && fr.url() === src && src.includes('runner.html'));
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
  let e;
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

  const GLB_JS = String.raw`// Builds a tiny .glb in memory so this example needs no file. A real sketch uses a .glb file:
// solid.model = 'https://.../ship.glb', or registerModel('ship', url) then solid.model = 'ship'.
function makeGlb(tris) {
  const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    const [a, b, c] = t, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1; n = n.map((x) => x / len);
    t.forEach((p, k) => { pos.set(p, i * 9 + k * 3); nor.set(n, i * 9 + k * 3); });
  });
  const bin = new Uint8Array(pos.byteLength * 2);
  bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(nor.buffer), pos.byteLength);
  const all = tris.flat(), count = tris.length * 3;
  const min = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]))), max = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.4, 0.9, 1, 1], metallicFactor: 0.3, roughnessFactor: 0.4 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5126, count, type: 'VEC3' }] });
  const jb = new TextEncoder().encode(json + ' '.repeat((4 - json.length % 4) % 4)), total = 20 + jb.length + 8 + bin.length;
  const out = new DataView(new ArrayBuffer(total));
  out.setUint32(0, 0x46546C67, true); out.setUint32(4, 2, true); out.setUint32(8, total, true);
  out.setUint32(12, jb.length, true); out.setUint32(16, 0x4E4F534A, true); new Uint8Array(out.buffer).set(jb, 20);
  out.setUint32(20 + jb.length, bin.length, true); out.setUint32(24 + jb.length, 0x004E4942, true); new Uint8Array(out.buffer).set(bin, 28 + jb.length);
  return URL.createObjectURL(new Blob([out.buffer]));
}
// A crystal: two pyramids base to base, as triangles (three corners each).
function crystal() {
  const top = [0, 1.5, 0], bottom = [0, -1.5, 0], r = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]], t = [];
  for (let i = 0; i < 4; i++) { t.push([top, r[(i + 1) % 4], r[i]]); t.push([bottom, r[i], r[(i + 1) % 4]]); }
  return t;
}
`;
  section("models (glTF)");
  r = await result(GLB_JS + String.raw`
    function preload() { registerModel('crystal', makeGlb(crystal())); window.__early = loadModel('crystal').ready; }
    function setup() {
      const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
      const a = new Solid(0, 2, 0, 1.6, 2.4, 1.6); const before = { vis: a._material.visible, model: a.model };
      a.model = 'crystal';
      const out = { early: window.__early, atSetup: loadModel('crystal').ready, names: modelNames(), before, drawn: a._modelObj !== null, shapeHidden: a._material.visible === false,
        scale: a._modelObj.scale.x, centred: a._modelObj.position.length(), model: a.model };
      out.errs = { unknown: t(() => { a.model = 'nope'; }), type: t(() => { a.model = 5; }), noModelHull: t(() => { new Solid(0, 0, 0).shape = 'hull'; }), still: a.model };
      const c = a.clone(); out.clone = c.model;
      const g = new Group(); const m = g.newSolid(5, 0, 0); g.model = 'crystal'; out.group = [m.model, m._modelObj !== null];
      a.shape = 'hull';
      const pts = a._rec.def.points; let hi = [-9, -9, -9], lo = [9, 9, 9]; for (const p of pts) for (let k = 0; k < 3; k++) { hi[k] = Math.max(hi[k], p[k]); lo[k] = Math.min(lo[k], p[k]); }
      out.hull = { shape: a.shape, n: pts.length, size: hi.map((v, k) => +(v - lo[k]).toFixed(2)), wh: [a.w, a.h, a.d].map((v) => +v.toFixed(2)), still: a._modelObj !== null };
      a.model = null; out.cleared = [a.model, a._modelObj, a._material.visible];
      window.__r = out; }`, 3);
  chk("loadModel is NOT ready at the start of preload() and IS by setup(); registerModel shows in modelNames()", r.early === false && r.atSetup === true && eq(r.names, ['crystal']), r);
  chk("a model draws instead of the shape (shape hidden), fitted into the box and centred",
    r.drawn && r.shapeHidden && Math.abs(r.scale - 0.8) < 1e-6 && r.centred < 1e-6 && r.model === 'crystal' && eq(r.before, { vis: true, model: null }), r);
  e = r.errs;
  chk("a wrong model explains itself and changes nothing",
    e.unknown.includes("no model called 'nope'") && e.unknown.includes('registerModel') && e.type.includes('model must be a name') && e.noModelHull.includes("shape = 'hull' wraps a model") && e.still === 'crystal', e);
  chk("a clone and a Group keep the model", r.clone === 'crystal' && eq(r.group, ['crystal', true]), r);
  const hl = r.hull;
  chk("shape = 'hull' wraps the model (a hull from its own points, sized to the fitted crystal) and the model still draws",
    hl.shape === 'hull' && hl.n >= 6 && eq(hl.size, [1.6, 2.4, 1.6]) && eq(hl.wh, [1.6, 2.4, 1.6]) && hl.still, hl);
  chk("model = null goes back to drawing the shape", eq(r.cleared, [null, null, true]), r.cleared);

  r = await result("function setup() { const a = new Solid(0, 2, 0); a.model = 'data:model/gltf-binary;base64,AAAA'; window.__r = { model: a.model, vis: a._material.visible }; }", 2);
  await page.waitForTimeout(1000);
  chk("a model that cannot be loaded says so in plain words and the shape stays", (await log(page)).includes('could not be loaded') && (await log(page)).includes('running') && r.vis === true, await log(page));

  section("sound (a real browser AudioContext)");
  r = await result(String.raw`function wavUrl() { const n = 4410, rate = 44100, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i * 2 * Math.PI * 440 / rate) * 12000, true);
      return URL.createObjectURL(new Blob([buf])); }
    let beep; function preload() { registerSound('beep', wavUrl()); beep = loadSound('beep'); window.__early = beep.loaded; }
    function setup() { const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
      const coin = loadSound('coin'); window.__snd = beep; window.__coin = coin;
      window.__r = { early: window.__early, atSetup: beep.loaded, dur: +beep.duration.toFixed(3), coinDur: +coin.duration.toFixed(2), names: soundNames(),
        errs: { unknown: t(() => loadSound('nope')), vol: t(() => { beep.volume = 'loud'; }), rate: t(() => { beep.rate = 0; }), reg: t(() => registerSound('x')) }, master: masterVolume() }; }`, 2);
  chk("a registered sound file is NOT loaded at the start of preload() and IS by setup() (a real decode)", r.early === false && r.atSetup === true && Math.abs(r.dur - 0.1) < 0.002, r);
  chk("the built-in sounds are made in code (coin has a real length) and soundNames lists them with registered ones",
    0.1 < r.coinDur && r.coinDur < 1.0 && eq(r.names, ['beep', 'blip', 'coin', 'explode', 'hit', 'jump', 'laser', 'pop', 'thud']), r);
  e = r.errs;
  chk("wrong sound arguments explain themselves", e.unknown.includes("no sound called 'nope'") && e.unknown.includes("'coin'") && e.vol.includes('volume must be a number') && e.rate.includes('rate') && e.reg.includes('registerSound'), e);
  await page.locator('#frame').click(); await page.waitForTimeout(300);
  const st = await (await runnerFrame(page)).evaluate(() => { const s = window.__snd, c = window.__coin; const out = {};
    out.play = typeof s.play(); out.playing = s.playing; out.blocked = s.blocked;
    s.stop(); out.stopped = !s.playing;
    s.loop(); out.looping = s.playing; s.pause(); out.paused = [s.paused, s.playing]; s.stop();
    const where = { x: 3, y: 0, z: 0 }; c.playAt(where); c.playAt(1, 2, 3); c.playAt([0, 0, -50]); out.at = c.playing;
    s.volume = 0.4; s.pan = -0.5; s.rate = 1.5; out.set = [s.volume, s.pan, s.rate];
    s.fade(0, 0.2); masterVolume(0.5); out.master = masterVolume();
    return out; });
  chk("after the first click a sound plays, loops, pauses and stops, and the browser did not block it", st.play === 'object' && st.playing && st.blocked === false && st.stopped && st.looping && eq(st.paused, [true, false]), st);
  chk("playAt takes numbers, a list or a Solid; volume, pan, rate, fade and masterVolume work", st.at === true && eq(st.set, [0.4, -0.5, 1.5]) && st.master === 0.5, st);

  section("saving (storeItem / getItem) and the collider outline (debug)");
  // the host page keeps saved values in localStorage; start clean so the section is repeatable
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  r = await result(String.raw`function setup() {
    const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
    storeItem('n', 7); storeItem('s', 'hi'); storeItem('o', { a: [1, 2, { b: 'x' }], flag: true }); storeItem('hiscore', 42);
    const circ = {}; circ.me = circ;
    window.__r = { n: getItem('n'), s: getItem('s'), o: getItem('o'), missing: getItem('nope'), type: typeof getItem('n'),
      errs: { fn: t(() => storeItem('f', () => 1)), undef: t(() => storeItem('u', undefined)), circ: t(() => storeItem('c', circ)), name: t(() => storeItem(5, 1)), big: t(() => storeItem('big', 'x'.repeat(120000))), get: t(() => getItem()) } };
    removeItem('s'); window.__r.removed = getItem('s'); window.__r.kept = getItem('n'); }`, 2);
  chk("storeItem saves numbers, text, lists and objects and getItem reads them back (null when missing)", r.n === 7 && r.s === 'hi' && eq(r.o, { a: [1, 2, { b: 'x' }], flag: true }) && r.missing === null && r.type === 'number', r);
  chk("removeItem forgets one value and keeps the others", r.removed === null && r.kept === 7, r);
  e = r.errs;
  chk("things that cannot be saved explain themselves",
    e.fn.includes('cannot save a function') && e.undef.includes('cannot save undefined') && e.circ.includes('refers to itself') && e.name.includes('needs a name') && e.big.includes('too big to save') && e.get.includes('needs a name'), e);
  r = await result("function setup() { window.__r = { hiscore: getItem('hiscore'), n: getItem('n'), o: getItem('o') }; storeItem('plain', 1); storeItem('texture:art', 'data:x'); }", 2);
  chk("a value saved in one Run is there in the next (the host page keeps it)", r.hiscore === 42 && r.n === 7 && r.o.flag === true, r);
  r = await result("function setup() { clearStorage(); window.__r = { plain: getItem('plain'), hiscore: getItem('hiscore'), art: getItem('texture:art') }; }", 2);
  chk("clearStorage forgets saved values but never the student's art (texture:, sound:, font:, model: ...)", r.plain === null && r.hiscore === null && r.art === 'data:x', r);
  r = await result("function setup() { window.__r = { plain: getItem('plain'), art: getItem('texture:art') }; }", 2);
  chk("and that holds in the next Run too (the host applied the same clear)", r.plain === null && r.art === 'data:x', r);

  r = await result(String.raw`let a, c; function setup() {
    const lines = () => __spashial.scene.children.filter((o) => o.isLineSegments);
    a = new Cube(0, 4, 0, 1); const none = lines().length; a.debug = true; const one = lines().length;
    const verts = lines()[0].geometry.getAttribute('position').count;
    const tor = new Torus(5, 0, 0); tor.debug = true; const torusVerts = lines()[1].geometry.getAttribute('position').count;
    const h = new Hull(8, 0, 0, [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 1.4, 0]]); h.debug = true; const three = lines().length;
    window.__s = { none, one, verts, torusVerts, three }; world.gravity.y = -10; new Floor(); }
    function update() { if (frameCount === 20) { const l = __spashial.scene.children.filter((o) => o.isLineSegments)[0];
      window.__r = { ...window.__s, follows: Math.abs(l.position.y - a._mesh.position.y) < 1e-6, moved: a.y < 3.5, scaleFree: l.scale.x === 1 };
      a.scale = 3; a.debug = false; window.__r.off = __spashial.scene.children.filter((o) => o.isLineSegments).length; } }`, 22);
  chk("debug draws the collider as green lines (a box, a torus ring of capsules, a hull) and turning it off removes them", r.none === 0 && r.one === 1 && r.verts > 0 && r.torusVerts > r.verts && r.three === 3 && r.off === 2, r);
  chk("the outline follows the solid as it falls and does not take the visual scale", r.follows && r.moved && r.scaleFree, r);

  section("online play between two tabs (no server: BroadcastChannel)");
  const octx = await env.browser.newContext({ viewport: { width: 1280, height: 760 } });
  const t1 = await octx.newPage(), t2 = await octx.newPage();
  for (const t of [t1, t2]) {
    await t.goto(URL);
    await t.evaluate(() => window.examplesReady);
    await t.selectOption('#examples', { label: 'Online (open two tabs)' });
    await t.waitForFunction("(() => { const x = document.getElementById('log').innerText; return x.includes('running') || /rror/.test(x); })()", null, { timeout: 90000 });
  }
  const of1 = await runnerFrame(t1, 90000), of2 = await runnerFrame(t2, 90000);
  await of1.waitForFunction('window.frameCount >= 5', null, { timeout: 90000 }); await of2.waitForFunction('window.frameCount >= 5', null, { timeout: 90000 });
  chk("multiplayer('coop', 2) shows the lobby bar above the picture", (await t1.locator('#lobby.on').count()) === 1 && (await t1.innerText('#lobby')).includes('Host a game'), await t1.innerText('#lobby'));
  await t1.click('#lobby >> text=Host a game');
  await t1.waitForFunction("document.querySelector('#lobby .code')", null, { timeout: 20000 });
  const code = await t1.innerText('#lobby .code');
  chk("hosting gives a 4-letter room code and a seat", code.length === 4 && (await t1.innerText('#lobby')).includes('seat 1 of 2'), await t1.innerText('#lobby'));
  await t2.fill('#lobby input', code.toLowerCase()); await t2.click('#lobby >> text=Join');
  await t2.waitForFunction("document.querySelector('#lobby .code')", null, { timeout: 20000 });
  for (const fr of [of1, of2]) await fr.waitForFunction("online.status === 'ready'", null, { timeout: 20000 });
  const sts = [];
  for (const fr of [of1, of2]) sts.push(await fr.evaluate(() => ({ status: online.status, code: online.code, seat: online.seat, seats: online.seats })));
  chk("the second tab joins by code: both are ready, same code, seats 0 and 1", sts[0].status === 'ready' && sts[1].status === 'ready' && sts[0].code === code && sts[1].code === code && eq([sts[0].seat, sts[1].seat], [0, 1]), sts);
  await of1.evaluate(() => { window.__moves = []; online.onMove((m, seat) => window.__moves.push([m.n, seat])); });
  await of2.evaluate(() => { window.__moves = []; online.onMove((m, seat) => window.__moves.push([m.n, seat])); });
  await of1.evaluate(() => { online.send({ n: 1 }); online.send({ n: 3 }); }); await of2.evaluate(() => { online.send({ n: 2 }); });
  await t1.waitForTimeout(1500);
  const m1 = await of1.evaluate(() => window.__moves), m2 = await of2.evaluate(() => window.__moves);
  chk("every move reaches BOTH tabs, the sender's own included, in the same order, with the right seat numbers",
    eq(m1, m2) && eq(m1.map((x) => x[0]).sort(), [1, 2, 3]) && m1.every((x) => (x[1] === 0) === [1, 3].includes(x[0])), [m1, m2]);
  await t1.waitForTimeout(1000);
  const g = [];
  for (const fr of [of1, of2]) g.push(await fr.evaluate(() => { const p = online.peers; return { seats: Object.keys(p), n: Object.values(p).flat().length, kind: Object.values(p).flat().map((s) => [s.collider, s.shape]) }; }));
  chk("each tab sees the other player's shared cube as a ghost Solid (collider 'none')", g.every((x) => x.n === 1 && eq(x.kind, [['none', 'box']])) && eq(g[0].seats, ['1']) && eq(g[1].seats, ['0']), g);
  await of1.evaluate(() => { me.pos = [4, 3, -2]; me.vel = [0, 0, 0]; world.gravity.y = 0; });
  await t1.waitForTimeout(1500);
  const gp = await of2.evaluate(() => { const s = online.peers[0][0]; return { pos: [s.x, s.y, s.z], color: s.color }; });
  chk("when one tab moves its cube the other tab's ghost goes there", Math.abs(gp.pos[0] - 4) < 0.1 && Math.abs(gp.pos[1] - 3) < 0.1 && Math.abs(gp.pos[2] + 2) < 0.1, gp);
  await of1.evaluate(() => { me.rotation = [0, 90, 0]; }); await t1.waitForTimeout(1200);
  const rot = await of2.evaluate(() => { const s = online.peers[0][0]; return s.rotation.y; });
  chk("and the ROTATION crosses too (a 3D pose, not x and y)", Math.abs(Math.abs(rot) - 90) < 2, rot);
  chk("the ghost has the sender's colour", gp.color === 'tomato', gp);
  await of1.evaluate(() => { me.w = 2.5; me.h = 2.5; me.d = 2.5; }); await t1.waitForTimeout(1500);
  const gs = await of2.evaluate(() => { const g = online.peers[0][0]; return { shape: g.shape, size: [g.w, g.h, g.d].map((v) => +v.toFixed(2)), debugSize: g._rec.def.w }; });
  chk("a peer that resizes its cube: the ghost's size follows (picture AND sensor)", eq(gs.size, [2.5, 2.5, 2.5]) && gs.debugSize === 2.5, gs);
  await of1.evaluate(() => { me.shape = 'sphere'; }); await t1.waitForTimeout(1500);
  chk("a peer that changes its cube into a sphere: the ghost becomes a sphere", (await of2.evaluate(() => online.peers[0][0].shape)) === 'sphere', '');
  let n0 = await of2.evaluate(() => { const g = online.peers[0][0]; g.remove(); return [online.sharedBy(0).includes(g), Object.values(online.peers).flat().includes(g)]; });
  chk("a deleted ghost is not in sharedBy() or peers THE SAME INSTANT (not only on the next frame)", eq(n0, [false, false]), n0);
  n0 = 0;
  await t1.waitForTimeout(1500);
  const n1 = await of2.evaluate(() => ({ n: Object.values(online.peers).flat().length, alive: Object.values(online.peers).flat().every((g) => !g.removed) }));
  chk("a sketch that deletes a ghost: it is no longer listed, and the peer's next share makes a fresh live one", [0, 1].includes(n0) && n1.n === 1 && n1.alive, [n0, n1]);
  await of1.evaluate(() => { me.w = 0.0004; me.h = 0.0004; me.d = 0.0004; }); await t1.waitForTimeout(1500);
  const tiny = await of2.evaluate(() => { const g = online.peers[0][0]; return { w: g.w, ok: !g.removed }; });
  const log2 = await t2.innerText('#log');
  chk("a peer's tiny cube (0.4 mm) is still a cube on the other tab, not a size of 0 that errors", tiny.ok && tiny.w > 0 && !log2.includes('must be above 0'), [tiny, log2.slice(0, 120)]);
  await of1.evaluate(() => { window.update = () => {}; me.color = 'rgb(255, 0, 0) '; }); await t1.waitForTimeout(1500);
  const gc = await of2.evaluate(() => online.peers[0][0].color);
  chk("a colour the sketch wrote with stray spaces still reaches the ghost (in a form the room accepts)", gc.toLowerCase().includes('ff0000') || gc.replace(/ /g, '').toLowerCase().startsWith('rgb(255,0,0'), gc);
  await of1.evaluate(() => { me.texture = null; me.color = 128; }); await t1.waitForTimeout(1500);
  const gg = await of2.evaluate(() => online.peers[0][0].color);
  chk("a grey written as a number (128) is the same grey on the other tab (#808080, not #000080)", gg.toLowerCase() === '#808080', gg);
  await of1.evaluate(() => { me._colorSet = false; me.texture = 'checker'; }); await t1.waitForTimeout(1500);
  const gt = await of2.evaluate(() => online.peers[0][0].color);
  chk("a textured solid whose colour was never set (it draws white) has a white ghost, not the default cyan", ['#ffffff', 'white'].includes(gt.toLowerCase()), gt);
  await of1.evaluate(() => { window.flat = new TriangleMesh(20, 5, 0, [[0, 0, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 2]]); online.share(flat); }); await t1.waitForTimeout(1500);
  const fl = await of2.evaluate(() => Object.values(online.peers).flat().length);
  const log3 = await t2.innerText('#log');
  chk("a peer's FLAT triangle mesh (no thickness) still gets a ghost on the other tab, not 'h must be above 0'", fl >= 2 && !log3.includes('must be above 0'), [fl, log3.slice(0, 120)]);
  await t1.click('#lobby >> text=Leave');
  await t1.waitForTimeout(1500);
  const left = await of2.evaluate(() => ({ n: Object.values(online.peers).flat().length, status: online.status }));
  chk("when the host leaves, the room closes for the other tab and the ghost goes", left.n === 0 && ['closed', 'waiting', 'off', 'error'].includes(left.status), left);
  await octx.close();

  section("council review fixes (things that worked alone but broke together)");
  r = await result(String.raw`let g, zone, visits = 0; function setup() {
      zone = new Cube(0, 1, 0, 10, 2, 10, 'none'); g = new Group(); g.collider = 'dynamic';
      for (let i = 0; i < 5; i++) g.newSolid(i - 2, 1, 0, 0.5); }
      function update() { if (frameCount === 6) { g.overlaps(zone, (s) => { visits++; s.remove(); }); window.__r = { visits, left: g.length }; } }`, 8);
  chk("removing group members inside a touch callback does not skip any (5 visited, none left)", eq(r, { visits: 5, left: 0 }), r);

  r = await result(String.raw`function setup() {
      const t = (f) => { try { f(); return ''; } catch (e) { return e.name; } };
      const bad = new Group(); bad.texture = 'nope'; const before = allSolids.length;
      const one = t(() => new bad.Solid(0, 0, 0)); const afterOne = allSolids.length - before;
      const two = t(() => new Tiles([['###']], 0, 0, 0, 1, { '#': bad }));
      window.__r = { one, afterOne, two, afterTiles: allSolids.length - before, members: bad.length }; }`, 2);
  chk("a group default that throws leaves NO live solid behind (a Solid, or a whole Tiles level)", r.one === 'TypeError' && r.afterOne === 0 && r.two === 'TypeError' && r.afterTiles === 0 && r.members === 0, r);

  r = await result(GLB_JS + String.raw`
      function preload() { registerModel('crystal', makeGlb(crystal())); loadModel('crystal'); }
      function setup() { const s = new Solid(0, 2, 0, 1.6, 2.4, 1.6); s.model = 'crystal'; s.shape = 'hull'; const c = s.clone();
        const d = new Solid(5, 2, 0, 1.6, 2.4, 1.6); d.model = 'crystal'; d.opacity = 0.3; const e = new Solid(9, 2, 0, 1.6, 2.4, 1.6); e.model = 'crystal';
        window.__r = { cloneShape: c.shape, cloneHullPts: c._rec.def.points.length > 3, cloneModel: c.model, sameSize: [c.w, c.h, c.d].map((v) => +v.toFixed(2)),
          op: d._modelMats.map((m) => +m.opacity.toFixed(2)), transparent: d._modelMats.every((m) => m.transparent), other: e._modelMats.map((m) => m.opacity) }; }`, 2);
  chk("cloning a hull wrapped round a model keeps the hull collider and the model", r.cloneShape === 'hull' && r.cloneHullPts && r.cloneModel === 'crystal' && eq(r.sameSize, [1.6, 2.4, 1.6]), r);
  chk("opacity reaches a model (and is that solid's own, not every solid's that uses the same file)", r.op.length > 0 && r.op.every((v) => v === 0.3) && r.transparent && r.other.every((v) => v === 1), r);

  r = await result(String.raw`let back, front, phase = 0, got = {}; function setup() {
      camera.pos = [0, 1, 10]; camera.lookAt(0, 1, 0);
      back = new Cube(0, 1, 0, 2, 2, 2, 'static'); front = new Cube(0, 1, 3, 2, 2, 2, 'static'); front.visible = false; }
      function update() {
        if (frameCount === 10) { mouse.x = width / 2; mouse.y = height / 2; got.pick = world.getSolidAt(width / 2, height / 2) === back; got.enter = [back.mouse.hovers(), back.mouse.hovered()]; }
        if (frameCount === 11) { got.still = [back.mouse.hovers(), back.mouse.hovered()]; }
        if (frameCount === 12) { mouse.x = -50; mouse.y = -50; got.exitAskedHoversFirst = [back.mouse.hovers(), back.mouse.hovered()]; got.exitAgain = [back.mouse.hovers(), back.mouse.hovered()]; window.__r = got; } }`, 14);
  chk("picking skips an invisible solid in front (the pointer is on what you can see)", r.pick === true, r);
  chk("hovers() and hovered() agree whichever is asked first, and an enter/exit is seen once per tick", eq(r.enter, [true, false]) && eq(r.still, [false, false]) && eq(r.exitAskedHoversFirst, [false, true]) && eq(r.exitAgain, [false, true]), r);

  r = await result(String.raw`function setup() { storeItem('__proto__', 7); storeItem('score', 9); window.__r = { proto: getItem('__proto__'), score: getItem('score') }; }`, 2);
  chk("a saved value named __proto__ is just a value (it used to vanish)", eq(r, { proto: 7, score: 9 }), r);
  r = await result(String.raw`function setup() { window.__r = { proto: getItem('__proto__'), score: getItem('score') }; }`, 2);
  chk("and it is still there in the next Run, through the host", eq(r, { proto: 7, score: 9 }), r);

  section("council round 2 (Opus): what a game does every day");
  r = await result(String.raw`let p, g = []; function setup() { world.gravity.y = -10; new Floor(); p = new Cube(0, 6, 0, 1); p.lockRotation = true; p.friction = 0; }
      const grounded = () => !!world.rayCast(p.pos, [p.x, p.y - 0.6, p.z]);
      function update() { if (frameCount === 2) g.push(['airborne', grounded()]); if (frameCount === 150) { g.push(['landed', grounded()]); window.__r = g; } }`, 152);
  chk("the 'am I on the ground?' ray from the player's own centre is false in mid-air and true on the floor (it used to be true always: you could jump in the air)", eq(r, [['airborne', false], ['landed', true]]), r);

  r = await result(String.raw`let s, fl, hits = [], t; function setup() { world.gravity.y = -10; fl = new Floor(); s = new Cube(0, 3, 0, 1); s.bounciness = 0; }
      function update() { s.collides(fl, (self, other, hit) => { if (!hits.length) hits.push({ speed: +hit.speed.toFixed(3), ny: +hit.normal.y.toFixed(2), py: +hit.point.y.toFixed(2), other: other === fl }); }); fl.collides(s, (self, other, hit) => { if (hits.length === 1) hits.push({ fromFloorNy: +hit.normal.y.toFixed(2) }); });
        if (frameCount === 90) { const ignoring = world.rayCast(0, 5, 0, 0, -5, 0, { ignore: s }); const plain = world.rayCast(0, 5, 0, 0, -5, 0); const bare = world.rayCast([0, 5, 0], [0, -5, 0], s), bareAll = world.rayCastAll([0, 5, 0], [0, -5, 0], s); window.__r = { hits, ignoreHitsFloor: ignoring && ignoring.solid === fl, plainHitsCube: plain && plain.solid === s, bareSkipsShooter: bare && bare.solid === fl && bareAll.every((h) => h.solid !== s) }; } }`, 92);
  chk("a collision callback gets the impact: speed (units per frame), a normal from the solid you asked toward the other, and the point",
    r.hits.length >= 2 && Math.abs(r.hits[0].speed - 0.118) < 0.02 && r.hits[0].ny < -0.9 && r.hits[0].other === true && Math.abs(r.hits[0].py) < 0.1 && r.hits[1].fromFloorNy > 0.9, r);
  chk("a ray can ignore the solid in its way ({ ignore: solid })", r.ignoreHitsFloor === true && r.plainHitsCube === true, r);
  chk("world.rayCast(from, to, shooter) with the shooter written bare skips it too (it used to be silently ignored)", r.bareSkipsShooter === true, r);

  // council round 3 (Sol): collider changes, new walls, clones of reshaped solids, group defaults, constructors that fail
  r = await result(String.raw`function setup() {
        world.autoStep = false; const step = (n) => { for (let i = 0; i < n; i++) world.physicsUpdate(); }; const out = {};
        const floor = new Floor(); const sleeper = new Cube(0, 0.5, 0); world.gravity.y = -10; step(200);
        const wall = new Cube(0.3, 1.5, 0, 1, 3, 3, 'static'); step(30); out.newWall = { moved: Math.abs(sleeper.x) > 0.4, awake: !sleeper.sleeping };
        wall.remove(); step(200);
        sleeper.collider = 'static'; sleeper.pos.y = 5; step(120); out.becameStatic = { touching: sleeper.colliding(floor), y: sleeper.y };
        const zone = new Cube(0, -0.7, 0, 1, 'none'); step(1); zone.collider = 'dynamic'; step(1);
        let hasHit = false; zone.colliding(floor, (a, b, hit) => { hasHit = !!hit; }); out.sensorToSolid = { collides: zone.collides(floor), impact: hasHit };
        const moved = new Cube(7, 5, 0, 1, 'static'); moved.shape = 'sphere'; moved.metalness = 0.7; moved.roughness = 0.1; const cl = moved.clone(); cl.x = 9;
        out.clone = { shape: cl.shape, m: cl.metalness, r: cl.roughness, boxCorner: world.rayCast([9.4, 6, 0.4], [9.4, 4, 0.4])?.solid === cl };
        const before = allSolids.amount; try { new Hull(0, 0, 0, [[0,0,0],[1,0,0],[0,1,0],[]]); } catch (e) {} try { new TriangleMesh(0, 0, 0, [[0,0,0],[1,0,0],[0,1,0]], [[0,1,2]], 'bouncy'); } catch (e) {} out.leftOver = allSolids.amount - before;
        const g = new Group(); g.mass = 3; g.density = 2; g.mass = 3; out.groupMass = +g.newSolid(15, 0, 0).mass.toFixed(2);
        const flat = new TriangleMesh(30, 5, 0, [[0,0,0],[1,0,0],[0,0,1]], [[0,1,2]]); window.__flatOk = flat.h;
        window.__r = out; world.gravity.y = 0;
      }`, 2);
  chk("a wall built through a sleeper wakes and pushes it", r.newWall.moved && r.newWall.awake, r.newWall);
  chk("a solid turned static and moved away no longer counts as touching the floor", r.becameStatic.touching === 0 && r.becameStatic.y === 5, r.becameStatic);
  chk("a sensor turned solid collides with what it overlapped, with an impact", r.sensorToSolid.collides === true && r.sensorToSolid.impact, r.sensorToSolid);
  chk("a clone of a reshaped Cube is the same shape and material, not a fresh box", r.clone.shape === 'sphere' && r.clone.m === 0.7 && r.clone.r === 0.1 && r.clone.boxCorner === false, r.clone);
  chk("a Hull or TriangleMesh that is refused leaves no solid behind", r.leftOver === 0, r.leftOver);
  chk("a group's defaults replay in the order they were last set (mass, density, mass again = the mass)", r.groupMass === 3, r.groupMass);

  // council round 3 (Opus): clones keep a changed shape, a visible 'none' solid can be pointed at
  r = await result(String.raw`let coin, hid; function setup() {
        world.gravity.y = 0; camera.pos = [0, 0, 10]; camera.lookAt(0, 0, 0);
        new Cube(0, 0, 0, 2, 2, 2, 'static'); coin = new Sphere(0, 0, 3, 1, 'none');
        const a = new Solid(5, 0, 0); a.shape = 'sphere'; const b = new Sphere(8, 0, 0); b.shape = 'box'; const t = new Solid(11, 0, 0); t.shape = 'torus';
        window.__shapes = [a.clone().shape, b.clone().shape, t.clone().shape];
      }
      function update() { if (frameCount === 3) { const hit = world.getSolidAt(width / 2, height / 2); coin.visible = false; const through = world.getSolidAt(width / 2, height / 2); coin.visible = true; coin.opacity = 0; const clear = world.getSolidAt(width / 2, height / 2); window.__r = { shapes: window.__shapes, pickedCoin: hit === coin, hiddenSeenThrough: through !== coin && through !== undefined, clearSeenThrough: clear !== coin && clear !== undefined }; } }`, 5);
  chk("a clone keeps a shape changed after it was made (Solid->sphere, Sphere->box, Solid->torus)", eq(r.shapes, ['sphere', 'box', 'torus']), r.shapes);
  chk("the mouse can point at a visible 'none' solid (a coin, a button); hidden, it is looked through", r.pickedCoin === true && r.hiddenSeenThrough === true, r);
  chk("a fully transparent solid is looked through by the mouse too", r.clearSeenThrough === true, r);

  // council round 4 (Sol): clones keep size and mass, group mass order, live lock and scale parts, Group.amount, teleports
  r = await result(String.raw`function setup() {
        world.autoStep = false; const step = (n) => { for (let i = 0; i < n; i++) world.physicsUpdate(); }; world.gravity.y = 0; const out = {};
        new Floor();
        const sp = new Sphere(0, 5, 0); sp.shape = 'box'; sp.w = 2; sp.h = 1; sp.d = 3; const sc = sp.clone();
        out.cloneBox = { size: [sc.w, sc.h, sc.d], mass: +sc.mass.toFixed(2), orig: +sp.mass.toFixed(2), shape: sc.shape };
        const tor = new Torus(10, 5, 0); tor.shape = 'sphere'; out.cloneTorus = tor.clone().shape;
        const stat = new Group(); stat.collider = 'static'; const m = stat.newSolid(20, 5, 0); m.collider = 'dynamic'; const mc = m.clone(); out.groupClone = { collider: mc.collider, inGroup: stat.includes(mc) };
        const g = new Group(); const first = g.newSolid(30, 5, 0); g.collider = 'static'; g.mass = 8; g.collider = 'dynamic'; out.groupMass = [+first.mass.toFixed(2), +g.newSolid(32, 5, 0).mass.toFixed(2)];
        const lk = new Cube(40, 5, 0); lk.lockPosition = { z: false }; lk.lockPosition.z = true; const lc = lk.clone(); lc.lockPosition.x = true;
        lk.vel.z = 1; step(2); out.lock = { z: lk.lockPosition.z, zMoved: +Math.abs(lk.z).toFixed(3), cloneIndependent: lk.lockPosition.x === false && lc.lockPosition.x === true };
        const ug = new Group(); const u = new Cube(50, 5, 0); ug.unshift(u); u.remove(); ug.amount = 0; out.unshift = ug.length;
        const big = new Cube(60, 5, 0); big.scale.x = 3; out.scale = [big.scale.x, big._mesh.scale.x];
        const cap = new Capsule(70, 5, 0, 2, 1, 2); out.capsule = cap.h;
        const kin = new Cube(80, 5, 0, 'kinematic'); kin.moveTo(81, 5, 0); kin.x = 85; step(2); out.glide = +kin.x.toFixed(2);
        out.floorClone = new Floor().clone().color === new Floor().color;
        const wallsG = new Group(); wallsG.collider = 'static'; wallsG.allowSleeping = false; wallsG.maxSpeed = 0.2; const door = wallsG.newSolid(90, 5, 0); door.collider = 'dynamic'; door.allowSleeping = true; door.maxSpeed = Infinity; const dc = door.clone();
        out.doorClone = [dc.collider, dc.allowSleeping, dc.maxSpeed === Infinity];
        const kc = new Cube(95, 5, 0, 'kinematic'); kc.mass = 5; kc.collider = 'dynamic'; out.kinMass = +kc.mass.toFixed(2);
        window.__r = out;
      }`, 2);
  chk("a Floor clone is the floor's colour; a group member's overrides survive cloning; mass set on a kinematic solid applies once it is dynamic", r.floorClone === true && eq(r.doorClone, ['dynamic', true, true]) && r.kinMass === 5, [r.floorClone, r.doorClone, r.kinMass]);
  chk("a clone of a Sphere reshaped into a 2 x 1 x 3 box keeps the shape, size and mass", r.cloneBox.shape === 'box' && eq(r.cloneBox.size, [2, 1, 3]) && r.cloneBox.mass === r.cloneBox.orig && r.cloneBox.orig === 6, r.cloneBox);
  chk("a Torus reshaped into a sphere clones without throwing", r.cloneTorus === 'sphere', r.cloneTorus);
  chk("a group member that overrode the group's static default clones as dynamic, not as the group's default", r.groupClone.collider === 'dynamic', r.groupClone);
  chk("group mass set while members were static still applies when they become dynamic (existing member and new ones agree)", eq(r.groupMass, [8, 8]), r.groupMass);
  chk("lockPosition parts can be set one at a time (and a clone's lock is its own)", r.lock.z === true && r.lock.zMoved < 0.01 && r.lock.cloneIndependent === true, r.lock);
  chk("Group.amount = 0 finishes even with an entry put in by unshift() that was already removed", r.unshift === 0, r.unshift);
  chk("solid.scale.x = 3 changes the picture", eq(r.scale, [3, 3]), r.scale);
  chk("a capsule is never shorter than it is wide", r.capsule >= 2, r.capsule);
  chk("moveTo followed by a teleport the same frame ends at the teleport, not past it", r.glide === 85, r.glide);

  // council round 5 (Sol): clones of reshaped floors and meshes, a flat mesh cannot become a box, picking skips scaled-to-nothing solids
  r = await result(String.raw`let btn; function setup() {
        world.gravity.y = 0; camera.pos = [0, 0, 10]; camera.lookAt(0, 0, 0); const out = {};
        const fl = new Floor(); fl.shape = 'cylinder'; out.floorClone = fl.clone().shape;
        const mesh = new TriangleMesh(5, 5, 0, [[0,0,0],[1,0,0],[0,0,1]], [[0,1,2]]);
        try { mesh.shape = 'box'; out.flat = 'allowed'; } catch (e) { out.flat = 'refused'; } out.flatStill = mesh.shape;
        const tall = new TriangleMesh(8, 5, 0, [[0,0,0],[1,0,0],[0,1,0]], [[0,1,2]]); tall.shape = 'sphere'; out.meshClone = tall.clone().shape;
        new Cube(0, 0, 0, 2, 2, 2, 'static'); btn = new Cube(0, 0, 3, 1, 'none'); btn.scale = 0;
        window.__out = out;
      }
      function update() { if (frameCount === 3) { window.__out.pickSkipsZeroScale = world.getSolidAt(width / 2, height / 2) !== btn && world.getSolidAt(width / 2, height / 2) !== undefined; window.__r = window.__out; } }`, 5);
  chk("a Floor reshaped into a cylinder clones as a cylinder; a mesh reshaped into a sphere clones as a sphere", r.floorClone === 'cylinder' && r.meshClone === 'sphere', [r.floorClone, r.meshClone]);
  chk("a FLAT triangle mesh cannot be turned into a box (no thickness): refused, and it stays a mesh", r.flat === 'refused' && r.flatStill === 'triangles', [r.flat, r.flatStill]);
  chk("the mouse looks through a solid scaled to nothing", r.pickSkipsZeroScale === true, r);

  // council round 5 (Opus): a student's own subclass clones, Group.remove() with nothing, a spinning platform still turns under moveTo
  r = await result(String.raw`class Coin extends Sphere { constructor(x, z) { super(x, 1, z, 0.5, 'none'); } }
      let sp, c, cl; function setup() {
        world.gravity.y = 0; const coin = new Coin(3, 4); cl = coin.clone(); const g = new Group(); let removeNothing = 'ok'; try { g.remove(); } catch (e) { removeNothing = e.message; }
        sp = new Cube(0, 5, 0, 2, 0.2, 2, 'kinematic'); sp.angularVelocity.y = 1.9099; // about 2 rad/s (degrees per frame)
        window.__ex = { clonePos: [cl.x, cl.z], removeNothing };
      }
      function update() { sp.moveTo(sp.x + 0.01, 5, 0); if (frameCount === 60) window.__r = { ...window.__ex, turned: Math.abs(sp.rotation.y) }; }`, 62);
  chk("a student's own subclass (its constructor takes x, z) clones at the same place", eq(r.clonePos, [3, 4]), r.clonePos);
  chk("group.remove() with nothing to remove does nothing, not a TypeError", r.removeNothing === 'ok', r.removeNothing);
  chk("a kinematic platform that is turning still turns while it moves with moveTo", r.turned > 50, r.turned);

  r = await result(String.raw`let side, free, c; function setup() { world.gravity.y = 0; side = new Cube(0, 2, 0, 1); side.lockPosition = { z: true }; free = new Cube(5, 2, 0, 1);
      side.vel = [0.05, 0, 0.05]; free.vel = [0.05, 0, 0.05]; side.lockRotation = true; side.mass = 7; side.allowSleeping = false; c = side.clone(); c.pos = [30, 2, 0]; c.vel = [0, 0, 0]; } // (a clone is made on top of its original: move it off)
      function update() { if (frameCount === 60) window.__r = { sideZ: +side.z.toFixed(3), sideX: +side.x.toFixed(2), freeZ: +free.z.toFixed(2), clone: [!!c.lockRotation, JSON.stringify(c.lockPosition), c.allowSleeping, +c.mass.toFixed(2)] }; }`, 62);
  chk("lockPosition { z: true } keeps a side-scroller in its plane while it still moves along x; a clone keeps lockRotation, lockPosition, allowSleeping and a set mass",
    r.sideZ === 0 && r.sideX > 2 && r.freeZ > 2 && eq(r.clone, [true, '{"x":false,"y":false,"z":true}', false, 7]), r);

  section("council round 2 (Sol): the edges of the round-1 fixes");
  r = await result(GLB_JS + String.raw`
      function preload() { registerModel('crystal', makeGlb(crystal())); loadModel('crystal'); }
      function setup() {
        const a = new Cube(0, 2, 0, 1.6, 2.4, 1.6); a.model = 'crystal'; a.shape = 'hull'; const c = a.clone();
        let disposed = 0; for (const m of a._modelMats) m.addEventListener('dispose', () => disposed++); const mats = a._modelMats.length; a.remove();
        const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
        const bad = new Group(); bad.texture = 'nope'; const groups0 = __spashial.groups.size; const e1 = t(() => new Tiles([['##']], 0, 0, 0, 1, { '#': bad })); const groupsLeft = __spashial.groups.size - groups0 - 0;
        window.__r = { cloneShape: c.shape, cloneIsCube: c instanceof Cube, mats, disposed, longKey: t(() => storeItem('x'.repeat(201), 1)), okKey: t(() => storeItem('x'.repeat(200), 1)), e1, groupsLeft }; }`, 2);
  chk("a Cube wrapped round a model keeps its hull collider when cloned, and removing it releases the model's materials", r.cloneShape === 'hull' && r.mats > 0 && r.disposed === r.mats, r);
  chk("a saved name the host would refuse (over 200 characters) is refused HERE, visibly, not lost on the next Run", r.longKey.includes('name is too long') && r.okKey === '', r);
  chk("a failed Tiles level leaves no empty group registered", r.e1.startsWith('TypeError') && r.groupsLeft === 0, r);

  r = await result(String.raw`let back, got = []; function setup() { camera.pos = [0, 1, 10]; camera.lookAt(0, 1, 0); back = new Cube(0, 1, 0, 2, 2, 2, 'static'); world.autoStep = false; }
      function draw() { const n = __spashial.frames;
        if (n === 8) { mouse.x = width / 2; mouse.y = height / 2; }
        if (n === 9) got.push(['in', back.mouse.hovers(), back.mouse.hovers()]);
        if (n === 10) { mouse.x = -50; mouse.y = -50; got.push(['out', back.mouse.hovered(), back.mouse.hovers()]); }
        if (n === 11) { got.push(['after', back.mouse.hovered()]); window.__r = got; } }`, 3);
  chk("hover is read once per DRAWN frame too (with autoStep off): enter, exit, then nothing", eq(r, [['in', true, true], ['out', true, false], ['after', false]]), r);

  section("Tiles (a level from text)");
  r = await result(String.raw`function setup() {
    const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
    const walls = new Group(); walls.collider = 'static'; walls.color = '#6272a4'; const coins = new Group(); coins.collider = 'none'; coins.color = 'gold';
    const level = new Tiles([['#####', '#.c.#', '#####'], ['#...#', '.....', '#...#']], 0, 0.5, 0, 1, { '#': walls, c: coins });
    const wallsAfterLevel = walls.length, before = allSolids.length;
    const first = level[0], last = level.find((s) => s.x === 4 && s.z === 2 && s.y === 0.5), up = level.find((s) => s.y === 1.5), coin = coins[0];
    const one = new Tiles(['##', '##'], 20, 0.5, 0, 2, { '#': walls }); const n0 = allSolids.length; t(() => new Tiles([['##', '#x']], 40, 0, 0, 1, { '#': walls })); const leftBehind = allSolids.length - n0;
    window.__r = { all: level.length, walls: wallsAfterLevel, coins: coins.length, first: [first.x, first.y, first.z], last: !!last, up: [up.x, up.z], coin: [coin.x, coin.y, coin.z, coin.collider],
      wall: [first.collider, first.color, first.w], isGroup: level instanceof Group, one: [one.length, one[0].w, one[3].x, one[3].z],
      leftBehind, errs: { char: t(() => new Tiles([['#x#']], 0, 0, 0, 1, { '#': walls })), legend: t(() => new Tiles([['#']], 0, 0, 0, 1, { '#': 5 })), shape: t(() => new Tiles(7, 0, 0, 0)), pos: t(() => new Tiles([['#']], 'a', 0, 0, 1, { '#': walls })) } }; }`, 2);
  chk("Tiles makes one solid per legend character (walls 16, one coin) and is a Group of them", r.all === 17 && r.walls === 16 && r.coins === 1 && r.isGroup, r);
  chk("rows run along +z, columns +x, layers up +y, from the middle of the first cell", eq(r.first, [0, 0.5, 0]) && r.last === true && [0, 4].includes(r.up[0]) && eq(r.coin.slice(0, 3), [2, 0.5, 1]), r);
  chk("each solid takes its group's settings (collider, colour) and the cell size", eq(r.wall, ['static', '#6272a4', 1]) && r.coin[3] === 'none', r);
  chk("a single layer can be a plain list of rows, with a bigger cell", eq(r.one, [4, 2, 22, 2]), r.one);
  chk("a level with a mistake in it makes NOTHING (no half-built level left behind)", r.leftBehind === 0, r.leftBehind);
  e = r.errs;
  chk("level mistakes name the character and where, or what to give",
    e.char.includes("the character 'x' (layer 0, row 0, column 1)") && e.char.includes("legend has no 'x'") && e.legend.includes('must be a Group') && e.shape.includes('new Tiles() takes layers') && e.pos.includes('needs a number for x'), e);

  section("billboard text");
  r = await result(String.raw`let a, c; function setup() {
    const sprites = () => __spashial.scene.children.filter((o) => o.isSprite);
    const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
    a = new Cube(0, 3, 0, 1); const none = sprites().length;
    a.text = 'score 3'; const one = sprites().length;
    a.text = 7; const num = a.text; const still = sprites().length;
    window.__s = { none, one, num, still, errs: { obj: t(() => { a.text = {}; }), col: t(() => { a.textColor = 5; }), size: t(() => { a.textSize = 0; }) } };
    a.text = 'score 3'; a.textColor = '#ffcc00'; a.textSize = 1; c = a.clone(); window.__s.clone = [c.text, c.textColor, c.textSize, sprites().length]; }
    function update() { if (frameCount === 12) { const sp = __spashial.scene.children.filter((o) => o.isSprite); const l = sp[0];
      const img = l.material.map.image; window.__r = { ...window.__s, sprites: sp.length, above: l.position.y - a.y, aspect: img.width / img.height, vis: l.visible };
      a.visible = false; window.__r.hidden = !__spashial.scene.children.filter((o) => o.isSprite)[0].visible; a.visible = true;
      a.text = null; window.__r.cleared = __spashial.scene.children.filter((o) => o.isSprite).length; c.remove(); a.remove(); window.__r.removed = __spashial.scene.children.filter((o) => o.isSprite).length; } }`, 14);
  chk("a label is one sprite: none before, one after text, still one when the text changes (a number becomes a string)", r.none === 0 && r.one === 1 && r.num === '7' && r.still === 1, r);
  chk("it floats above the solid and is wider than tall (a real picture of the words)", r.above > 0.9 && r.aspect > 1.5 && r.vis === true, r);
  chk("hiding the solid hides its label; text = null removes it; remove() takes labels away", r.hidden === true && r.cleared === 1 && r.removed === 0, r);
  chk("a clone keeps the text, colour and size (and has its own label)", eq(r.clone, ['score 3', '#ffcc00', 1, 2]), r.clone);
  e = r.errs;
  chk("wrong text values explain themselves", e.obj.includes('text must be a string or a number') && e.col.includes('textColor must be a colour') && e.size.includes('textSize must be above 0'), e);

  section("textures");
  r = await result(String.raw`function setup() {
    const names = textureNames(), out = { names }, flat = [];
    const t = (f) => { try { f(); return ''; } catch (e) { return e.name + ': ' + e.message; } };
    const a = new Cube(0, 0, 0, 1);
    out.before = { map: a._material.map === null, tex: a.texture };
    for (const n of names) {
      a.texture = n; const img = a._material.map.image; const px = img.getContext('2d').getImageData(0, 0, img.width, img.height).data; const seen = new Set();
      for (let i = 0; i < px.length; i += 4 * 97) seen.add(px[i] + ',' + px[i + 1] + ',' + px[i + 2]);
      if (img.width !== 256 || seen.size < 2) flat.push(n);
    }
    out.flat = flat;
    a.texture = 'bricks';
    out.white = '#' + a._material.color.getHexString(); out.set = a.texture;
    a.color = 'tomato'; out.tinted = '#' + a._material.color.getHexString();
    a.textureRepeat = 4; out.rep = [a._material.map.repeat.x, a._material.map.repeat.y, a.textureRepeat.x];
    a.textureRepeat = [2, 5]; out.rep2 = [a._material.map.repeat.x, a._material.map.repeat.y];
    out.errs = { unknown: t(() => { a.texture = 'nope'; }), type: t(() => { a.texture = 5; }), rep: t(() => { a.textureRepeat = 0; }), still: a.texture };
    a.texture = null; out.cleared = [a._material.map === null, a.texture];
    const g = new Group(); const b = g.newSolid(5, 0, 0); g.texture = 'planks'; g.textureRepeat = 3; out.group = [b.texture, b.textureRepeat.x];
    const c = b.clone(); out.clone = [c.texture, c.textureRepeat.x];
    const h = new Hull(0, 0, 5, [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 1.4, 0]]); h.texture = 'stone';
    const m = new TriangleMesh(9, 0, 0, [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]], [[0, 2, 1], [0, 3, 2]]); m.texture = 'grid';
    const uvRange = (x) => { const u = x._mesh.geometry.getAttribute('uv'); let lo = 9, hi = -9; for (let i = 0; i < u.array.length; i++) { lo = Math.min(lo, u.array[i]); hi = Math.max(hi, u.array[i]); } return [u.count, +lo.toFixed(3), +hi.toFixed(3)]; };
    out.uv = { hull: uvRange(h), mesh: uvRange(m), hullVerts: h._mesh.geometry.getAttribute('position').count };
    window.__r = out; }`, 2);
  chk("textureNames lists the 8 built-in patterns", eq(r.names, ['bricks', 'checker', 'dots', 'grass', 'grid', 'planks', 'stone', 'stripes']), r.names);
  chk("a solid starts with no texture", eq(r.before, { map: true, tex: null }), r.before);
  chk("every built-in is a real 256 px picture (not blank)", eq(r.flat, []), r.flat);
  chk("a textured solid draws white until you set a colour, then the colour tints it", r.white === '#ffffff' && r.tinted !== '#ffffff' && r.set === 'bricks', r);
  chk("textureRepeat takes a number or [across, up]", eq(r.rep, [4, 4, 4]) && eq(r.rep2, [2, 5]), r);
  e = r.errs;
  chk("a wrong texture explains itself, lists the choices, and changes nothing",
    e.unknown.includes("no texture called 'nope'") && e.unknown.includes("'bricks'") && e.type.includes('texture must be a name') && e.rep.includes('textureRepeat must be') && e.still === 'bricks', e);
  chk("texture = null goes back to the plain colour", eq(r.cleared, [true, null]), r.cleared);
  chk("a Group sets texture and textureRepeat on its members, and a clone keeps them", eq(r.group, ['planks', 3]) && eq(r.clone, ['planks', 3]), r);
  const uh = r.uv.hull, um = r.uv.mesh;
  chk("a hull and a triangle mesh get UVs spread over their box (0 to 1)", uh[0] === r.uv.hullVerts && uh[1] >= 0 && 0.99 <= uh[2] && uh[2] <= 1.001 && um[1] >= 0 && 0.99 <= um[2] && um[2] <= 1.001, r.uv);

  r = await result(String.raw`let red; function preload() {
    const c = document.createElement('canvas'); c.width = c.height = 4; const g = c.getContext('2d'); g.fillStyle = '#ff0000'; g.fillRect(0, 0, 4, 4);
    registerTexture('red', c.toDataURL()); red = loadTexture('red'); window.__early = red.ready; }
    function setup() { const a = new Cube(0, 0, 0); a.texture = 'red'; window.__r = { early: window.__early, atSetup: red.ready, names: textureNames().includes('red'), map: a._material.map.image instanceof HTMLImageElement,
      size: a._material.map.image.width }; }`, 2);
  chk("preload() waits for a texture: it is NOT ready at the start of preload and IS by setup()", r.early === false && r.atSetup === true && r.map && r.size === 4, r);
  chk("a registered name shows up in textureNames()", r.names === true, r);

  r = await result("function setup() { const a = new Cube(0, 0, 0); a.texture = 'data:image/png;base64,AAAA'; window.__r = { color: '#' + a._material.color.getHexString(), tex: a.texture }; }", 2);
  await page.waitForTimeout(1000);
  chk("a picture that cannot be loaded says so in plain words and the sketch keeps running", (await log(page)).includes('could not be loaded') && (await log(page)).includes('running'), await log(page));
  chk("and it says so ONCE: no 'Texture marked for update' complaint from three.js on every frame", !(await log(page)).includes('Texture marked') && (await log(page)).split('could not be loaded').length - 1 === 1, (await log(page)).slice(0, 300));

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
  e = dd.errs;
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
    const fr = await runnerFrame(page, 120000);
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

// Runs EVERY demo in the docs, every "Try it" row, and every standalone demo, in a real browser.
//   node tests/docs-demos.test.mjs
//   ONLY=bounce node tests/docs-demos.test.mjs         run the demos whose id contains "bounce"
//   CONCURRENCY=2 node tests/docs-demos.test.mjs       how many run at once (default 3)
//
// A docs demo passes only if it starts clean AND the claim its page makes is true afterwards:
//   - it performs the demo's scripted `steps` (key presses, mouse moves and clicks, waiting for frames),
//   - then runs the demo's `expect()` INSIDE the sketch and requires it to return true.
// A demo that is meant to fail (the errors page) passes only if it raises its stated error at its
// stated line, and (with `stops: true`) the loop really halts.
//
// Headless Chromium here draws with software GL, so frame RATE means nothing: every wait is a wait
// for the sketch's own `frameCount`, never for wall-clock time.
import { readFileSync } from 'node:fs';
import { pages, REFERENCE } from '../docs/content/index.mjs';
import { tryCode } from '../docs/try-template.mjs';
import { start, reporter } from './launch.mjs';

const t = reporter('docs: every demo runs and does what its page says');
const only = process.env.ONLY;
const CONC = Math.max(1, Number(process.env.CONCURRENCY || 3));
const read = (name) => readFileSync(new URL(`../demos/${name}.js`, import.meta.url), 'utf8');

const jobs = [];
for (const p of pages) for (const b of p.blocks) if (b.demo) jobs.push({ kind: 'demo', name: `${p.id}/${b.demo.id}`, id: b.demo.id, code: b.demo.code ?? read(b.demo.from), ...b.demo });
for (const r of REFERENCE.find((o) => o.object === 'Solid').members) if (r.try || r.tryUpdate) jobs.push({ kind: 'try', name: `try/${r.name}`, id: `try-${r.name}`, code: tryCode(r), steps: [{ wait: 90 }], expect: () => frameCount >= 90 });
// What the standalone demos must do, beyond starting clean. Any demo not listed just has to run.
const FILE_CHECKS = {
  'wrecking-ball': { steps: [{ wait: 400 }], expect: () => [...__spashial.solids].some((s) => s._collider === 'dynamic' && s._shape === 'box' && s.x > 4) },
  dominoes: { steps: [{ wait: 30 }, { press: 'Space' }, { wait: 800 }], expect: () => dominoes.filter((d) => d.y < 0.7).length > 18 },
  bowling: { steps: [{ wait: 30 }, { press: 'Space' }, { wait: 200 }], expect: () => pins.filter((p) => p.y < 0.5 || Math.abs(p.rotation.x) > 40 || Math.abs(p.rotation.z) > 40).length >= 3 },
  turntable: { steps: [{ wait: 10 }, { move: 'center' }, { mdown: true }, { move: { fx: 0.8, fy: 0.5 } }, { wait: 3 }, { mup: true }, { wait: 5 }], expect: () => Math.abs(camera.x) > 1 },
  textures: { steps: [{ wait: 60 }], expect: () => [...__spashial.solids].filter((s) => s.texture).length >= 5 },
  models: { steps: [{ wait: 260 }], expect: () => [...__spashial.solids].filter((s) => s.model === 'crystal').length === 2 },
  'level-from-text': { steps: [{ click: 'center' }, { wait: 30 }, { down: 'd' }, { down: 'w' }, { wait: 60 }, { up: 'd' }, { up: 'w' }, { wait: 5 }], expect: () => score >= 1 },
  'walk-and-jump': { steps: [{ wait: 60 }, { down: 'd' }, { wait: 30 }, { up: 'd' }], expect: () => player.x > 1.5 },
  tower: { steps: [{ wait: 60 }, { press: 'Space' }, { wait: 200 }], expect: () => [...__spashial.solids].some((s) => s._collider === 'dynamic' && Math.abs(s.x) > 1.5) },
};
for (const d of JSON.parse(readFileSync(new URL('../demos/index.json', import.meta.url), 'utf8'))) {
  const c = FILE_CHECKS[d.id] ?? { steps: [{ wait: 150 }], expect: () => frameCount >= 150 };
  jobs.push({ kind: 'demo file', name: `demos/${d.id}`, id: d.id, code: read(d.file.replace(/\.js$/, '')), ...c });
}
const todo = jobs.filter((j) => !only || j.id.includes(only) || j.name.includes(only));

const env = await start();
const runnerOf = (page) => page.frames().find((f) => f.url().includes('runner.html'));
const logOf = (page) => page.innerText('#log');

async function waitFrames(frame, n, timeout) {
  const now = await frame.evaluate(() => window.frameCount);
  await frame.waitForFunction((target) => window.frameCount >= target, now + n, { timeout, polling: 100 });
}

async function perform(page, frame, steps) {
  const box = await page.locator('#frame').boundingBox();
  const at = (s) => (s === 'center' ? [box.x + box.width / 2, box.y + box.height / 2]
    : Array.isArray(s) ? [box.x + s[0], box.y + s[1]] : [box.x + box.width * s.fx, box.y + box.height * s.fy]);
  await page.locator('#frame').focus(); // keys go to the sketch; a click would be a click IN the sketch
  for (const s of steps) {
    if (s.wait) await waitFrames(frame, s.wait, Math.max(90000, s.wait * 250));
    else if (s.down) await page.keyboard.down(s.down);
    else if (s.up) await page.keyboard.up(s.up);
    else if (s.press) await page.keyboard.press(s.press);
    else if (s.move) { const [x, y] = at(s.move); await page.mouse.move(x, y, { steps: 6 }); }
    else if (s.click) { const [x, y] = at(s.click); await page.mouse.click(x, y, { button: s.button ?? 'left' }); }
    else if (s.mdown) await page.mouse.down();
    else if (s.mup) await page.mouse.up();
    else if (s.rerun) { // press Run again: what the first run saved must be there for the second
      await page.click('#run');
      await page.waitForFunction(() => document.getElementById('log').innerText.trim() === 'running', null, { timeout: 90000 });
      await waitFrames(frame, 5, 90000);
    }
    else throw new Error('unknown step ' + JSON.stringify(s));
  }
}

async function runJob(page, job) {
  await page.evaluate(() => localStorage.clear());   // the sandbox page is the host that keeps saved values: start each demo with none
  await page.fill('#code', job.code);
  await page.click('#run');
  await page.waitForFunction(() => document.getElementById('log').innerText.length > 0, null, { timeout: 120000 });
  if (job.error) {
    await page.waitForFunction((rx) => new RegExp(rx).test(document.getElementById('log').innerText), job.error.message.source, { timeout: 60000 }).catch(() => {});
    const log = await logOf(page);
    if (!job.error.message.test(log)) return { ok: false, detail: `wanted ${job.error.message}, log was: ${log.slice(0, 200)}` };
    if (!new RegExp(`\\(line ${job.error.line}\\)`).test(log)) return { ok: false, detail: `wanted line ${job.error.line}, log was: ${log.slice(0, 200)}` };
    if (job.stops) {
      const frame = runnerOf(page);
      const a = await frame.evaluate(() => window.frameCount); await page.waitForTimeout(700);
      const b = await frame.evaluate(() => window.frameCount);
      if (a !== b) return { ok: false, detail: `the loop kept running after the error (${a} -> ${b})` };
    }
    return { ok: true };
  }
  const first = await logOf(page);
  if (!/running/.test(first)) { await page.waitForTimeout(500); const again = await logOf(page); if (!/running/.test(again)) return { ok: false, detail: `did not start: ${again.slice(0, 240)}` }; }
  const frame = runnerOf(page);
  try { await perform(page, frame, job.steps ?? [{ wait: 120 }]); }
  catch (e) { return { ok: false, detail: `${e.message.split('\n')[0]}; the sketch's log said: ${(await logOf(page)).replace(/\n/g, ' | ').slice(0, 240)}` }; }
  if (process.env.DEBUG_EXPR) console.log(`  [debug ${job.name}]`, JSON.stringify(await frame.evaluate(process.env.DEBUG_EXPR)));
  let ok;
  try { ok = await frame.evaluate(job.expect); } catch (e) { return { ok: false, detail: `expect threw: ${e.message.split('\n')[0]}` }; }
  const log = await logOf(page);
  const bad = log.split('\n').filter((l) => /error/i.test(l));
  if (bad.length) return { ok: false, detail: `error in the log: ${bad[0].slice(0, 200)}` };
  return ok ? { ok: true } : { ok: false, detail: `expect() was ${JSON.stringify(ok)}; frameCount ${await frame.evaluate(() => window.frameCount).catch(() => '?')}` };
}

// Online demos need TWO tabs: open two sandbox pages in one browser, host a room in the first and join it from
// the second (the way a person would, through the lobby bar), run `steps` in the first tab and `stepsB` in the
// second, then run `expect` in BOTH. They run one at a time, after the rest: tabs of one browser share a
// BroadcastChannel, so two online demos at once could hear each other's rooms.
async function runTwoTabs(job) {
  const a = await env.page(), b = await env.page();
  try {
    for (const p of [a, b]) {
      await p.goto(env.base + '/sandbox.html');
      await p.evaluate(() => window.examplesReady);
      await p.fill('#code', job.code);
      await p.click('#run');
    }
    await a.waitForSelector('#lobby.on', { timeout: 90000 });
    await a.click('#lobby button:has-text("Host a game")');
    await a.waitForSelector('#lobby .code', { timeout: 60000 });
    const room = await a.innerText('#lobby .code');
    await b.waitForSelector('#lobby.on', { timeout: 90000 });
    await b.fill('#lobby input', room);
    await b.click('#lobby button:has-text("Join")');
    const fa = runnerOf(a), fb = runnerOf(b);
    for (const f of [fa, fb]) await f.waitForFunction(() => online.status === 'ready', null, { timeout: 60000 });
    await Promise.all([perform(a, fa, job.steps ?? [{ wait: 60 }]), perform(b, fb, job.stepsB ?? [{ wait: 60 }])]);
    await waitFrames(fa, 30, 90000);                                  // let the last messages arrive
    const results = [];
    for (const [name, f, p] of [['tab 1 (host)', fa, a], ['tab 2 (guest)', fb, b]]) {
      let ok; try { ok = await f.evaluate(job.expect); } catch (e) { return { ok: false, detail: `${name}: expect threw: ${e.message.split('\n')[0]}` }; }
      const bad = (await p.innerText('#log')).split('\n').filter((l) => /error/i.test(l));
      if (bad.length) return { ok: false, detail: `${name}: error in the log: ${bad[0].slice(0, 160)}` };
      results.push(ok);
    }
    return results.every(Boolean) ? { ok: true } : { ok: false, detail: `expect() was ${JSON.stringify(results)} in tab 1 and tab 2` };
  } finally { await a.close(); await b.close(); }
}

const queue = todo.filter((j) => j.tabs !== 2);
const twoTabJobs = todo.filter((j) => j.tabs === 2);
const started = Date.now();
async function worker(n) {
  // Each worker has its OWN browser context: the sandbox page keeps a sketch's saved values in localStorage, and
  // pages of one context share it, so one worker's clear would wipe another's demo mid-run.
  const ctx = await env.browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  (page error in worker ${n}: ${e.message})`));
  await page.goto(env.base + '/sandbox.html');
  await page.evaluate(() => window.examplesReady);
  while (queue.length) {
    const job = queue.shift();
    const t0 = Date.now();
    let r;
    try { r = await runJob(page, job); } catch (e) { r = { ok: false, detail: `harness: ${e.message.split('\n')[0]}` }; }
    t.check(`${job.kind}: ${job.name}   (${((Date.now() - t0) / 1000).toFixed(0)}s)`, r.ok, r.detail ?? '');
  }
  await ctx.close();
}
try {
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));
  for (const job of twoTabJobs) {
    const t0 = Date.now();
    let r; try { r = await runTwoTabs(job); } catch (e) { r = { ok: false, detail: `harness: ${e.message.split('\n')[0]}` }; }
    t.check(`${job.kind} (two tabs): ${job.name}   (${((Date.now() - t0) / 1000).toFixed(0)}s)`, r.ok, r.detail ?? '');
  }
}
finally { await env.close(); }
console.log(`\n${todo.length} demos in ${((Date.now() - started) / 60000).toFixed(1)} minutes`);
t.done();

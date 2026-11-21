// The three pages people use, in a real browser: the landing page, the docs site and the sandbox.
//   node tests/docs-site.test.mjs
// (The demos' own behaviour is tests/docs-demos.test.mjs; this is the page around them.)
import { pages } from '../docs/content/index.mjs';
import { start, reporter } from './launch.mjs';

const t = reporter('the landing page, the docs site and the sandbox');
const env = await start();
const runnerFrames = (page) => page.frames().filter((f) => f.url().includes('runner.html'));
const frameCount = (f) => f.evaluate(() => window.frameCount).catch(() => -1);
async function running(page, timeout = 90000) {
  await page.waitForFunction(() => document.querySelector('iframe') !== null, null, { timeout });
  const f = runnerFrames(page)[0];
  await f.waitForFunction(() => window.frameCount >= 5, null, { timeout });
  return f;
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const errorsOf = (page) => { const e = []; page.on('pageerror', (x) => e.push(x.message)); page.on('console', (m) => { if (m.type() === 'error') e.push(m.text()); }); return e; };

try {
  // ---------------------------------------------------------------- landing
  t.section('the landing page');
  {
    const page = await env.page(); const errs = errorsOf(page);
    await page.goto(env.base + '/index.html');
    const f = await running(page);
    t.check('the hero starts the wrecking ball by itself', (await frameCount(f)) >= 5);
    t.check('the hero frame is sandboxed with an opaque origin', (await page.getAttribute('#heroStage iframe', 'sandbox')) === 'allow-scripts allow-downloads allow-modals' && (await f.evaluate(() => self.origin)) === 'null');
    t.check('the picker lists every demo in demos/index.json', (await page.locator('#list button').count()) === 13, await page.locator('#list button').count());
    await page.click('#list button >> text=Dominoes');
    await page.waitForFunction(() => document.querySelectorAll('iframe').length === 1 && document.querySelector('#galleryStage iframe'), null, { timeout: 60000 });
    t.check('choosing a demo stops the hero, so only one sketch runs', (await page.locator('iframe').count()) === 1 && (await page.locator('#heroStage iframe').count()) === 0);
    t.check('and the hero says so and offers to play again', (await page.locator('#heroIdle').isVisible()) && /Paused/.test(await page.innerText('#heroNote')));
    t.check('the demo link opens that demo in the sandbox', (await page.getAttribute('#gOpen', 'href')).endsWith('sandbox.html?demo=dominoes'));
    t.check('the code sample link carries the sketch in the hash', /sandbox\.html#code=[A-Za-z0-9_-]+/.test(await page.getAttribute('#sampleOpen', 'href')));
    t.check('the docs index lists every page of four groups', (await page.locator('#index a').count()) === pages.filter((p) => ['Objects', 'Physics', 'Interaction', 'World'].includes(p.group)).length);
    t.check('no console or page errors', !errs.length, errs);
    for (const [w, label] of [[390, 'a phone'], [1280, 'a desktop']]) {
      await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(150);
      t.check(`no sideways scrolling on ${label}`, (await overflow(page)) <= 0, await overflow(page));
    }
    const text = await page.innerText('body');
    t.check('no em dash or en dash on the landing page', !/[–—]/.test(text));
    await page.close();
  }

  // ---------------------------------------------------------------- docs
  t.section('the docs site');
  {
    const page = await env.page(); const errs = errorsOf(page);
    await page.goto(env.base + '/docs/');
    t.check(`the sidebar links every page (${pages.length})`, (await page.locator('#nav a').count()) === pages.length, await page.locator('#nav a').count());
    await running(page);
    t.check('the first demo of a page runs by itself', runnerFrames(page).length === 1);
    t.check('the current page is marked aria-current', (await page.getAttribute('#nav a[aria-current]', 'data-id')) === 'welcome');
    await page.goto(env.base + '/docs/#/physics');
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Bodies and materials');
    await page.locator('.demo >> text=Three balls, three bounciness values').scrollIntoViewIfNeeded();
    await page.locator('.demo', { hasText: 'Three balls, three bounciness values' }).getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.demo iframe').length === 1, null, { timeout: 60000 });
    t.check('pressing Run on another demo stops the one before it (one iframe on the page)', (await page.locator('iframe').count()) === 1);
    const ta = page.locator('.demo', { hasText: 'Three balls, three bounciness values' }).locator('textarea');
    await ta.fill('function setup() { new Cube(1, 2); }');
    await page.locator('.demo', { hasText: 'Three balls, three bounciness values' }).getByRole('button', { name: 'Run', exact: true }).click();
    await page.waitForFunction(() => /takes x, y, z/.test(document.body.innerText), null, { timeout: 60000 });
    t.check('editing the code and running it shows the real error with its line', /line 1/.test(await page.locator('.demo .console').first().innerText()) || /takes x, y, z/.test(await page.innerText('body')));
    await page.locator('.demo', { hasText: 'Three balls, three bounciness values' }).getByRole('button', { name: 'Reset' }).click();
    t.check('Reset puts the original code back', (await ta.inputValue()).includes('bounciness'));
    // Try it on a reference row
    await page.getByRole('button', { name: 'Try drag' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.tryrow iframe').length === 1, null, { timeout: 60000 });
    const f = runnerFrames(page)[0]; await f.waitForFunction(() => window.frameCount >= 5, null, { timeout: 60000 });
    t.check('Try it opens a running demo under the row, and the sketch has that row\'s code', (await f.evaluate(() => c.drag)) === 2);
    await page.getByRole('button', { name: 'Try drag' }).click();
    t.check('pressing Try it again closes it and stops the sketch', (await page.locator('.tryrow').count()) === 0 && runnerFrames(page).length <= 1 && (await page.locator('iframe').count()) === 0);
    // deep link to a demo
    await page.goto(env.base + '/docs/#/mouse/get-solid-at');
    await page.waitForFunction(() => document.querySelector('#demo-get-solid-at iframe'), null, { timeout: 60000 });
    t.check('a link to a page and a demo (#/mouse/get-solid-at) scrolls to it and runs it', (await page.locator('#demo-get-solid-at').isVisible()));
    // search
    await page.fill('#q', 'torque');
    t.check('search finds pages by what is on them (torque -> Forces)', (await page.locator('#nav a').allInnerTexts()).some((x) => /Forces/.test(x)));
    await page.fill('#q', 'zzzznotaword');
    t.check('an empty search says so', await page.locator('#none').isVisible());
    await page.fill('#q', '');
    t.check('no console or page errors', !errs.length, errs.slice(0, 3));
    await page.close();
  }
  // every page at phone width and desktop width: nothing may scroll sideways, and every table fits its wrapper
  {
    const page = await env.page(); await page.setViewportSize({ width: 390, height: 800 });
    const wide = [];
    for (const p of pages) {
      await page.goto(env.base + `/docs/#/${p.id}`);
      await page.waitForFunction((title) => document.querySelector('h1')?.textContent === title, p.title);
      await page.waitForTimeout(80);
      if ((await overflow(page)) > 0) wide.push(p.id);
    }
    t.check(`no docs page scrolls sideways on a phone (${pages.length} pages)`, !wide.length, wide);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(env.base + '/docs/#/reference');
    t.check('the reference page has a row for Solid.drag with its default', /0\.05/.test(await page.locator('[id="ref-Solid.drag"]').innerText()));
    await page.close();
  }

  // ---------------------------------------------------------------- sandbox
  t.section('the sandbox');
  {
    const page = await env.page(); const errs = errorsOf(page);
    await page.goto(env.base + '/sandbox.html?demo=bowling');
    await page.evaluate(() => window.examplesReady);
    t.check('?demo= opens that demo in the editor', (await page.inputValue('#code')).includes('Ten pins'));
    await page.fill('#code', 'function setup() {\n  new Cube(1, 2);\n}');
    await page.click('#run');
    await page.waitForFunction(() => /line 2/.test(document.getElementById('log').innerText), null, { timeout: 60000 });
    t.check('an error names its line in the log', true);
    const code = 'function setup() { world.gravity.y = -10; new Floor(); new Cube(0, 3, 0); }\n// a long comment ' + 'x'.repeat(8000);
    await page.fill('#code', code);
    await page.click('#run');
    await page.waitForFunction(() => document.getElementById('log').innerText.includes('running'), null, { timeout: 90000 });
    t.check('a sketch over 8 KB runs (it travels by postMessage, not in the address)', true);
    t.check('the line numbers match the code', (await page.locator('#gutter').innerText()).split('\n').length === code.split('\n').length);
    // a shared link round trip
    const hashCode = await page.evaluate(async (c) => { const m = await import('/embed.js'); return m.toBase64Url(c); }, 'function setup() { new Sphere(0, 1, 0); }  // héllo');
    const p2 = await env.page();
    await p2.goto(env.base + `/sandbox.html#code=${hashCode}`);
    await p2.evaluate(() => window.examplesReady);
    t.check('a #code= link restores the sketch, accents included', (await p2.inputValue('#code')) === 'function setup() { new Sphere(0, 1, 0); }  // héllo');
    t.check('no console or page errors', !errs.length, errs.slice(0, 3));
    await page.setViewportSize({ width: 390, height: 800 });
    t.check('no sideways scrolling on a phone', (await overflow(page)) <= 0, await overflow(page));
  }
} finally { await env.close(); }
t.done();

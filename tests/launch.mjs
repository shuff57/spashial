// Shared by the browser tests: starts the site on a free port and launches headless Chromium.
//
//   npx playwright install chromium     # once, to get a browser. package.json pins the Playwright
//                                         # version, so this fetches the Chromium build it expects.
//   CHROMIUM_PATH=/path/to/chrome ...   # or point the tests at one you already have
//
// --disable-features=IsolateSandboxedIframes: recent Chromium runs a sandboxed iframe (no
// allow-same-origin, which is how every sketch runs) in its OWN process, and Playwright then loses
// track of that frame: page.frames() keeps showing about:blank for a runner that is running. The frame
// stays sandboxed with an opaque origin (the tests assert `self.origin === 'null'`); only the
// process split is off, and only in the test browser.
//
// Headless Chromium here draws with software GL (SwiftShader), so frame RATE means nothing and no
// test asserts on it. Tests wait on the sketch's own `frameCount`, never on wall-clock time.
import { chromium } from 'playwright';
import { serve } from '../scripts/serve.mjs';

export async function start({ viewport = { width: 1280, height: 760 }, deviceScaleFactor = 1, colorScheme } = {}) {
  const server = await serve(0);
  const port = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-features=IsolateSandboxedIframes'],
  });
  const context = await browser.newContext({ viewport, deviceScaleFactor, ...(colorScheme ? { colorScheme } : {}) });
  return {
    base: `http://127.0.0.1:${port}`,
    browser, context,
    page: () => context.newPage(),
    async close() { await browser.close(); server.close(); },
  };
}

/** The tiny pass/fail reporter the tests share. */
export function reporter(title) {
  const fails = [];
  console.log(`\n# ${title}`);
  return {
    section(name) { console.log(`\n== ${name}`); },
    check(name, ok, detail = '') {
      console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`));
      if (!ok) fails.push(name);
    },
    near: (a, b, tol) => a != null && Math.abs(a - b) <= tol,
    done() {
      console.log(`\n${fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}` : 'ALL PASSED'}`);
      process.exit(fails.length ? 1 : 0);
    },
  };
}

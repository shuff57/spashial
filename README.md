# spaSHial

**spaSHial** is a small 3D game engine for the web. It draws with [three.js][] and moves things with
real rigid-body physics ([Jolt][], a physics engine used in commercial games). The whole API is a handful of
globals: `Solid`, `Group`, `world`, `camera`, `kb` and `mouse`. No imports, no install, no build step.

It is the 3D sibling of [moSHion](https://github.com/shuff57/moshion), a 2D engine, and it grew out of
the [shCode](https://github.com/shuff57/shCode) high-school JavaScript course, where students write
games in a sandboxed iframe. If you know moSHion, the hooks, `Group`, the four collider words and the
touch verbs (`collides`, `overlaps` and friends) are the same.

```js
function setup() {
  world.gravity.y = -10;          // gravity starts off. Turn it on.
  new Floor();
  const box = new Cube(0, 4, 0);
  box.color = 'tomato';
  box.bounciness = 0.6;
}

function update() {
  // Space blows everything away from the middle
  if (kb.presses('space')) world.explodeAt(0, 0, 0, 6, 8);
}
```

## Try it

- **[The live site](https://shuff57.github.io/spashial/)** has a demo gallery.
- **[The sandbox](https://shuff57.github.io/spashial/sandbox.html)** is an editor with 13 examples.
  *Copy link* puts the whole sketch in the address, so anyone can open it.
- **[The docs](https://shuff57.github.io/spashial/docs/)** have 26 pages and about 90 demos you can run
  and change, one for every kind of interaction: shapes, physics, forces, touching, joints, keyboard,
  mouse, ray casts, camera, lights and the HUD.

## Run it on your computer

```sh
git clone https://github.com/shuff57/spashial
cd spashial
node scripts/serve.mjs          # then open http://127.0.0.1:8180/
```

It must be served over HTTP: browsers will not run modules or WebAssembly from `file://`. Any static
server works if it sends `Access-Control-Allow-Origin: *` (the sketch runs in a sandboxed frame with an
opaque origin, so everything it loads is a cross-origin request). `scripts/serve.mjs` does that.

## Use it in your own page

The sketch runs in an iframe sandboxed **without** `allow-same-origin`, so it cannot read your page, its
cookies or its storage. The host hands it the code with one message:

```html
<iframe id="frame" sandbox="allow-scripts allow-downloads allow-modals"
        src="https://shuff57.github.io/spashial/runner.html"></iframe>
<script>
  addEventListener('message', (e) => {
    if (e.data?.source === 'preview-storage-request')
      frame.contentWindow.postMessage({ source: 'preview-storage-init', code: mySketch }, '*');
  });
</script>
```

`embed.js` wraps this (`runSketch(iframe, code, { onReady, onLog, onError })`). The messages and the
hosting notes are in [the embedding guide](docs/content/04-guides.mjs) (page `embedding`).
To host your own copy, copy `runner.html`, `spashial.js`, `physics.js` and `vendor/` into one folder.

## What is built, and what is not

Built and tested: six shapes plus `Hull` and `TriangleMesh`; colliders (`dynamic`, `static`,
`kinematic`, `none`); gravity, bounce, friction, drag, gravity scale, speed limits and continuous
collision; forces, impulses and torque; touch verbs; groups; hinge, ball, distance, slider and glue
joints; collision groups; ray casts; keyboard and mouse; follow, orbit and free cameras; ambient, sun,
point and spot lights with shadows; a 2D layer for scores and bars.

**Not built yet:** textures, sounds, glTF models, `Tiles`, text labels on a Solid, saving, online
play, height-map terrain, vehicles, ragdolls, motorised joints. Setting a property the engine does not
know (`solid.texture = 'coin'`) is quietly ignored, so check [Planned](docs/content/04-guides.mjs)
before suspecting your code. Graphics speed on integrated graphics has not been measured; physics has
(about 3 ms a step at 400 awake bodies on a fast desktop CPU).

## What is in this repository

| Path | What it is |
| --- | --- |
| `spashial.js` | The engine's sketch API on top of three.js: `Solid`, `Group`, `world`, `camera`, lights, input, the loop. |
| `physics.js` | The **only** file that talks to Jolt. It knows nothing about three.js. |
| `runner.html` | The sandboxed page a sketch runs in. |
| `vendor/` | Jolt (WebAssembly, single-threaded) and three.js, with their licences. Refresh with `npm run vendor`. |
| `index.html`, `sandbox.html`, `site.css`, `embed.js` | The landing page, the editor, the shared styles and the helper that runs a sketch in a frame. |
| `docs/` | The docs site. `docs/content/` is the pages; `docs/spashial.d.ts` is the typings. See [docs/README.md](docs/README.md). |
| `demos/` | Standalone sketches. `demos/index.json` lists them for the sandbox and the landing page. |
| `tests/` | See below. |

## Tests

```sh
npm install
npx playwright install chromium     # once, for the browser tests
npm test
```

| Test | What it checks |
| --- | --- |
| `tests/physics.test.mjs` | The Jolt layer, in Node: resting heights, joints, ray casts, collision groups, meshes (147 tests). |
| `tests/docs.test.mjs` | The docs agree with themselves, with `docs/spashial.d.ts` and with the running engine: every documented name exists and every documented default is true. |
| `tests/browser.test.mjs` | The engine in a real browser, from inside the sandboxed frame: the sketch API, errors with line numbers, input, quality, shadows, every example. |
| `tests/docs-demos.test.mjs` | Every docs demo, every "Try it" row and every standalone demo: runs it, performs its key presses and clicks, and checks the claim its page makes. |
| `tests/docs-site.test.mjs` | The landing page, the docs site and the sandbox: autorun, one demo at a time, search, deep links, share links, no sideways scrolling on a phone. |

Headless Chromium draws with software GL, so frame *rate* means nothing and no test asserts on it. If
Playwright cannot find a browser, point `CHROMIUM_PATH` at one.

## Adding to the engine

The engine's API is described in three places that must agree: `spashial.js` (what it does),
`docs/spashial.d.ts` (the typings) and `docs/content/reference-data.mjs` (one row per name). Add the
property to the first, then the other two, and `tests/docs.test.mjs` tells you which one is out of step.
The steps are in [docs/README.md](docs/README.md). Where the engine's files came from, and how to bring
in a newer copy, is in [VENDORED.md](VENDORED.md).

## Licence

MIT, see [LICENSE](LICENSE). three.js and Jolt Physics (via JoltPhysics.js) are MIT too: see
[THIRD-PARTY.md](THIRD-PARTY.md).

[three.js]: https://threejs.org/
[Jolt]: https://github.com/jrouwe/JoltPhysics

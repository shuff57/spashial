// Pages: performance, errors, embedding, planned, reference.
// Block types are listed at the top of 01-start.mjs. Two more are used here:
//   { reference: true }   draws the whole reference from reference-data.mjs
//   a demo with `error: { message: /regex/, line: N }` is a demo that is MEANT to fail: the test
//   passes only if that error appears at that line, and `stops: true` also checks the loop halted.

export default [
  {
    id: 'performance', group: 'World', title: 'Performance',
    summary: 'How many things you can have, and the switches that keep it smooth.',
    blocks: [
      'spaSHial is built to run on a school desktop with integrated graphics, so the cheap setting is the default and each expensive thing is opt-in. Most games never need to think about this page. Read it when a sketch starts to stutter.',
      { h: 'See what it costs' },
      'Call `showPerf()` in `setup()` and a small panel shows frames per second, the time each frame takes, the number of draw calls and triangles, how many bodies exist, and the render scale.',
      { demo: { id: 'perf-panel', title: 'Rain, with the performance panel', from: 'rain', steps: [{ wait: 200 }], expect: () => __spashial.perf === true && __spashial.renderer.info.render.calls > 20 } },
      { h: 'quality' },
      'The 3D picture is drawn at a **render scale**: below 1 it is drawn smaller and stretched up, which is cheaper and blurrier. The HUD always stays sharp. Set it with `quality`.',
      { table: { head: ['quality', 'Render scale', 'Notes'], rows: [
        ['`\'auto\'` (default)', 'Between 0.7 and 1', 'Starts at 1. Lowers the scale only when frames run long for a sustained time, and ignores the first 2.5 seconds (start-up is slow for every sketch). It occasionally tries a step back up, waiting longer after each failure.'],
        ['`\'high\'`', '1', 'Always full resolution.'],
        ['`\'medium\'`', '0.75', 'Fixed.'],
        ['`\'low\'`', '0.5', 'Fixed. Visibly soft; for a very slow machine.'],
      ] } },
      'On a sharp screen the picture is drawn at the screen\'s own pixel density (up to 2 times), within a budget of about a 1080p canvas of pixels, so a big canvas on a 4K screen gets a little less.',
      { demo: {
        id: 'quality-keys', title: 'Switch quality while it runs',
        hint: 'Click the picture, then press 1, 2, 3 or 4.',
        code: `function setup() {
  world.gravity.y = -10;
  new Floor(20);
  showPerf();
  for (let i = 0; i < 40; i++) {
    const s = new Sphere(random(-3, 3), 3 + i * 0.6, random(-3, 3), 0.8);
    s.color = ['tomato', 'gold', 'skyblue', 'orchid'][i % 4];
  }
  camera.pos = [0, 6, 12];
  camera.lookAt(0, 1, 0);
}
function update() {
  if (kb.presses('1')) quality = 'low';
  if (kb.presses('2')) quality = 'medium';
  if (kb.presses('3')) quality = 'high';
  if (kb.presses('4')) quality = 'auto';
}
function drawTop() {
  fill('white'); textSize(14);
  text("quality = '" + quality + "'   (keys 1 low, 2 medium, 3 high, 4 auto)", 12, 70);
}
`,
        steps: [{ wait: 10 }, { press: '1' }, { wait: 3 }],
        expect: () => quality === 'low' && __spashial.renderScale === 0.5,
      } },
      { h: 'How many bodies?' },
      { list: [
        'Plan for **about 300 to 400 awake dynamic bodies**. On a fast desktop processor the physics step cost about 3 milliseconds at 400 bodies, out of the 16.7 milliseconds a frame has. That number was measured on a high-end CPU; a slower machine will manage fewer.',
        'Bodies that stop moving go to sleep and cost almost nothing, so a big static scene is cheap. A moving pile is not.',
        'Each Solid is one draw call. The engine does not group identical shapes yet, so 300 Solids is about 300 draw calls. Graphics speed on integrated graphics has **not** been measured, only physics; use `showPerf()` on your own machine.',
        'A **Torus** costs about six times what a sphere costs. A Hull costs more than a box. A TriangleMesh is cheap if it is static.',
        '`isSuperFast` costs a little more per body. Use it on bullets only.',
        'Remove what you no longer need: `group.cull()` in a spawner, `solid.remove()` for one.',
      ] },
      { h: 'Canvas size' },
      '`new Canvas(w, h)` in `setup()` sets the size of the 3D picture in pixels. Without it the picture fills the frame it is in. A smaller canvas is the most direct way to make a sketch cheaper.',
    ],
  },

  {
    id: 'errors', group: 'Guides', title: 'When something goes wrong',
    summary: 'The messages you will see, with the line, and what to change.',
    blocks: [
      'A mistake in your code shows up as a **red message with the line number** and the line itself. Because the loop stops at the first error, you see one message, not hundreds. spaSHial checks what you give it and says what it expected, in plain words. Every demo on this page is meant to fail: run it and read the message.',
      { h: 'Wrong arguments' },
      { demo: {
        id: 'err-args', title: 'Not enough numbers',
        code: `function setup() {
  new Cube(1, 2);        // a position needs x, y AND z
}
`,
        error: { message: /takes x, y, z, then an optional size/, line: 2 },
      } },
      { demo: {
        id: 'err-size', title: 'A size that cannot exist',
        code: `function setup() {
  new Cube(0, 0, 0, 0);     // a cube 0 across
}
`,
        error: { message: /w must be above 0/, line: 2 },
      } },
      { demo: {
        id: 'err-torus', title: 'A torus thicker than it is wide',
        code: `function setup() {
  new Torus(0, 0, 0, 1, 2, 1);     // across 1, ring thickness 2
}
`,
        error: { message: /a torus needs h/, line: 2 },
      } },
      { h: 'A number is needed' },
      'Settings that are numbers say so when you give them something else, or a number that cannot be right: friction, bounciness and light intensity cannot go below 0, density and mass must be above 0, and `camera.fov` must be between 0 and 180. Opacity, metalness and roughness are simply held between 0 and 1.',
      { demo: {
        id: 'err-number', title: 'A word where a number goes',
        code: `function setup() {
  const a = new Cube(0, 0, 0);
  a.friction = 'slippery';      // friction is a number
}
`,
        error: { message: /friction must be a number \(got "slippery"\)/, line: 3 },
      } },
      { demo: {
        id: 'err-negative', title: 'A number that cannot be negative',
        code: `function setup() {
  const a = new Cube(0, 0, 0);
  a.bounciness = -1;
}
`,
        error: { message: /bounciness cannot be below 0 \(got -1\)/, line: 3 },
      } },
      { h: 'A word that is not one of the choices' },
      'Where a setting takes one of a few words, a wrong word lists the right ones.',
      { demo: {
        id: 'err-collider', title: 'A collider that does not exist',
        code: `function setup() {
  const a = new Cube(0, 0, 0);
  a.collider = 'bouncy';
}
`,
        error: { message: /collider must be 'dynamic', 'static', 'kinematic' or 'none'/, line: 3 },
      } },
      { demo: {
        id: 'err-quality', title: 'A quality that does not exist',
        code: `function setup() {
  quality = 'ultra';
}
`,
        error: { message: /quality must be 'auto', 'low', 'medium' or 'high'/, line: 2 },
      } },
      { demo: {
        id: 'err-shape', title: 'A shape that is not one of the six',
        code: `function setup() {
  new Cube(0, 0, 0).shape = 'pyramid';
}
`,
        error: { message: /shape must be one of 'box', 'sphere'/, line: 2 },
      } },
      { h: 'Things that need a particular kind of body' },
      { demo: {
        id: 'err-moveto', title: 'moveTo on a body that is not kinematic',
        code: `function setup() {
  new Cube(0, 0, 0).moveTo(1, 1, 1);    // only 'kinematic' bodies are moved this way
}
`,
        error: { message: /moveTo is for 'kinematic' bodies/, line: 2 },
      } },
      { demo: {
        id: 'err-tri', title: 'A TriangleMesh that is dynamic',
        code: `function setup() {
  new TriangleMesh(0, 0, 0, [[0, 0, 0], [1, 0, 0], [0, 0, 1]], [[0, 1, 2]], 'dynamic');
}
`,
        error: { message: /a triangle mesh cannot be 'dynamic'/, line: 2 },
      } },
      { demo: {
        id: 'err-hull', title: 'A Hull with all its points on one plane',
        code: `function setup() {
  new Hull(0, 0, 0, [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]]);   // a flat square
}
`,
        error: { message: /a hull needs points that are not all on one flat plane/, line: 2 },
      } },
      { demo: {
        id: 'err-hull-size', title: 'Resizing a Hull',
        code: `function setup() {
  const h = new Hull(0, 0, 0, [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]]);
  h.w = 3;                               // its size comes from its points
}
`,
        error: { message: /a Hull's size comes from its points/, line: 3 },
      } },
      { h: 'Joints' },
      { demo: {
        id: 'err-joint-static', title: 'A joint between two static bodies',
        code: `function setup() {
  const a = new Cube(0, 0, 0, 'static');
  const b = new Cube(2, 0, 0, 'static');
  new HingeJoint(a, b);                  // neither can move, so there is nothing to join
}
`,
        error: { message: /a joint needs at least one body that can move/, line: 4 },
      } },
      { demo: {
        id: 'err-joint-option', title: 'An option a joint does not have',
        code: `function setup() {
  const a = new Cube(0, 0, 0);
  const b = new Cube(2, 0, 0);
  new HingeJoint(a, b, { speed: 3 });
}
`,
        error: { message: /HingeJoint has no option 'speed' \(its options: anchor, axis, lowerLimit, upperLimit, friction\)/, line: 4 },
      } },
      { demo: {
        id: 'err-hinge-limit', title: 'A hinge limit out of range',
        code: `function setup() {
  const a = new Cube(0, 0, 0);
  const b = new Cube(2, 0, 0);
  new HingeJoint(a, b, { upperLimit: 400 });
}
`,
        error: { message: /upperLimit must be between 0 and 180 degrees/, line: 4 },
      } },
      { h: 'Typos' },
      'A misspelt name is not something spaSHial can check, because JavaScript reports it first. The message is JavaScript\'s own, but it still points at the right line. `world.gravty` does not exist, so asking for its `y` fails.',
      { demo: {
        id: 'err-typo', title: 'A misspelt property',
        code: `function setup() {
  world.gravty.y = -10;
}
`,
        error: { message: /Cannot set properties of undefined/, line: 2 },
      } },
      { h: 'After an error' },
      'The loop stops at the first error, so a mistake in `update()` is reported once, not 60 times a second. Fix the line and press **Run** again. This sketch is fine for three frames, then throws.',
      { demo: {
        id: 'err-update', title: 'An error in update() stops the loop',
        code: `let n = 0;
function update() {
  n++;
  if (n === 3) throw new Error('boom');
}
`,
        error: { message: /boom/, line: 4 }, stops: true,
      } },
      { note: 'Setting a property spaSHial does not know is **not** an error: `solid.texture = \'coin\'` is accepted and does nothing, because textures are not built yet. If something has no effect, check the [Planned](#/planned) page before suspecting your code.' },
    ],
  },

  {
    id: 'embedding', group: 'Guides', title: 'Using it in your own page',
    summary: 'Put a sketch in a web page, safely, with a few lines.',
    blocks: [
      'spaSHial runs inside a **sandboxed iframe**. Your page (the host) puts the iframe on the page, and the sketch inside it cannot read your page, its cookies or its storage. That is what makes it safe to run code a student typed.',
      { code: `<iframe id="frame"
        sandbox="allow-scripts allow-downloads allow-modals"
        allow="autoplay; fullscreen; gamepad; clipboard-write"
        src="https://shuff57.github.io/spashial/runner.html"></iframe>

<script>
const sketch = \`
function setup() {
  world.gravity.y = -10;
  new Floor();
  new Cube(0, 4, 0).color = 'tomato';
}\`;

window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow) return;
  const m = e.data || {};
  if (m.source === 'preview-storage-request')      // the frame asks for the sketch
    frame.contentWindow.postMessage({ source: 'preview-storage-init', code: sketch }, '*');
  if (m.source === 'preview-error') console.log(m.error.message, 'line', m.error.line);
});
</script>` },
      'Do **not** add `allow-same-origin` to the sandbox. Without it the sketch gets an opaque origin, and that is the whole safety.',
      { h: 'The messages' },
      { table: { head: ['From', 'Message', 'Meaning'], rows: [
        ['frame to host', '`{ source: \'preview-storage-request\' }`', 'The frame is ready and asks for the sketch.'],
        ['host to frame', '`{ source: \'preview-storage-init\', code }`', 'The sketch, as a string. Any length.'],
        ['frame to host', '`{ source: \'preview-ready\' }`', 'The engine started and `setup()` ran.'],
        ['frame to host', '`{ source: \'preview-console\', type, args }`', '`console.log`, `warn`, `error` and `info` from the sketch.'],
        ['frame to host', '`{ source: \'preview-error\', error: { name, message, line, col, snippet } }`', 'The first error, with the line and the code on it.'],
      ] } },
      'If the host does not answer within 0.4 seconds, the frame falls back to a `?code=<base64url>` in its own address. That works for small sketches only: GitHub Pages refuses addresses much over 6 KB, so use the message.',
      { h: 'A ready-made helper' },
      'The repository has `embed.js`, which does all of this: `runSketch(iframe, code, { onReady, onLog, onError })` returns an object with `stop()`. The docs and the sandbox use it.',
      { h: 'Hosting your own copy' },
      { list: [
        'Copy these into one folder: `runner.html`, `spashial.js`, `physics.js` and the `vendor/` folder. Nothing else is needed, and there is no build step.',
        'Serve it over **HTTP**, not by opening the file: browsers will not run modules or WebAssembly from `file://`. `node scripts/serve.mjs` does it for local work.',
        'Every file must be sent with `Access-Control-Allow-Origin: *`. The sandboxed frame has an opaque origin, so each module and the physics `.wasm` it loads is a cross-origin request. GitHub Pages does this for you. On Cloudflare Pages, the `_headers` file in the repository does it. Without the header the sketch never starts.',
        'You do not need `SharedArrayBuffer` or special isolation headers: the physics build is single-threaded on purpose.',
      ] },
    ],
  },

  {
    id: 'planned', group: 'Guides', title: 'Planned, not built yet',
    summary: 'What is not in the engine, so you do not waste an afternoon looking for it.',
    blocks: [
      'These are things people ask for. **None of them work today.** They are listed here so you know it is the engine and not your code.',
      { table: { head: ['Planned', 'What you can do today'], rows: [
        ['Textures (pictures wrapped on a shape)', 'Use `color`, `metalness` and `roughness`.'],
        ['Sounds', 'Nothing yet.'],
        ['glTF models', 'Build shapes from `Hull` and `TriangleMesh`, or compose several Solids with a `GlueJoint`.'],
        ['`Tiles` (a level built from rows of text)', 'Loop over a list and make Solids, as the examples do.'],
        ['Text labels that float above a Solid', 'Draw text in `drawTop()`.'],
        ['Saving (`storeItem`, `getItem`)', 'Nothing yet.'],
        ['Online play (`multiplayer`, `online`)', 'Nothing yet.'],
        ['Terrain from a height map', 'Build a `TriangleMesh` yourself, as the bowl on [Hulls and triangle meshes](#/custom-shapes) does.'],
        ['Vehicles, ragdolls, soft bodies, a character controller', 'Build them from Solids and joints, and a locked-rotation body for a character.'],
        ['Motorised, cone-limited and 6-axis joints', 'The five joints on the [Joints](#/joints) page.'],
        ['Grouping identical Solids into one draw call', 'Keep the number of Solids down. See [Performance](#/performance).'],
        ['Maths helpers (`map`, `lerp`, `constrain`, `sin`...)', 'Use JavaScript\'s own: `Math.sin`, `Math.min`, `Math.max`.'],
      ] } },
      { demo: {
        id: 'unknown-property', title: 'An unknown property is quietly ignored',
        code: `function setup() {
  const a = new Cube(0, 0, 0);
  a.texture = 'coin';                     // accepted, and does nothing
  console.log('texture reads back as', a.texture);
  console.log('but nothing was drawn with it: it is still', a.color);
}
`,
        steps: [{ wait: 10 }],
        expect: () => new Cube(0, 0, 0).color === '#8be9fd',
      } },
    ],
  },

  {
    id: 'reference', group: 'Reference', title: 'Reference',
    summary: 'Every name, one line each. Generated from the same table the tests check against the engine.',
    blocks: [
      'Types are written the way you would use them. **Units**: positions and sizes in units (about metres), angles in degrees, `vel`, `angularVelocity`, `maxSpeed` and `maxSpin` per frame. The typings for editors are in [`docs/spashial.d.ts`](spashial.d.ts).',
      { reference: true },
    ],
  },
];

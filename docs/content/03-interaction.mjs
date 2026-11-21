// Pages: keyboard, mouse, raycasts, camera, lights, hud.
// Block types are listed at the top of 01-start.mjs. Test steps (not shown on the page) also accept
// { mdown: true } / { mup: true } for the mouse button, and { click: 'center', button: 'right' }.

export default [
  {
    id: 'keyboard', group: 'Interaction', title: 'Keyboard',
    summary: 'Is a key going down, held, or coming up?',
    blocks: [
      'Click the picture once so it has the keyboard, then press keys. Three functions cover everything, and each one takes a key name.',
      { table: { head: ['Call', 'Answers', 'Use it for'], rows: [
        ['`kb.presses(\'space\')`', '`true` on the **one frame** the key goes down', 'A jump, a shot, a menu choice.'],
        ['`kb.pressing(\'d\')`', 'How many frames the key has been held (0 when it is up, so it also works as true or false)', 'Walking, steering, anything continuous.'],
        ['`kb.released(\'space\')`', '`true` on the **one frame** the key comes up', 'Letting go of a charged shot.'],
      ] } },
      'Key names are lowercase: letters and digits as they are (`\'a\'`, `\'7\'`), and `\'space\'`, `\'enter\'`, `\'tab\'`, `\'escape\'`, `\'shift\'`, `\'ctrl\'`, `\'up\'`, `\'down\'`, `\'left\'`, `\'right\'`. With **no name**, a call means any key: `kb.presses()`.',
      { demo: {
        id: 'kb-verbs', title: 'See the three verbs',
        hint: 'Click the picture, then tap and hold Space.',
        code: `const n = { presses: 0, maxHeld: 0, released: 0 };
function setup() {
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 0, 0);
}
function update() {
  if (kb.presses('space')) n.presses++;                          // once
  n.maxHeld = Math.max(n.maxHeld, kb.pressing('space'));         // counts up while held
  if (kb.released('space')) n.released++;                        // once
}
function drawTop() {
  fill('white'); textSize(18);
  text('presses ' + n.presses + '    held ' + kb.pressing('space') + ' frames    released ' + n.released, 12, 12);
}
`,
        steps: [{ wait: 10 }, { down: 'Space' }, { wait: 25 }, { up: 'Space' }, { wait: 5 }],
        expect: () => n.presses === 1 && n.released === 1 && n.maxHeld >= 20,
      } },
      { h: 'Walking' },
      'Hold a key with `pressing`, and set the velocity from it. Setting `vel.x` and `vel.z` and leaving `vel.y` alone keeps gravity working. This is the whole example from the sandbox: WASD to walk, Space to jump from the ground.',
      { demo: { id: 'walk', title: 'WASD and Space', from: 'walk-and-jump', hint: 'Click the picture, then use W A S D and Space.', steps: [{ wait: 60 }, { down: 'd' }, { wait: 30 }, { up: 'd' }], expect: () => player.x > 1.5 } },
      { demo: {
        id: 'arrows-shift', title: 'Arrow keys, and Shift to sprint',
        hint: 'Click the picture, then use the arrow keys. Hold Shift to run.',
        code: `let ball;
function setup() {
  world.gravity.y = -10;
  new Floor(40);
  ball = new Sphere(0, 0.5, 0, 1);
  ball.color = 'tomato';
  camera.follow(ball, { distance: 9, height: 5 });
}
function update() {
  const speed = kb.pressing('shift') ? 0.2 : 0.1;
  let dx = 0, dz = 0;
  if (kb.pressing('left')) dx -= 1;
  if (kb.pressing('right')) dx += 1;
  if (kb.pressing('up')) dz -= 1;
  if (kb.pressing('down')) dz += 1;
  ball.vel.x = dx * speed;
  ball.vel.z = dz * speed;
}
`,
        steps: [{ down: 'ArrowRight' }, { wait: 30 }, { up: 'ArrowRight' }],
        expect: () => ball.x > 1.5,
      } },
      { h: 'Any key' },
      'Call `kb.presses()` with no name to wait for the first key of any kind: a title screen, "press any key to start".',
      { demo: {
        id: 'any-key', title: 'Press any key to start',
        hint: 'Click the picture, then press any key.',
        code: `let started = false, box;
function setup() {
  world.gravity.y = -10;
  new Floor();
  box = new Cube(0, 6, 0);
  box.color = 'gold';
  world.autoStep = false;                       // frozen until a key is pressed
  camera.pos = [0, 3, 9];
  camera.lookAt(0, 2.5, 0);
}
function update() {
  if (!started && kb.presses()) { started = true; world.autoStep = true; }
}
function drawTop() {
  fill('white'); textSize(20); textAlign(CENTER);
  text(started ? 'go!' : 'press any key', width / 2, 24);
}
`,
        steps: [{ wait: 30 }, { press: 'x' }, { wait: 30 }],
        expect: () => started === true && box.y < 6,
      } },
      { note: 'The arrow keys and Space are kept from scrolling the web page, so a game can use them. The page must have focus: if keys do nothing, click the picture first.' },
    ],
  },

  {
    id: 'mouse', group: 'Interaction', title: 'Mouse',
    summary: 'Where the pointer is, which Solid it is over, and what a click does.',
    blocks: [
      'The pointer has a position and three buttons: `\'left\'` (the default), `\'center\'` and `\'right\'`. The browser\'s own right-click menu is switched off over the picture, so a game can use the right button.',
      { table: { head: ['Call', 'Meaning'], rows: [
        ['`mouse.x`, `mouse.y`', 'Where the pointer is, in pixels from the top left of the picture.'],
        ['`mouse.presses()`', '`true` on the one frame a button goes down. Give a name for a different button: `mouse.presses(\'right\')`.'],
        ['`mouse.pressing()`', 'How many frames the button has been held, 0 if it is up.'],
        ['`mouse.released()`', '`true` on the one frame the button comes up.'],
        ['`mouse.moved`', 'How far the pointer moved this frame, `{ x, y }`.'],
        ['`solid.mouse.hovering()`', 'Is the pointer over this Solid?'],
        ['`solid.mouse.hovers()` and `hovered()`', '`true` on the one frame the pointer arrives or leaves.'],
        ['`solid.mouse.presses()`, `pressing()`, `released()`', 'A button going down, held, or up while the pointer is over this Solid.'],
        ['`world.getSolidAt(x, y)`', 'The Solid under any point on the screen, or `undefined`.'],
      ] } },
      { demo: {
        id: 'mouse-xy', title: 'The pointer position',
        hint: 'Move the pointer over the picture.',
        code: `function setup() {
  new Floor(20);
  camera.pos = [0, 6, 10];
  camera.lookAt(0, 0, 0);
}
function drawTop() {
  fill('white'); textSize(16);
  text('mouse: ' + Math.round(mouse.x) + ', ' + Math.round(mouse.y), 12, 12);
  noFill(); stroke('gold'); strokeWeight(2);
  circle(mouse.x, mouse.y, 30);                 // a ring that follows the pointer
}
`,
        steps: [{ move: 'center' }, { wait: 5 }],
        expect: () => mouse.x > 100 && mouse.y > 60,
      } },
      { h: 'Hover and click a Solid' },
      { demo: {
        id: 'mouse-solid', title: 'Hover to light up, click to pop',
        hint: 'Move over a cube, then click it.',
        code: `const cubes = [];
function setup() {
  world.gravity.y = -10;
  new Floor(20);
  for (let i = 0; i < 5; i++) {
    const c = new Cube(-4 + i * 2, 0.7, 0, 1.4);
    c.color = '#6272a4';
    cubes.push(c);
  }
  camera.pos = [0, 4, 10];
  camera.lookAt(0, 0.7, 0);
}
function update() {
  for (const c of cubes) {
    c.color = c.mouse.hovering() ? 'gold' : '#6272a4';
    if (c.mouse.presses()) c.applyImpulse(0, 12, 0);     // click: pop it up
  }
}
`,
        steps: [{ move: 'center' }, { wait: 5 }, { click: 'center' }, { wait: 12 }],
        expect: () => cubes[2].y > 1.2,
      } },
      { h: 'What is under the pointer?' },
      '`world.getSolidAt(x, y)` takes a point on the screen and gives back the Solid there. With `mouse.x` and `mouse.y` it answers "what am I pointing at?" for the whole scene, without asking every Solid.',
      { demo: {
        id: 'get-solid-at', title: 'Name what you point at',
        hint: 'Move the pointer over the shapes.',
        code: `let under;
function setup() {
  new Floor(20);
  new Sphere(-3, 1, 0, 2, 'static').color = 'tomato';
  new Cube(0, 1, 0, 2, 2, 2, 'static').color = 'gold';
  new Cone(3, 1, 0, 2, 2, 2, 'static').color = 'skyblue';
  camera.pos = [0, 4, 10];
  camera.lookAt(0, 1, 0);
}
function update() {
  under = world.getSolidAt(mouse.x, mouse.y);
}
function drawTop() {
  fill('white'); textSize(18);
  text(under ? 'pointing at a ' + under.shape : 'pointing at nothing', 12, 12);
}
`,
        steps: [{ move: 'center' }, { wait: 5 }],
        expect: () => under && under.shape === 'box',
      } },
      { h: 'The other buttons' },
      { demo: {
        id: 'right-click', title: 'Right click flips gravity',
        hint: 'Right-click the picture. No browser menu opens.',
        code: `let ball;
function setup() {
  world.gravity.y = -10;
  new Floor(20);
  new Cube(0, 14, 0, 20, 1, 20, 'static').opacity = 0.2;     // a glass ceiling
  ball = new Sphere(0, 3, 0, 1.4);
  ball.bounciness = 0.6;
  ball.color = 'orchid';
  camera.pos = [0, 7, 15];
  camera.lookAt(0, 6, 0);
}
function update() {
  if (mouse.presses('right')) world.gravity.y = -world.gravity.y;
}
function drawTop() {
  fill('white'); textSize(16);
  text('gravity ' + world.gravity.y + '   (right-click to flip)', 12, 12);
}
`,
        steps: [{ wait: 10 }, { click: 'center', button: 'right' }, { wait: 5 }],
        expect: () => world.gravity.y === 10,
      } },
      'The mouse also steers the camera: see [Camera](#/camera) for `camera.orbit(..., { drag: true })`.',
      { note: 'Pointer lock (`mouse.lock()`) is for first-person looking. It needs permission the docs frames do not give, so here it only prints a warning. If you host spaSHial yourself you can add `allow-pointer-lock` to the iframe\'s `sandbox`.' },
    ],
  },

  {
    id: 'raycasts', group: 'Interaction', title: 'Ray casts',
    summary: 'Draw an invisible line and ask what it hits.',
    blocks: [
      'A **ray cast** fires a line between two points and tells you what it crosses first. It is how you ask "is there ground under my feet?", "can I see the target?" or "where is my laser pointing?".',
      { table: { head: ['Call', 'Returns'], rows: [
        ['`world.rayCast(from, to)`', 'The closest **solid** thing on the line, or `null`. Sensors and `\'none\'` solids are looked through.'],
        ['`world.rayCastAll(from, to)`', 'Every Solid along the line, nearest first, as a list.'],
      ] } },
      'Both take two points, each as `[x, y, z]` or as a vector (`player.pos`), and an optional third argument (see **Skipping the shooter** below). A hit is an object with four parts.',
      { table: { head: ['Field', 'Meaning'], rows: [
        ['`solid`', 'The Solid that was hit.'],
        ['`point`', 'Where, as a vector.'],
        ['`normal`', 'Which way the hit surface faces, length 1, pointing away from it.'],
        ['`fraction`', 'How far along the line, from 0 (the start) to 1 (the end).'],
      ] } },
      { demo: {
        id: 'ray-sweep', title: 'A sweeping scanner',
        code: `let marker, hits = 0;
function setup() {
  new Floor(26);
  // an uneven ring of walls round the middle
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = 6 + (i % 3);
    const wall = new Cube(Math.cos(a) * r, 1, Math.sin(a) * r, 2, 2, 2, 'static');
    wall.rotation.y = -a * 57.3;
    wall.color = i % 2 ? '#6272a4' : '#8be9fd';
  }
  marker = new Sphere(0, 1, 0, 0.5, 'none');          // looked through by rays
  marker.color = 'gold';
  camera.pos = [0, 14, 9];
  camera.lookAt(0, 0, 0);
}
function update() {
  const a = frameCount * 0.02;
  const hit = world.rayCast([0, 1, 0], [Math.cos(a) * 20, 1, Math.sin(a) * 20]);
  if (hit) { marker.pos = hit.point; hits++; }          // put the marker where the ray ended
}
function drawTop() {
  fill('white'); textSize(14);
  text('hits: ' + hits, 12, 12);
}
`,
        steps: [{ wait: 120 }],
        expect: () => hits > 100 && marker.distanceTo(0, 1, 0) > 3.5 && marker.distanceTo(0, 1, 0) < 9,
      } },
      { h: 'Skipping the shooter' },
      'A ray that starts **inside** a solid does not hit that solid. But a ray that starts further back crosses it, so it can report the body that fired it. Pass `{ ignore: shooter }` (a Solid, or a list of them) to look past it. With two points, a bare `shooter` works too.',
      { demo: {
        id: 'ray-ignore', title: 'The same ray, with and without ignore',
        code: `let shooter, target, plain = null, past = null;
function setup() {
  new Floor(20);
  shooter = new Cube(-3, 1, 0, 1.4, 2, 1.4, 'static');
  shooter.color = 'tomato';
  target = new Cube(4, 1, 0, 1.4, 2, 1.4, 'static');
  target.color = 'gold';
  camera.pos = [0, 7, 12];
  camera.lookAt(0, 1, 0);
}
function update() {
  plain = world.rayCast([-6, 1, 0], [8, 1, 0]);                         // the shooter is in the way
  past = world.rayCast([-6, 1, 0], [8, 1, 0], { ignore: shooter });     // looks past it
}
function drawTop() {
  fill('white'); textSize(16);
  text('plain: ' + (plain && plain.solid === shooter ? 'the shooter' : '?') + '    ignore: ' + (past && past.solid === target ? 'the target' : '?'), 12, 12);
}
`,
        steps: [{ wait: 20 }],
        expect: () => plain !== null && plain.solid === shooter && past !== null && past.solid === target,
      } },
      { h: 'Every Solid on the line' },
      { demo: {
        id: 'ray-all', title: 'rayCastAll lists them nearest first',
        code: `let list = [];
function setup() {
  new Floor(24);
  [['tomato', -6], ['gold', -1], ['skyblue', 4]].forEach(([color, x]) => {
    new Cube(x, 1, 0, 1.6, 2, 1.6, 'static').color = color;
  });
  camera.pos = [0, 6, 14];
  camera.lookAt(0, 1, 0);
}
function update() {
  list = world.rayCastAll([-10, 1, 0], [10, 1, 0]);
}
function drawTop() {
  fill('white'); textSize(16);
  text('the ray crosses: ' + list.map((h) => h.solid.color).join(', then '), 12, 12);
}
`,
        steps: [{ wait: 10 }],
        expect: () => list.length === 3 && list[0].solid.color === 'tomato' && list[2].solid.color === 'skyblue',
      } },
      { h: 'Is the player on the ground?' },
      'A short ray straight down from the player is the standard ground check: jump only if it hits something. The walking example from [Keyboard](#/keyboard) does exactly this with `world.rayCast(player.pos, [player.x, player.y - 0.6, player.z])`.',
      { demo: { id: 'ground-check', title: 'Jump only from the ground', from: 'walk-and-jump', hint: 'Click the picture, then press Space once and again in the air.', steps: [{ wait: 60 }, { press: 'Space' }, { wait: 8 }, { press: 'Space' }, { wait: 12 }], expect: () => player.y > 0.9 } },
    ],
  },

  {
    id: 'camera', group: 'Interaction', title: 'Camera',
    summary: 'Place it, aim it, zoom it, make it follow, orbit or fly.',
    blocks: [
      'There is one global `camera`. It starts a few units back and above the middle of the world, looking at it.',
      { table: { head: ['Call', 'Meaning'], rows: [
        ['`camera.pos = [x, y, z]`', 'Where the camera is. `camera.x`, `.y` and `.z` work too.'],
        ['`camera.lookAt(x, y, z)`', 'Aim it at a point (or a Solid). It stays aimed there while you move it.'],
        ['`camera.fov`', 'Field of view in degrees, default 60. Smaller zooms in, bigger is wide angle.'],
        ['`camera.follow(solid, { distance, height, tracking })`', 'Trails a Solid from behind and above, smoothly. `tracking` is the share of the gap closed each frame (default 0.1).'],
        ['`camera.orbit(point, { distance, drag })`', 'Circles a point. With `drag: true` the player turns it by dragging with the mouse.'],
        ['`camera.free()`', 'Stops `follow` or `orbit` and leaves the camera where it is.'],
      ] } },
      { demo: {
        id: 'camera-fov', title: 'Position, aim and zoom',
        hint: 'Click the picture, then press the up and down arrow keys.',
        code: `function setup() {
  new Floor(30);
  for (let i = 0; i < 6; i++) new Cube(-5 + i * 2, 1, -2 - i, 1.5, 2, 1.5, 'static').color = ['tomato', 'gold', 'skyblue'][i % 3];
  camera.pos = [0, 3, 10];
  camera.lookAt(0, 1, -4);
}
function update() {
  if (kb.pressing('up')) camera.fov = Math.max(20, camera.fov - 1);
  if (kb.pressing('down')) camera.fov = Math.min(110, camera.fov + 1);
}
function drawTop() {
  fill('white'); textSize(16);
  text('fov ' + camera.fov + ' degrees   (up and down)', 12, 12);
}
`,
        steps: [{ down: 'ArrowUp' }, { wait: 15 }, { up: 'ArrowUp' }],
        expect: () => camera.fov < 50,
      } },
      { h: 'Follow' },
      'A follow camera hangs behind a Solid. Behind means behind the way the Solid is facing, so for a body that never turns (a locked character) it stays on the +z side. A bigger `tracking` keeps up faster; a smaller one lags and feels floaty.',
      { demo: {
        id: 'camera-follow', title: 'Follow a rolling ball',
        hint: 'Click the picture, then hold D or A.',
        code: `let ball;
function setup() {
  world.gravity.y = -10;
  new Floor(200);
  for (let i = 0; i < 20; i++) new Cube(i * 6 - 30, 1, -4, 1, 2, 1, 'static').color = i % 2 ? 'gold' : 'tomato';
  ball = new Sphere(0, 1, 0, 1.4);
  ball.color = 'skyblue';
  camera.follow(ball, { distance: 8, height: 4, tracking: 0.08 });
}
function update() {
  if (kb.pressing('d')) ball.applyForce(12, 0, 0);
  if (kb.pressing('a')) ball.applyForce(-12, 0, 0);
}
`,
        steps: [{ down: 'd' }, { wait: 90 }, { up: 'd' }, { wait: 60 }],
        expect: () => ball.x > 3 && Math.abs(camera.x - ball.x) < 3,
      } },
      { h: 'Orbit' },
      'An orbit camera circles one point. Turn on `drag` and the player can swing it round by dragging with the mouse: good for looking at a model or a puzzle.',
      { demo: {
        id: 'camera-orbit', title: 'Drag to look around',
        hint: 'Drag with the mouse over the picture.',
        code: `let startX;
function setup() {
  new Floor(14);
  new Cube(0, 1, 0, 2, 2, 2, 'static').color = 'tomato';
  new Sphere(3, 0.7, 0, 1.4, 'static').color = 'gold';
  new Cone(-3, 1, 0, 2, 2, 2, 'static').color = 'skyblue';
  camera.orbit([0, 1, 0], { distance: 11, drag: true });
  startX = camera.x;
}
function drawTop() {
  fill('white'); textSize(16);
  text('drag to orbit', 12, 12);
}
`,
        steps: [{ wait: 10 }, { move: 'center' }, { mdown: true }, { move: { fx: 0.75, fy: 0.5 } }, { wait: 3 }, { mup: true }, { wait: 5 }],
        expect: () => Math.abs(camera.x - startX) > 1,
      } },
      { h: 'Free flight' },
      '`camera.free()` stops follow and orbit and leaves the camera where it is, and then you can move it yourself. Move `camera.pos` and the aim stays pointing the same way.',
      { demo: {
        id: 'camera-fly', title: 'Fly the camera with W A S D',
        hint: 'Click the picture, then hold W, A, S, D, Q or E.',
        code: `function setup() {
  new Floor(60);
  for (let i = 0; i < 30; i++) {
    new Cube(random(-20, 20), 1, random(-30, 0), 2, random(1, 5), 2, 'static').color = ['tomato', 'gold', 'skyblue', 'orchid'][i % 4];
  }
  camera.pos = [0, 3, 10];
  camera.lookAt(0, 3, -10);
  camera.free();
}
function update() {
  const s = 0.15;
  if (kb.pressing('w')) camera.z -= s;
  if (kb.pressing('s')) camera.z += s;
  if (kb.pressing('a')) camera.x -= s;
  if (kb.pressing('d')) camera.x += s;
  if (kb.pressing('e')) camera.y += s;
  if (kb.pressing('q')) camera.y -= s;
}
`,
        steps: [{ down: 'w' }, { wait: 30 }, { up: 'w' }],
        expect: () => camera.z < 8,
      } },
    ],
  },

  {
    id: 'lights', group: 'World', title: 'Lights and sky',
    summary: 'Ambient light, a sun, bulbs, torches, shadows and the colour of the sky.',
    blocks: [
      'A scene has two lights from the start: **ambient** light that comes from everywhere (so nothing is pitch black) and a **sun** that shines in one direction (so shapes have a bright side and a dark side). You can add bulbs and torches.',
      { table: { head: ['Name', 'What it is'], rows: [
        ['`ambientLight.color`, `.intensity`', 'Light from everywhere. Default white, 0.9.'],
        ['`sunLight.color`, `.intensity`, `.direction`, `.shadows`', 'One light with a direction (a vector for which way it travels). Default white, 2.4, shadows off.'],
        ['`new PointLight(x, y, z, color, intensity)`', 'A bulb: spreads light in every direction from a point.'],
        ['`new SpotLight(x, y, z, color, intensity)`', 'A torch: a cone of light. Aim it with `lookAt(x, y, z)`, widen it with `angle`.'],
        ['`background(colour)`', 'The colour of the sky. A CSS colour, or a grey 0 to 255.'],
      ] } },
      { demo: {
        id: 'sun-direction', title: 'Turn the sun',
        code: `let a = 0;
function setup() {
  new Floor(20);
  new Cube(-2, 1, 0, 2, 2, 2, 'static').color = 'tomato';
  new Sphere(2, 1, 0, 2, 'static').color = 'gold';
  new Cylinder(0, 1, 3, 1.5, 2, 1.5, 'static').color = 'skyblue';
  camera.pos = [0, 6, 11];
  camera.lookAt(0, 0.8, 0);
}
function update() {
  a += 0.02;
  sunLight.direction = [Math.cos(a), -0.8, Math.sin(a)];     // the sun walks round the sky
}
`,
        steps: [{ wait: 30 }],
        expect: () => Math.abs(sunLight.direction.x + 0.4) > 0.05,
      } },
      { h: 'Shadows' },
      '`sunLight.shadows = true` makes Solids cast soft shadows. They are **off by default**, because shadows cost graphics time, and on a school computer with integrated graphics that matters. Turn them on where they help the picture, such as showing how high a jumping character is.',
      { list: [
        'The shadows are drawn inside a box 40 units across that **follows what the camera looks at**, so they work wherever the action is, not only near the middle of the world.',
        'The default sun is low and sideways, so a shadow falls off to one side. For a shadow **right under** things, point the sun nearly straight down: `sunLight.direction = [-0.15, -1, -0.2]`.',
        'For a soft, gentle shadow rather than a harsh one, balance the two lights: `sunLight.intensity = 1.8` and `ambientLight.intensity = 1.2`.',
      ] },
      { demo: {
        id: 'shadows', title: 'A shadow under a bouncing ball',
        code: `let ball;
function setup() {
  world.gravity.y = -10;
  new Floor(20);
  sunLight.shadows = true;
  sunLight.direction = [-0.15, -1, -0.2];   // nearly overhead: the shadow lands under the ball
  sunLight.intensity = 1.8;
  ambientLight.intensity = 1.2;
  new Cube(-3, 1, 0, 2, 2, 2, 'static').color = 'tomato';
  ball = new Sphere(1, 5, 0, 1.4);
  ball.bounciness = 0.9; ball.color = 'gold';
  camera.pos = [0, 5, 11];
  camera.lookAt(0, 1.5, 0);
}
`,
        steps: [{ wait: 20 }],
        expect: () => sunLight.shadows === true && __spashial.renderer.shadowMap.enabled && __spashial.sun.castShadow,
      } },
      'The shadow box moves with the camera, so shadows keep working as you travel. This player walks more than 20 units from where the world started, and the shadow under it stays on the floor, even in a jump.',
      { demo: {
        id: 'shadow-follows', title: 'Walk a long way with shadows on',
        hint: 'Click the picture, then hold D to walk and press Space to jump.',
        code: `let player;
function setup() {
  world.gravity.y = -10;
  new Floor(200);
  sunLight.shadows = true;
  sunLight.direction = [-0.15, -1, -0.2];
  sunLight.intensity = 1.8;
  ambientLight.intensity = 1.2;
  for (let i = 0; i < 12; i++) new Cube(i * 6 - 6, 1.5, -3, 1.5, 3, 1.5, 'static').color = i % 2 ? 'gold' : 'skyblue';
  player = new Cube(0, 0.5, 0);
  player.color = 'tomato';
  player.lockRotation = true;
  player.friction = 0;
  camera.follow(player, { distance: 9, height: 5 });
}
function update() {
  player.vel.x = kb.pressing('d') ? 0.12 : kb.pressing('a') ? -0.12 : 0;
  if (kb.presses('space') && player.y < 0.6) player.applyImpulse(0, 6, 0);
}
`,
        steps: [{ down: 'd' }, { wait: 190 }, { up: 'd' }, { wait: 10 }],
        expect: () => player.x > 20 && Math.abs(__spashial.sun.target.position.x - player.x) < 3,
      } },
      { note: 'Shadows are optional and cost GPU time. If a sketch runs slowly on a school computer, switching `sunLight.shadows` off is one of the cheapest ways to get speed back. See [Performance](#/performance).' },
      { h: 'Bulbs' },
      'To see a bulb, turn the ambient light down. A `PointLight` is not a Solid: it has a position you can move every frame, a colour and an intensity, and nothing can touch it.',
      { demo: {
        id: 'bulbs', title: 'A bulb circling three shapes',
        code: `let bulb;
function setup() {
  new Floor(20);
  ambientLight.intensity = 0.15;        // dim the room
  sunLight.intensity = 0.2;
  new Cube(-3, 1, 0, 2, 2, 2, 'static');
  new Sphere(0, 1, 0, 2, 'static');
  new Cone(3, 1, 0, 2, 2, 2, 'static');
  bulb = new PointLight(0, 3, 4, '#ffb86c', 60);
  camera.pos = [0, 5, 11];
  camera.lookAt(0, 1, 0);
}
function update() {
  const a = frameCount * 0.03;
  bulb.pos = [Math.cos(a) * 5, 3, Math.sin(a) * 5];
}
`,
        steps: [{ wait: 30 }],
        expect: () => ambientLight.intensity === 0.15 && Math.hypot(bulb.pos.x, bulb.pos.z) > 4.9,
      } },
      { h: 'A torch' },
      { demo: {
        id: 'torch', title: 'A spotlight that follows a ball',
        code: `let ball, torch;
function setup() {
  world.gravity.y = -10;
  new Floor(24);
  ambientLight.intensity = 0.2;
  sunLight.intensity = 0.2;
  ball = new Sphere(-5, 0.7, 0, 1.4);
  ball.color = 'gold';
  torch = new SpotLight(0, 9, 6, 'white', 400);
  torch.angle = 22;
  camera.pos = [0, 7, 12];
  camera.lookAt(0, 0, 0);
}
function update() {
  ball.vel.x = Math.cos(frameCount * 0.02) * 0.08;        // rolls back and forth
  torch.lookAt(ball.x, ball.y, ball.z);                      // the torch tracks it
}
`,
        steps: [{ wait: 30 }],
        expect: () => torch.angle > 21 && torch.angle < 23,
      } },
      { h: 'The sky' },
      { demo: {
        id: 'sky', title: 'A sky that changes colour',
        code: `function setup() {
  new Floor(20);
  new Cube(0, 1, 0, 2, 2, 2, 'static').color = 'tomato';
  camera.pos = [0, 4, 9];
  camera.lookAt(0, 1, 0);
}
function draw() {
  const t = (Math.sin(frameCount * 0.02) + 1) / 2;            // 0 to 1 and back
  background('rgb(' + Math.round(20 + t * 90) + ', ' + Math.round(30 + t * 120) + ', ' + Math.round(60 + t * 160) + ')');
}
`,
        steps: [{ wait: 60 }],
        expect: () => __spashial.scene.background.r > 0,
      } },
    ],
  },

  {
    id: 'hud', group: 'World', title: 'The HUD',
    summary: 'Scores, health bars and crosshairs drawn over the 3D picture.',
    blocks: [
      'Everything you draw in `drawTop()` goes on a flat layer **over** the finished 3D picture, in pixels measured from the top left. That is where scores, labels and health bars live. Anything drawn outside `drawTop()` is wiped each frame.',
      { table: { head: ['Call', 'Does'], rows: [
        ['`fill(colour)`, `noFill()`', 'The colour inside shapes and text. A CSS colour, a grey 0 to 255, or `fill(r, g, b)`.'],
        ['`stroke(colour)`, `noStroke()`, `strokeWeight(n)`', 'The outline.'],
        ['`text(words, x, y)`', 'Writes words (or a number). Its top left corner is at x, y.'],
        ['`textSize(n)`, `textAlign(LEFT | CENTER | RIGHT)`', 'How big, and which side of x the words sit on.'],
        ['`rect(x, y, w, h)`', 'A rectangle from its top left corner.'],
        ['`circle(x, y, diameter)`', 'A circle from its middle.'],
        ['`line(x1, y1, x2, y2)`', 'A line.'],
        ['`width`, `height`', 'The size of the picture, for placing things relative to the edges.'],
      ] } },
      { demo: {
        id: 'hud-basics', title: 'Every drawing call',
        code: `function setup() {
  world.gravity.y = -10;
  new Floor();
  new Sphere(0, 5, 0, 1.6).bounciness = 0.8;
  camera.pos = [0, 3, 10];
  camera.lookAt(0, 2, 0);
}
function drawTop() {
  fill('#282a36'); stroke('white'); strokeWeight(2);
  rect(10, 10, 220, 64);                          // a panel
  noStroke(); fill('white'); textSize(18);
  text('SCORE ' + frameCount, 22, 20);
  fill('tomato'); circle(30, 56, 14);             // a lives marker
  fill('gold'); rect(50, 50, 150, 12);            // a bar
  stroke('white'); strokeWeight(1);
  line(width / 2 - 12, height / 2, width / 2 + 12, height / 2);   // a crosshair
  line(width / 2, height / 2 - 12, width / 2, height / 2 + 12);
  noStroke(); fill('white'); textAlign(CENTER); textSize(14);
  text('centred text', width / 2, height - 30);
  textAlign(LEFT);
}
`,
        steps: [{ wait: 10 }],
        expect: () => { const r = __spashial.hudRatio; const d = __spashial.hud.getContext('2d').getImageData(Math.round(120 * r), Math.round(55 * r), 1, 1).data; return d[3] === 255 && d[0] > 200; },
      } },
      { h: 'A health bar' },
      'A bar is a rectangle whose width is a number. Draw a dark one for the empty bar, then a bright one for what is left.',
      { demo: {
        id: 'health-bar', title: 'Space to take damage, R to heal',
        hint: 'Click the picture, then press Space and R.',
        code: `let health = 100;
function setup() {
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 0, 0);
  new Floor(10);
}
function update() {
  if (kb.presses('space')) health = Math.max(0, health - 20);
  if (kb.presses('r')) health = 100;
}
function drawTop() {
  noStroke();
  fill('#44475a'); rect(12, 12, 200, 18);                  // the empty bar
  fill(health > 40 ? '#50fa7b' : '#ff5555'); rect(12, 12, 2 * health, 18);   // what is left
  fill('white'); textSize(14);
  text(health + ' / 100', 220, 14);
}
`,
        steps: [{ wait: 5 }, { press: 'Space' }, { wait: 2 }, { press: 'Space' }, { wait: 2 }],
        expect: () => health === 60,
      } },
      { note: 'The HUD is a flat 2D layer, so it cannot sit "in" the 3D world. To label a 3D object, give it a label: `solid.text = \'score 3\'` floats above it and always faces the camera. See [Text labels](#/labels).' },
    ],
  },
];

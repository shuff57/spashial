// Pages: welcome, hooks, coordinates, shapes, looks, custom-shapes.
//
// Block types a page can hold (docs/index.html draws them, tests/docs.test.mjs checks them):
//   'text'                      a paragraph. `code`, **bold** and [label](#/page-id) work.
//   { h: 'Heading' }            a sub heading
//   { list: ['a', 'b'] }        a bullet list
//   { code: '...' }             a code block that is not runnable
//   { note: 'text' }            a call-out
//   { table: { head, rows } }   a table (each cell is text with the same inline marks)
//   { demo: { id, title, code | from, hint?, steps?, expect? } }
//         a live sketch. `from: 'name'` loads demos/name.js. `steps` and `expect` are only for the
//         tests: `steps` is a list of { wait: frames } | { down: key } | { up: key } | { press: key } |
//         { click: [x, y] } | { move: [x, y] }; `expect` runs inside the sketch afterwards and must
//         return true. Every demo needs one: that is what makes a demo a test of the page's claim.
//   { physics: ['physics', 'forces'] }   the Solid reference rows of those groups, with Try it buttons
// Never use an em dash or en dash in any text (the tests refuse them).

export default [
  {
    id: 'welcome', group: 'Start', title: 'Welcome',
    summary: 'A 3D game engine for the web, small enough to learn in an afternoon.',
    blocks: [
      'spaSHial draws 3D with three.js and moves things with **real rigid-body physics** (Jolt, a physics engine used in commercial games). You write a handful of functions and use a handful of globals: `Solid`, `Group`, `world`, `camera`, `kb` and `mouse`. There is nothing to install, import or build.',
      'Here is a whole game world. Press **Run**, then change a number and press it again.',
      { demo: {
        id: 'first-sketch', title: 'Your first sketch',
        code: `function setup() {
  world.gravity.y = -10;      // gravity starts off. This turns it on.
  new Floor();                // a big flat slab to land on
  const box = new Cube(0, 4, 0);
  box.color = 'tomato';
}
`,
        expect: () => __spashial.solids.size === 2 && [...__spashial.solids].some((s) => Math.abs(s.y - 0.5) < 0.1),
      } },
      'Three ideas are all you need to get started.',
      { list: [
        '**Everything you can see is a `Solid`.** `new Cube()`, `new Sphere()` and the other [shapes](#/shapes) are Solids with a shape already chosen.',
        '**Nothing falls until you turn gravity on.** `world.gravity.y = -10` is about right for a world measured in metres.',
        '**`setup()` runs once, `update()` runs 60 times a second.** Put your starting scene in `setup()` and your game rules in `update()`. See [the hooks](#/hooks).',
      ] },
      { h: 'Where to go next' },
      { list: [
        'Make things and make them look right: [Shapes](#/shapes) and [Looks](#/looks).',
        'Make them move and collide: [Physics](#/physics), [Forces](#/forces) and [Touching](#/touch).',
        'Let the player in: [Keyboard](#/keyboard), [Mouse](#/mouse) and [Camera](#/camera).',
        'Build machines: [Joints](#/joints) and [Moving platforms](#/platforms).',
        'Stuck? [When something goes wrong](#/errors) shows the messages you will see and what they mean.',
      ] },
      { note: 'If you already know **moSHion**, the 2D sibling of this engine: the hooks, `Group`, the four collider words and the touch verbs (`collides`, `overlaps` and friends) are the same. The differences are three axes, degrees, and a default friction of 0.5.' },
    ],
  },

  {
    id: 'hooks', group: 'Start', title: 'The hooks',
    summary: 'The functions the engine calls for you, and the order they run in.',
    blocks: [
      'You do not write a loop. You write functions with these names and the engine calls them.',
      { table: { head: ['Function', 'When it runs', 'Use it for'], rows: [
        ['`setup()`', 'Once, first', 'Making your starting scene.'],
        ['`update()`', 'Before every physics step: **60 times a second**, whatever the screen does', 'Game rules, input, forces, timers.'],
        ['`draw()`', 'Once for each frame the screen draws, before the 3D scene', 'Changing the sky with `background()`.'],
        ['`drawTop()`', 'After the 3D scene, in screen space', 'The HUD: scores, labels, health bars. See [the HUD](#/hud).'],
      ] } },
      'The order inside one frame is: `update()`, then the physics step, then `draw()`, then the picture is drawn, then `drawTop()`.',
      { demo: {
        id: 'hooks-order', title: 'Watch the hooks run',
        code: `let box;
function setup() {
  world.gravity.y = -10;
  new Floor();
  box = new Cube(0, 5, 0);
  box.bounciness = 0.7;
}
function update() {
  // runs 60 times a second, even on a 144 Hz screen
  box.color = box.vel.y > 0 ? 'gold' : 'tomato';   // gold while rising
}
function draw() {
  background('#1b2a3a');   // runs once per drawn frame
}
function drawTop() {
  fill('white');
  textSize(16);
  text('frame ' + frameCount, 12, 12);
}
`,
        expect: () => frameCount > 100 && typeof box.color === 'string',
      } },
      { h: 'Good to know' },
      { list: [
        '`update(step)` is given the step length in seconds (always 1/60), if you want it.',
        'Physics runs at a **fixed 60 Hz** and the picture is smoothed between steps, so a game plays the same on a slow laptop and a fast monitor.',
        '`frameCount` counts physics frames. It is the right thing to time with: `if (frameCount % 60 === 0)` happens once a second.',
        'If your code throws an error, the loop stops at the first one so you read one message, not sixty a second.',
        'A fifth hook, `preload()`, is called once before `setup()`. Nothing needs loading yet, so you can ignore it.',
      ] },
    ],
  },

  {
    id: 'coordinates', group: 'Start', title: 'Space, units and angles',
    summary: 'Which way is up, how big is one unit, and what a degree is.',
    blocks: [
      { list: [
        '**Y is up.** X points right and Z points toward you (a right-handed system).',
        '**One unit is about one metre.** A default cube is 1 unit across. A person is about 1.8 units tall.',
        '**Angles are degrees**, not radians. A quarter turn is 90.',
        '**Speeds are per frame.** `vel` and `angularVelocity` are in units (or degrees) per frame, 60 frames a second. `vel.x = 0.1` is 6 units a second.',
      ] },
      { demo: {
        id: 'axes', title: 'The three axes',
        code: `// Red bar along x (right), green along y (up), blue along z (toward you).
function setup() {
  new Floor(12);
  new Cube(2.5, 0.05, 0, 5, 0.1, 0.1, 'static').color = 'tomato';
  new Cube(0, 2.5, 0, 0.1, 5, 0.1, 'static').color = 'limegreen';
  new Cube(0, 0.05, 2.5, 0.1, 0.1, 5, 'static').color = 'skyblue';
  camera.pos = [6, 5, 8];
  camera.lookAt(0, 1.5, 0);
}
`,
        expect: () => __spashial.solids.size === 4,
      } },
      { demo: {
        id: 'rotation-degrees', title: 'Rotation is in degrees',
        code: `// rotation is three angles in degrees: turn (y), pitch (x) and roll (z).
let spinner;
function setup() {
  new Floor(12);
  spinner = new Cube(0, 1, 0, 3, 0.5, 1, 'static');
  spinner.color = 'gold';
  camera.pos = [0, 4, 8];
  camera.lookAt(0, 1, 0);
}
function update() {
  spinner.rotation.y = frameCount * 2;   // 2 degrees a frame
}
function drawTop() {
  fill('white'); textSize(16);
  text('turn: ' + Math.round(spinner.rotation.y) + ' degrees', 12, 12);
}
`,
        steps: [{ wait: 40 }],
        expect: () => Math.abs(Math.abs(spinner.rotation.y) - 80) < 6 || Math.abs(spinner.rotation.y) > 50,
      } },
      { note: 'Rotation angles are applied in the order turn (y), then pitch (x), then roll (z). If a spinning body does something strange when it tilts, that order is why. For a falling body prefer forces over setting `rotation`: setting it wins over physics for that frame.' },
    ],
  },

  {
    id: 'shapes', group: 'Objects', title: 'Shapes and sizes',
    summary: 'Six shapes, the ways to size them, and the Floor.',
    blocks: [
      'The six shapes are `Cube`, `Sphere`, `Cylinder`, `Capsule`, `Cone` and `Torus`. They are all Solids; the name only picks the starting shape.',
      { demo: { id: 'all-shapes', title: 'All six, dropped from the same height', from: 'all-the-shapes', expect: () => [...__spashial.solids].filter((s) => s._collider === 'dynamic').length === 6 } },
      { h: 'Giving a size' },
      'Every shape takes a position first, then optionally a size, then optionally a collider word.',
      { table: { head: ['You write', 'You get'], rows: [
        ['`new Cube(0, 1, 0)`', 'A 1 by 1 by 1 cube centred at (0, 1, 0).'],
        ['`new Cube(0, 1, 0, 2)`', 'One size: a 2 by 2 by 2 cube. For a sphere, a diameter of 2.'],
        ['`new Cube(0, 1, 0, 4, 1, 2)`', 'Three sizes: width 4, height 1, depth 2.'],
        ['`new Cube(0, 1, 0, 2, \'static\')`', 'Any of the above, then a collider: `\'dynamic\'` (default), `\'static\'`, `\'kinematic\'` or `\'none\'`.'],
        ['`new Floor()`', 'A big static slab 40 across with its top at y = 0. `new Floor(100)` is 100 across.'],
      ] } },
      { table: { head: ['Shape', 'What the one-size form means', 'Default'], rows: [
        ['Cube', 'Width, height and depth', '1 by 1 by 1'],
        ['Sphere', 'Diameter (a sphere has one size)', '1 across'],
        ['Cylinder', 'Diameter and height', '1 across, 1 high'],
        ['Capsule', 'Diameter; it is twice as tall as it is wide', '1 across, 2 high'],
        ['Cone', 'Base diameter and height; the tip points up', '1 across, 1 high'],
        ['Torus', 'Across; the ring is 0.35 of that thick. `h` is the thickness and must be smaller than `w`', '1 across, 0.35 thick'],
      ] } },
      { demo: {
        id: 'sizes', title: 'Every way to size a Solid',
        code: `let a, b, c, d, ball, tall;
function setup() {
  new Floor(14);
  a = new Cube(-4.5, 0.5, 0);               // default
  b = new Cube(-2.5, 1, 0, 2);              // one size
  c = new Cube(0.5, 0.5, 0, 3, 1, 1);       // three sizes
  d = new Cube(3, 0.25, 0, 1, 0.5, 1, 'static');  // with a collider word
  ball = new Sphere(5, 1, 0, 2);            // a sphere 2 across
  tall = new Capsule(-6, 2, 0, 1);          // one size: 1 across, 2 tall
  camera.pos = [0, 4, 12];
  camera.lookAt(0, 1, 0);
}
function drawTop() {
  fill('white'); textSize(14);
  text('c is ' + c.w + ' by ' + c.h + ' by ' + c.d, 12, 12);
}
`,
        expect: () => a.w === 1 && b.w === 2 && c.w === 3 && c.h === 1 && d.collider === 'static' && ball.diameter === 2 && tall.h === 2,
      } },
      { h: 'Changing shape and size later' },
      'Both `shape` and the sizes (`w`, `h`, `d`, `diameter`) can be changed after the Solid exists, and the collider changes with them. Press **Space** in the sketch to cycle the shape.',
      { demo: {
        id: 'change-shape', title: 'Change the shape while it runs',
        hint: 'Click the picture, then press Space.',
        code: `const SHAPES = ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus'];
let thing, n = 0;
function setup() {
  world.gravity.y = -10;
  new Floor();
  thing = new Cube(0, 3, 0, 1.4);
  thing.color = 'orchid';
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 1, 0);
}
function update() {
  if (kb.presses('space')) {
    n = (n + 1) % SHAPES.length;
    thing.shape = SHAPES[n];
    thing.pos = [0, 3, 0];       // pick it up and drop it again
    thing.vel = [0, 0, 0];
  }
}
function drawTop() {
  fill('white'); textSize(16);
  text(thing.shape + '   (Space for the next shape)', 12, 12);
}
`,
        steps: [{ wait: 30 }, { press: 'Space' }, { wait: 5 }],
        expect: () => thing.shape === 'sphere',
      } },
      { note: 'A **Torus** has no ready-made collider in the physics engine, so spaSHial builds one from a ring of 16 capsules. It is accurate to about 2 cm and costs roughly six times what a sphere costs. Use a few, not hundreds.' },
    ],
  },

  {
    id: 'looks', group: 'Objects', title: 'Looks',
    summary: 'Colour, shine, see-through, hidden, and how big it looks.',
    blocks: [
      'These change how a Solid looks and nothing else. A see-through or hidden Solid still collides. `opacity`, `metalness` and `roughness` are held between 0 and 1 (a bigger number counts as 1), and anything that is not a number is an error.',
      { table: { head: ['Property', 'Meaning', 'Default'], rows: [
        ['`color`', 'Any CSS colour: `\'tomato\'`, `\'#ff79c6\'`, `\'rgb(80, 250, 123)\'`', '`\'#8be9fd\'`'],
        ['`metalness`', '0 is matt like chalk, 1 is polished metal', '0'],
        ['`roughness`', '0 is a mirror finish, 1 is completely dull', '0.8'],
        ['`opacity`', '1 is solid, 0 is invisible', '1'],
        ['`visible`', '`false` hides it', '`true`'],
        ['`scale`', 'How big it looks. The collider does not change.', '1'],
      ] } },
      { demo: {
        id: 'metal-grid', title: 'Metalness and roughness',
        code: `// Left to right: more rough. Front to back: more metal.
function setup() {
  new Floor(16);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const s = new Sphere(-2.5 + col * 2.5, 1, -2.5 + row * 2.5, 1.8, 'static');
      s.color = 'gold';
      s.metalness = row / 2;       // 0, 0.5, 1
      s.roughness = 0.1 + col * 0.4; // 0.1, 0.5, 0.9
    }
  }
  camera.pos = [0, 6, 9];
  camera.lookAt(0, 0.5, 0);
}
`,
        expect: () => [...__spashial.solids].filter((s) => s.metalness === 1).length === 3,
      } },
      { demo: {
        id: 'glass', title: 'Opacity and visible',
        hint: 'Click the picture, then press Space to hide and show the glass.',
        code: `let glass;
function setup() {
  world.gravity.y = -10;
  new Floor();
  glass = new Cube(0, 1.5, 0, 3, 3, 3, 'static');
  glass.color = 'skyblue';
  glass.opacity = 0.25;          // see-through
  new Sphere(0, 6, 0, 1).color = 'tomato';   // lands on top of the glass
  camera.pos = [0, 4, 9];
  camera.lookAt(0, 1.5, 0);
}
function update() {
  if (kb.presses('space')) glass.visible = !glass.visible;   // hidden, but still solid
}
`,
        steps: [{ wait: 200 }],
        expect: () => glass.opacity === 0.25 && [...__spashial.solids].some((s) => s._shape === 'sphere' && s.y > 3),
      } },
      { demo: {
        id: 'scale-is-look', title: 'Scale changes the look, not the body',
        code: `// The cube LOOKS 3 times bigger, but its collider is still 1 across.
// So the ball lands where the small cube's top is, and sinks into the big one.
let ball;
function setup() {
  world.gravity.y = -10;
  new Floor();
  const cube = new Cube(0, 0.5, 0, 'static');
  cube.color = 'gold';
  cube.scale = 3;
  ball = new Sphere(0, 6, 0, 1);
  ball.color = 'tomato';
  camera.pos = [0, 3, 9];
  camera.lookAt(0, 1, 0);
}
`,
        steps: [{ wait: 200 }],
        expect: () => Math.abs(ball.y - 1.5) < 0.1,
      } },
      'If you want the collider to change as well, change `w`, `h` and `d` instead. [Shapes](#/shapes) shows how.',
    ],
  },

  {
    id: 'custom-shapes', group: 'Objects', title: 'Hulls and triangle meshes',
    summary: 'Your own shapes: a convex Hull from points, or any shape from triangles.',
    blocks: [
      'When none of the six shapes is right, make your own. There are two ways, and they differ in what they can do.',
      { table: { head: ['', 'Hull', 'TriangleMesh'], rows: [
        ['Made from', 'A list of points. The engine wraps the **smallest convex shape** around them.', 'A list of vertices and a list of triangles, so any shape at all.'],
        ['Can be dynamic?', 'Yes (it is the default).', '**No.** It has no mass, so it is `static` unless you say `kinematic`.'],
        ['Good for', 'Rocks, gems, wedges, crates with cut corners.', 'Rooms, bowls, terrain, anything with a hollow.'],
        ['Size', 'Comes from the points. `w`, `h`, `d` read but cannot be set.', 'Comes from the vertices. Same.'],
      ] } },
      { h: 'A Hull' },
      '`new Hull(x, y, z, points, collider?)`. Points are relative to the Hull\'s own position, and you need at least four that are not all on one flat plane.',
      { demo: {
        id: 'gem-hull', title: 'A dynamic gem and a static ramp',
        code: `let gem;
function setup() {
  world.gravity.y = -10;
  new Floor();
  // an octahedron: two points at the top and bottom, four around the middle
  gem = new Hull(0, 6, 0, [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]);
  gem.color = 'orchid';
  // a wedge: high on the left, sloping down to the right. It never moves.
  const ramp = new Hull(0, 0, 3, [[-3, 0, -1], [3, 0, -1], [-3, 0, 1], [3, 0, 1], [-3, 2, -1], [-3, 2, 1]], 'static');
  ramp.color = '#6272a4';
  const ball = new Sphere(-2.5, 4, 3, 0.8);   // lands on the ramp and rolls down it
  ball.color = 'gold';
  camera.pos = [0, 4, 11];
  camera.lookAt(0, 1.5, 1);
}
`,
        steps: [{ wait: 240 }],
        expect: () => gem.shape === 'hull' && gem.y < 1.2 && gem.points.length === 6,
      } },
      { h: 'A TriangleMesh' },
      '`new TriangleMesh(x, y, z, vertices, triangles, collider?)`. Each triangle is three numbers: indexes into `vertices`. A TriangleMesh is solid from both sides, so the order of a triangle\'s corners does not matter. It stores each triangle twice, so keep the triangle count modest.',
      { demo: {
        id: 'bowl-mesh', title: 'A bowl built from triangles',
        code: `// A bowl: rings of points on a curve, joined into triangles.
function makeBowl(radius, rings, around) {
  const vertices = [[0, 0, 0]];                       // the very bottom
  for (let r = 1; r <= rings; r++) {
    const dist = (r / rings) * radius;
    for (let a = 0; a < around; a++) {
      const angle = (a / around) * Math.PI * 2;
      vertices.push([Math.cos(angle) * dist, dist * dist * 0.25, Math.sin(angle) * dist]);
    }
  }
  const triangles = [];
  for (let a = 0; a < around; a++) triangles.push([0, 1 + a, 1 + ((a + 1) % around)]);
  for (let r = 1; r < rings; r++) {
    for (let a = 0; a < around; a++) {
      const i = 1 + (r - 1) * around + a, j = 1 + (r - 1) * around + ((a + 1) % around);
      triangles.push([i, i + around, j], [j, i + around, j + around]);
    }
  }
  return { vertices, triangles };
}
let balls = [];
function setup() {
  world.gravity.y = -10;
  const bowl = makeBowl(4, 6, 24);
  const b = new TriangleMesh(0, 0, 0, bowl.vertices, bowl.triangles);
  b.color = '#6272a4';
  for (let i = 0; i < 5; i++) {
    const s = new Sphere(random(-2, 2), 5 + i * 1.3, random(-2, 2), 0.9);
    s.color = ['tomato', 'gold', 'skyblue', 'orchid', 'limegreen'][i];
    s.bounciness = 0.3;
    balls.push(s);
  }
  camera.pos = [0, 7, 11];
  camera.lookAt(0, 0.5, 0);
}
`,
        steps: [{ wait: 600 }],
        expect: () => balls.every((s) => Math.hypot(s.x, s.z) < 2.2 && s.y < 1.8),
      } },
      { note: 'A `TriangleMesh` is checked when you make it: a `dynamic` one is refused with a plain message, and so is a list of vertices or triangles that is the wrong shape.' },
    ],
  },
];

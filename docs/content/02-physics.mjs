// Pages: groups, physics, body-settings, forces, touch, platforms, joints, collision-groups, world.
// Block types are listed at the top of 01-start.mjs.

export default [
  {
    id: 'groups', group: 'Objects', title: 'Groups',
    summary: 'A list of Solids that share settings, so one line changes them all.',
    blocks: [
      'A `Group` is an array of Solids with extras. Make one, then make Solids **inside** it with `new group.Solid(...)`. Any setting you give the group is given to every member now, and to every member made later.',
      { demo: {
        id: 'group-basics', title: 'Settings that reach every member',
        code: `const coins = new Group();
coins.color = 'gold';         // set BEFORE they exist: new members get it
coins.bounciness = 0.6;

function setup() {
  world.gravity.y = -10;
  new Floor();
  for (let i = 0; i < 6; i++) {
    new coins.Solid(-3 + i * 1.2, 4 + i, 0, 0.8);   // a small cube, made inside the group
  }
  coins.color = 'orange';     // set AFTER: reaches the six that already exist
  camera.pos = [0, 4, 11];
  camera.lookAt(0, 2, 0);
}
function drawTop() {
  fill('white'); textSize(16);
  text(coins.length + ' in the group', 12, 12);
}
`,
        expect: () => coins.length === 6 && coins.every((s) => s.color === 'orange' && s.bounciness === 0.6),
      } },
      { h: 'It is also an array' },
      'A Group is a real JavaScript array, so `for (const s of group)`, `group.forEach(...)`, `group.length`, `group.filter(...)` and `group.map(...)` all work. On top of that it has its own helpers.',
      { table: { head: ['Name', 'What it does'], rows: [
        ['`new group.Solid(x, y, z, size)`', 'Makes a Solid already in the group, with the group\'s settings.'],
        ['`group.add(solid)`', 'Puts a Solid you already have into the group.'],
        ['`group.remove(solid)`', 'Takes a Solid OUT OF THE GROUP. It stays in the world.'],
        ['`group.amount = 10`', 'Makes or removes members until there are exactly 10.'],
        ['`group.cull()`', 'Removes members that fell or flew far outside the play area. Use it in a spawner so lost bodies do not pile up.'],
        ['`group.delete()`', 'Removes every member from the world.'],
        ['`group.collides(other)` and friends', 'The [touch verbs](#/touch), true if ANY member answers yes.'],
      ] } },
      { demo: { id: 'group-rain', title: 'A spawner that cleans up after itself', from: 'rain', expect: () => rain.length > 10 && rain.length <= 300 } },
      { note: 'Groups cascade colour, collider, bounciness, friction, density, opacity, visible, drag, rotationDrag, gravityScale, isSuperFast, maxSpeed, maxSpin, allowSleeping and collisionGroup. The full list is on the [reference](#/reference) page.' },
    ],
  },

  {
    id: 'physics', group: 'Physics', title: 'Bodies and materials',
    summary: 'Colliders, gravity, bounce, friction and weight.',
    blocks: [
      'Every Solid is a **body** in a physics world. What kind of body it is decides everything about how it behaves, and you pick that with `collider`.',
      { table: { head: ['collider', 'Falls and is pushed?', 'Pushes others?', 'Use it for'], rows: [
        ['`\'dynamic\'` (default)', 'Yes', 'Yes', 'Balls, crates, a player, anything that moves by physics.'],
        ['`\'static\'`', 'No, never moves', 'Blocks others', 'Floors, walls, scenery.'],
        ['`\'kinematic\'`', 'No, only moves when you move it', 'Yes, and carries things', 'Lifts and moving platforms. See [Moving platforms](#/platforms).'],
        ['`\'none\'`', 'No, nothing touches it', 'No', 'Sensor zones. It still reports `overlaps`. See [Touching](#/touch).'],
      ] } },
      { demo: {
        id: 'colliders', title: 'The four colliders side by side',
        code: `let drop, fixed, lift, zone, ball;
function setup() {
  world.gravity.y = -10;
  new Floor(16);
  drop = new Cube(-5, 4, 0);                       // dynamic: falls
  fixed = new Cube(-2.5, 4, 0, 'static');          // static: hangs in the air
  lift = new Cube(0, 1, 0, 'kinematic');           // kinematic: only moves if you move it
  zone = new Cube(3, 1.5, 0, 2, 3, 2, 'none');     // none: a ghost zone
  zone.opacity = 0.3; zone.color = 'limegreen';
  ball = new Sphere(3, 8, 0, 0.8);                 // falls straight through the zone
  ball.color = 'tomato';
  camera.pos = [0, 4, 12];
  camera.lookAt(0, 2, 0);
}
function update() {
  lift.moveTo(0, 1 + Math.abs(Math.sin(frameCount * 0.03)) * 2, 0);
}
`,
        steps: [{ wait: 240 }],
        expect: () => Math.abs(drop.y - 0.5) < 0.1 && fixed.y === 4 && ball.y < 1,
      } },
      { h: 'Gravity' },
      '`world.gravity` is a vector, and it starts at (0, 0, 0): **nothing falls until you turn it on.** Set `world.gravity.y = -10` for a world that feels right in metres. A negative `y` pulls down. You can also set sideways gravity.',
      { h: 'Bounce' },
      '`bounciness` goes from 0 (no bounce, the default) to 1 (bounces back as high as it fell). When two bodies touch, the bouncier of the two wins.',
      { demo: {
        id: 'bounce', title: 'Three balls, three bounciness values',
        code: `const peaks = [0, 0, 0];
const balls = [];
function setup() {
  world.gravity.y = -10;
  new Floor(14);
  [0, 0.5, 0.95].forEach((b, i) => {
    const s = new Sphere(-3 + i * 3, 7, 0, 1.4);
    s.bounciness = b;
    s.color = ['#8be9fd', 'gold', 'tomato'][i];
    balls.push(s);
  });
  camera.pos = [0, 4, 13];
  camera.lookAt(0, 3, 0);
}
function update() {
  // after the first hit, remember how high each ball gets
  balls.forEach((s, i) => { if (frameCount > 70 && s.y > peaks[i]) peaks[i] = s.y; });
}
function drawTop() {
  fill('white'); textSize(14);
  text('bounciness 0, 0.5 and 0.95', 12, 12);
}
`,
        steps: [{ wait: 260 }],
        expect: () => peaks[2] > peaks[1] && peaks[1] > peaks[0],
      } },
      { h: 'Friction' },
      '`friction` is how much a Solid grips what it slides on. The default is **0.5**, not 0: with no friction, nothing in a 3D scene would ever stop sliding. Two bodies grip with the geometric mean of their two frictions, so an icy floor stays icy whatever slides on it.',
      { demo: {
        id: 'friction-ramp', title: 'Same slope, three frictions',
        code: `const boxes = [];
function setup() {
  world.gravity.y = -10;
  new Floor(24);
  const ramp = new Cube(0, 2, 0, 12, 0.4, 7, 'static');
  ramp.rotation.z = -25;            // right side lower
  ramp.color = '#6272a4';
  [0.05, 0.3, 0.9].forEach((f, i) => {
    const b = new Cube(-3, 4.1, -2 + i * 2, 1.2);
    b.friction = f;
    b.color = ['#8be9fd', 'gold', 'tomato'][i];
    boxes.push(b);
  });
  camera.pos = [-1, 6, 14];
  camera.lookAt(1, 1.5, 0);
}
`,
        steps: [{ wait: 420 }],
        expect: () => boxes[0].x > boxes[2].x + 2 && boxes[2].x < 0.5,
      } },
      { h: 'Weight' },
      'A Solid\'s `mass` comes from its size and `density` (a 1 unit cube of density 1 weighs 1 kg). Make a body heavier by making it bigger or denser, or set `mass` directly. Mass decides how hard a push has to be: see [Forces](#/forces).',
      { demo: {
        id: 'mass-density', title: 'Mass from size and density',
        code: `let small, big, dense;
function setup() {
  world.gravity.y = -10;
  new Floor(14);
  small = new Cube(-3, 1, 0, 1);
  big = new Cube(0, 1.5, 0, 2);
  dense = new Cube(3, 0.5, 0, 1);
  dense.density = 10;
  big.color = 'gold'; dense.color = 'tomato';
  camera.pos = [0, 3, 11];
  camera.lookAt(0, 1, 0);
}
function drawTop() {
  fill('white'); textSize(14);
  text('mass: small ' + small.mass + ', big ' + big.mass + ', dense ' + dense.mass, 12, 12);
}
`,
        expect: () => small.mass === 1 && Math.abs(big.mass - 8) < 0.05 && Math.abs(dense.mass - 10) < 0.05,
      } },
      { h: 'Every physics property' },
      'This table is the whole set. Press **Try it** on any row to run it on a cube. It is the same table the [reference](#/reference) uses.',
      { physics: ['physics'] },
    ],
  },

  {
    id: 'body-settings', group: 'Physics', title: 'Drag, gravity scale and limits',
    summary: 'Tune how a single body feels: slowing, weightlessness, speed limits, fast bullets, upright characters.',
    blocks: [
      'These properties belong to one Solid, so a floaty balloon and a heavy crate can live in the same world.',
      { h: 'drag' },
      '`drag` is how quickly a body loses speed to the air, per second. The default is 0.05. Raise it for things that move through water or honey. In the demo gravity is off, so drag is the only thing slowing the three spheres.',
      { demo: {
        id: 'drag', title: 'Three drags, same push',
        code: `const balls = [];
function setup() {
  new Floor(30);
  [0, 0.05, 1.5].forEach((d, i) => {
    const s = new Sphere(-8, 1, -3 + i * 3, 1.2);
    s.drag = d;
    s.vel.x = 0.1;                       // 6 units a second
    s.color = ['#8be9fd', 'gold', 'tomato'][i];
    balls.push(s);
  });
  camera.pos = [0, 8, 16];
  camera.lookAt(0, 0, 0);
}
function drawTop() {
  fill('white'); textSize(14);
  text('drag 0, 0.05 and 1.5', 12, 12);
}
`,
        steps: [{ wait: 150 }],
        expect: () => balls[0].x > balls[1].x && balls[1].x > balls[2].x,
      } },
      { h: 'gravityScale' },
      '`gravityScale` multiplies world gravity for one body: 1 is normal, 0 is weightless, 0.3 is floaty, and a negative number falls **up**.',
      { demo: {
        id: 'gravity-scale', title: 'Normal, floaty and upside down',
        code: `const balls = [];
function setup() {
  world.gravity.y = -10;
  new Floor(14);
  [1, 0.2, -0.3].forEach((g, i) => {
    const s = new Sphere(-3 + i * 3, 4, 0, 1.2);
    s.gravityScale = g;
    s.color = ['tomato', 'gold', 'skyblue'][i];
    balls.push(s);
  });
  camera.pos = [0, 4, 13];
  camera.lookAt(0, 3, 0);
}
`,
        steps: [{ wait: 90 }],
        expect: () => balls[0].y < 1 && balls[1].y < 4 && balls[1].y > balls[0].y && balls[2].y > 4,
      } },
      { h: 'lockRotation' },
      'A character that tips over is no use. `lockRotation = true` stops a body turning at all; `lockRotation = { x: true, z: true }` stops it tipping but lets it still turn about y.',
      { demo: {
        id: 'lock-rotation', title: 'Kicked at the top: free and locked',
        code: `let free, locked;
function setup() {
  world.gravity.y = -10;
  new Floor(12);
  free = new Cube(-2, 1, 0, 1, 2, 1);
  locked = new Cube(2, 1, 0, 1, 2, 1);
  locked.lockRotation = true;
  free.color = 'tomato'; locked.color = 'limegreen';
  camera.pos = [0, 3, 9];
  camera.lookAt(0, 1, 0);
}
function update() {
  if (frameCount === 10) {          // the same sideways kick, near the top of each
    free.applyImpulseAt(4, 0, 0, free.x, free.y + 0.9, free.z);
    locked.applyImpulseAt(4, 0, 0, locked.x, locked.y + 0.9, locked.z);
  }
}
`,
        steps: [{ wait: 120 }],
        expect: () => Math.abs(free.rotation.z) > 10 && Math.abs(locked.rotation.z) < 1 && Math.abs(locked.rotation.x) < 1,
      } },
      { h: 'maxSpeed and maxSpin' },
      '`maxSpeed` caps how fast a body can go (in units per frame, like `vel`) and `maxSpin` caps how fast it can turn (degrees per frame). Both are `Infinity` by default, which means no limit of their own (`null` means the same).',
      { demo: {
        id: 'max-speed', title: 'A speed limit',
        code: `let fast, capped;
function setup() {
  new Floor(30);
  fast = new Sphere(-10, 1, -2, 1);
  capped = new Sphere(-10, 1, 2, 1);
  capped.maxSpeed = 0.05;              // 3 units a second at most
  fast.color = 'tomato'; capped.color = 'gold';
  camera.pos = [0, 7, 16];
  camera.lookAt(0, 0, 0);
}
function update() {
  if (frameCount === 10) { fast.applyImpulse(8, 0, 0); capped.applyImpulse(8, 0, 0); }
}
`,
        steps: [{ wait: 70 }],
        expect: () => capped.vel.x <= 0.0501 && fast.vel.x > 0.1,
      } },
      { h: 'isSuperFast' },
      'Physics moves bodies in steps of 1/60 of a second. A very fast, very small body can cross a thin wall **between** two steps and never touch it. `isSuperFast = true` turns on continuous collision for that body so it cannot. It costs a little more each frame, so only bullets need it.',
      { demo: {
        id: 'super-fast', title: 'A bullet and a thin wall',
        code: `let slow, fast;
function setup() {
  new Floor(30);
  for (const z of [-2, 2]) new Cube(6, 1, z, 0.05, 2, 2, 'static').color = 'tomato';   // two thin walls
  slow = new Sphere(-6.7, 1, -2, 0.4);     // 3 units a frame: 5.3 then 8.3, so it steps right over a wall at 6
  fast = new Sphere(-6.7, 1, 2, 0.4);
  fast.isSuperFast = true;
  slow.vel.x = fast.vel.x = 3;           // 180 units a second
  camera.pos = [0, 7, 14];
  camera.lookAt(0, 0, 0);
}
function drawTop() {
  fill('white'); textSize(14);
  text('isSuperFast: off (back), on (front)', 12, 12);
}
`,
        steps: [{ wait: 40 }],
        expect: () => fast.x < 6.5 && slow.x > 9,
      } },
      { h: 'Sleeping' },
      'A body that has stopped moving is put to sleep by physics, which makes it free. `sleeping` tells you when. A sleeping body wakes by itself when something touches it. If you need a body to always notice changes under it, set `allowSleeping = false`.',
      { demo: {
        id: 'sleeping', title: 'Watch a box fall asleep',
        code: `let box;
function setup() {
  world.gravity.y = -10;
  new Floor();
  box = new Cube(0, 3, 0);
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 1, 0);
}
function update() {
  box.color = box.sleeping ? 'skyblue' : 'tomato';
}
function drawTop() {
  fill('white'); textSize(16);
  text(box.sleeping ? 'asleep' : 'awake', 12, 12);
}
`,
        steps: [{ wait: 240 }],
        expect: () => box.sleeping === true,
      } },
    ],
  },

  {
    id: 'forces', group: 'Physics', title: 'Forces and impulses',
    summary: 'Push, kick and twist a body the way physics expects.',
    blocks: [
      'To make a dynamic body move, you can set `vel` yourself, or you can **push it** and let physics work out the rest. Pushing keeps collisions, mass and friction honest.',
      { table: { head: ['', 'Instant (once)', 'Steady (every frame)'], rows: [
        ['Push', '`applyImpulse(x, y, z)`', '`applyForce(x, y, z)`'],
        ['Push at a point', '`applyImpulseAt(x, y, z, px, py, pz)`', '`applyForceAt(x, y, z, px, py, pz)`'],
        ['Twist', '`applyAngularImpulse(x, y, z)`', '`applyTorque(x, y, z)`'],
      ] } },
      'An **impulse** is a kick: use it once, for a jump or a hit. A **force** is a push that only has an effect if you keep applying it, so call it in `update()`.',
      { demo: {
        id: 'impulse-jump', title: 'Jump with an impulse',
        hint: 'Click the picture, then press Space.',
        code: `let player;
function setup() {
  world.gravity.y = -10;
  new Floor();
  player = new Cube(0, 0.5, 0);
  player.color = 'tomato';
  player.lockRotation = true;
  camera.pos = [0, 4, 10];
  camera.lookAt(0, 1.5, 0);
}
function update() {
  const onGround = player.y < 0.6;
  if (kb.presses('space') && onGround) player.applyImpulse(0, 6, 0);
}
function drawTop() {
  fill('white'); textSize(16);
  text('Space to jump', 12, 12);
}
`,
        steps: [{ wait: 20 }, { press: 'Space' }, { wait: 20 }],
        expect: () => player.y > 1,
      } },
      { demo: {
        id: 'force-keys', title: 'Drive with a steady force',
        hint: 'Click the picture, then hold A or D.',
        code: `let cart;
function setup() {
  world.gravity.y = -10;
  new Floor(30);
  cart = new Cube(0, 0.5, 0, 1.5, 1, 1);
  cart.color = 'gold';
  cart.lockRotation = true;
  camera.follow(cart, { distance: 10, height: 4 });
}
function update() {
  if (kb.pressing('d')) cart.applyForce(25, 0, 0);
  if (kb.pressing('a')) cart.applyForce(-25, 0, 0);
}
function drawTop() {
  fill('white'); textSize(16);
  text('speed ' + (cart.vel.x * 60).toFixed(1) + ' units a second', 12, 12);
}
`,
        steps: [{ down: 'd' }, { wait: 40 }, { up: 'd' }],
        expect: () => cart.vel.x > 0.02,
      } },
      { h: 'Heavy and light' },
      'The same force gives a **light** body a bigger speed-up than a **heavy** one. If you want every body to respond the same, use `applyForceScaled`, which multiplies by the mass for you.',
      { demo: {
        id: 'force-mass', title: 'applyForce and applyForceScaled',
        code: `// Gravity is off. Back row: applyForce. Front row: applyForceScaled.
let light, heavy, lightS, heavyS;
function setup() {
  new Floor(30);
  light = new Cube(-8, 1, -3, 1);          // mass 1
  heavy = new Cube(-8, 1.5, -1, 2);        // mass 8
  lightS = new Cube(-8, 1, 1, 1);
  heavyS = new Cube(-8, 1.5, 3, 2);
  heavy.color = heavyS.color = 'tomato';
  camera.pos = [0, 9, 16];
  camera.lookAt(0, 0, 0);
}
function update() {
  if (frameCount > 5 && frameCount <= 65) {
    light.applyForce(3, 0, 0);   heavy.applyForce(3, 0, 0);
    lightS.applyForceScaled(3, 0, 0); heavyS.applyForceScaled(3, 0, 0);
  }
}
`,
        steps: [{ wait: 70 }],
        expect: () => light.vel.x > 4 * heavy.vel.x && Math.abs(lightS.vel.x - heavyS.vel.x) < 0.003,
      } },
      { h: 'Off centre makes it spin' },
      'A push through a body\'s middle only moves it. A push at a point off to one side also **spins** it, just like kicking a ball off centre. The point is in world coordinates.',
      { demo: {
        id: 'impulse-at', title: 'Centre kick and off-centre kick',
        code: `let straight, spinning;
function setup() {
  new Floor(24);
  straight = new Cube(-4, 1, 0, 1.6);
  spinning = new Cube(4, 1, 0, 1.6);
  straight.color = 'skyblue'; spinning.color = 'gold';
  camera.pos = [0, 6, 13];
  camera.lookAt(0, 1, 0);
}
function update() {
  if (frameCount === 10) {
    straight.applyImpulse(0, 0, -3);
    spinning.applyImpulseAt(0, 0, -3, spinning.x + 0.7, spinning.y, spinning.z);   // off to one side
  }
}
`,
        steps: [{ wait: 30 }],
        expect: () => spinning.angularVelocity.mag() > 0.5 && straight.angularVelocity.mag() < 0.01,
      } },
      { demo: {
        id: 'torque', title: 'Torque (steady) and angular impulse (instant)',
        code: `// Gravity is off. The left cube is twisted a little every frame; the right one gets one hard twist.
let steady, instant;
function setup() {
  new Floor(16);
  steady = new Cube(-3, 2, 0, 1.6);
  instant = new Cube(3, 2, 0, 1.6);
  steady.color = 'orchid'; instant.color = 'gold';
  steady.rotationDrag = instant.rotationDrag = 0;     // let the spin build up and stay
  camera.pos = [0, 4, 11];
  camera.lookAt(0, 2, 0);
}
function update() {
  if (frameCount > 5 && frameCount <= 65) steady.applyTorque(0, 1, 0);
  if (frameCount === 5) instant.applyAngularImpulse(0, 1, 0);
}
function drawTop() {
  fill('white'); textSize(14);
  text('spin: left ' + steady.angularVelocity.y.toFixed(1) + ', right ' + instant.angularVelocity.y.toFixed(1) + ' degrees a frame', 12, 12);
}
`,
        steps: [{ wait: 80 }],
        expect: () => steady.angularVelocity.y > 0.3 && instant.angularVelocity.y > 0.3,
      } },
      { h: 'A blast' },
      '`world.explodeAt(x, y, z, radius, magnitude, falloff)` shoves every body inside `radius` away from a point. `falloff` (0 to 1) is how much of the push is left at the edge. Press Space to blow up the tower.',
      { demo: { id: 'explode', title: 'Knock the tower over', from: 'tower', hint: 'Click the picture, then press Space.', steps: [{ wait: 60 }, { press: 'Space' }, { wait: 200 }], expect: () => [...__spashial.solids].some((s) => s._collider === 'dynamic' && Math.abs(s.x) > 1.5) } },
      { physics: ['forces'] },
    ],
  },

  {
    id: 'touch', group: 'Physics', title: 'Touching',
    summary: 'Find out what hit what, for how long, and when it stopped.',
    blocks: [
      'Six functions answer the question "is this Solid touching that one?". There are two kinds of touching and three moments, so six names.',
      { table: { head: ['', 'The first frame', 'Every frame it lasts', 'The last frame'], rows: [
        ['**Physical** (they bump)', '`collides`', '`colliding` (counts frames)', '`collided`'],
        ['**Overlap** (they pass through)', 'n/a', '`overlaps` and `overlapping` (counts frames)', '`overlapped`'],
      ] } },
      { list: [
        'Use **collides** to react to a hit once: a sound, a point, a crack.',
        'Use **overlaps** for zones. A `collider = \'none\'` solid is a sensor: nothing bounces off it but it still tells you who is inside.',
        'Every verb takes a Solid **or a Group**, and an optional callback `(self, other) => ...` that runs for each pair that matched.',
      ] },
      { demo: {
        id: 'touch-counters', title: 'All the verbs on one falling box',
        code: `let box, floor, zone, ball;
const seen = { collides: 0, colliding: 0, collided: 0, overlapping: 0, overlapped: 0 };
function setup() {
  world.gravity.y = -10;
  floor = new Floor();
  box = new Cube(-3, 4, 0);
  box.color = 'tomato';
  zone = new Cube(3, 2, 0, 3, 1, 3, 'none');       // a sensor
  zone.color = 'limegreen'; zone.opacity = 0.3;
  ball = new Sphere(3, 7, 0, 0.6);
  camera.pos = [0, 4, 12];
  camera.lookAt(0, 1.5, 0);
}
function update() {
  if (box.collides(floor)) seen.collides++;                  // one frame
  seen.colliding = Math.max(seen.colliding, box.colliding(floor));   // counts up while resting
  if (box.collided(floor)) seen.collided++;
  seen.overlapping = Math.max(seen.overlapping, ball.overlapping(zone));
  if (ball.overlapped(zone)) seen.overlapped++;              // one frame, when the ball leaves
}
function drawTop() {
  fill('white'); textSize(14);
  text('collides ' + seen.collides + '   colliding ' + seen.colliding + '   overlapping ' + seen.overlapping + '   overlapped ' + seen.overlapped, 12, 12);
}
`,
        steps: [{ wait: 300 }],
        expect: () => seen.collides === 1 && seen.colliding > 60 && seen.collided === 0 && seen.overlapping > 3 && seen.overlapped === 1,
      } },
      { h: 'Callbacks' },
      'Pass a function as the second argument and it runs for each pair that matched. That is the tidy way to react to a Group.',
      { demo: {
        id: 'coins', title: 'Collect the coins',
        hint: 'Click the picture, then hold D.',
        code: `const coins = new Group();
coins.collider = 'none';            // sensors: you pass through them
coins.color = 'gold';
let player, score = 0;
function setup() {
  new Floor(30);
  player = new Cube(-6, 0.5, 0);
  player.color = 'tomato';
  for (let i = 0; i < 5; i++) new coins.Solid(-2 + i * 2.5, 0.8, 0, 0.7);
  camera.follow(player, { distance: 9, height: 4 });
}
function update() {
  player.vel.x = kb.pressing('d') ? 0.12 : 0;
  player.overlaps(coins, (p, coin) => { coin.remove(); score++; });
}
function drawTop() {
  fill('white'); textSize(18);
  text('coins: ' + score, 12, 12);
}
`,
        steps: [{ down: 'd' }, { wait: 160 }, { up: 'd' }],
        expect: () => score >= 3,
      } },
      { demo: { id: 'touch-zone', title: 'A zone that colours what is inside', from: 'touch-verbs', expect: () => balls.length === 12 } },
      { note: 'A Group answers "yes" if **any** member does, and a count verb answers with the longest count among its members.' },
    ],
  },

  {
    id: 'platforms', group: 'Physics', title: 'Moving platforms',
    summary: 'Kinematic bodies: you move them, and they carry whatever stands on them.',
    blocks: [
      'A `\'kinematic\'` body ignores gravity and forces, and moves only when you tell it to. But unlike a `\'static\'` body it **pushes and carries** whatever touches it. That is exactly what a lift, a conveyor or a moving platform is.',
      'Move it with `moveTo(x, y, z)`. It glides to that point during the next physics step. Call it every frame to follow a path.',
      { demo: {
        id: 'lift', title: 'A lift that carries a crate',
        code: `let lift, crate;
function setup() {
  world.gravity.y = -10;
  new Floor(20);
  lift = new Cube(0, 0.2, 0, 4, 0.4, 4, 'kinematic');
  lift.color = '#6272a4';
  lift.friction = 1;
  crate = new Cube(0, 1.4, 0, 1.5);
  crate.color = 'gold'; crate.friction = 1;
  camera.pos = [0, 5, 14];
  camera.lookAt(0, 2, 0);
}
function update() {
  lift.moveTo(0, 2 + Math.sin(frameCount * 0.03) * 1.7, 0);   // up and down
}
`,
        steps: [{ wait: 200 }],
        expect: () => Math.abs(crate.x) < 0.2 && crate.y > lift.y && crate.y < lift.y + 1.6,
      } },
      { h: 'moveTo carries, pos teleports' },
      'Setting `pos` instead of calling `moveTo` teleports the body. It arrives, but it carries nothing: whatever was standing on it is left behind. The left platform below uses `moveTo`; the right one uses `pos`.',
      { demo: {
        id: 'carry-vs-teleport', title: 'moveTo (left) and pos (right)',
        code: `let moveToPlat, posPlat, crateA, crateB;
let gapA = 0, gapB = 0;
function setup() {
  world.gravity.y = -10;
  new Floor(24);
  moveToPlat = new Cube(-5, 0.2, 0, 3, 0.4, 3, 'kinematic');
  posPlat = new Cube(5, 0.2, 0, 3, 0.4, 3, 'kinematic');
  moveToPlat.friction = posPlat.friction = 1;
  crateA = new Cube(-5, 1.1, 0, 1); crateA.friction = 1; crateA.color = 'gold';
  crateB = new Cube(5, 1.1, 0, 1); crateB.friction = 1; crateB.color = 'tomato';
  camera.pos = [0, 5, 16];
  camera.lookAt(0, 1, 0);
}
function update() {
  const off = Math.sin(frameCount * 0.02) * 3;      // gentle enough for the crate to grip
  moveToPlat.moveTo(-5 + off, 0.2, 0);
  posPlat.pos = [5 + off, 0.2, 0];
  gapA = Math.max(gapA, Math.abs(crateA.x - moveToPlat.x));
  gapB = Math.max(gapB, Math.abs(crateB.x - posPlat.x));
}
function drawTop() {
  fill('white'); textSize(14);
  text('furthest the crate got from its platform: left ' + gapA.toFixed(1) + ', right ' + gapB.toFixed(1), 12, 12);
}
`,
        steps: [{ wait: 260 }],
        expect: () => gapA < 1 && gapB > 1.5,
      } },
      { demo: { id: 'lift-and-bullets', title: 'A lift and bullets in one scene', from: 'platform-and-bullets', expect: () => lift.collider === 'kinematic' } },
      { note: '`moveTo` throws a plain error on a body that is not `\'kinematic\'`, so a typo shows up at once instead of doing nothing.' },
    ],
  },

  {
    id: 'joints', group: 'Physics', title: 'Joints',
    summary: 'Hinges, chains, ropes, springs, drawers and glue.',
    blocks: [
      'A joint ties two Solids together and lets them move relative to each other in one particular way. Make one with `new SomeJoint(a, b, options)`. At least one of the two Solids must be able to move, so tie a dynamic body to a static anchor, or two dynamic bodies together. Angles are degrees counted from the pose the two were in when the joint was made. `anchor` is a point in the world; it defaults to the first Solid\'s middle.',
      { table: { head: ['Joint', 'The two can...', 'Options'], rows: [
        ['`HingeJoint`', 'turn about a line, like a door', '`anchor`, `axis`, `lowerLimit` (-180 to 0), `upperLimit` (0 to 180), `friction`'],
        ['`BallJoint`', 'swing any way around a point, like a chain link', '`anchor`'],
        ['`DistanceJoint`', 'stay a set distance apart: a stick, a rope or a spring', '`length`, `rope: true`, `spring: { hz, damping }`'],
        ['`SliderJoint`', 'slide along a line, like a drawer', '`axis`, `lowerLimit` (0 or less), `upperLimit` (0 or more)'],
        ['`GlueJoint`', 'not move at all relative to each other', 'none'],
      ] } },
      { h: 'Hinge: a door' },
      { demo: {
        id: 'hinge', title: 'A door that swings 90 degrees either way',
        code: `let door, hinge, widest = 0;
function setup() {
  world.gravity.y = -10;
  new Floor();
  const post = new Cube(-2, 2, 0, 0.3, 4, 0.3, 'static');
  door = new Cube(-0.9, 2, 0, 2.2, 3.6, 0.2);
  door.color = 'tomato';
  hinge = new HingeJoint(post, door, { anchor: [-2, 2, 0], axis: [0, 1, 0], lowerLimit: -90, upperLimit: 90, friction: 0.1 });
  const ball = new Sphere(0, 2, 6, 1.4);
  ball.density = 3;
  ball.vel.z = -0.25;                          // rolls in and knocks the door open
  camera.pos = [3, 5, 9];
  camera.lookAt(-1, 2, 0);
}
function update() {
  widest = Math.max(widest, Math.abs(hinge.angle));
}
function drawTop() {
  fill('white'); textSize(16);
  text('angle ' + Math.round(hinge.angle) + ' degrees', 12, 12);
}
`,
        steps: [{ wait: 200 }],
        expect: () => widest > 25 && widest <= 91,
      } },
      { h: 'Ball joint: a chain' },
      { demo: {
        id: 'ball-chain', title: 'A chain of links',
        code: `const links = [];
let farthest = 0;
function setup() {
  world.gravity.y = -10;
  new Floor();
  let prev = new Cube(0, 8, 0, 1, 0.3, 1, 'static');
  for (let i = 0; i < 5; i++) {
    const s = new Sphere(0, 7 - i * 1.2, 0, 1);
    s.color = ['tomato', 'gold', 'limegreen', 'skyblue', 'orchid'][i];
    new BallJoint(prev, s, { anchor: [0, (prev.y + s.y) / 2, 0] });   // the point between the two
    links.push(s);
    prev = s;
  }
  links[4].applyImpulse(7, 0, 0);               // swing the end
  camera.pos = [0, 4, 14];
  camera.lookAt(0, 4, 0);
}
function update() {
  farthest = Math.max(farthest, Math.abs(links[4].x));
}
`,
        steps: [{ wait: 120 }],
        expect: () => links.length === 5 && farthest > 1.5 && world.joints.length === 5,
      } },
      { h: 'Distance: a stick, a rope and a spring' },
      'Three ways to use the same joint. A plain `DistanceJoint` is a **stiff stick**. With `rope: true` it can go slack but never stretch. With `spring: { hz, damping }` it bounces; `hz` about 1 to 3 is springy and `damping` (0 to 1) calms it down.',
      { demo: {
        id: 'distance-joints', title: 'Stick, rope, spring',
        code: `let stick, rope, spring, springJoint;
let lo = 99, hi = 0;      // the smallest and largest the spring joint has been
function setup() {
  world.gravity.y = -10;
  new Floor();
  const beam = new Cube(0, 9, 0, 9, 0.3, 0.5, 'static');
  const hang = (x, color) => { const s = new Sphere(x, 5.5, 0, 1.2); s.color = color; return s; };
  stick = hang(-3, 'tomato'); rope = hang(0, 'gold'); spring = hang(3, 'skyblue');
  new DistanceJoint(beam, stick, { length: 3.5 });
  new DistanceJoint(beam, rope, { length: 3.5, rope: true });
  springJoint = new DistanceJoint(beam, spring, { length: 3.5, spring: { hz: 1.5, damping: 0.1 } });
  camera.pos = [0, 6, 14];
  camera.lookAt(0, 5, 0);
}
function update() {
  lo = Math.min(lo, springJoint.distance);
  hi = Math.max(hi, springJoint.distance);
}
function drawTop() {
  fill('white'); textSize(14);
  text('spring joint is ' + springJoint.distance.toFixed(2) + ' long (resting length ' + springJoint.length + ')', 12, 12);
}
`,
        steps: [{ wait: 120 }],
        expect: () => hi - lo > 0.05 && Math.abs(stick.distanceTo(0, 9, 0) - 3.5) < 0.1 && rope.distanceTo(0, 9, 0) < 3.6,
      } },
      { h: 'Slider: a drawer' },
      { demo: {
        id: 'slider', title: 'A drawer that stops at 3 units',
        code: `let drawer, slide;
function setup() {
  world.gravity.y = -10;
  new Floor();
  const rail = new Cube(0, 1, -4, 0.2, 0.2, 0.2, 'static');
  drawer = new Cube(0, 1, 0, 2, 1, 2);
  drawer.color = '#8be9fd';
  slide = new SliderJoint(rail, drawer, { axis: [0, 0, 1], lowerLimit: 0, upperLimit: 3 });
  drawer.applyImpulse(0, 0, 8);                 // shove it open
  camera.pos = [5, 4, 9];
  camera.lookAt(0, 1, 0);
}
function drawTop() {
  fill('white'); textSize(16);
  text('slid ' + slide.position.toFixed(2) + ' units (limit 3)', 12, 12);
}
`,
        steps: [{ wait: 200 }],
        expect: () => slide.position > 2 && slide.position <= 3.05,
      } },
      { h: 'Glue: one piece' },
      { demo: {
        id: 'glue', title: 'Two cubes that move as one',
        code: `let a, b;
function setup() {
  world.gravity.y = -10;
  new Floor();
  a = new Cube(0, 0.5, 0, 1, 1, 1);
  b = new Cube(0, 1.6, 0, 3, 0.2, 1);       // a flat top on a stalk: a T
  a.color = 'tomato'; b.color = 'gold';
  new GlueJoint(a, b);
  a.applyImpulse(2, 3, 0);                  // kick the stalk: the top follows
  camera.pos = [0, 3, 9];
  camera.lookAt(0, 1, 0);
}
`,
        steps: [{ wait: 120 }],
        expect: () => Math.abs((b.x - a.x)) < 4 && b.joints.length === 1 && a.joints[0].b === b,
      } },
      { demo: { id: 'joints-all', title: 'A door, a rope and a drawer together', from: 'joints', hint: 'Click the picture, then press Space.', expect: () => world.joints.length === 3 } },
      { note: 'Removing a Solid removes its joints. `joint.remove()` takes one joint away and leaves both Solids free. `solid.joints` and `world.joints` list them.' },
    ],
  },

  {
    id: 'collision-groups', group: 'Physics', title: 'Collision groups',
    summary: 'Decide which bodies walk through each other.',
    blocks: [
      'Sometimes two kinds of body should ignore each other: bullets that do not hit the player who fired them, ghosts that pass through ghosts, a team that can walk through its own gates. Give them a **name**, then tell the world.',
      { list: [
        '`solid.collisionGroup = \'bullets\'` puts a Solid in a named group (or `null` to take it out).',
        '`world.ignoreCollisions(\'bullets\', \'player\')` makes those two groups pass through each other.',
        '`world.ignoreCollisions(\'bullets\')` with one name makes members of that group pass through **each other**.',
        '`world.restoreCollisions(...)` puts it back. You can have at most 32 group names.',
        'Ignoring only affects bodies touching each other. Everything still collides with the floor.',
      ] },
      { demo: {
        id: 'ghosts', title: 'Normal pile and ghost pile',
        hint: 'Both columns are dropped at the same spot. The ghosts all land in one place.',
        code: `const normal = new Group();
const ghosts = new Group();
ghosts.collisionGroup = 'ghost';
function setup() {
  world.gravity.y = -10;
  new Floor(16);
  world.ignoreCollisions('ghost');          // ghosts pass through ghosts
  for (let i = 0; i < 8; i++) {
    new normal.Solid(-3, 2 + i * 1.2, 0, 1).color = 'tomato';
    new ghosts.Solid(3, 2 + i * 1.2, 0, 1).color = 'skyblue';
  }
  camera.pos = [0, 5, 14];
  camera.lookAt(0, 2, 0);
}
`,
        steps: [{ wait: 300 }],
        expect: () => Math.max(...ghosts.map((s) => s.y)) < 0.8 && Math.max(...normal.map((s) => s.y)) > 2,
      } },
      { demo: {
        id: 'toggle-collisions', title: 'Switch it on and off',
        hint: 'Click the picture, then press Space to toggle.',
        code: `const group = new Group();
group.collisionGroup = 'phantoms';
let on = true;
function setup() {
  world.gravity.y = -10;
  new Floor(14);
  world.ignoreCollisions('phantoms');
  for (let i = 0; i < 6; i++) new group.Solid(0, 2 + i * 1.3, 0, 1).color = 'orchid';
  camera.pos = [0, 4, 12];
  camera.lookAt(0, 1.5, 0);
}
function update() {
  if (kb.presses('space')) {
    on = !on;
    if (on) world.ignoreCollisions('phantoms'); else world.restoreCollisions('phantoms');
  }
}
function drawTop() {
  fill('white'); textSize(16);
  text(on ? 'phantoms pass through each other' : 'phantoms collide again', 12, 12);
}
`,
        steps: [{ wait: 200 }, { press: 'Space' }, { wait: 2 }],
        expect: () => on === false,
      } },
    ],
  },

  {
    id: 'world', group: 'Physics', title: 'Tuning the world',
    summary: 'Settings for the whole simulation: stepping, sleeping, bouncing, solver quality.',
    blocks: [
      'The defaults suit most games. These settings are for when they do not.',
      { table: { head: ['Setting', 'Default', 'What it does'], rows: [
        ['`world.solverSteps`', '10', 'How hard physics works to keep stacks and joints steady. More is steadier and slower.'],
        ['`world.sleepDelay`', '0.5', 'Seconds a body must rest before it is put to sleep.'],
        ['`world.sleepSpeed`', '0.0005', 'A body slower than this (units per frame) counts as resting.'],
        ['`world.minBounceSpeed`', 'about 0.017', 'A hit slower than this (units per frame) does not bounce. 0 lets every hit bounce.'],
        ['`world.allowSleeping`', '`true`', '`false` keeps every body awake.'],
        ['`world.autoStep`', '`true`', '`false` hands the physics step to you.'],
      ] } },
      { demo: {
        id: 'min-bounce', title: 'minBounceSpeed: bounces that die out',
        code: `// With the default, a ball stops bouncing once its hits get tiny.
// Set world.minBounceSpeed = 0 and it bounces on for much longer.
let ball;
function setup() {
  world.gravity.y = -10;
  new Floor(10);
  ball = new Sphere(0, 4, 0, 1);
  ball.bounciness = 0.7;
  ball.color = 'gold';
  // world.minBounceSpeed = 0;
  camera.pos = [0, 3, 9];
  camera.lookAt(0, 1.5, 0);
}
`,
        steps: [{ wait: 900 }],
        expect: () => ball.y < 0.6 && world.minBounceSpeed > 0.01,
      } },
      { h: 'Stepping by hand' },
      'Normally physics steps by itself, 60 times a second. Set `world.autoStep = false` and it only steps when you call `world.physicsUpdate()`. That is how you make a pause button, a slow motion mode or a turn-based game.',
      { demo: {
        id: 'manual-step', title: 'Step the world one frame at a time',
        hint: 'Click the picture, then press N to step, or hold P to run.',
        code: `let box, steps = 0;
function setup() {
  world.gravity.y = -10;
  world.autoStep = false;         // we decide when time passes
  new Floor();
  box = new Cube(0, 6, 0);
  box.color = 'tomato';
  camera.pos = [0, 3, 10];
  camera.lookAt(0, 3, 0);
}
function update() {
  if (kb.presses('n') || kb.pressing('p')) { world.physicsUpdate(); steps++; }
}
function drawTop() {
  fill('white'); textSize(16);
  text('steps taken: ' + steps + '   (N steps once, hold P to run)', 12, 12);
}
`,
        steps: [{ wait: 20 }, { press: 'n' }, { wait: 2 }, { press: 'n' }, { wait: 2 }, { press: 'n' }, { wait: 2 }],
        expect: () => steps === 3 && box.y < 6 && box.y > 5.9,
      } },
      { demo: { id: 'sleep-count', title: 'A pile going to sleep', from: 'tower', expect: () => world.sleepDelay === 0.5 } },
    ],
  },
];

// Tests for physics.js, the Jolt layer. Runs in Node: no browser, no GPU.
//   node tests/physics.test.mjs
import init from 'jolt-physics';
import { createPhysics, FIXED_DT, PRIMITIVES, SHAPES, volumeOf } from '../physics.js';

const J = await init();
let pass = 0, fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`); }
};
const near = (a, b, tol, name) => ok(Math.abs(a - b) <= tol, name, `got ${a}, want ${b} +/- ${tol}`);
const run = (w, n) => { for (let i = 0; i < n; i++) w.step(); };
const fresh = (gravity = [0, -10, 0]) => {
  const w = createPhysics(J, { gravity });
  const floor = w.createBody({ shape: 'box', w: 40, h: 1, d: 40, collider: 'static', pos: [0, -0.5, 0], friction: 0.6 });
  return { w, floor };
};

// 1. a box falls and comes to rest on the floor
{
  const { w } = fresh();
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 3, 0], friction: 0.6 });
  run(w, 180);
  near(w.getPose(b).pos[1], 0.5, 0.06, 'box rests on the floor at y = 0.5');
  near(Math.hypot(...w.getVelocity(b)), 0, 0.05, 'box is at rest');
  w.dispose();
}

// 2. every shape falls to the floor and rests at its own half-height
{
  const want = { box: 0.5, sphere: 0.5, cylinder: 0.5, capsule: 0.5, cone: 0.5, torus: 0.2 };
  for (const shape of PRIMITIVES) {
    const { w } = fresh();
    const dims = shape === 'torus' ? { w: 1.2, h: 0.4, d: 1 } : { w: 1, h: 1, d: 1 };
    const b = w.createBody({ shape, ...dims, collider: 'dynamic', pos: [0, 2, 0], friction: 0.6 });
    run(w, 240);
    near(w.getPose(b).pos[1], want[shape], 0.07, `${shape} rests at y = ${want[shape]}`);
    w.dispose();
  }
}

// 3. the touch table: began once, frames count up, ended once after leaving
{
  const { w, floor } = fresh();
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 1.5, 0] });
  let began = 0, maxFrames = 0, sawPhysical = false;
  for (let i = 0; i < 120; i++) {
    w.step();
    const t = w.touching(b, floor);
    if (t) { if (t.began) began++; maxFrames = Math.max(maxFrames, t.frames); sawPhysical ||= t.physical; }
  }
  ok(began === 1, 'collision begins exactly once', `began ${began} times`);
  ok(maxFrames > 60, 'frames keep counting while touching', `max ${maxFrames}`);
  ok(sawPhysical, 'a solid contact is physical');
  w.setPose(b, [0, 5, 0], [0, 0, 0, 1]);
  w.setVelocity(b, [0, 0, 0]);
  w.step();
  const e = w.touching(b, floor);
  ok(e && e.ended && e.frames === 0, 'the step after leaving reports ended');
  w.step();
  ok(w.touching(b, floor) === null, 'and the step after that reports nothing');
  w.dispose();
}

// 4. a sensor ('none') reports an overlap but does not stop anything
{
  const { w } = fresh();
  const zone = w.createBody({ shape: 'box', w: 4, h: 1, d: 4, collider: 'none', pos: [0, 2, 0] });
  const ball = w.createBody({ shape: 'sphere', w: 0.5, collider: 'dynamic', pos: [0, 4, 0], friction: 0.6 });
  let overlapFrames = 0, everPhysical = false;
  for (let i = 0; i < 180; i++) {
    w.step();
    const t = w.touching(ball, zone);
    if (t && !t.ended) { overlapFrames++; everPhysical ||= t.physical; }
  }
  ok(overlapFrames > 5, 'the ball overlaps the zone while falling through it', `${overlapFrames} frames`);
  ok(!everPhysical, 'a sensor contact is never physical');
  near(w.getPose(ball).pos[1], 0.25, 0.06, 'the ball fell straight through to the floor');
  w.dispose();
}

// 5. ray casts: closest solid hit, correct normal, sensors are looked through
{
  const { w } = fresh();
  w.createBody({ shape: 'box', w: 4, h: 1, d: 4, collider: 'none', pos: [0, 5, 0] }); // sensor in the way
  const crate = w.createBody({ shape: 'box', w: 2, h: 2, d: 2, collider: 'static', pos: [0, 2, 0] });
  const hit = w.rayCast([0, 10, 0], [0, -10, 0]);
  ok(hit && hit.rec === crate, 'the ray hits the crate, not the sensor above it');
  near(hit?.point[1] ?? NaN, 3, 0.001, 'hit point is the crate top');
  near(hit?.normal[1] ?? NaN, 1, 0.001, 'normal points up');
  near(hit?.fraction ?? NaN, 0.35, 0.001, 'fraction is 0.35 along the line');
  ok(w.rayCast([20, 10, 0], [20, -10, 0])?.rec.def.collider === 'static', 'a ray beside the crate hits the floor');
  ok(w.rayCast([0, 10, 100], [0, -10, 100]) === null, 'a ray past everything hits nothing');
  const all = w.rayCastAll([0, 10, 0], [0, -10, 0]);
  ok(all.length === 2 && all[0].rec === crate && all[1].rec.def.shape === 'box', 'rayCastAll lists crate then floor, nearest first', `${all.length} hits`);
  w.dispose();
}

// 6. mass and impulses: v = impulse / mass
{
  const { w } = fresh([0, 0, 0]);
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 5, 0], density: 2 });
  near(w.massOf(b), 2, 0.001, 'a 1 m cube at density 2 weighs 2 kg');
  near(volumeOf('sphere', 2, 2, 2), (4 / 3) * Math.PI, 1e-9, 'sphere volume');
  w.addImpulse(b, [0, 4, 0]);
  w.step();
  near(w.getVelocity(b)[1], 2, 0.01, 'impulse 4 on 2 kg gives 2 m/s');
  const heavy = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [5, 5, 0], mass: 10 });
  near(w.massOf(heavy), 10, 0.001, 'an explicit mass wins over density');
  w.dispose();
}

// 7. lockRotation keeps a body upright; without it the same push spins it
{
  const { w } = fresh([0, 0, 0]);
  const locked = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 5, 0], lockRotation: true });
  const free = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [5, 5, 0] });
  for (const b of [locked, free]) w.addTorque(b, [0, 0, 50]);
  run(w, 30);
  near(Math.hypot(...w.getAngularVelocity(locked)), 0, 1e-3, 'a locked body does not spin');
  ok(Math.hypot(...w.getAngularVelocity(free)) > 0.5, 'a free body does spin');
  w.dispose();
}

// 8. rebuild keeps pose and speed while changing size
{
  const { w } = fresh([0, 0, 0]);
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [1, 2, 3] });
  w.setVelocity(b, [1, 0, 0]);
  w.rebuild(b, { w: 2, h: 2, d: 2 });
  const p = w.getPose(b).pos, v = w.getVelocity(b);
  near(p[0], 1, 1e-6, 'x kept'); near(p[1], 2, 1e-6, 'y kept'); near(p[2], 3, 1e-6, 'z kept'); near(v[0], 1, 1e-6, 'speed kept');
  near(w.massOf(b), 8, 0.001, 'a doubled cube is eight times the mass');
  w.dispose();
}

// 9. kinematic bodies move by their velocity and push dynamic ones; removed bodies vanish
{
  const { w } = fresh([0, 0, 0]);
  const mover = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'kinematic', pos: [0, 1, 0] });
  const crate = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [2, 1, 0] });
  w.setVelocity(mover, [2, 0, 0]);
  run(w, 90);
  near(w.getPose(mover).pos[0], 3, 0.05, 'a kinematic body moves at its velocity (2 m/s for 1.5 s)');
  ok(w.getPose(crate).pos[0] > 3.5, 'and pushes a dynamic body ahead of it');
  w.removeBody(crate);
  ok(!w.isAlive(crate) && w.bodyCount === 2, 'a removed body is gone');
  ok(w.rayCast([w.getPose(mover).pos[0], 10, 0], [w.getPose(mover).pos[0], -10, 0])?.rec === mover, 'rays no longer see a removed body');
  w.dispose();
}

// 10. explodeAt pushes away, harder near the centre, same speed whatever the mass
{
  const { w } = fresh([0, 0, 0]);
  const near1 = w.createBody({ shape: 'sphere', w: 1, collider: 'dynamic', pos: [1, 0, 0] });
  const heavy = w.createBody({ shape: 'sphere', w: 1, collider: 'dynamic', pos: [-1, 0, 0], mass: 50 });
  const far = w.createBody({ shape: 'sphere', w: 1, collider: 'dynamic', pos: [0, 0, 4.5] });
  const outside = w.createBody({ shape: 'sphere', w: 1, collider: 'dynamic', pos: [0, 0, 20] });
  w.explodeAt([0, 0, 0], 5, 10, 0.2);
  w.step();
  ok(w.getVelocity(near1)[0] > 7, 'a body 1 m away is pushed outward', `vx ${w.getVelocity(near1)[0]}`);
  near(Math.abs(w.getVelocity(heavy)[0]), Math.abs(w.getVelocity(near1)[0]), 0.1, 'a 50 kg body leaves as fast as a light one');
  ok(w.getVelocity(far)[2] > 0 && w.getVelocity(far)[2] < w.getVelocity(near1)[0], 'a far body is pushed less');
  near(Math.hypot(...w.getVelocity(outside)), 0, 1e-6, 'a body outside the radius is untouched');
  w.dispose();
}

// 11. gravity can be read and changed
{
  const { w } = fresh([0, 0, 0]);
  const b = w.createBody({ shape: 'sphere', w: 1, collider: 'dynamic', pos: [0, 10, 0] });
  run(w, 30);
  near(w.getPose(b).pos[1], 10, 1e-6, 'nothing falls at gravity 0');
  w.gravity = [0, -10, 0];
  ok(w.gravity[1] === -10, 'gravity reads back');
  run(w, 30);
  ok(w.getPose(b).pos[1] < 9.9, 'and then it falls');
  w.dispose();
}

// 11b. material changes are live, and sleeping can be switched off
{
  const { w } = fresh();
  const b = w.createBody({ shape: 'sphere', w: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6, bounciness: 0 });
  run(w, 150);
  ok(!w.isAwake(b), 'a body at rest goes to sleep');
  w.allowSleeping = false;
  ok(w.allowSleeping === false && w.isAwake(b), 'allowSleeping = false wakes it');
  run(w, 150);
  ok(w.isAwake(b), 'and it stays awake');
  w.setBounciness(b, 0.9); w.setFriction(b, 0.2);
  ok(b.def.bounciness === 0.9 && b.def.friction === 0.2, 'friction and bounciness change without a rebuild');
  const key = b.key;
  w.setBounciness(b, 0.5);
  ok(b.key === key, 'the body is the same body');
  w.allowSleeping = true;
  w.setPose(b, [0, 6, 0], [0, 0, 0, 1]);
  run(w, 60);
  ok(w.getVelocity(b)[1] < -1, 'a dropped bouncy ball is falling');
  w.dispose();
}

// 12. bad input fails loudly, in plain words
{
  const w = createPhysics(J);
  let msg = '';
  try { w.createBody({ shape: 'pyramid', collider: 'dynamic' }); } catch (e) { msg = e.message; }
  ok(/unknown shape 'pyramid'/.test(msg), 'an unknown shape throws a clear error', msg);
  try { w.createBody({ shape: 'box', collider: 'bouncy' }); } catch (e) { msg = e.message; }
  ok(/unknown collider 'bouncy'/.test(msg), 'an unknown collider throws a clear error', msg);
  w.dispose();
}

// ============================ the rest of the body properties ============================
const ball = (w, o = {}) => w.createBody({ shape: 'sphere', w: 0.5, h: 0.5, d: 0.5, collider: 'dynamic', pos: [0, 5, 0], ...o });
const speed = (w, b) => Math.hypot(...w.getVelocity(b));
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

// 13. drag and rotationDrag slow a body down; 0 keeps it going
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const free = ball(w, { drag: 0, vel: [6, 0, 0] }), slow = ball(w, { drag: 2, vel: [6, 0, 0], pos: [0, 9, 0] });
  const spinFree = ball(w, { rotationDrag: 0, angVel: [0, 5, 0], pos: [0, 13, 0] }), spinSlow = ball(w, { rotationDrag: 3, angVel: [0, 5, 0], pos: [0, 17, 0] });
  run(w, 60);
  near(speed(w, free), 6, 0.01, 'drag 0: nothing slows it down');
  ok(speed(w, slow) < 1.2, 'drag 2: it loses most of its speed in a second', `speed ${speed(w, slow)}`);
  near(w.getAngularVelocity(spinFree)[1], 5, 0.01, 'rotationDrag 0: the spin stays');
  ok(w.getAngularVelocity(spinSlow)[1] < 1, 'rotationDrag 3: the spin dies away');
  w.setDrag(free, 3);
  run(w, 60);
  ok(speed(w, free) < 0.5, 'drag can be changed live');
  ok(w.createBody({ shape: 'box', collider: 'static' }).def.drag === 0.05, 'the default drag is Jolt\'s own 0.05');
  ok(throws(() => w.setDrag(w.createBody({ shape: 'box', collider: 'static' }), 1)) === '', 'drag on a static body is ignored, not an error');
  w.dispose();
}

// 14. gravityScale: 0 hangs, 2 falls twice as fast, -1 rises
{
  const { w } = fresh();
  const none = ball(w, { gravityScale: 0, pos: [-3, 5, 0] }), norm = ball(w, { pos: [0, 5, 0] }), dbl = ball(w, { gravityScale: 2, pos: [3, 5, 0] }), up = ball(w, { gravityScale: -1, pos: [6, 5, 0] });
  run(w, 30);
  near(w.getPose(none).pos[1], 5, 0.01, 'gravityScale 0: weightless');
  const fall = (b) => 5 - w.getPose(b).pos[1];
  near(fall(dbl) / fall(norm), 2, 0.1, 'gravityScale 2 falls twice as far');
  ok(w.getPose(up).pos[1] > 5.5, 'gravityScale -1 falls upward');
  w.setGravityScale(none, 1);
  run(w, 30);
  ok(w.getPose(none).pos[1] < 4.9, 'gravityScale can be changed live (and wakes a sleeper)');
  w.dispose();
}

// 15. speed limits
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const b = ball(w, { maxSpeed: 10 }), spin = ball(w, { maxSpin: 3, pos: [0, 9, 0] }), free = ball(w, { pos: [0, 13, 0] });
  w.setVelocity(b, [100, 0, 0]); w.setAngularVelocity(spin, [0, 40, 0]); w.setVelocity(free, [100, 0, 0]);
  run(w, 2);
  ok(speed(w, b) <= 10.01, 'maxSpeed caps the speed', `speed ${speed(w, b)}`);
  ok(Math.abs(w.getAngularVelocity(spin)[1]) <= 3.01, 'maxSpin caps the spin');
  near(speed(w, free), 100, 0.5, 'with no cap a body keeps its speed');
  w.setMaxSpeed(b, null); w.setVelocity(b, [100, 0, 0]); run(w, 2);
  ok(speed(w, b) > 90, 'maxSpeed null lifts the cap');
  w.dispose();
}

// 16. superFast: a thin wall stops a bullet that would otherwise jump through it
{
  const shoot = (superFast) => {
    const w = createPhysics(J, { gravity: [0, 0, 0] });
    w.createBody({ shape: 'box', w: 0.05, h: 4, d: 4, collider: 'static', pos: [10, 0, 0] });
    const b = w.createBody({ shape: 'sphere', w: 0.1, h: 0.1, d: 0.1, collider: 'dynamic', pos: [0, 0, 0], vel: [120, 0, 0], drag: 0, superFast });
    run(w, 30);
    const x = w.getPose(b).pos[0]; w.dispose(); return x;
  };
  ok(shoot(false) > 11, 'without superFast a fast ball tunnels through a thin wall', `x ${shoot(false)}`);
  ok(shoot(true) < 10.2, 'with superFast the wall stops it', `x ${shoot(true)}`);
  { const w = createPhysics(J); ok(w.createBody({ shape: 'box', collider: 'dynamic', superFast: true }).def.superFast === true, 'superFast can be set at creation'); w.dispose(); }
}

// 17. allowSleeping per body
{
  const { w } = fresh();
  const a = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.6, 0], friction: 0.6 });
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [4, 0.6, 0], friction: 0.6, allowSleeping: false });
  run(w, 240);
  ok(w.isAsleep(a), 'a resting body goes to sleep');
  ok(!w.isAsleep(b), 'allowSleeping: false keeps it awake');
  w.setAllowSleeping(b, true); run(w, 240);
  ok(w.isAsleep(b), 'allowSleeping can be turned back on');
  ok(!w.isAsleep(w.floor ?? { def: { collider: 'static' }, body: { IsActive: () => false } }), 'a static body is never reported asleep');
  w.dispose();
}

// 18. forces and impulses at a point spin a body; at the centre they do not
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const mk = (x) => w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [x, 0, 0] });
  const centre = mk(0), off = mk(5), force = mk(10), torque = mk(15);
  w.addImpulseAt(centre, [0, 5, 0], [0, 0, 0]);
  w.addImpulseAt(off, [0, 5, 0], [5.4, 0, 0]);
  w.addForceAt(force, [0, 50, 0], [10.4, 0, 0]); run(w, 10);
  w.addAngularImpulse(torque, [0, 0, 2]); run(w, 1);
  near(Math.hypot(...w.getAngularVelocity(centre)), 0, 1e-3, 'an impulse through the centre does not spin it');
  ok(Math.abs(w.getAngularVelocity(off)[2]) > 0.5, 'an impulse off-centre spins it');
  ok(Math.abs(w.getAngularVelocity(force)[2]) > 0.2, 'a force off-centre spins it');
  ok(Math.abs(w.getAngularVelocity(torque)[2]) > 0.5, 'an angular impulse spins it');
  near(w.centerOfMass(centre)[1], w.getPose(centre).pos[1], 0.01, 'centerOfMass reads back (a box\'s is its middle)');
  w.dispose();
}

// 19. kinematic moveTo: glides there, carries what stands on it, and stops
{
  const { w } = fresh();
  const plat = w.createBody({ shape: 'box', w: 4, h: 0.2, d: 4, collider: 'kinematic', pos: [0, 1, 0], friction: 1 });
  const rider = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 1.7, 0], friction: 1 });
  run(w, 30);
  for (let i = 0; i < 60; i++) { const p = w.getPose(plat).pos; w.moveKinematic(plat, [Math.min(p[0] + 0.05, 3), 1, 0]); w.step(); }
  near(w.getPose(plat).pos[0], 3, 0.02, 'moveTo glides a kinematic body to its target');
  ok(w.getPose(rider).pos[0] > 2.3, 'and carries what stands on it', `rider x ${w.getPose(rider).pos[0]}`);
  const at = w.getPose(plat).pos[0]; run(w, 30);
  near(w.getPose(plat).pos[0], at, 0.001, 'it stops there when told no more');
  ok(/moveTo is for 'kinematic'/.test(throws(() => w.moveKinematic(rider, [0, 0, 0]))), 'moveTo on a dynamic body explains itself');
  w.dispose();
}

// 20. collision groups
{
  const dropOnto = (gFloor, gBall, setup) => {
    const w = createPhysics(J, { gravity: [0, -10, 0] });
    setup?.(w);
    w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0], group: gFloor });
    const b = ball(w, { pos: [0, 2, 0], group: gBall });
    run(w, 90); const y = w.getPose(b).pos[1]; w.dispose(); return y;
  };
  ok(dropOnto(null, null) > 0, 'no groups: it lands');
  ok(dropOnto('a', 'a') > 0, 'two bodies of the same group still collide');
  ok(dropOnto('a', 'b') > 0, 'different groups collide by default');
  ok(dropOnto('a', 'b', (w) => w.ignoreCollisions('a', 'b')) < -1, 'ignoreCollisions(a, b): they pass through each other');
  ok(dropOnto('a', 'a', (w) => w.ignoreCollisions('a')) < -1, 'ignoreCollisions(a): members pass through each other');
  ok(dropOnto('a', 'b', (w) => { w.ignoreCollisions('a', 'b'); w.restoreCollisions('a', 'b'); }) > 0, 'restoreCollisions puts it back');
  ok(dropOnto(null, 'b', (w) => w.ignoreCollisions('b')) > 0, 'a body in no group is unaffected');
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0], group: 'x' });
  const b = ball(w, { pos: [0, 2, 0], group: 'x' });
  w.ignoreCollisions('x', 'y'); w.setGroup(b, 'y'); run(w, 90);
  ok(w.getPose(b).pos[1] < 0, 'a body can change group live');
  w.setGroup(b, null); w.setPose(b, [0, 2, 0], [0, 0, 0, 1]); w.setVelocity(b, [0, 0, 0]); run(w, 90);
  ok(w.getPose(b).pos[1] > 0, 'and leave its group (null)');
  let msg = ''; try { for (let i = 0; i < 40; i++) w.ignoreCollisions('g' + i); } catch (e) { msg = e.message; }
  ok(/at most 32 collision groups/.test(msg), 'more than 32 groups says so', msg);
  w.dispose();
}

// 21. convex hulls
{
  const pyramid = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, 1, 0]];
  const { w } = fresh();
  const h = w.createBody({ shape: 'hull', points: pyramid, collider: 'dynamic', pos: [0, 3, 0], friction: 0.6 });
  near(h.def.h, 1, 1e-6, 'a hull takes its size from its points');
  run(w, 300);
  near(w.getPose(h).pos[1], 0, 0.08, 'a pyramid hull comes to rest on its base');
  ok(w.massOf(h) > 0.1 && w.massOf(h) < 0.6, 'a hull has a mass from its volume', `mass ${w.massOf(h)}`);
  const cube = [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z])));
  const c = w.createBody({ shape: 'hull', points: cube, collider: 'dynamic', pos: [5, 3, 0], density: 2 });
  near(w.massOf(c), 2, 0.2, 'a cube-shaped hull at density 2 weighs about 2');
  ok(/at least 4 points/.test(throws(() => w.createBody({ shape: 'hull', points: pyramid.slice(0, 3), collider: 'dynamic' }))), 'a hull with 3 points says so');
  ok(/flat plane/.test(throws(() => w.createBody({ shape: 'hull', points: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], collider: 'dynamic' }))), 'a flat hull says so');
  ok(/flat plane/.test(throws(() => w.createBody({ shape: 'hull', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], collider: 'dynamic' }))), 'and so does a hull that is a line');
  w.dispose();
}

// 22. triangle meshes
{
  const v = [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]], t = [[0, 2, 1], [0, 3, 2]];
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const floor = w.createBody({ shape: 'triangles', vertices: v, triangles: t, collider: 'static' });
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 3, 0], friction: 0.6 });
  run(w, 180);
  near(w.getPose(b).pos[1], 0.5, 0.08, 'a box rests on a triangle-mesh floor');
  ok(w.rayCast([0, 5, 5], [0, -5, 5])?.rec === floor, 'a ray hits the mesh');
  ok(/cannot be 'dynamic'/.test(throws(() => w.createBody({ shape: 'triangles', vertices: v, triangles: t, collider: 'dynamic' }))), 'a dynamic mesh is refused in plain words');
  ok(/position of a vertex/.test(throws(() => w.createBody({ shape: 'triangles', vertices: v, triangles: [[0, 1, 9]], collider: 'static' }))), 'a triangle pointing at a missing vertex says so');
  ok(/cannot be 'dynamic'/.test(throws(() => w.rebuild(floor, { collider: 'dynamic' }))), 'changing a mesh to dynamic is refused before anything is torn down');
  ok(w.isAlive(floor) && w.rayCast([0, 5, 5], [0, -5, 5])?.rec === floor, 'and the mesh is still there afterwards');
  w.dispose();
}

// 22b. winding does not matter: a triangle mesh is solid from both sides, as it is drawn
{
  const v = [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]];
  for (const [name, t] of [['counter-clockwise', [[0, 2, 1], [0, 3, 2]]], ['clockwise', [[0, 1, 2], [0, 2, 3]]]]) {
    const w = createPhysics(J, { gravity: [0, -10, 0] });
    const floor = w.createBody({ shape: 'triangles', vertices: v, triangles: t, collider: 'static' });
    const b = w.createBody({ shape: 'sphere', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [3, 3, 2], friction: 0.5 });
    run(w, 150);
    near(w.getPose(b).pos[1], 0.5, 0.06, `a ball rests on a mesh wound ${name}`);
    w.removeBody(b);
    const down = w.rayCast([3, 8, 1], [3, -2, 1]), up = w.rayCast([3, -2, 1], [3, 8, 1]);
    ok(down?.rec === floor && Math.abs(down.point[1]) < 1e-6, `a ray from above hits a mesh wound ${name}`);
    ok(up?.rec === floor && Math.abs(up.point[1]) < 1e-6, `a ray from below hits it too`);
    ok(w.rayCastAll([3, 8, 1], [3, -2, 1]).length === 1, `and rayCastAll reports it once, not once per side`);
    w.dispose();
  }
}

// 23. joints
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const pivotAt = (w, p) => w.createBody({ shape: 'box', w: 0.2, h: 0.2, d: 0.2, collider: 'static', pos: p });
{
  // ball joint: a pendulum keeps its length and swings down
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const pin = pivotAt(w, [0, 5, 0]), arm = ball(w, { pos: [2, 5, 0], drag: 0 });
  const j = w.createJoint({ kind: 'ball', a: pin, b: arm, anchor: [0, 5, 0] });
  let worst = 0, low = 5;
  for (let i = 0; i < 120; i++) { w.step(); const p = w.getPose(arm).pos; worst = Math.max(worst, Math.abs(dist(p, [0, 5, 0]) - 2)); low = Math.min(low, p[1]); }
  ok(worst < 0.05, 'ball joint: the arm keeps its length', `off by ${worst}`);
  ok(low < 3.5, 'ball joint: and swings down');
  w.removeJoint(j);
  ok(w.jointCount === 0, 'removing a joint is counted');
  run(w, 120);
  ok(w.getPose(arm).pos[1] < -3, 'with the joint gone it falls free', `y ${w.getPose(arm).pos[1]}`);
  w.dispose();
}
{
  // hinge: stays in its plane; limits hold; friction slows it
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const pin = pivotAt(w, [0, 5, 0]), arm = ball(w, { pos: [2, 5, 0], drag: 0, rotationDrag: 0 });
  const j = w.createJoint({ kind: 'hinge', a: pin, b: arm, anchor: [0, 5, 0], axis: [0, 0, 1] });
  let z = 0, worst = 0;
  for (let i = 0; i < 120; i++) { w.step(); const p = w.getPose(arm).pos; z = Math.max(z, Math.abs(p[2])); worst = Math.max(worst, Math.abs(dist(p, [0, 5, 0]) - 2)); }
  ok(z < 0.02 && worst < 0.05, 'hinge: swings in one plane at a fixed radius', `z ${z} r ${worst}`);
  ok(Math.abs(w.jointValue(j)) > 0.5, 'hinge: jointValue reads the angle');
  w.dispose();

  const w2 = createPhysics(J, { gravity: [0, -10, 0] });
  const pin2 = pivotAt(w2, [0, 5, 0]), arm2 = ball(w2, { pos: [2, 5, 0], drag: 0, rotationDrag: 0 });
  const j2 = w2.createJoint({ kind: 'hinge', a: pin2, b: arm2, anchor: [0, 5, 0], axis: [0, 0, 1], lower: -0.3, upper: 0.3 });
  run(w2, 180);
  near(w2.jointValue(j2), -0.3, 0.06, 'hinge: stops at its lower limit');
  ok(w2.getPose(arm2).pos[1] > 4.35, 'hinge: so the arm does not drop past it');
  w2.setJointLimits(j2, -1, 1); run(w2, 120);
  ok(w2.jointValue(j2) < -0.8, 'hinge: limits can be changed live');
  ok(/lowerLimit/.test(throws(() => w2.createJoint({ kind: 'hinge', a: pin2, b: arm2, lower: 0.5 }))), 'a hinge limit on the wrong side of zero explains itself');
  w2.dispose();

  const w3 = createPhysics(J, { gravity: [0, -10, 0] });
  const pin3 = pivotAt(w3, [0, 5, 0]), arm3 = ball(w3, { pos: [2, 5, 0], drag: 0, rotationDrag: 0 });
  const free = createPhysics(J, { gravity: [0, -10, 0] });
  const pinF = pivotAt(free, [0, 5, 0]), armF = ball(free, { pos: [2, 5, 0], drag: 0, rotationDrag: 0 });
  w3.createJoint({ kind: 'hinge', a: pin3, b: arm3, anchor: [0, 5, 0], axis: [0, 0, 1], friction: 8 });
  free.createJoint({ kind: 'hinge', a: pinF, b: armF, anchor: [0, 5, 0], axis: [0, 0, 1] });
  run(w3, 40); run(free, 40);
  ok(w3.getPose(arm3).pos[1] > free.getPose(armF).pos[1] + 0.2, 'hinge friction slows the swing');
  w3.dispose(); free.dispose();
}
{
  // distance: a rod keeps its length, a rope only stops it stretching, a spring bounces
  const rod = createPhysics(J, { gravity: [0, -10, 0] });
  const pin = pivotAt(rod, [0, 5, 0]), b = ball(rod, { pos: [3, 5, 0], drag: 0 });
  rod.createJoint({ kind: 'distance', a: pin, b, length: 3 });
  let worst = 0; for (let i = 0; i < 120; i++) { rod.step(); worst = Math.max(worst, Math.abs(dist(rod.getPose(b).pos, [0, 5, 0]) - 3)); }
  ok(worst < 0.05, 'distance joint: a rod keeps its length', `off by ${worst}`);
  rod.dispose();

  const rope = createPhysics(J, { gravity: [0, -10, 0] });
  const pinR = pivotAt(rope, [0, 5, 0]), slack = ball(rope, { pos: [1, 5, 0], drag: 0 }), taut = ball(rope, { pos: [0, 2, 0], drag: 0 });
  const jr = rope.createJoint({ kind: 'distance', a: pinR, b: slack, length: 3, rope: true });
  rope.createJoint({ kind: 'distance', a: pinR, b: taut, length: 3, rope: true });
  run(rope, 12);
  ok(rope.getPose(slack).pos[1] < 4.95 && dist(rope.getPose(slack).pos, [0, 5, 0]) < 2.5, 'distance joint: a rope lets it come closer');
  let far = 0; run(rope, 1); for (let i = 0; i < 240; i++) { rope.step(); far = Math.max(far, dist(rope.getPose(taut).pos, [0, 5, 0]) - 3); }
  ok(far < 0.06, 'distance joint: but never stretch past its length', `over by ${far}`);
  rope.setJointLength(jr, 5); ok(rope.jointValue(jr) > 0, 'the length can be changed live');
  rope.dispose();

  const mk = (spring) => {
    const w = createPhysics(J, { gravity: [0, -10, 0] });
    const p = pivotAt(w, [0, 8, 0]), m = ball(w, { pos: [0, 6.5, 0], drag: 0 });
    w.createJoint({ kind: 'distance', a: p, b: m, length: 1.5, spring });
    let lo = 99, hi = -99; for (let i = 0; i < 180; i++) { w.step(); const y = w.getPose(m).pos[1]; if (i > 20) { lo = Math.min(lo, y); hi = Math.max(hi, y); } }
    w.dispose(); return hi - lo;
  };
  ok(mk(null) < 0.05, 'distance joint: a rigid rod does not bounce');
  ok(mk({ hz: 1, damping: 0.05 }) > 0.3, 'distance joint: a spring bounces');
}
{
  // slider: moves along its axis only, within its limits
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const base = pivotAt(w, [0, 3, 0]), car = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 3, 0] });
  const j = w.createJoint({ kind: 'slider', a: base, b: car, axis: [1, 0, 0], lower: -1, upper: 1.5 });
  w.addImpulse(car, [20, 0, 0]); run(w, 120);
  ok(Math.abs(w.getPose(car).pos[1] - 3) < 0.05 && Math.abs(w.getPose(car).pos[2]) < 0.05, 'slider: gravity does not pull it off its line');
  near(w.getPose(car).pos[0], 1.5, 0.06, 'slider: stops at its upper limit');
  near(w.jointValue(j), 1.5, 0.06, 'slider: jointValue reads the position');
  w.dispose();
}
{
  // glue: two bodies move as one; a joint survives a rebuild and goes with a removed body
  const { w } = fresh();
  const a = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 3, 0], friction: 0.6 });
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [1.2, 3, 0], friction: 0.6 });
  w.createJoint({ kind: 'glue', a, b });
  run(w, 120);
  near(dist(w.getPose(a).pos, w.getPose(b).pos), 1.2, 0.05, 'glue: the two stay the same distance apart');
  w.dispose();

  const r = createPhysics(J, { gravity: [0, -10, 0] });
  const pin = pivotAt(r, [0, 5, 0]), arm = ball(r, { pos: [2, 5, 0], drag: 0 });
  r.createJoint({ kind: 'distance', a: pin, b: arm, length: 2 });
  r.rebuild(arm, { w: 0.8, h: 0.8, d: 0.8 });
  let worst = 0; for (let i = 0; i < 90; i++) { r.step(); worst = Math.max(worst, Math.abs(dist(r.getPose(arm).pos, [0, 5, 0]) - 2)); }
  ok(r.jointCount === 1 && worst < 0.06, 'a joint survives its body being resized', `off by ${worst}`);
  r.removeBody(pin);
  ok(r.jointCount === 0, 'removing a body removes its joints');
  run(r, 90); ok(r.getPose(arm).pos[1] < -2, 'and the other body is free');
  ok(/two 'static' bodies/.test(throws(() => r.createJoint({ kind: 'glue', a: pivotAt(r, [0, 0, 0]), b: pivotAt(r, [5, 0, 0]) }))), 'joining two static bodies explains itself');
  ok(/same body|two different/.test(throws(() => r.createJoint({ kind: 'glue', a: arm, b: arm }))), 'joining a body to itself explains itself');
  r.dispose();
}

// 24. world tuning
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  w.solverSteps = 20; near(w.solverSteps, 20, 0, 'solverSteps reads back');
  w.sleepDelay = 0.1; near(w.sleepDelay, 0.1, 1e-6, 'sleepDelay reads back');
  w.sleepSpeed = 0.2; near(w.sleepSpeed, 0.2, 1e-6, 'sleepSpeed reads back');
  w.minBounceSpeed = 0; near(w.minBounceSpeed, 0, 0, 'minBounceSpeed reads back');
  w.dispose();

  const timeToSleep = (delay) => {
    const { w } = fresh(); w.sleepDelay = delay;
    const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.55, 0], friction: 0.6 });
    let n = 0; while (!w.isAsleep(b) && n < 600) { w.step(); n++; }
    w.dispose(); return n;
  };
  ok(timeToSleep(0.1) + 15 < timeToSleep(1.5), 'a shorter sleepDelay puts things to sleep sooner');

  const bounce = (min) => {
    const { w } = fresh(); w.minBounceSpeed = min;
    const b = ball(w, { pos: [0, 0.29, 0], bounciness: 0.9, friction: 0.5 });
    let hi = 0; for (let i = 0; i < 40; i++) { w.step(); if (i > 3) hi = Math.max(hi, w.getPose(b).pos[1]); }
    w.dispose(); return hi;
  };
  ok(bounce(0) > bounce(1) + 0.01, 'minBounceSpeed 0 lets a tiny drop bounce; the default does not');
}

console.log(`\n${pass} passed, ${fail} failed  (fixed step ${(FIXED_DT * 1000).toFixed(2)} ms)`);
process.exit(fail ? 1 : 0);

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

// ============================ council review fixes (a refused change never breaks a live body) ============================
// 25. a refused collision group changes nothing, and the body can still be resized afterwards
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const b = ball(w, { group: 'first' });
  for (let i = 0; i < 31; i++) w.ignoreCollisions('g' + i); // 'first' + 31 more fills the 32 slots
  let msg = ''; try { w.setGroup(b, 'one-too-many'); } catch (e) { msg = e.message; }
  ok(/at most 32 collision groups/.test(msg), 'a 33rd group name is refused', msg);
  ok(b.def.group === 'first', 'and the body keeps the group it had (the refused name is not stored)', String(b.def.group));
  let after = ''; try { w.rebuild(b, { w: 1, h: 1, d: 1 }); } catch (e) { after = e.message; }
  ok(after === '' && b.body !== null && w.isAlive(b), 'so a later resize still works', after);
  w.dispose();
}

// 25b. resizing the ONLY body in a group keeps working (Jolt deletes a group filter nobody holds)
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const floor = w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const b = ball(w, { group: 'solo', pos: [0, 2, 0] });
  w.setGroup(floor, 'solo'); // the group of two: the ball and the floor
  for (let i = 0; i < 5; i++) w.rebuild(b, { w: 0.5 + i * 0.1, h: 0.5 + i * 0.1, d: 0.5 + i * 0.1 }); // while the floor also holds the group
  w.ignoreCollisions('solo'); run(w, 120);
  ok(w.getPose(b).pos[1] < -1, 'a group still works after its grouped bodies were rebuilt five times (it lets the ball through the floor)');
  w.dispose();
  const w2 = createPhysics(J, { gravity: [0, 0, 0] });
  ok(w2.createBody({ shape: 'box', collider: 'dynamic', group: 'x' }).alive, 'and the next world is fine (no freed filter left behind)');
  w2.dispose();
}

// 26. a rebuild Jolt refuses leaves the old body, with its joints, exactly as it was
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const v = [[-10, 0, -10], [10, 0, -10], [10, 0, 10], [-10, 0, 10]], t = [[0, 2, 1], [0, 3, 2]];
  const floor = w.createBody({ shape: 'triangles', vertices: v, triangles: t, collider: 'static' });
  let msg = ''; try { w.rebuild(floor, { vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], triangles: [[0, 1, 2]] }); } catch (e) { msg = e.message; }
  ok(msg !== '', 'a triangle mesh Jolt cannot make is refused', msg);
  ok(floor.body !== null && w.isAlive(floor) && w.rayCast([3, 5, 1], [3, -5, 1])?.rec === floor, 'and the floor is still a floor afterwards');
  const pin = pivotAt(w, [0, 5, 0]), arm = ball(w, { pos: [2, 5, 0] });
  w.createJoint({ kind: 'ball', a: pin, b: arm, anchor: [0, 5, 0] });
  try { w.rebuild(arm, { shape: 'hull', points: [[0, 0, 0], [1, 0, 0]] }); } catch { /* refused */ }
  ok(arm.body !== null && w.jointCount === 1, 'a refused rebuild keeps the body and its joint');
  run(w, 60); ok(Math.abs(dist(w.getPose(arm).pos, [0, 5, 0]) - 2) < 0.1, 'and the joint still holds');
  w.dispose();
}

// 27. resizing a jointed body keeps the joint's zero: the limits still count from where it was made
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const pin = pivotAt(w, [0, 5, 0]), arm = ball(w, { pos: [2, 5, 0], drag: 0, rotationDrag: 0 });
  const j = w.createJoint({ kind: 'hinge', a: pin, b: arm, anchor: [0, 5, 0], axis: [0, 0, 1], lower: -0.3, upper: 0.3 });
  run(w, 180);
  const before = w.jointValue(j);
  near(before, -0.3, 0.06, 'the arm rests on its lower limit');
  w.rebuild(arm, { w: 0.8, h: 0.8, d: 0.8 });
  near(w.jointValue(j), before, 0.05, 'resizing it does not change the angle the joint reports');
  run(w, 180);
  near(w.jointValue(j), -0.3, 0.06, 'and the lower limit still stops it at the ORIGINAL -0.3, not 0.3 further round');
  ok(w.getPose(arm).pos[1] > 4.3, 'the arm did not drop past its limit');
  w.dispose();

  const w2 = createPhysics(J, { gravity: [0, 0, 0] });
  const base = pivotAt(w2, [0, 3, 0]), car = w2.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 3, 0] });
  const js = w2.createJoint({ kind: 'slider', a: base, b: car, axis: [1, 0, 0], lower: -1, upper: 1.5 });
  w2.setPose(car, [1, 3, 0], [0, 0, 0, 1]); run(w2, 5);
  w2.rebuild(car, { w: 1.4, h: 1, d: 1 });
  near(w2.jointValue(js), 1, 0.1, 'a slider keeps its position reading after a resize');
  w2.addImpulse(car, [10, 0, 0]); run(w2, 120);
  near(w2.jointValue(js), 1.5, 0.08, 'and its upper limit is still 1.5 from where it was made');
  w2.dispose();
}

// 28. removing a body lets go of its shape (Jolt reference counts are by hand)
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const pyramid = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [0, 1, 0]];
  const makers = {
    box: () => w.createBody({ shape: 'box', collider: 'dynamic' }),
    sphere: () => w.createBody({ shape: 'sphere', collider: 'dynamic' }),
    cone: () => w.createBody({ shape: 'cone', collider: 'dynamic' }),
    torus: () => w.createBody({ shape: 'torus', w: 1.2, h: 0.4, d: 1, collider: 'dynamic' }),
    hull: () => w.createBody({ shape: 'hull', points: pyramid, collider: 'dynamic' }),
    triangles: () => w.createBody({ shape: 'triangles', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]], collider: 'static' }),
  };
  for (const [name, make] of Object.entries(makers)) {
    const b = make(), shape = b.body.GetShape();
    shape.AddRef(); w.removeBody(b);
    const n = shape.GetRefCount(); shape.Release();
    ok(n === 1, `a removed ${name} leaves no reference to its shape behind (only ours)`, `refs ${n}`);
  }
  const b = w.createBody({ shape: 'hull', points: pyramid, collider: 'dynamic' }), shape = b.body.GetShape();
  shape.AddRef(); w.rebuild(b, { friction: 0.2 }); const sh2 = b.body.GetShape(); const n = shape.GetRefCount(); shape.Release();
  ok(n === 1 && sh2 !== shape, 'a rebuild lets go of the old shape too', `refs ${n}`);
  w.dispose();
}

// ============================ council round 2 (Opus): what a game does every day ============================
// 29. groups: the last member can go, or change group, and the next step must not touch freed memory
{
  const mkWorld = () => { const w = createPhysics(J, { gravity: [0, 0, 0] }); return w; };
  const w = mkWorld();
  const only = ball(w, { group: 'ghost', pos: [0, 0, 0] });
  w.removeBody(only);
  const a = ball(w, { group: 'ghost', pos: [0, 0, 0] }), b = ball(w, { group: 'ghost', pos: [0.2, 0, 0] });
  w.ignoreCollisions('ghost'); run(w, 10);
  ok(w.isAlive(a) && w.isAlive(b), 'remove the only grouped body, make two more, step: no crash');
  const c = ball(w, { group: 'p', pos: [5, 0, 0] });
  w.setGroup(c, null); w.setGroup(c, 'p'); run(w, 5);
  ok(w.isAlive(c), 'leave a group and come back, then step: no crash');
  w.dispose();
}

// 30. a sleeper must notice that what it rests on has gone, moved or shrunk
{
  const resting = (act) => {
    const w = createPhysics(J, { gravity: [0, -10, 0] });
    const plat = w.createBody({ shape: 'box', w: 4, h: 0.5, d: 4, collider: 'static', pos: [0, 5, 0] });
    const box = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [1.5, 5.75, 0], friction: 0.6 }); // near the platform's edge
    run(w, 180);
    const asleep = w.isAsleep(box), y0 = w.getPose(box).pos[1];
    act(w, plat); run(w, 90);
    const y1 = w.getPose(box).pos[1]; w.dispose();
    return { asleep, y0, y1 };
  };
  const rm = resting((w, p) => w.removeBody(p));
  ok(rm.asleep && rm.y0 > 5.6 && rm.y1 < 3, 'a sleeping box falls when its platform is REMOVED', JSON.stringify(rm));
  const mv = resting((w, p) => w.setPose(p, [20, 5, 0], [0, 0, 0, 1]));
  ok(mv.y1 < 3, 'a sleeping box falls when its platform is MOVED away', JSON.stringify(mv));
  const sh = resting((w, p) => w.rebuild(p, { w: 1, h: 0.5, d: 4 })); // the platform no longer reaches under the box
  ok(sh.asleep && sh.y1 < 3, 'a sleeping box falls when its platform shrinks from under it', JSON.stringify(sh));
}

// 31. a removed record is inert: its id must not reach the NEXT body
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const a = ball(w, { pos: [0, 0, 0] });
  w.removeBody(a);
  const b = ball(w, { pos: [5, 0, 0] });
  w.addImpulse(a, [0, 100, 0]); w.addForce(a, [0, 100, 0]); w.setVelocity(a, [0, 9, 0]); w.setPose(a, [9, 9, 9], [0, 0, 0, 1]); w.addTorque(a, [0, 9, 0]);
  run(w, 5);
  near(w.getVelocity(b)[1], 0, 1e-6, 'pushing a REMOVED record does not push the body that took its place');
  near(w.getPose(b).pos[0], 5, 1e-6, 'nor move it');
  ok(throws(() => { w.getPose(a); w.getVelocity(a); w.isAwake(a); w.isAsleep(a); w.massOf(a); w.centerOfMass(a); w.touchingAll(a); }) === '', 'reading a removed record does not throw (it answers with what it was)');
  w.dispose();
}

// 32. the ground ray: from inside the player it must not hit the player; a ray can ignore a body
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const cap = w.createBody({ shape: 'capsule', w: 1, h: 2, d: 1, collider: 'dynamic', pos: [0, 10, 0] });
  ok(w.rayCast([0, 10, 0], [0, 8.9, 0]) === null, 'a ray that starts INSIDE a body does not hit it (mid-air "on the ground?" is false)');
  const floor = w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  w.setPose(cap, [0, 1, 0], [0, 0, 0, 1]);
  const down = w.rayCast([0, 1, 0], [0, -0.2, 0]);
  ok(down?.rec === floor && Math.abs(down.point[1]) < 1e-6, 'standing on the floor the same ray hits the FLOOR');
  const through = w.rayCast([0, 5, 0], [0, -1, 0]);
  ok(through?.rec === cap, 'a ray from outside still hits the body in its way');
  ok(w.rayCast([0, 5, 0], [0, -1, 0], cap)?.rec === floor, 'unless it is told to ignore that body');
  ok(w.rayCast([0, 5, 0], [0, -1, 0], [cap, floor]) === null, 'a list of bodies to ignore works too');
  ok(w.rayCastAll([0, 5, 0], [0, -1, 0], cap).length === 1, 'rayCastAll takes the same ignore list');
  w.dispose();
}

// 33. rayCastAll reports each body once
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const tor = w.createBody({ shape: 'torus', w: 4, h: 1, d: 4, collider: 'static', pos: [0, 0, 0] });
  const all = w.rayCastAll([-5, 0, 0], [5, 0, 0]);
  ok(all.length === 1 && all[0].rec === tor, 'a ray through a torus reports the torus once (it used to be four times)', String(all.length));
  w.dispose();
}

// 34. two 'none' solids see each other (a pickup zone and a peer's ghost)
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const z = w.createBody({ shape: 'box', w: 2, h: 2, d: 2, collider: 'none', pos: [0, 0, 0] }), g = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'none', pos: [0.5, 0, 0] });
  run(w, 3);
  const t = w.touching(z, g);
  ok(t && !t.physical, 'two sensors overlap, and it is an overlap, not a collision', JSON.stringify(t));
  w.dispose();
}

// 35. contact details: where, which way and how hard
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const floor = w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const b = ball(w, { pos: [0, 5, 0], friction: 0.5 });
  let hit = null, from = null;
  for (let i = 0; i < 120 && !hit; i++) { w.step(); const t = w.touching(b, floor); if (t && t.began && t.physical) { hit = t.hit; from = w.touching(floor, b).hit; } }
  ok(hit != null, 'the first frame of a collision carries the impact');
  near(hit.speed, Math.sqrt(2 * 10 * 4.75), 1.2, 'its speed is how fast they were closing (about 9.7 m/s after a 4.75 m fall)');
  near(hit.normal[1], -1, 0.05, 'seen from the ball the normal points DOWN, toward the floor');
  near(from.normal[1], 1, 0.05, 'and seen from the floor it points UP, toward the ball');
  near(hit.point[1], 0, 0.05, 'the point is on the floor surface');
  run(w, 5);
  ok(w.touching(b, floor).hit?.speed === hit.speed, 'the impact is kept while they stay in contact');
  const s = w.createBody({ shape: 'box', w: 2, h: 2, d: 2, collider: 'none', pos: [8, 1, 0] }), b2 = ball(w, { pos: [8, 1, 0] });
  run(w, 3);
  ok(w.touching(s, b2) && w.touching(s, b2).hit === null, 'a sensor overlap has no impact');
  w.dispose();
}

// 36. lockPosition: a side-scroller keeps its z
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const lock = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0, 0], lockPosition: { z: true } });
  const free = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 5, 0] });
  w.setVelocity(lock, [1, 0, 3]); w.setVelocity(free, [1, 0, 3]); run(w, 60);
  near(w.getPose(lock).pos[2], 0, 1e-6, 'lockPosition { z: true }: it never leaves its plane');
  ok(w.getPose(lock).pos[0] > 0.8, 'and still moves along x');
  ok(w.getPose(free).pos[2] > 2, 'an unlocked body moves in z');
  w.rebuild(lock, { lockPosition: false }); w.setVelocity(lock, [0, 0, 3]); run(w, 30);
  ok(w.getPose(lock).pos[2] > 1, 'and the lock can be taken off again');
  w.dispose();
}

// 37. density (a rebuild) keeps a hinge's zero as well
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const pin = pivotAt(w, [0, 5, 0]), arm = ball(w, { pos: [2, 5, 0], drag: 0, rotationDrag: 0 });
  const j = w.createJoint({ kind: 'hinge', a: pin, b: arm, anchor: [0, 5, 0], axis: [0, 0, 1], lower: -1, upper: 1 });
  run(w, 20);
  const before = w.jointValue(j);
  w.rebuild(arm, { density: 2, mass: null });
  near(w.jointValue(j), before, 0.05, 'changing the density (which rebuilds the body) leaves the joint angle alone');
  w.dispose();
}

// 38. council round 2 (Sol): an impact is measured AT the contact point, and belongs to one physical contact
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const bar = w.createBody({ shape: 'box', w: 4, h: 0.2, d: 0.2, collider: 'dynamic', pos: [0, 0, 0], angVel: [0, 0, 4] });
  const wall = w.createBody({ shape: 'box', w: 1, h: 0.2, d: 1, collider: 'static', pos: [1.8, 0.45, 0] });
  let hit = null;
  for (let i = 0; i < 120 && !hit; i++) { w.step(); const t = w.touching(bar, wall); if (t && t.began && t.physical) hit = t.hit; }
  ok(hit != null && hit.speed > 2, 'a spinning bar with NO linear speed still hits hard (speed taken at the contact point)', hit && String(hit.speed));
  w.dispose();

  const w2 = createPhysics(J, { gravity: [0, -10, 0] });
  const floor = w2.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const b = ball(w2, { pos: [0, 1, 0] });
  let seen = null;
  for (let i = 0; i < 90 && !seen; i++) { w2.step(); const t = w2.touching(b, floor); if (t && t.hit) seen = t.hit; }
  ok(seen != null, 'a collision carries an impact');
  w2.rebuild(b, { collider: 'none' }); run(w2, 3);
  const after = w2.touching(b, floor);
  ok(after && !after.physical && after.hit === null, 'turned into a sensor, the same pair reports an overlap with NO stale impact', JSON.stringify(after));
  w2.dispose();
}

// 39. council round 2 (Opus): moving or growing a STATIC body into a sleeper wakes it; mass of a position-locked solid; contact point
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const sleeper = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6 });
  const wall = w.createBody({ shape: 'box', w: 1, h: 3, d: 3, collider: 'static', pos: [-6, 1.5, 0] });
  run(w, 200);
  ok(!w.isAwake(sleeper), 'the box fell asleep on the floor');
  w.setPose(wall, [0, 1.5, 0], [0, 0, 0, 1]); run(w, 30);
  ok(w.getPose(sleeper).pos[0] < -0.5 || w.getPose(sleeper).pos[0] > 0.5, 'a static wall teleported INTO a sleeper pushes it out', String(w.getPose(sleeper).pos[0]));
  w.dispose();

  const w2 = createPhysics(J, { gravity: [0, -10, 0] });
  w2.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const s2 = w2.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [2, 0.5, 0], friction: 0.6 });
  const post = w2.createBody({ shape: 'box', w: 1, h: 3, d: 1, collider: 'static', pos: [0, 1.5, 0] });
  run(w2, 200);
  ok(!w2.isAwake(s2), 'the second box fell asleep too');
  w2.rebuild(post, { w: 4 }); run(w2, 30);
  ok(w2.getPose(s2).pos[0] > 2.4, 'a static post grown INTO a sleeper pushes it away', String(w2.getPose(s2).pos[0]));
  w2.dispose();

  const w3 = createPhysics(J, { gravity: [0, 0, 0] });
  const a = w3.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0, 0], lockPosition: true, mass: 3 });
  const b = w3.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [5, 0, 0], lockPosition: true });
  near(w3.massOf(a), 3, 1e-6, 'a position-locked solid still reports its mass (set by hand)');
  near(w3.massOf(b), 1 * w3.massOf(w3.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [9, 0, 0] })), 1e-6, 'and from its density when none is set');
  w3.dispose();

  const hitFrom = (floorFirst) => {
    const w4 = createPhysics(J, { gravity: [0, -10, 0] });
    let fl, bl;
    if (floorFirst) { fl = w4.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] }); bl = ball(w4, { pos: [0, 1.2, 0] }); }
    else { bl = ball(w4, { pos: [0, 1.2, 0] }); fl = w4.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] }); }
    let hit = null;
    for (let i = 0; i < 90 && !hit; i++) { w4.step(); const t = w4.touching(bl, fl); if (t && t.hit) hit = t.hit; }
    w4.dispose();
    return hit;
  };
  const h1 = hitFrom(true), h2 = hitFrom(false);
  ok(h1 && h2 && Math.abs(h1.point[1] - h2.point[1]) < 1e-6, 'the impact point does not depend on which body was made first', `${h1 && h1.point[1]} vs ${h2 && h2.point[1]}`);
}

// 40. council round 3 (Sol): new walls, collider changes, kinematic contacts, a tightened slider
{
  // a wall BUILT through a sleeper pushes it out
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const sleeper = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6 });
  run(w, 200);
  ok(!w.isAwake(sleeper), 'the box fell asleep');
  w.createBody({ shape: 'box', w: 1, h: 3, d: 3, collider: 'static', pos: [0, 1.5, 0] }); run(w, 30);
  ok(Math.abs(w.getPose(sleeper).pos[0]) > 0.5, 'a static wall created THROUGH a sleeper pushes it out', String(w.getPose(sleeper).pos[0]));
  w.dispose();

  // a resting pair where one becomes static and leaves: the contact ends instead of counting for ever
  const w2 = createPhysics(J, { gravity: [0, -10, 0] });
  const fl = w2.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const c = w2.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6 });
  run(w2, 200);
  ok(w2.touching(c, fl) != null, 'a resting cube touches the floor');
  w2.rebuild(c, { collider: 'static' }); w2.setPose(c, [0, 5, 0], [0, 0, 0, 1]); run(w2, 10);
  const t = w2.touching(c, fl);
  ok(t == null || t.ended, 'a cube turned static and moved away no longer touches the floor', JSON.stringify(t));
  w2.dispose();

  // an overlap that becomes a collision is a NEW physical contact with an impact
  const w3 = createPhysics(J, { gravity: [0, 0, 0] });
  const fl3 = w3.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
  const s3 = w3.createBody({ shape: 'sphere', w: 1, collider: 'none', pos: [0, 0.3, 0], vel: [0, -2, 0] });
  run(w3, 5);
  ok(w3.touching(s3, fl3) && !w3.touching(s3, fl3).physical, 'a sensor overlapping the floor reports an overlap');
  w3.rebuild(s3, { collider: 'dynamic' });
  let got = null; for (let i = 0; i < 10 && !got; i++) { w3.step(); const t3 = w3.touching(s3, fl3); if (t3 && t3.physical && t3.began) got = t3; }
  ok(got != null && got.hit != null, 'turned into a solid, the same pair begins a PHYSICAL contact with an impact', JSON.stringify(got));
  w3.dispose();

  // kinematic bodies touch static walls and other kinematic bodies
  const w4 = createPhysics(J, { gravity: [0, 0, 0] });
  const gl = w4.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'kinematic', pos: [0, 1, 0] });
  const wall = w4.createBody({ shape: 'box', w: 1, h: 3, d: 3, collider: 'static', pos: [3, 1, 0] });
  let seenWall = false;
  for (let i = 0; i < 120; i++) { w4.moveKinematic(gl, [Math.min(i, 60) * 0.05, 1, 0]); w4.step(); if (w4.touching(gl, wall)) seenWall = true; }
  ok(seenWall, 'a kinematic solid touches a static wall');
  const w5 = createPhysics(J, { gravity: [0, 0, 0] });
  const k1 = w5.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'kinematic', pos: [0, 1, 0] });
  const k2 = w5.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'kinematic', pos: [0.6, 1, 0] });
  run(w5, 3);
  ok(w5.touching(k1, k2) != null, 'two kinematic solids touch each other');
  w4.dispose(); w5.dispose();

  // a slider rebuilt (mass change) keeps its ORIGINAL zero: a limit tightened afterwards pulls it back
  const w6 = createPhysics(J, { gravity: [0, 0, 0] });
  const base = w6.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'static', pos: [0, 0, 0] });
  const car = w6.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 2, 0] });
  const sl = w6.createJoint({ kind: 'slider', a: base, b: car, axis: [1, 0, 0], lower: -3, upper: 3 });
  w6.setVelocity(car, [3, 0, 0]); run(w6, 30); w6.setVelocity(car, [0, 0, 0]);
  const at = w6.jointValue(sl);
  w6.rebuild(car, { mass: 5 }); run(w6, 5);
  near(w6.jointValue(sl), at, 0.05, 'a rebuilt slider still reports the same position');
  w6.setJointLimits(sl, -3, 1); run(w6, 300); // Jolt eases a limit it finds already passed, so it takes a few seconds
  near(w6.jointValue(sl), 1, 0.1, 'a limit tightened past where a rebuilt slider has gone pulls it back to 1', `at ${at} now ${w6.jointValue(sl)}`);
  w6.dispose();
}

// 41. council round 3 (Opus): joints, friction and groups wake sleepers
{
  // cutting a rope drops what hung on it (it had fallen asleep)
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const hook = w.createBody({ shape: 'sphere', w: 0.2, collider: 'static', pos: [0, 5, 0] });
  const b = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 3, 0] });
  const rope = w.createJoint({ kind: 'distance', a: hook, b, length: 2, rope: true });
  run(w, 240);
  ok(!w.isAwake(b), 'a body hanging still on a rope fell asleep');
  w.removeJoint(rope); run(w, 40);
  ok(w.getPose(b).pos[1] < 2.5, 'cutting the rope wakes it and it falls', String(w.getPose(b).pos[1]));
  w.dispose();

  // removing the hook does the same
  const wa = createPhysics(J, { gravity: [0, -10, 0] });
  const hook2 = wa.createBody({ shape: 'sphere', w: 0.2, collider: 'static', pos: [0, 5, 0] });
  const b2 = wa.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 3, 0] });
  wa.createJoint({ kind: 'distance', a: hook2, b: b2, length: 2, rope: true });
  run(wa, 240);
  ok(!wa.isAwake(b2), 'the second hanging body fell asleep');
  wa.removeBody(hook2); run(wa, 40);
  ok(wa.getPose(b2).pos[1] < 2.5, 'removing the hook wakes what hung from it', String(wa.getPose(b2).pos[1]));
  wa.dispose();

  // a joint made on sleepers pulls them
  const wb = createPhysics(J, { gravity: [0, -10, 0] });
  wb.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0], friction: 0.6 });
  const sl = wb.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6 });
  const hk = wb.createBody({ shape: 'sphere', w: 0.2, collider: 'static', pos: [0, 5, 0] });
  run(wb, 200);
  ok(!wb.isAwake(sl), 'a box fell asleep on the floor');
  wb.createJoint({ kind: 'distance', a: hk, b: sl, length: 2, rope: true }); run(wb, 90);
  ok(wb.getPose(sl).pos[1] > 1.5, 'a rope made on a sleeper pulls it up', String(wb.getPose(sl).pos[1]));
  wb.dispose();

  // ice: a box asleep on a ramp starts to slide when the friction goes to 0
  const wc = createPhysics(J, { gravity: [0, -10, 0] });
  const a15 = (15 * Math.PI) / 360, q = [0, 0, Math.sin(a15), Math.cos(a15)];
  const ramp = wc.createBody({ shape: 'box', w: 20, h: 0.5, d: 4, collider: 'static', pos: [0, 0, 0], quat: q, friction: 1 });
  const bx = wc.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.78, 0], quat: q, friction: 1 });
  run(wc, 300);
  ok(!wc.isAwake(bx), 'a box rests (asleep) on a 15 degree ramp');
  const x0 = wc.getPose(bx).pos[0];
  wc.setFriction(ramp, 0); wc.setFriction(bx, 0); run(wc, 90);
  ok(Math.abs(wc.getPose(bx).pos[0] - x0) > 0.5, 'making it ice sets the sleeper sliding', String(wc.getPose(bx).pos[0] - x0));
  // setting the SAME friction again every frame does not keep things awake
  const wd = createPhysics(J, { gravity: [0, -10, 0] });
  const fl = wd.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0], friction: 0.6 });
  const rb = wd.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6 });
  for (let i = 0; i < 240; i++) { wd.setFriction(rb, 0.6); wd.setFriction(fl, 0.6); wd.step(); }
  ok(!wd.isAwake(rb), 'a sketch that sets friction to the same value every frame still lets things sleep');
  wc.dispose(); wd.dispose();

  // changing the collision group wakes a sleeper that now falls through
  const we = createPhysics(J, { gravity: [0, -10, 0] });
  we.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0], group: 'ground' });
  const gb = we.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6 });
  we.ignoreCollisions('ghost', 'ground'); run(we, 200);
  ok(!we.isAwake(gb), 'a box sleeps on a floor in group ground');
  we.setGroup(gb, 'ghost'); run(we, 60);
  ok(we.getPose(gb).pos[1] < 0, 'turned into a ghost it falls through the ground', String(we.getPose(gb).pos[1]));
  we.dispose();

  // the pick layer sees a sensor; the ordinary ray does not
  const wf = createPhysics(J, { gravity: [0, 0, 0] });
  wf.createBody({ shape: 'box', w: 2, h: 2, d: 2, collider: 'static', pos: [0, 0, 0] });
  const coin = wf.createBody({ shape: 'sphere', w: 1, collider: 'none', pos: [0, 0, 3] });
  ok(wf.rayCast([0, 0, 10], [0, 0, -10]).rec !== coin, 'an ordinary ray looks through a sensor');
  ok(wf.rayCast([0, 0, 10], [0, 0, -10], undefined, true).rec === coin, 'the pick ray stops at a sensor in front');
  ok(wf.rayCastAll([0, 0, 10], [0, 0, -10], undefined, true)[0].rec === coin, 'and so does the pick ray that lists everything');
  wf.dispose();
}

// 42. council round 4 (Sol): kinematic riders, joint frames across rebuilds, queued force across a resize
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const plat = w.createBody({ shape: 'box', w: 6, h: 0.5, d: 6, collider: 'kinematic', pos: [0, 0, 0] });
  const rider = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.75, 0], friction: 0.6, group: 'rider' });
  w.ignoreCollisions('plat', 'rider'); run(w, 200);
  ok(!w.isAwake(rider), 'a box sleeps on a kinematic platform');
  w.setGroup(plat, 'plat'); run(w, 60);
  ok(w.getPose(rider).pos[1] < 0, 'a sleeping rider falls through when its kinematic platform joins a group that ignores it', String(w.getPose(rider).pos[1]));
  w.dispose();

  // a hinge keeps its ORIGINAL zero and limits across a rebuild: a limit tightened after (past the swing) pulls the door back
  const wh = createPhysics(J, { gravity: [0, 0, 0] });
  const post = wh.createBody({ shape: 'box', w: 0.2, h: 0.2, d: 0.2, collider: 'static', pos: [0, 0, 0] });
  const door = wh.createBody({ shape: 'box', w: 1.6, h: 0.2, d: 0.4, collider: 'dynamic', pos: [1, 0, 0] });
  const hg = wh.createJoint({ kind: 'hinge', a: post, b: door, anchor: [0, 0, 0], axis: [0, 0, 1], lower: -1.5, upper: 1.5 });
  wh.setAngularVelocity(door, [0, 0, Math.PI / 3]); wh.setVelocity(door, [0, Math.PI / 3, 0]); run(wh, 60); wh.setAngularVelocity(door, [0, 0, 0]); wh.setVelocity(door, [0, 0, 0]);
  const swung = wh.jointValue(hg);
  near(swung, Math.PI / 3, 0.15, 'the door swung about 60 degrees');
  wh.rebuild(door, { mass: 5 }); run(wh, 5);
  near(wh.jointValue(hg), swung, 0.05, 'a rebuilt hinge still reports the same angle');
  wh.setJointLimits(hg, -1.5, Math.PI / 6); run(wh, 400);
  near(wh.jointValue(hg), Math.PI / 6, 0.12, 'a limit tightened past the swing, after a rebuild, pulls the door back to it', String(wh.jointValue(hg)));
  wh.dispose();

  // a ball joint and a glue joint stay what they were when a stretched body is rebuilt before the next step
  for (const kind of ['ball', 'glue']) {
    const wk = createPhysics(J, { gravity: [0, 0, 0] });
    const pin = wk.createBody({ shape: 'sphere', w: 0.2, collider: 'static', pos: [0, 0, 0] });
    const arm = wk.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [2, 0, 0] });
    wk.createJoint({ kind, a: pin, b: arm, anchor: [0, 0, 0] });
    run(wk, 5);
    wk.setPose(arm, [5, 0, 0], [0, 0, 0, 1]); wk.rebuild(arm, { w: 1.2 }); run(wk, 240);
    const d = Math.hypot(...wk.getPose(arm).pos);
    ok(d < 2.4, `a stretched ${kind} joint is still pulled back after the body is resized`, String(d));
    wk.dispose();
  }

  // a push applied this frame survives a resize in the same frame
  const wf = createPhysics(J, { gravity: [0, 0, 0] });
  const cube = wf.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0, 0] });
  wf.addForce(cube, [120, 0, 0]); wf.rebuild(cube, { w: 2 }); run(wf, 3);
  ok(wf.getVelocity(cube)[0] > 0.05, 'force queued before a resize is still applied', String(wf.getVelocity(cube)[0]));
  wf.dispose();
}

// 43. council round 4 (Opus): a box asleep on a DYNAMIC box falls when the bottom one changes group; a static body takes allowSleeping without touching Jolt
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  w.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0], friction: 0.6 });
  const bottom = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 0.5, 0], friction: 0.6 });
  const top = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 1.5, 0], friction: 0.6, group: 'b' });
  w.ignoreCollisions('a', 'b'); run(w, 240);
  ok(!w.isAwake(top), 'a box sleeps on top of another box');
  w.setGroup(bottom, 'a'); run(w, 40);
  ok(w.getPose(top).pos[1] < 1.2, 'the top box falls when the bottom one joins a group that ignores it', String(w.getPose(top).pos[1]));
  const wall = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'static', pos: [5, 0.5, 0] });
  w.setAllowSleeping(wall, false);
  ok(wall.def.allowSleeping === false, 'a static body remembers allowSleeping = false (and Jolt is not written to)');
  w.rebuild(wall, { collider: 'dynamic' }); run(w, 300);
  ok(w.isAwake(wall), 'and when it becomes dynamic it keeps that setting (never sleeps)');
  w.dispose();
}

// 44. council round 5 (Sol): a hook teleported away wakes its weight; a teleport or a collider change drops a queued glide
{
  const w = createPhysics(J, { gravity: [0, -10, 0] });
  const hook = w.createBody({ shape: 'sphere', w: 0.2, collider: 'static', pos: [0, 3, 0] });
  const weight = w.createBody({ shape: 'box', w: 1, h: 1, d: 1, collider: 'dynamic', pos: [0, 1, 0] });
  w.createJoint({ kind: 'distance', a: hook, b: weight, length: 2, rope: true }); run(w, 300);
  ok(!w.isAwake(weight), 'a weight hangs asleep from its hook');
  w.setPose(hook, [0, 9, 0], [0, 0, 0, 1]); run(w, 90);
  ok(w.getPose(weight).pos[1] > 4, 'a hook teleported up pulls its sleeping weight along', String(w.getPose(weight).pos[1]));
  w.dispose();

  const wg = createPhysics(J, { gravity: [0, 0, 0] });
  const plat = wg.createBody({ shape: 'box', w: 2, h: 0.5, d: 2, collider: 'kinematic', pos: [20, 0, 0] });
  wg.moveKinematic(plat, [21, 0, 0]); wg.setPose(plat, [20, 0, 0], [0, 0, 0, 1], true); run(wg, 3);
  near(wg.getPose(plat).pos[0], 20, 1e-6, 'a teleport to the SAME place still drops a glide queued this frame');
  wg.moveKinematic(plat, [21, 0, 0]); wg.setPose(plat, [20, 0, 0], [0, 0.38, 0, 0.92], false); run(wg, 3);
  ok(wg.getPose(plat).pos[0] > 20.5, 'a rotation-only write leaves the queued glide alone', String(wg.getPose(plat).pos[0]));
  wg.setPose(plat, [20, 0, 0], [0, 0, 0, 1], true);
  wg.moveKinematic(plat, [20.1, 0, 0]); wg.rebuild(plat, { collider: 'dynamic' }); run(wg, 3);
  ok(wg.getVelocity(plat)[0] > 4, 'a platform gliding at 6 m/s that becomes dynamic keeps its speed (the step does not zero it)', String(wg.getVelocity(plat)[0]));
  wg.dispose();
}

// 45. council round 5 (Opus): a kinematic solid keeps turning while it glides with moveTo
{
  const w = createPhysics(J, { gravity: [0, 0, 0] });
  const spinner = w.createBody({ shape: 'box', w: 2, h: 0.2, d: 2, collider: 'kinematic', pos: [0, 0, 0], angVel: [0, 2, 0] });
  for (let i = 0; i < 60; i++) { w.moveKinematic(spinner, [i * 0.01, 0, 0]); w.step(); }
  const q = w.getPose(spinner).quat;
  near(Math.abs(q[1]), Math.sin(1), 0.06, 'a spinning kinematic solid that moves with moveTo still turns (2 rad/s for 1 s)');
  near(w.getPose(spinner).pos[0], 0.59, 0.03, 'and still travels');
  w.dispose();
}

console.log(`\n${pass} passed, ${fail} failed  (fixed step ${(FIXED_DT * 1000).toFixed(2)} ms)`);
process.exit(fail ? 1 : 0);

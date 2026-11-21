// spaSHial physics layer: the ONLY file that talks to Jolt. It knows nothing about
// three.js or the sketch API, so it runs in Node for tests and in the sandboxed
// preview iframe. If the physics library ever changes, this is the file that does.
//
//   import init from '.../jolt-physics.wasm.js';
//   const world = createPhysics(await init(), { gravity: [0, -10, 0] });
//   const floor = world.createBody({ shape: 'box', w: 20, h: 1, d: 20, collider: 'static', pos: [0, -0.5, 0] });
//
// Units: metres, radians, seconds, Y up. The sketch-facing layer converts to the
// per-frame and degree units the API promises (see plans/spashial/spashial.d.ts).
//
// Shape sizes (full extents, not half):
//   box       w h d
//   sphere    w = diameter
//   cylinder  w = diameter, h = height
//   capsule   w = diameter, h = total height (at least w)
//   cone      w = base diameter, h = height (tip up)
//   torus     w = outer diameter, h = tube thickness; lies flat, axis Y
//   hull      `points` [[x,y,z]...]: the smallest convex shape around them (at least 4, not flat)
//   triangles `vertices` [[x,y,z]...] and `triangles` [[i,j,k]...]: any shape, but it can never be
//             'dynamic' (Jolt cannot work out a mass for it); use it for floors, terrain, rooms
//
// Colliders (moSHion's words): 'dynamic' | 'static' | 'kinematic' | 'none'.
// 'none' is a sensor: it moves by its velocity, nothing is pushed, and it still
// reports overlaps.
//
// Per-body settings (all live, none needs a rebuild): friction, bounciness, drag, rotationDrag,
// gravityScale, superFast, maxSpeed, maxSpin, allowSleeping, group. Joints join two bodies
// (hinge, ball, distance, slider, glue). World settings: gravity, allowSleeping, solverSteps,
// sleepDelay, sleepSpeed, minBounceSpeed. Speeds here are metres per second and radians per
// second; the sketch layer converts to per-frame and degrees.

export const FIXED_DT = 1 / 60;
export const PRIMITIVES = ['box', 'sphere', 'cylinder', 'capsule', 'cone', 'torus'];
export const SHAPES = [...PRIMITIVES, 'hull', 'triangles'];
export const COLLIDERS = ['dynamic', 'static', 'kinematic', 'none'];
export const JOINTS = ['hinge', 'ball', 'distance', 'slider', 'glue'];
export const MAX_GROUPS = 32;      // named collision groups
export const DEFAULT_MAX_SPEED = 500;              // m/s, Jolt's own limit
export const DEFAULT_MAX_SPIN = 0.25 * Math.PI * 60; // rad/s, Jolt's own limit

// A torus has no Jolt primitive: it is a ring of capsules (measured in
// scripts/spashial-bench/torus.mjs: about 2 cm of error at 16, about 6x a sphere's cost).
export const TORUS_SEGMENTS = 16;

const L_STATIC = 0, L_MOVING = 1, L_SENSOR = 2, L_QUERY = 3, L_PICK = 4; // L_QUERY: rays look through sensors; L_PICK: the mouse sees them too
const KEY = 67108864; // 2^26: pair key = low id * KEY + high id

/** Volume in m^3 for the default mass (density 1 = 1 kg per m^3). */
export function volumeOf(shape, w, h, d) {
  const r = w / 2;
  switch (shape) {
    case 'box': return w * h * d;
    case 'sphere': return (4 / 3) * Math.PI * r ** 3;
    case 'cylinder': return Math.PI * r * r * h;
    case 'capsule': return Math.PI * r * r * Math.max(h - w, 0) + (4 / 3) * Math.PI * r ** 3;
    case 'cone': return (Math.PI * r * r * h) / 3;
    case 'torus': { const t = h / 2, R = (w - h) / 2; return 2 * Math.PI ** 2 * R * t * t; }
    default: throw new Error(`unknown shape '${shape}'`);
  }
}

// quaternions are [x, y, z, w]
const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qy = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const qinv = ([x, y, z, w]) => [-x, -y, -z, w]; // unit quaternions only
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]); if (!l) throw new Error('an axis cannot be [0, 0, 0]'); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const perpendicular = (axis) => unit3(cross3(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
const boundsOf = (pts) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
};
function isFlat(pts) { // all on one plane (or line)? Jolt happily builds a hull with no volume
  const p0 = pts[0], len = (v) => Math.hypot(v[0], v[1], v[2]);
  const far = (from, f) => pts.reduce((best, p) => (f(p) > f(best) ? p : best), from);
  const p1 = far(p0, (p) => len(sub3(p, p0)));
  const e = sub3(p1, p0);
  if (len(e) < 1e-9) return true;
  const p2 = far(p0, (p) => len(cross3(e, sub3(p, p0))));
  const n = cross3(e, sub3(p2, p0));
  if (len(n) < 1e-9) return true;
  const nh = unit3(n);
  return pts.every((p) => Math.abs(nh[0] * (p[0] - p0[0]) + nh[1] * (p[1] - p0[1]) + nh[2] * (p[2] - p0[2])) < 1e-6);
}
function checkPoints(name, pts, min) {
  if (!Array.isArray(pts) || pts.length < min || pts.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((n) => !Number.isFinite(n)))) {
    throw new Error(`${name} needs at least ${min} points like [x, y, z]`);
  }
}

export function createPhysics(J, { gravity = [0, 0, 0] } = {}) {
  // ---- the Jolt system: four object layers, two broad-phase layers -------------
  const settings = new J.JoltSettings();
  const pairs = new J.ObjectLayerPairFilterTable(5);
  pairs.EnableCollision(L_STATIC, L_MOVING);
  pairs.EnableCollision(L_MOVING, L_MOVING);
  pairs.EnableCollision(L_SENSOR, L_MOVING);
  pairs.EnableCollision(L_SENSOR, L_STATIC);
  pairs.EnableCollision(L_SENSOR, L_SENSOR); // two 'none' solids see each other
  pairs.EnableCollision(L_QUERY, L_STATIC); // rays see solid things only:
  pairs.EnableCollision(L_QUERY, L_MOVING); // never a sensor
  pairs.EnableCollision(L_PICK, L_STATIC); pairs.EnableCollision(L_PICK, L_MOVING); pairs.EnableCollision(L_PICK, L_SENSOR);
  const bpi = new J.BroadPhaseLayerInterfaceTable(5, 2);
  bpi.MapObjectToBroadPhaseLayer(L_STATIC, new J.BroadPhaseLayer(0));
  for (const l of [L_MOVING, L_SENSOR, L_QUERY, L_PICK]) bpi.MapObjectToBroadPhaseLayer(l, new J.BroadPhaseLayer(1));
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = bpi;
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, pairs, 5);
  const jolt = new J.JoltInterface(settings);
  J.destroy(settings);
  const system = jolt.GetPhysicsSystem();
  const bi = system.GetBodyInterface();
  const narrow = system.GetNarrowPhaseQuery();

  // Named collision groups. A body in a group carries our filter, so Jolt asks it (a JS
  // callback) whenever that body meets another; a body in no group carries none, and two such
  // bodies never cost a callback. (Jolt's own GroupFilterTable cannot be used: it treats two
  // bodies of the same group as parts of one ragdoll and never lets them touch.)
  // world.ignoreCollisions(a, b) switches a pair of groups off, restoreCollisions back on.
  const groupIds = new Map();
  const ignored = new Set();
  const pairKey = (a, b) => (a < b ? a * 64 + b : b * 64 + a);
  function groupIndex(name) {
    let i = groupIds.get(name);
    if (!i) {
      if (groupIds.size >= MAX_GROUPS) throw new Error(`there can be at most ${MAX_GROUPS} collision groups`);
      i = groupIds.size + 1; groupIds.set(name, i);
    }
    return i;
  }
  const groupFilter = new J.GroupFilterJS();
  groupFilter.AddRef(); // Jolt counts references to it: without ours, destroying the LAST body in a group (a resize destroys and re-makes it) deletes the filter while we still use it
  groupFilter.CanCollide = (p1, p2) => !ignored.has(pairKey(
    J.wrapPointer(p1, J.CollisionGroup).GetSubGroupID(), J.wrapPointer(p2, J.CollisionGroup).GetSubGroupID()));
  const groupOf = (name) => (name == null ? new J.CollisionGroup() : new J.CollisionGroup(groupFilter, 0, groupIndex(name)));

  const setGravity = (g) => { const v = new J.Vec3(g[0], g[1], g[2]); system.SetGravity(v); J.destroy(v); };
  setGravity(gravity);
  let gravityNow = [...gravity];

  // ray query filters and a reusable collector
  const rayBp = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), L_QUERY);
  const rayObj = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), L_QUERY);
  const pickBp = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), L_PICK);
  const pickObj = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), L_PICK);
  const rayBody = new J.BodyFilter();
  const rayShape = new J.ShapeFilter();
  const rayCfg = new J.RayCastSettings();
  // A ray that STARTS inside a convex shape must not hit that shape at fraction 0: "am I on the ground?"
  // from a player's own centre would otherwise always hit the player (the spec's own example did).
  rayCfg.set_mTreatConvexAsSolid(false);
  const rayIgnore = new J.IgnoreMultipleBodiesFilter();
  /** The body filter for one ray: everything, or everything but these records (a ray can ignore the shooter). */
  function filterFor(ignore) {
    const list = ignore == null ? [] : Array.isArray(ignore) ? ignore : [ignore];
    const live = list.filter((r) => r && r.alive && r.body);
    if (!live.length) return rayBody;
    rayIgnore.Clear();
    for (const r of live) rayIgnore.IgnoreBody(r.bodyId);
    return rayIgnore;
  }
  // wakes sleepers in a box: for what rests on a body that moves or goes away
  const wakeBp = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), L_MOVING);
  const wakeObj = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), L_MOVING);
  const closest = new J.CastRayClosestHitCollisionCollector();

  // ---- bookkeeping ---------------------------------------------------------------
  let nextId = 1;
  const byPtr = new Map();  // Jolt body pointer -> record (for contact callbacks, no allocation)
  const byKey = new Map();  // BodyID index+sequence -> record (for ray hits)
  const all = new Set();    // live records

  // ---- contacts: the touch verbs ---------------------------------------------------
  // Jolt calls the listener during Step. We collect the pairs seen this step, then
  // reconcile with last step's: new = began, gone = ended. A sleeping pair makes no
  // contacts, so a pair is carried over while both bodies are inactive.
  let seen = new Map();
  let touching = new Map();
  let endedPairs = new Map();
  // The first frame of a physical contact also records where and how hard (read in OnContactAdded, before the
  // solver changes the velocities): the point, the normal pointing from body 1 to body 2, and the closing speed
  // along it in m/s. A sensor contact has none.
  // linear + angular x (point - centre of mass). Not BodyInterface.GetPointVelocity: this runs INSIDE Jolt's contact
  // callback, where the locking body interface waits for a lock the callback's own thread holds (it hung).
  function pointVelocity(body, pt) {
    const lin = v3(body.GetLinearVelocity()), ang = v3(body.GetAngularVelocity()), com = v3(body.GetCenterOfMassPosition());
    const r = sub3(pt, com);
    return add3(lin, cross3(ang, r));
  }
  function contactHit(a, b, manifoldPtr) {
    // Jolt hands back a Vec3 BY VALUE through one shared temporary: a second call overwrites the first, so each
    // result is copied into plain numbers before the next call (reading two velocities in a row gave the same one twice)
    const m = J.wrapPointer(manifoldPtr, J.ContactManifold), n = v3(m.get_mWorldSpaceNormal());
    const p1 = v3(m.GetWorldSpaceContactPointOn1(0)), p2 = v3(m.GetWorldSpaceContactPointOn2(0)); // copied out one at a time
    const pt = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2]; // halfway between the two surfaces: the same whichever body was made first
    const va = pointVelocity(a.body, pt), vb = pointVelocity(b.body, pt); // the speed of each body AT the contact: a spinning bar counts
    return { first: a, n, point: pt, speed: (va[0] - vb[0]) * n[0] + (va[1] - vb[1]) * n[1] + (va[2] - vb[2]) * n[2] };
  }
  const note = (p1, p2, manifoldPtr) => {
    const a = byPtr.get(p1), b = byPtr.get(p2);
    if (!a || !b) return;
    const lo = a.id < b.id ? a : b, hi = lo === a ? b : a;
    const k = lo.id * KEY + hi.id;
    if (seen.has(k)) return;
    const sensor = a.def.collider === 'none' || b.def.collider === 'none';
    const was = touching.get(k);
    seen.set(k, { a: lo, b: hi, sensor, hit: !sensor && manifoldPtr && (!was || was.sensor) ? contactHit(a, b, manifoldPtr) : null });
  };
  const listener = new J.ContactListenerJS();
  listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair;
  listener.OnContactAdded = (p1, p2, manifold) => note(p1, p2, manifold);
  listener.OnContactPersisted = (p1, p2) => note(p1, p2);
  listener.OnContactRemoved = () => {};
  system.SetContactListener(listener);

  /** The impact, with the normal pointing from `rec` toward the other body (the manifold's is from its body 1). */
  const asSeenFrom = (hit, rec) => (hit ? { point: hit.point, speed: hit.speed, normal: hit.first === rec ? hit.n : hit.n.map((v) => -v) } : null);
  function reconcile() {
    const next = new Map();
    for (const [k, c] of seen) {
      const prev = touching.get(k);
      const same = prev && prev.sensor === c.sensor; // an overlap that turns into a collision (or back) is a new contact
      next.set(k, { a: c.a, b: c.b, sensor: c.sensor, frames: same ? prev.frames + 1 : 1, began: !same, hit: same && !c.sensor ? prev.hit : c.hit }); // kept while the SAME physical contact lasts; a sensor/solid change starts afresh
    }
    const ended = new Map();
    for (const [k, p] of touching) {
      if (seen.has(k)) continue;
      const bothAsleep = p.a.alive && p.b.alive && p.a.body && p.b.body && !p.a.body.IsActive() && !p.b.body.IsActive()
        && (p.a.def.collider !== 'static' || p.b.def.collider !== 'static'); // two static bodies are not 'asleep': a pair that was resting and had one turned static ends
      if (bothAsleep) next.set(k, { ...p, frames: p.frames + 1, began: false });
      else ended.set(k, p);
    }
    touching = next;
    endedPairs = ended;
    seen = new Map();
  }

  // ---- building a body ---------------------------------------------------------------
  // Jolt objects are reference counted by hand. A shape made from settings is held by the settings AND by the
  // result Create() hands back (measured: two references before any body has it). Both must be destroyed once
  // the body has the shape, result first, or removing the body leaves the shape alive for ever (a hull or a
  // torus kept 3 references). `own(x)` records a temporary to destroy after the body exists, and hands it back.
  function makeShape(def, own) {
    const { shape, w, h, d } = def;
    const r = w / 2;
    const V3 = (x, y, z) => own(new J.Vec3(x, y, z));
    switch (shape) {
      case 'hull': {
        const s = own(new J.ConvexHullShapeSettings());
        const pts = s.mPoints;
        for (const p of def.points) pts.push_back(V3(p[0], p[1], p[2]));
        const res = own(s.Create());
        if (!res.IsValid()) throw new Error('hull: ' + res.GetError().c_str() + ' (give at least 4 points that are not all on one flat plane)');
        return res.Get();
      }
      case 'triangles': {
        const s = own(new J.MeshShapeSettings());
        for (const p of def.vertices) s.mTriangleVertices.push_back(own(new J.Float3(p[0], p[1], p[2])));
        // Jolt only collides with and rays against a triangle's FRONT face (corners counter-clockwise
        // as seen), so a shape wound the other way looks solid (it is drawn double-sided) and lets
        // everything through, and a beginner cannot see the winding. Each triangle goes in both ways
        // round, so winding never matters. Costs twice the triangles.
        for (const t of def.triangles) {
          for (const order of [[t[0], t[1], t[2]], [t[0], t[2], t[1]]]) s.mIndexedTriangles.push_back(own(new J.IndexedTriangle(order[0], order[1], order[2], 0)));
        }
        s.Sanitize();
        const res = own(s.Create());
        if (!res.IsValid()) throw new Error('triangle mesh: ' + res.GetError().c_str());
        return res.Get();
      }
      case 'box': return new J.BoxShape(V3(w / 2, h / 2, d / 2), Math.min(0.05, w / 4, h / 4, d / 4), null);
      case 'sphere': return new J.SphereShape(r);
      case 'cylinder': return new J.CylinderShape(h / 2, r, Math.min(0.05, r / 2, h / 4));
      case 'capsule': return new J.CapsuleShape(Math.max(h - w, 0) / 2, r);
      case 'cone': { // a tapered cylinder with a point on top; it needs a convex radius of 0
        const s = own(new J.TaperedCylinderShapeSettings(h / 2, 0, r, 0));
        const res = own(s.Create());
        if (!res.IsValid()) throw new Error('cone: ' + res.GetError().c_str());
        return res.Get();
      }
      case 'torus': {
        const tube = h / 2, ring = (w - h) / 2;
        const cs = own(new J.StaticCompoundShapeSettings());
        const half = ring * Math.sin(Math.PI / TORUS_SEGMENTS); // half a chord: the capsule's straight part
        for (let i = 0; i < TORUS_SEGMENTS; i++) {
          const t = (i / TORUS_SEGMENTS) * 2 * Math.PI;
          const q = qmul(qy(-t), qx(Math.PI / 2)); // lay a Y-axis capsule along the ring's tangent
          cs.AddShapeShape(V3(ring * Math.cos(t), 0, ring * Math.sin(t)), own(new J.Quat(q[0], q[1], q[2], q[3])), new J.CapsuleShape(half, tube), 0);
        }
        const res = own(cs.Create());
        if (!res.IsValid()) throw new Error('torus: ' + res.GetError().c_str());
        return res.Get();
      }
      default: throw new Error(`unknown shape '${shape}'`);
    }
  }
  /** The shape and what to destroy once a body holds it. Throws (leaving nothing behind) if Jolt cannot make it. */
  function prepareShape(def) {
    const temps = [];
    try { return { shape: makeShape(def, (o) => { temps.push(o); return o; }), temps }; }
    catch (e) { freeTemps(temps); throw e; }
  }
  const freeTemps = (temps) => { for (const o of temps.reverse()) J.destroy(o); temps.length = 0; };

  function allowedDofs(lockRotation, lockPosition) {
    if (!lockRotation && !lockPosition) return J.EAllowedDOFs_All;
    const axes = (v) => (v === true ? { x: true, y: true, z: true } : v || {});
    const r = axes(lockRotation), t = axes(lockPosition);
    let f = 0;
    if (!t.x) f |= J.EAllowedDOFs_TranslationX;
    if (!t.y) f |= J.EAllowedDOFs_TranslationY;
    if (!t.z) f |= J.EAllowedDOFs_TranslationZ;
    if (!r.x) f |= J.EAllowedDOFs_RotationX;
    if (!r.y) f |= J.EAllowedDOFs_RotationY;
    if (!r.z) f |= J.EAllowedDOFs_RotationZ;
    return f;
  }

  function build(rec, pose, made = prepareShape(rec.def)) {
    const d = rec.def;
    const collider = d.collider;
    const { shape, temps } = made;
    const moving = collider !== 'static';
    const motion = collider === 'dynamic' ? J.EMotionType_Dynamic : collider === 'static' ? J.EMotionType_Static : J.EMotionType_Kinematic;
    const layer = collider === 'static' ? L_STATIC : collider === 'none' ? L_SENSOR : L_MOVING;
    const pos = new J.RVec3(pose.pos[0], pose.pos[1], pose.pos[2]);
    const rot = new J.Quat(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
    const cs = new J.BodyCreationSettings(shape, pos, rot, motion, layer);
    cs.set_mFriction(d.friction);
    cs.set_mRestitution(d.bounciness);
    cs.set_mUserData(rec.id);
    cs.set_mAllowSleeping(d.allowSleeping);
    cs.set_mLinearDamping(d.drag);
    cs.set_mAngularDamping(d.rotationDrag);
    cs.set_mGravityFactor(d.gravityScale);
    cs.set_mMaxLinearVelocity(d.maxSpeed ?? DEFAULT_MAX_SPEED);
    cs.set_mMaxAngularVelocity(d.maxSpin ?? DEFAULT_MAX_SPIN);
    if (d.superFast) cs.set_mMotionQuality(J.EMotionQuality_LinearCast);
    const cg = groupOf(d.group); cs.set_mCollisionGroup(cg); J.destroy(cg); // (a group name Jolt cannot take throws in setGroup, never here)
    if (collider === 'none') cs.set_mIsSensor(true);
    if (collider === 'none' || collider === 'kinematic') cs.set_mCollideKinematicVsNonDynamic(true); // so a glider's touch verbs see static walls and other gliders (no response: only reported)
    if (collider === 'dynamic') {
      cs.set_mAllowedDOFs(allowedDofs(d.lockRotation, d.lockPosition));
      const mp = new J.MassProperties();
      const volume = d.shape === 'hull' ? shape.GetVolume() : volumeOf(d.shape, d.w, d.h, d.d);
      mp.set_mMass(Math.max(d.mass ?? d.density * volume, 1e-4));
      cs.set_mOverrideMassProperties(J.EOverrideMassProperties_CalculateInertia);
      cs.set_mMassPropertiesOverride(mp);
      J.destroy(mp);
    }
    const body = bi.CreateBody(cs);
    J.destroy(cs); J.destroy(pos); J.destroy(rot);
    freeTemps(temps); // the body holds the shape now
    rec.body = body;
    rec.bodyId = body.GetID();
    rec.key = rec.bodyId.GetIndexAndSequenceNumber();
    rec.ptr = J.getPointer(body);
    bi.AddBody(rec.bodyId, moving ? J.EActivation_Activate : J.EActivation_DontActivate);
    byPtr.set(rec.ptr, rec);
    byKey.set(rec.key, rec);
  }

  function unbuild(rec) {
    byPtr.delete(rec.ptr);
    byKey.delete(rec.key);
    bi.RemoveBody(rec.bodyId);
    bi.DestroyBody(rec.bodyId);
    rec.body = null;
  }

  // ---- reading and writing a body ---------------------------------------------------
  const v3 = (v) => [v.GetX(), v.GetY(), v.GetZ()];
  function pose(rec) {
    const p = rec.body.GetPosition(), q = rec.body.GetRotation();
    return { pos: [p.GetX(), p.GetY(), p.GetZ()], quat: [q.GetX(), q.GetY(), q.GetZ(), q.GetW()] };
  }
  function withVec(a, fn) { const v = new J.Vec3(a[0], a[1], a[2]); try { return fn(v); } finally { J.destroy(v); } }
  function withRVec(a, fn) { const v = new J.RVec3(a[0], a[1], a[2]); try { return fn(v); } finally { J.destroy(v); } }
  /** A resting body that is touched by a change to ITSELF (friction, collision group) must notice: a static one wakes what rests on it. */
  const wakeFor = (rec) => { wakeAround(rec); if (rec.def.collider !== 'static') bi.ActivateBody(rec.bodyId); }; // whatever sleeps on it too (a platform's riders, the box on top of a stack)
  const wakeAll = () => { for (const rec of all) if (rec.def.collider !== 'static') bi.ActivateBody(rec.bodyId); };

  /** Sleepers do not notice that what they rest on has gone: wake everything in (and just around) the body's
   *  box BEFORE it is removed, rebuilt or moved (a box on a removed platform used to hang in the air). */
  function wakeAround(rec) {
    if (!rec.body || rec.def.collider === 'none') return;
    const b = rec.body.GetWorldSpaceBounds(), c = v3(b.GetCenter()), e = v3(b.GetExtent()), pad = 0.1; // copied out one at a time: they share a temporary
    const lo = new J.Vec3(c[0] - e[0] - pad, c[1] - e[1] - pad, c[2] - e[2] - pad);
    const hi = new J.Vec3(c[0] + e[0] + pad, c[1] + e[1] + pad, c[2] + e[2] + pad);
    const box = new J.AABox(lo, hi);
    bi.ActivateBodiesInAABox(box, wakeBp, wakeObj);
    J.destroy(box); J.destroy(lo); J.destroy(hi);
  }

  /** Reject what Jolt cannot build, in words, BEFORE anything is torn down; fills a hull's or
   *  triangle mesh's size from its points. */
  function checkDef(d) {
    if (d.shape === 'hull') {
      checkPoints('a hull', d.points, 4);
      if (isFlat(d.points)) throw new Error('a hull needs points that are not all on one flat plane (or line), or it has no inside; a flat thing is a thin box');
      [d.w, d.h, d.d] = boundsOf(d.points);
    }
    if (d.shape === 'triangles') {
      checkPoints('a triangle mesh', d.vertices, 3);
      if (!Array.isArray(d.triangles) || !d.triangles.length || d.triangles.some((t) => !Array.isArray(t) || t.length !== 3 || t.some((i) => !Number.isInteger(i) || i < 0 || i >= d.vertices.length))) {
        throw new Error('a triangle mesh needs triangles like [0, 1, 2], each number the position of a vertex in the list');
      }
      if (d.collider === 'dynamic') throw new Error("a triangle mesh cannot be 'dynamic' (it has no mass); make it 'static', or build the shape from a hull or from simple shapes");
      [d.w, d.h, d.d] = boundsOf(d.vertices);
    }
  }

  // kinematic bodies moved with moveTo: stopped again after the step they glide in
  const glide = new Map(); // record -> the spin it had before moveTo (a glide aims at a position, so the spin is put back after the step)

  // ---- joints ---------------------------------------------------------------------------
  // A joint remembers where it holds in each body's own terms, so it can be put back after a
  // body is rebuilt (resized, given a new collider) even if the bodies have moved since.
  const joints = new Set();
  const wakeJoint = (j) => { for (const r of [j.a, j.b]) if (r.def.collider !== 'static') bi.ActivateBody(r.bodyId); };
  function dropConstraint(j) { if (j.constraint) { system.RemoveConstraint(j.constraint); j.constraint = null; } }
  function buildJoint(j) {
    // Every joint remembers the frame it was made in on EACH body (its own anchor, axes and normal, in that body's own
    // space). A body rebuilt for a new size or mass is joined again from those frames, so the pair is held exactly as
    // before: a hinge keeps its zero, a stretched ball or glue joint is still pulled back, a limit tightened past where a
    // door has swung still pulls it round. (Re-joining from where the bodies happen to be forgot all of that.)
    const pa = pose(j.a), pb = pose(j.b), s = j.spec, la = j.local, lb = j.local.b;
    const at = (p, l) => add3(p.pos, qrot(p.quat, l.anchor));
    const temps = [];
    const R = (v) => { const o = new J.RVec3(v[0], v[1], v[2]); temps.push(o); return o; }, V = (v) => { const o = new J.Vec3(v[0], v[1], v[2]); temps.push(o); return o; };
    let st;
    switch (j.kind) {
      case 'hinge': {
        st = new J.HingeConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mPoint1(R(at(pa, la))); st.set_mPoint2(R(at(pb, lb)));
        st.set_mHingeAxis1(V(qrot(pa.quat, la.axis))); st.set_mHingeAxis2(V(qrot(pb.quat, lb.axis)));
        st.set_mNormalAxis1(V(qrot(pa.quat, la.normal))); st.set_mNormalAxis2(V(qrot(pb.quat, lb.normal)));
        if (s.lower != null) st.set_mLimitsMin(Math.max(-Math.PI, Math.min(0, s.lower)));
        if (s.upper != null) st.set_mLimitsMax(Math.min(Math.PI, Math.max(0, s.upper)));
        st.set_mMaxFrictionTorque(s.friction ?? 0);
        break;
      }
      case 'ball': {
        st = new J.PointConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mPoint1(R(at(pa, la))); st.set_mPoint2(R(at(pb, lb)));
        break;
      }
      case 'glue': {
        st = new J.FixedConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mAutoDetectPoint(false);
        st.set_mPoint1(R(at(pa, la))); st.set_mPoint2(R(at(pb, lb)));
        st.set_mAxisX1(V(qrot(pa.quat, la.axis))); st.set_mAxisY1(V(qrot(pa.quat, la.normal)));
        st.set_mAxisX2(V(qrot(pb.quat, lb.axis))); st.set_mAxisY2(V(qrot(pb.quat, lb.normal)));
        break;
      }
      case 'slider': {
        st = new J.SliderConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mAutoDetectPoint(false);
        st.set_mPoint1(R(at(pa, la))); st.set_mPoint2(R(at(pb, lb)));
        st.set_mSliderAxis1(V(qrot(pa.quat, la.axis))); st.set_mSliderAxis2(V(qrot(pb.quat, lb.axis)));
        st.set_mNormalAxis1(V(qrot(pa.quat, la.normal))); st.set_mNormalAxis2(V(qrot(pb.quat, lb.normal)));
        if (s.lower != null) st.set_mLimitsMin(Math.min(0, s.lower));
        if (s.upper != null) st.set_mLimitsMax(Math.max(0, s.upper));
        break;
      }
      case 'distance': {
        st = new J.DistanceConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mPoint1(R(pa.pos)); st.set_mPoint2(R(pb.pos));
        st.set_mMinDistance(s.min); st.set_mMaxDistance(s.max);
        if (s.spring) { const ss = st.get_mLimitsSpringSettings(); ss.set_mFrequency(s.spring.hz); ss.set_mDamping(s.spring.damping); }
        break;
      }
    }
    j.constraint = st.Create(j.a.body, j.b.body);
    system.AddConstraint(j.constraint);
    J.destroy(st);
    for (const o of temps) J.destroy(o);
  }

  const world = {
    /** Make a body. `def` fields: shape, w, h, d, collider, friction, bounciness, density,
     *  mass (optional override), lockRotation, pos [x,y,z], quat [x,y,z,w], vel, angVel, userData. */
    createBody(def) {
      if (!SHAPES.includes(def.shape)) throw new Error(`unknown shape '${def.shape}'`);
      if (!COLLIDERS.includes(def.collider)) throw new Error(`unknown collider '${def.collider}'`);
      const d = {
        shape: def.shape, w: def.w ?? 1, h: def.h ?? 1, d: def.d ?? 1, collider: def.collider,
        friction: def.friction ?? 0, bounciness: def.bounciness ?? 0, density: def.density ?? 1,
        mass: def.mass ?? null, lockRotation: def.lockRotation ?? false, lockPosition: def.lockPosition ?? false,
        drag: def.drag ?? 0.05, rotationDrag: def.rotationDrag ?? 0.05, gravityScale: def.gravityScale ?? 1,
        superFast: !!def.superFast, maxSpeed: def.maxSpeed ?? null, maxSpin: def.maxSpin ?? null,
        allowSleeping: def.allowSleeping ?? true, group: def.group ?? null,
        points: def.points ?? null, vertices: def.vertices ?? null, triangles: def.triangles ?? null };
      checkDef(d);
      const rec = { id: nextId++, alive: true, userData: def.userData, joints: new Set(), def: d };
      build(rec, { pos: def.pos ?? [0, 0, 0], quat: def.quat ?? [0, 0, 0, 1] });
      all.add(rec);
      if (d.collider === 'static' || d.collider === 'kinematic') wakeAround(rec); // a wall built through a sleeper must push it
      if (def.vel) world.setVelocity(rec, def.vel);
      if (def.angVel) world.setAngularVelocity(rec, def.angVel);
      return rec;
    },
    removeBody(rec) {
      if (!rec.alive) return;
      wakeAround(rec);
      rec.last = { pose: pose(rec), vel: world.getVelocity(rec), ang: world.getAngularVelocity(rec), com: world.centerOfMass(rec) }; // what a removed record still answers
      for (const j of [...rec.joints]) world.removeJoint(j);
      glide.delete(rec);
      unbuild(rec);
      rec.alive = false;
      all.delete(rec);
    },
    /** Change what a body is made of (size, shape, collider, mass...) keeping its pose and speed.
     *  Joints are taken off for the swap and put back where they were. */
    rebuild(rec, patch) {
      const next = { ...rec.def, ...patch };
      checkDef(next); // also fills in a hull's or mesh's size from its points
      const made = prepareShape(next); // throws here if Jolt cannot make it: nothing has been torn down yet
      const before = { ...rec.def };
      wakeAround(rec); // it may be smaller or gone from where it was: what rests on it must notice
      const p = pose(rec), vel = world.getVelocity(rec), ang = world.getAngularVelocity(rec);
      const queued = before.collider === 'dynamic' ? { f: v3(rec.body.GetAccumulatedForce()), t: v3(rec.body.GetAccumulatedTorque()) } : null; // a push applied this frame and not yet stepped
      const js = [...rec.joints];
      for (const j of js) dropConstraint(j);
      unbuild(rec);
      try {
        Object.assign(rec.def, patch, { w: next.w, h: next.h, d: next.d });
        build(rec, p, made);
      } catch (e) { // never leave a live Solid without a body: put the old one back
        freeTemps(made.temps);
        Object.assign(rec.def, before);
        build(rec, p);
        for (const j of js) buildJoint(j);
        throw e;
      }
      for (const j of js) buildJoint(j);
      // a body that stops being kinematic keeps the speed it had (a platform that drops when stepped on keeps moving), but the
      // glide bookkeeping goes: the step must not zero a dynamic body's velocity
      if (rec.def.collider !== 'kinematic' && rec.def.collider !== 'none') glide.delete(rec);
      world.setVelocity(rec, vel);
      world.setAngularVelocity(rec, ang);
      if (queued && rec.def.collider === 'dynamic') { // copy each out before the next call: they share a temporary
        if (queued.f.some((v) => v)) world.addForce(rec, queued.f);
        if (queued.t.some((v) => v)) world.addTorque(rec, queued.t);
      }
      wakeAround(rec); // it may have grown into something asleep
    },
    /** Live material changes: no rebuild, so a sketch may set these every frame. */
    setFriction(rec, f) { const changed = rec.def.friction !== f; rec.def.friction = f; bi.SetFriction(rec.bodyId, f); if (changed) wakeFor(rec); }, // only a CHANGE wakes (a sketch may set it every frame); a box asleep on an ice-ed ramp must start to slide
    setBounciness(rec, r) { rec.def.bounciness = r; bi.SetRestitution(rec.bodyId, r); },
    /** Slows it down like air does; per second. Static bodies have nothing to slow. */
    setDrag(rec, v) { rec.def.drag = v; if (rec.def.collider !== 'static') rec.body.GetMotionProperties().SetLinearDamping(v); },
    setRotationDrag(rec, v) { rec.def.rotationDrag = v; if (rec.def.collider !== 'static') rec.body.GetMotionProperties().SetAngularDamping(v); },
    /** 1 = normal, 0 = weightless, -1 = falls up. */
    setGravityScale(rec, v) { rec.def.gravityScale = v; if (rec.def.collider !== 'static') { bi.SetGravityFactor(rec.bodyId, v); bi.ActivateBody(rec.bodyId); } },
    /** Continuous collision: moves in sweeps so a fast thing cannot jump through a thin wall. */
    setSuperFast(rec, on) {
      rec.def.superFast = !!on;
      if (rec.def.collider !== 'static') bi.SetMotionQuality(rec.bodyId, on ? J.EMotionQuality_LinearCast : J.EMotionQuality_Discrete);
    },
    /** Speed limits in m/s and rad/s; null lifts a limit back to Jolt's own. */
    setMaxSpeed(rec, v) { rec.def.maxSpeed = v; if (rec.def.collider !== 'static') bi.SetMaxLinearVelocity(rec.bodyId, v ?? DEFAULT_MAX_SPEED); },
    setMaxSpin(rec, v) { rec.def.maxSpin = v; if (rec.def.collider !== 'static') bi.SetMaxAngularVelocity(rec.bodyId, v ?? DEFAULT_MAX_SPIN); },
    setAllowSleeping(rec, on) { rec.def.allowSleeping = !!on; if (rec.def.collider === 'static') return; /* a static body has no motion properties to write */ rec.body.SetAllowSleeping(!!on); if (!on && rec.def.collider !== 'static') bi.ActivateBody(rec.bodyId); },
    /** Which named collision group it is in (null = none). */
    setGroup(rec, name) {
      const cg = groupOf(name ?? null); // throws for a 33rd name: the body keeps the group it had
      const changed = rec.def.group !== (name ?? null);
      rec.def.group = name ?? null;
      bi.SetCollisionGroup(rec.bodyId, cg); J.destroy(cg);
      if (changed) wakeFor(rec); // a sleeper that now passes through what it rests on must fall
    },
    /** Bodies in these two groups pass through each other. One name: members of that group
     *  pass through each other. */
    ignoreCollisions(a, b = a) { ignored.add(pairKey(groupIndex(a), groupIndex(b))); wakeAll(); },
    restoreCollisions(a, b = a) { ignored.delete(pairKey(groupIndex(a), groupIndex(b))); wakeAll(); },
    get allowSleeping() { return system.GetPhysicsSettings().get_mAllowSleeping(); },
    set allowSleeping(on) {
      const s = system.GetPhysicsSettings();
      s.set_mAllowSleeping(!!on);
      system.SetPhysicsSettings(s);
      if (!on) for (const rec of all) if (rec.def.collider === 'dynamic') bi.ActivateBody(rec.bodyId);
    },
    getPose: pose,
    /** `teleport`: the sketch wrote a POSITION (even the one it already has), so a glide queued by moveTo() the same frame is dropped. */
    setPose(rec, pos, quat, teleport = false) {
      wakeAround(rec); // whatever rests where it WAS must notice
      for (const j of rec.joints) wakeJoint(j); // and what hangs from it (a hook moved away from a sleeping weight)
      if (teleport && glide.has(rec)) { world.setVelocity(rec, [0, 0, 0]); world.setAngularVelocity(rec, [0, 0, 0]); glide.delete(rec); }
      const p = new J.RVec3(pos[0], pos[1], pos[2]), q = new J.Quat(quat[0], quat[1], quat[2], quat[3]);
      bi.SetPositionAndRotation(rec.bodyId, p, q, rec.def.collider === 'static' ? J.EActivation_DontActivate : J.EActivation_Activate);
      J.destroy(p); J.destroy(q);
      wakeAround(rec); // and whatever it now lands in or against (a wall moved into a sleeper must push it)
    },
    getVelocity: (rec) => v3(bi.GetLinearVelocity(rec.bodyId)),
    setVelocity(rec, v) { if (rec.def.collider !== 'static') withVec(v, (x) => bi.SetLinearVelocity(rec.bodyId, x)); },
    getAngularVelocity: (rec) => v3(bi.GetAngularVelocity(rec.bodyId)),
    setAngularVelocity(rec, v) { if (rec.def.collider !== 'static') withVec(v, (x) => bi.SetAngularVelocity(rec.bodyId, x)); },
    addForce(rec, f) { withVec(f, (x) => bi.AddForce(rec.bodyId, x)); },
    addImpulse(rec, i) { withVec(i, (x) => bi.AddImpulse(rec.bodyId, x)); },
    addTorque(rec, t) { withVec(t, (x) => bi.AddTorque(rec.bodyId, x)); },
    /** A force or impulse applied at a point in the world, so an off-centre push also spins it. */
    addForceAt(rec, f, at) { withVec(f, (x) => withRVec(at, (p) => bi.AddForce(rec.bodyId, x, p, J.EActivation_Activate))); },
    addImpulseAt(rec, i, at) { withVec(i, (x) => withRVec(at, (p) => bi.AddImpulse(rec.bodyId, x, p))); },
    addAngularImpulse(rec, a) { withVec(a, (x) => bi.AddAngularImpulse(rec.bodyId, x)); },
    /** Glide a kinematic body (or a sensor) to a pose during the next step, pushing and carrying
     *  whatever touches it; it stops there. Moving it by setPose instead is a teleport. */
    moveKinematic(rec, pos, quat) {
      if (rec.def.collider !== 'kinematic' && rec.def.collider !== 'none') throw new Error("moveTo is for 'kinematic' bodies (a 'dynamic' one is moved by forces and velocity, a 'static' one never moves)");
      const ang = world.getAngularVelocity(rec);
      let q = quat ?? pose(rec).quat;
      const spin = Math.hypot(...ang);
      if (!quat && spin > 1e-9) { // a solid that is turning keeps turning while it glides: aim at the rotation it will have after this step
        const half = (spin * FIXED_DT) / 2, k = Math.sin(half) / spin;
        q = qmul([ang[0] * k, ang[1] * k, ang[2] * k, Math.cos(half)], q);
      }
      const p = new J.RVec3(pos[0], pos[1], pos[2]), r = new J.Quat(q[0], q[1], q[2], q[3]);
      bi.MoveKinematic(rec.bodyId, p, r, FIXED_DT);
      J.destroy(p); J.destroy(r);
      glide.set(rec, ang);
    },
    centerOfMass: (rec) => v3(rec.body.GetCenterOfMassPosition()),
    /** The body's shape as triangles in its own space: a flat Float32Array, 9 numbers a triangle.
     *  The sketch layer draws a hull with this. */
    triangles(rec) {
      const shape = rec.body.GetShape();
      const one = new J.Vec3(1, 1, 1), com = shape.GetCenterOfMass(), q = new J.Quat(0, 0, 0, 1);
      const t = new J.ShapeGetTriangles(shape, shape.GetLocalBounds(), com, q, one);
      const out = new Float32Array(J.HEAPF32.buffer, t.GetVerticesData(), t.GetNumTriangles() * 9).slice();
      J.destroy(t); J.destroy(one); J.destroy(q);
      return out;
    },
    isAsleep: (rec) => rec.def.collider !== 'static' && !rec.body.IsActive(),

    /** Join two bodies. `spec`: { kind, a, b, anchor?, axis?, lower?, upper?, friction?, length?,
     *  rope?, spring? } in metres and radians, world space. Returns a joint record. */
    createJoint(spec) {
      const { kind, a, b } = spec;
      if (!JOINTS.includes(kind)) throw new Error(`unknown joint '${kind}'`);
      if (!a?.alive || !b?.alive) throw new Error('a joint needs two live bodies');
      if (a === b) throw new Error('a joint needs two different bodies');
      if (a.def.collider === 'static' && b.def.collider === 'static') throw new Error("a joint needs at least one body that can move: two 'static' bodies cannot be joined");
      const pa = pose(a), pb = pose(b);
      // an anchorless slider or glue joint holds at the body that can move (or halfway between two that can): an anchor on
      // a static base 3 m from the car would make a long lever for the solver, and the car stopped short of its limit
      const movableAt = a.def.collider === 'static' ? pb.pos : b.def.collider === 'static' ? pa.pos : [(pa.pos[0] + pb.pos[0]) / 2, (pa.pos[1] + pb.pos[1]) / 2, (pa.pos[2] + pb.pos[2]) / 2];
      const anchor = spec.anchor ?? (kind === 'slider' || kind === 'glue' ? movableAt : pa.pos);
      const axis = unit3(spec.axis ?? (kind === 'slider' ? [1, 0, 0] : [0, 1, 0]));
      const s = { lower: spec.lower ?? null, upper: spec.upper ?? null, friction: spec.friction ?? 0 };
      if (kind === 'hinge') {
        if (s.lower != null && (s.lower > 0 || s.lower < -Math.PI)) throw new Error('a hinge lowerLimit is counted from where it starts: between -180 and 0 degrees');
        if (s.upper != null && (s.upper < 0 || s.upper > Math.PI)) throw new Error('a hinge upperLimit is counted from where it starts: between 0 and 180 degrees');
      }
      if (kind === 'slider' && ((s.lower != null && s.lower > 0) || (s.upper != null && s.upper < 0))) throw new Error('a slider lowerLimit must be 0 or less and upperLimit 0 or more (counted from where it starts)');
      if (kind === 'distance') {
        const len = spec.length ?? Math.hypot(...sub3(pb.pos, pa.pos));
        if (!(len >= 0)) throw new Error('a distance joint length cannot be negative');
        s.rope = !!spec.rope; s.min = s.rope ? 0 : len; s.max = len;
        if (spec.spring) s.spring = { hz: spec.spring.hz ?? 2, damping: spec.spring.damping ?? 0.5 };
      }
      const j = { kind, a, b, alive: true, constraint: null, spec: s };
      const n = perpendicular(kind === 'glue' ? [1, 0, 0] : axis); // glue keeps the two bodies' world axes X and Y as they were
      const jaxis = kind === 'glue' ? [1, 0, 0] : axis, jnorm = kind === 'glue' ? [0, 1, 0] : n;
      const frameOf = (p) => ({ anchor: qrot(qinv(p.quat), sub3(anchor, p.pos)), axis: qrot(qinv(p.quat), jaxis), normal: qrot(qinv(p.quat), jnorm) });
      j.local = { ...frameOf(pa), b: frameOf(pb) };
      buildJoint(j);
      a.joints.add(j); b.joints.add(j); joints.add(j);
      wakeJoint(j); // two sleepers joined must start pulling on each other
      return j;
    },
    removeJoint(j) {
      if (!j.alive) return;
      wakeJoint(j); // what hung on it must fall (both bodies are still alive here: removeBody drops its joints first)
      dropConstraint(j);
      j.alive = false; j.a.joints.delete(j); j.b.joints.delete(j); joints.delete(j);
    },
    /** Hinge: radians from the start pose. Slider: metres from the start. null = no limit. */
    setJointLimits(j, lower, upper) {
      if (j.kind !== 'hinge' && j.kind !== 'slider') return;
      const hinge = j.kind === 'hinge';
      j.spec.lower = lower; j.spec.upper = upper;
      const lo = lower == null ? (hinge ? -Math.PI : -1e9) : Math.min(0, lower), hi = upper == null ? (hinge ? Math.PI : 1e9) : Math.max(0, upper);
      const c = J.castObject(j.constraint, hinge ? J.HingeConstraint : J.SliderConstraint);
      c.SetLimits(hinge ? Math.max(-Math.PI, lo) : lo, hinge ? Math.min(Math.PI, hi) : hi);
      wakeJoint(j);
    },
    setJointFriction(j, f) { j.spec.friction = f; if (j.kind === 'hinge') J.castObject(j.constraint, J.HingeConstraint).SetMaxFrictionTorque(f); wakeJoint(j); },
    setJointLength(j, len) {
      if (j.kind !== 'distance') return;
      j.spec.max = len; j.spec.min = j.spec.rope ? 0 : len;
      J.castObject(j.constraint, J.DistanceConstraint).SetDistance(j.spec.min, j.spec.max);
      wakeJoint(j);
    },
    /** Hinge angle in radians, slider position in metres, distance joints their current length. */
    jointValue(j) {
      if (j.kind === 'hinge') return J.castObject(j.constraint, J.HingeConstraint).GetCurrentAngle();
      if (j.kind === 'slider') return J.castObject(j.constraint, J.SliderConstraint).GetCurrentPosition();
      if (j.kind === 'distance') return Math.hypot(...sub3(pose(j.b).pos, pose(j.a).pos));
      return 0;
    },
    get jointCount() { return joints.size; },

    /** World tuning. Speeds are metres per second here. */
    get solverSteps() { return system.GetPhysicsSettings().get_mNumVelocitySteps(); },
    set solverSteps(n) { const s = system.GetPhysicsSettings(); s.set_mNumVelocitySteps(n); system.SetPhysicsSettings(s); },
    get sleepDelay() { return system.GetPhysicsSettings().get_mTimeBeforeSleep(); },
    set sleepDelay(t) { const s = system.GetPhysicsSettings(); s.set_mTimeBeforeSleep(t); system.SetPhysicsSettings(s); },
    get sleepSpeed() { return system.GetPhysicsSettings().get_mPointVelocitySleepThreshold(); },
    set sleepSpeed(v) { const s = system.GetPhysicsSettings(); s.set_mPointVelocitySleepThreshold(v); system.SetPhysicsSettings(s); },
    get minBounceSpeed() { return system.GetPhysicsSettings().get_mMinVelocityForRestitution(); },
    set minBounceSpeed(v) { const s = system.GetPhysicsSettings(); s.set_mMinVelocityForRestitution(v); system.SetPhysicsSettings(s); },
    /** Real mass in kg as Jolt has it (0 for static, kinematic and sensors). */
    massOf(rec) {
      if (rec.def.collider !== 'dynamic') return 0; // only dynamic bodies have a finite mass
      const lp = rec.def.lockPosition;
      if (lp === true || (lp && lp.x && lp.y && lp.z)) { // Jolt zeroes the inverse mass when no axis can move: say what it was built with
        const d = rec.def;
        return d.mass ?? d.density * (d.shape === 'hull' ? rec.body.GetShape().GetVolume() : volumeOf(d.shape, d.w, d.h, d.d));
      }
      const inv = rec.body.GetMotionProperties().GetInverseMass();
      return inv > 0 ? 1 / inv : 0;
    },
    isAwake: (rec) => rec.body.IsActive(),
    isAlive: (rec) => rec.alive,

    get gravity() { return [...gravityNow]; },
    set gravity(g) {
      gravityNow = [g[0], g[1], g[2]];
      setGravity(gravityNow);
      // Jolt does not wake sleeping bodies when gravity changes, so a ball that sat still
      // at gravity 0 would hang there after world.gravity.y = -10.
      for (const rec of all) if (rec.def.collider === 'dynamic') bi.ActivateBody(rec.bodyId);
    },

    /** Advance one fixed step and update the touch table. */
    step() {
      jolt.Step(FIXED_DT, 1);
      for (const [rec, ang] of glide) { if (rec.alive) { world.setVelocity(rec, [0, 0, 0]); world.setAngularVelocity(rec, ang); } }
      glide.clear();
      reconcile();
    },

    /** How two records touch right now, or null. `physical` is true when solid bodies
     *  touch; a sensor contact (collider 'none') is an overlap only. */
    touching(a, b) {
      const lo = a.id < b.id ? a : b, hi = lo === a ? b : a;
      const k = lo.id * KEY + hi.id;
      const t = touching.get(k);
      if (t) return { frames: t.frames, began: t.began, ended: false, physical: !t.sensor, hit: asSeenFrom(t.hit, a) };
      const e = endedPairs.get(k);
      return e ? { frames: 0, began: false, ended: true, physical: !e.sensor, hit: asSeenFrom(e.hit, a) } : null;
    },
    /** Every record `rec` touches right now. */
    touchingAll(rec) {
      const out = [];
      for (const t of touching.values()) {
        if (t.a === rec) out.push({ other: t.b, frames: t.frames, began: t.began, physical: !t.sensor });
        else if (t.b === rec) out.push({ other: t.a, frames: t.frames, began: t.began, physical: !t.sensor });
      }
      return out;
    },

    /** Closest SOLID body on the line from `from` to `to` ([x,y,z]); sensors are looked through. */
    rayCast(from, to, ignore, pick = false) {
      const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const o = new J.RVec3(from[0], from[1], from[2]), dv = new J.Vec3(dir[0], dir[1], dir[2]);
      const ray = new J.RRayCast(o, dv);
      closest.Reset();
      narrow.CastRay(ray, rayCfg, closest, pick ? pickBp : rayBp, pick ? pickObj : rayObj, filterFor(ignore), rayShape);
      J.destroy(ray); J.destroy(o); J.destroy(dv);
      if (!closest.HadHit()) return null;
      const hit = closest.get_mHit();
      return hitOf(from, dir, byKey.get(hit.get_mBodyID().GetIndexAndSequenceNumber()), hit.get_mFraction(), hit.get_mSubShapeID2().GetValue());
    },
    /** Every solid body along the line, nearest first. */
    rayCastAll(from, to, ignore, pick = false) { // pick: the mouse's ray, which also sees 'none' solids
      const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const hits = [];
      const col = new J.CastRayCollectorJS();
      col.OnBody = () => {};
      col.AddHit = (ptr) => {
        const r = J.wrapPointer(ptr, J.RayCastResult);
        hits.push({ key: r.get_mBodyID().GetIndexAndSequenceNumber(), f: r.get_mFraction(), sub: r.get_mSubShapeID2().GetValue() });
      };
      const o = new J.RVec3(from[0], from[1], from[2]), dv = new J.Vec3(dir[0], dir[1], dir[2]);
      const ray = new J.RRayCast(o, dv);
      narrow.CastRay(ray, rayCfg, col, pick ? pickBp : rayBp, pick ? pickObj : rayObj, filterFor(ignore), rayShape);
      J.destroy(ray); J.destroy(o); J.destroy(dv); J.destroy(col);
      hits.sort((a, b) => a.f - b.f);
      const seenBody = new Set(); // a torus or a closed mesh is crossed several times: the nearest hit per body
      return hits.filter((h) => !seenBody.has(h.key) && seenBody.add(h.key)).map((h) => hitOf(from, dir, byKey.get(h.key), h.f, h.sub)).filter(Boolean);
    },

    /** An instant outward push: `magnitude` is the speed given at the centre, fading to
     *  `falloff` of it at `radius`. Scaled by mass, so heavy things are pushed as fast as light ones. */
    explodeAt(center, radius, magnitude, falloff = 0) {
      for (const rec of all) {
        if (rec.def.collider !== 'dynamic') continue;
        const p = pose(rec).pos;
        const d = [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
        const dist = Math.hypot(d[0], d[1], d[2]);
        if (dist > radius) continue;
        const dir = dist < 1e-6 ? [0, 1, 0] : [d[0] / dist, d[1] / dist, d[2] / dist];
        const k = magnitude * (1 - (1 - falloff) * (dist / radius)) * world.massOf(rec);
        world.addImpulse(rec, [dir[0] * k, dir[1] * k, dir[2] * k]);
      }
    },

    get bodyCount() { return all.size; },
    bodies: () => all,
    dispose() {
      for (const rec of [...all]) world.removeBody(rec);
      for (const f of [rayBp, rayObj, pickBp, pickObj]) J.destroy(f);
      J.destroy(jolt);
      groupFilter.Release();
    },
  };

  // A removed Solid keeps its record, and its body id is a pointer into memory Jolt hands to the NEXT body, so a
  // push on a removed record moved some other body (measured). Every per-body call now does nothing for a
  // record that is gone, and the readers answer with what it was when it was removed.
  const DEAD_READ = {
    getPose: (r) => r.last.pose, getVelocity: (r) => r.last.vel, getAngularVelocity: (r) => r.last.ang, centerOfMass: (r) => r.last.com,
    isAwake: () => false, isAsleep: () => false, massOf: () => 0, triangles: () => new Float32Array(0),
  };
  const DEAD_WRITE = ['setPose', 'setVelocity', 'setAngularVelocity', 'addForce', 'addImpulse', 'addTorque', 'addForceAt', 'addImpulseAt',
    'addAngularImpulse', 'moveKinematic', 'setFriction', 'setBounciness', 'setDrag', 'setRotationDrag', 'setGravityScale', 'setSuperFast',
    'setMaxSpeed', 'setMaxSpin', 'setAllowSleeping', 'setGroup', 'rebuild'];
  for (const [name, dead] of Object.entries(DEAD_READ)) { const f = world[name]; world[name] = (rec, ...a) => (rec.alive ? f(rec, ...a) : dead(rec)); }
  for (const name of DEAD_WRITE) { const f = world[name]; world[name] = (rec, ...a) => (rec.alive ? f(rec, ...a) : undefined); }

  function hitOf(from, dir, rec, fraction, subValue) {
    if (!rec) return null;
    const point = [from[0] + dir[0] * fraction, from[1] + dir[1] * fraction, from[2] + dir[2] * fraction];
    const sid = new J.SubShapeID(); sid.SetValue(subValue);
    const pr = new J.RVec3(point[0], point[1], point[2]);
    const n = v3(rec.body.GetWorldSpaceSurfaceNormal(sid, pr));
    J.destroy(sid); J.destroy(pr);
    return { rec, point, normal: n, fraction };
  }

  return world;
}

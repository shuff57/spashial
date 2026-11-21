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

const L_STATIC = 0, L_MOVING = 1, L_SENSOR = 2, L_QUERY = 3;
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
  const pairs = new J.ObjectLayerPairFilterTable(4);
  pairs.EnableCollision(L_STATIC, L_MOVING);
  pairs.EnableCollision(L_MOVING, L_MOVING);
  pairs.EnableCollision(L_SENSOR, L_MOVING);
  pairs.EnableCollision(L_SENSOR, L_STATIC);
  pairs.EnableCollision(L_QUERY, L_STATIC); // rays see solid things only:
  pairs.EnableCollision(L_QUERY, L_MOVING); // never a sensor
  const bpi = new J.BroadPhaseLayerInterfaceTable(4, 2);
  bpi.MapObjectToBroadPhaseLayer(L_STATIC, new J.BroadPhaseLayer(0));
  for (const l of [L_MOVING, L_SENSOR, L_QUERY]) bpi.MapObjectToBroadPhaseLayer(l, new J.BroadPhaseLayer(1));
  settings.mObjectLayerPairFilter = pairs;
  settings.mBroadPhaseLayerInterface = bpi;
  settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, pairs, 4);
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
  groupFilter.CanCollide = (p1, p2) => !ignored.has(pairKey(
    J.wrapPointer(p1, J.CollisionGroup).GetSubGroupID(), J.wrapPointer(p2, J.CollisionGroup).GetSubGroupID()));
  const groupOf = (name) => (name == null ? new J.CollisionGroup() : new J.CollisionGroup(groupFilter, 0, groupIndex(name)));

  const setGravity = (g) => { const v = new J.Vec3(g[0], g[1], g[2]); system.SetGravity(v); J.destroy(v); };
  setGravity(gravity);
  let gravityNow = [...gravity];

  // ray query filters and a reusable collector
  const rayBp = new J.DefaultBroadPhaseLayerFilter(jolt.GetObjectVsBroadPhaseLayerFilter(), L_QUERY);
  const rayObj = new J.DefaultObjectLayerFilter(jolt.GetObjectLayerPairFilter(), L_QUERY);
  const rayBody = new J.BodyFilter();
  const rayShape = new J.ShapeFilter();
  const rayCfg = new J.RayCastSettings();
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
  const note = (p1, p2) => {
    const a = byPtr.get(p1), b = byPtr.get(p2);
    if (!a || !b) return;
    const lo = a.id < b.id ? a : b, hi = lo === a ? b : a;
    const k = lo.id * KEY + hi.id;
    if (!seen.has(k)) seen.set(k, { a: lo, b: hi, sensor: a.def.collider === 'none' || b.def.collider === 'none' });
  };
  const listener = new J.ContactListenerJS();
  listener.OnContactValidate = () => J.ValidateResult_AcceptAllContactsForThisBodyPair;
  listener.OnContactAdded = (p1, p2) => note(p1, p2);
  listener.OnContactPersisted = (p1, p2) => note(p1, p2);
  listener.OnContactRemoved = () => {};
  system.SetContactListener(listener);

  function reconcile() {
    const next = new Map();
    for (const [k, c] of seen) {
      const prev = touching.get(k);
      next.set(k, { a: c.a, b: c.b, sensor: c.sensor, frames: prev ? prev.frames + 1 : 1, began: !prev });
    }
    const ended = new Map();
    for (const [k, p] of touching) {
      if (seen.has(k)) continue;
      const bothAsleep = p.a.alive && p.b.alive && !p.a.body.IsActive() && !p.b.body.IsActive();
      if (bothAsleep) next.set(k, { ...p, frames: p.frames + 1, began: false });
      else ended.set(k, p);
    }
    touching = next;
    endedPairs = ended;
    seen = new Map();
  }

  // ---- building a body ---------------------------------------------------------------
  function makeShape(def) {
    const { shape, w, h, d } = def;
    const r = w / 2;
    switch (shape) {
      case 'hull': {
        const s = new J.ConvexHullShapeSettings();
        for (const p of def.points) { const v = new J.Vec3(p[0], p[1], p[2]); s.mPoints.push_back(v); J.destroy(v); }
        const res = s.Create();
        if (!res.IsValid()) throw new Error('hull: ' + res.GetError().c_str() + ' (give at least 4 points that are not all on one flat plane)');
        return res.Get();
      }
      case 'triangles': {
        const s = new J.MeshShapeSettings();
        for (const p of def.vertices) { const v = new J.Float3(p[0], p[1], p[2]); s.mTriangleVertices.push_back(v); J.destroy(v); }
        // Jolt only collides with and rays against a triangle's FRONT face (corners counter-clockwise
        // as seen), so a shape wound the other way looks solid (it is drawn double-sided) and lets
        // everything through, and a beginner cannot see the winding. Each triangle goes in both ways
        // round, so winding never matters. Costs twice the triangles.
        for (const t of def.triangles) {
          for (const order of [[t[0], t[1], t[2]], [t[0], t[2], t[1]]]) {
            const tri = new J.IndexedTriangle(order[0], order[1], order[2], 0); s.mIndexedTriangles.push_back(tri); J.destroy(tri);
          }
        }
        s.Sanitize();
        const res = s.Create();
        if (!res.IsValid()) throw new Error('triangle mesh: ' + res.GetError().c_str());
        return res.Get();
      }
      case 'box': return new J.BoxShape(new J.Vec3(w / 2, h / 2, d / 2), Math.min(0.05, w / 4, h / 4, d / 4), null);
      case 'sphere': return new J.SphereShape(r);
      case 'cylinder': return new J.CylinderShape(h / 2, r, Math.min(0.05, r / 2, h / 4));
      case 'capsule': return new J.CapsuleShape(Math.max(h - w, 0) / 2, r);
      case 'cone': { // a tapered cylinder with a point on top; it needs a convex radius of 0
        const s = new J.TaperedCylinderShapeSettings(h / 2, 0, r, 0);
        const res = s.Create();
        if (!res.IsValid()) throw new Error('cone: ' + res.GetError().c_str());
        return res.Get();
      }
      case 'torus': {
        const tube = h / 2, ring = (w - h) / 2;
        const cs = new J.StaticCompoundShapeSettings();
        const half = ring * Math.sin(Math.PI / TORUS_SEGMENTS); // half a chord: the capsule's straight part
        for (let i = 0; i < TORUS_SEGMENTS; i++) {
          const t = (i / TORUS_SEGMENTS) * 2 * Math.PI;
          const q = qmul(qy(-t), qx(Math.PI / 2)); // lay a Y-axis capsule along the ring's tangent
          cs.AddShapeShape(new J.Vec3(ring * Math.cos(t), 0, ring * Math.sin(t)), new J.Quat(q[0], q[1], q[2], q[3]), new J.CapsuleShape(half, tube), 0);
        }
        const res = cs.Create();
        if (!res.IsValid()) throw new Error('torus: ' + res.GetError().c_str());
        return res.Get();
      }
      default: throw new Error(`unknown shape '${shape}'`);
    }
  }

  function allowedDofs(lock) {
    if (!lock) return J.EAllowedDOFs_All;
    const l = lock === true ? { x: true, y: true, z: true } : lock;
    let f = J.EAllowedDOFs_TranslationX | J.EAllowedDOFs_TranslationY | J.EAllowedDOFs_TranslationZ;
    if (!l.x) f |= J.EAllowedDOFs_RotationX;
    if (!l.y) f |= J.EAllowedDOFs_RotationY;
    if (!l.z) f |= J.EAllowedDOFs_RotationZ;
    return f;
  }

  function build(rec, pose) {
    const d = rec.def;
    const collider = d.collider;
    const shape = makeShape(d);
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
    const cg = groupOf(d.group); cs.set_mCollisionGroup(cg); J.destroy(cg);
    if (collider === 'none') { cs.set_mIsSensor(true); cs.set_mCollideKinematicVsNonDynamic(true); }
    if (collider === 'dynamic') {
      cs.set_mAllowedDOFs(allowedDofs(d.lockRotation));
      const mp = new J.MassProperties();
      const volume = d.shape === 'hull' ? shape.GetVolume() : volumeOf(d.shape, d.w, d.h, d.d);
      mp.set_mMass(Math.max(d.mass ?? d.density * volume, 1e-4));
      cs.set_mOverrideMassProperties(J.EOverrideMassProperties_CalculateInertia);
      cs.set_mMassPropertiesOverride(mp);
      J.destroy(mp);
    }
    const body = bi.CreateBody(cs);
    J.destroy(cs); J.destroy(pos); J.destroy(rot);
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
  const wakeAll = () => { for (const rec of all) if (rec.def.collider !== 'static') bi.ActivateBody(rec.bodyId); };

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
  const glide = new Set();

  // ---- joints ---------------------------------------------------------------------------
  // A joint remembers where it holds in each body's own terms, so it can be put back after a
  // body is rebuilt (resized, given a new collider) even if the bodies have moved since.
  const joints = new Set();
  const wakeJoint = (j) => { for (const r of [j.a, j.b]) if (r.def.collider !== 'static') bi.ActivateBody(r.bodyId); };
  function dropConstraint(j) { if (j.constraint) { system.RemoveConstraint(j.constraint); j.constraint = null; } }
  function buildJoint(j) {
    const pa = pose(j.a), s = j.spec;
    const anchor = add3(pa.pos, qrot(pa.quat, j.local.anchor));
    const axis = qrot(pa.quat, j.local.axis);
    const R = (v) => new J.RVec3(v[0], v[1], v[2]), V = (v) => new J.Vec3(v[0], v[1], v[2]);
    let st;
    switch (j.kind) {
      case 'hinge': {
        st = new J.HingeConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mPoint1(R(anchor)); st.set_mPoint2(R(anchor));
        const n = perpendicular(axis);
        st.set_mHingeAxis1(V(axis)); st.set_mHingeAxis2(V(axis));
        st.set_mNormalAxis1(V(n)); st.set_mNormalAxis2(V(n));
        if (s.lower != null) st.set_mLimitsMin(s.lower);
        if (s.upper != null) st.set_mLimitsMax(s.upper);
        st.set_mMaxFrictionTorque(s.friction ?? 0);
        break;
      }
      case 'ball': {
        st = new J.PointConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mPoint1(R(anchor)); st.set_mPoint2(R(anchor));
        break;
      }
      case 'glue': {
        st = new J.FixedConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mAutoDetectPoint(true);
        break;
      }
      case 'slider': {
        st = new J.SliderConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mAutoDetectPoint(true);
        const n = perpendicular(axis);
        st.set_mSliderAxis1(V(axis)); st.set_mSliderAxis2(V(axis));
        st.set_mNormalAxis1(V(n)); st.set_mNormalAxis2(V(n));
        if (s.lower != null) st.set_mLimitsMin(s.lower);
        if (s.upper != null) st.set_mLimitsMax(s.upper);
        break;
      }
      case 'distance': {
        st = new J.DistanceConstraintSettings();
        st.set_mSpace(J.EConstraintSpace_WorldSpace);
        st.set_mPoint1(R(pa.pos)); st.set_mPoint2(R(pose(j.b).pos));
        st.set_mMinDistance(s.min); st.set_mMaxDistance(s.max);
        if (s.spring) { const ss = st.get_mLimitsSpringSettings(); ss.set_mFrequency(s.spring.hz); ss.set_mDamping(s.spring.damping); }
        break;
      }
    }
    j.constraint = st.Create(j.a.body, j.b.body);
    system.AddConstraint(j.constraint);
    J.destroy(st);
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
        mass: def.mass ?? null, lockRotation: def.lockRotation ?? false,
        drag: def.drag ?? 0.05, rotationDrag: def.rotationDrag ?? 0.05, gravityScale: def.gravityScale ?? 1,
        superFast: !!def.superFast, maxSpeed: def.maxSpeed ?? null, maxSpin: def.maxSpin ?? null,
        allowSleeping: def.allowSleeping ?? true, group: def.group ?? null,
        points: def.points ?? null, vertices: def.vertices ?? null, triangles: def.triangles ?? null };
      checkDef(d);
      const rec = { id: nextId++, alive: true, userData: def.userData, joints: new Set(), def: d };
      build(rec, { pos: def.pos ?? [0, 0, 0], quat: def.quat ?? [0, 0, 0, 1] });
      all.add(rec);
      if (def.vel) world.setVelocity(rec, def.vel);
      if (def.angVel) world.setAngularVelocity(rec, def.angVel);
      return rec;
    },
    removeBody(rec) {
      if (!rec.alive) return;
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
      checkDef(next); // also fills in a hull's or triangle mesh's size from its points
      const p = pose(rec), vel = world.getVelocity(rec), ang = world.getAngularVelocity(rec);
      const js = [...rec.joints];
      for (const j of js) dropConstraint(j);
      unbuild(rec);
      Object.assign(rec.def, patch, { w: next.w, h: next.h, d: next.d });
      build(rec, p);
      for (const j of js) buildJoint(j);
      world.setVelocity(rec, vel);
      world.setAngularVelocity(rec, ang);
    },
    /** Live material changes: no rebuild, so a sketch may set these every frame. */
    setFriction(rec, f) { rec.def.friction = f; bi.SetFriction(rec.bodyId, f); },
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
    setAllowSleeping(rec, on) { rec.def.allowSleeping = !!on; rec.body.SetAllowSleeping(!!on); if (!on && rec.def.collider !== 'static') bi.ActivateBody(rec.bodyId); },
    /** Which named collision group it is in (null = none). */
    setGroup(rec, name) {
      rec.def.group = name ?? null;
      const cg = groupOf(rec.def.group); bi.SetCollisionGroup(rec.bodyId, cg); J.destroy(cg);
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
    setPose(rec, pos, quat) {
      const p = new J.RVec3(pos[0], pos[1], pos[2]), q = new J.Quat(quat[0], quat[1], quat[2], quat[3]);
      bi.SetPositionAndRotation(rec.bodyId, p, q, rec.def.collider === 'static' ? J.EActivation_DontActivate : J.EActivation_Activate);
      J.destroy(p); J.destroy(q);
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
      const q = quat ?? pose(rec).quat;
      const p = new J.RVec3(pos[0], pos[1], pos[2]), r = new J.Quat(q[0], q[1], q[2], q[3]);
      bi.MoveKinematic(rec.bodyId, p, r, FIXED_DT);
      J.destroy(p); J.destroy(r);
      glide.add(rec);
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
      const anchor = spec.anchor ?? pa.pos;
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
      const j = { kind, a, b, alive: true, constraint: null, spec: s,
        local: { anchor: qrot(qinv(pa.quat), sub3(anchor, pa.pos)), axis: qrot(qinv(pa.quat), axis) } };
      buildJoint(j);
      a.joints.add(j); b.joints.add(j); joints.add(j);
      return j;
    },
    removeJoint(j) {
      if (!j.alive) return;
      dropConstraint(j);
      j.alive = false; j.a.joints.delete(j); j.b.joints.delete(j); joints.delete(j);
    },
    /** Hinge: radians from the start pose. Slider: metres from the start. null = no limit. */
    setJointLimits(j, lower, upper) {
      if (j.kind !== 'hinge' && j.kind !== 'slider') return;
      const lo = lower ?? (j.kind === 'hinge' ? -Math.PI : -1e9), hi = upper ?? (j.kind === 'hinge' ? Math.PI : 1e9);
      j.spec.lower = lower; j.spec.upper = upper;
      const c = J.castObject(j.constraint, j.kind === 'hinge' ? J.HingeConstraint : J.SliderConstraint);
      c.SetLimits(lo, hi);
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
      for (const rec of glide) { if (rec.alive) { world.setVelocity(rec, [0, 0, 0]); world.setAngularVelocity(rec, [0, 0, 0]); } }
      glide.clear();
      reconcile();
    },

    /** How two records touch right now, or null. `physical` is true when solid bodies
     *  touch; a sensor contact (collider 'none') is an overlap only. */
    touching(a, b) {
      const lo = a.id < b.id ? a : b, hi = lo === a ? b : a;
      const k = lo.id * KEY + hi.id;
      const t = touching.get(k);
      if (t) return { frames: t.frames, began: t.began, ended: false, physical: !t.sensor };
      const e = endedPairs.get(k);
      return e ? { frames: 0, began: false, ended: true, physical: !e.sensor } : null;
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
    rayCast(from, to) {
      const dir = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const o = new J.RVec3(from[0], from[1], from[2]), dv = new J.Vec3(dir[0], dir[1], dir[2]);
      const ray = new J.RRayCast(o, dv);
      closest.Reset();
      narrow.CastRay(ray, rayCfg, closest, rayBp, rayObj, rayBody, rayShape);
      J.destroy(ray); J.destroy(o); J.destroy(dv);
      if (!closest.HadHit()) return null;
      const hit = closest.get_mHit();
      return hitOf(from, dir, byKey.get(hit.get_mBodyID().GetIndexAndSequenceNumber()), hit.get_mFraction(), hit.get_mSubShapeID2().GetValue());
    },
    /** Every solid body along the line, nearest first. */
    rayCastAll(from, to) {
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
      narrow.CastRay(ray, rayCfg, col, rayBp, rayObj, rayBody, rayShape);
      J.destroy(ray); J.destroy(o); J.destroy(dv); J.destroy(col);
      hits.sort((a, b) => a.f - b.f);
      return hits.map((h) => hitOf(from, dir, byKey.get(h.key), h.f, h.sub)).filter(Boolean);
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
      J.destroy(jolt);
    },
  };

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

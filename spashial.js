// spaSHial: the sketch-facing 3D engine (milestone 1). The API is plans/spashial/spashial.d.ts;
// physics is physics.js (Jolt), drawing is three.js on WebGL2. Loaded as an ES module by
// runner.html, which defines the globals below on `window` before the student's code runs.
//
// Frame order, like moSHion: update(step) -> physics step -> (per rendered frame) draw() ->
// render -> perf HUD -> drawTop(). Physics runs at a fixed 60 Hz whatever the screen does, and
// the picture is interpolated between steps so a 144 Hz monitor is smooth.
//
// Not built yet (named in the spec): textures, glTF models, joints, Tiles, the billboard
// `text` label, hull/triangle-mesh shapes, sounds, online. Setting an unknown property on a Solid does
// nothing special; it is not an error, as in moSHion.

import * as THREE from 'three';
import initJolt from './vendor/jolt/jolt-physics.wasm.js';
import { createPhysics, FIXED_DT, PRIMITIVES, COLLIDERS } from './physics.js';

const DEG = 180 / Math.PI, RAD = Math.PI / 180;
const S = { // engine state, one per page
  phys: null, scene: null, renderer: null, cam: null, hud: null, hudCtx: null,
  solids: new Set(), groups: new Set(), joints: new Set(), halted: false, tick: 0, frameMs: 16.7, lastDt: 16.7, frames: 0, hudRatio: 1, perf: false,
  renderScale: 1, qualityMode: 'auto', canvasSize: null,
};

// ---------------------------------------------------------------- vectors
function arr3(v, what = 'a position') {
  if (Array.isArray(v) && v.length >= 3) return [+v[0], +v[1], +v[2]];
  if (v && typeof v === 'object' && 'x' in v && 'y' in v) return [+v.x, +v.y, +(v.z ?? 0)];
  throw new TypeError(`${what} must be [x, y, z] or a vector with x, y and z`);
}
function num(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what} must be a number (got ${JSON.stringify(v)})`);
  return v;
}
const nonNeg = (v, what) => { if (num(v, what) < 0) throw new RangeError(`${what} cannot be below 0 (got ${v})`); return v; };
const unit = (v, what) => Math.max(0, Math.min(1, num(v, what))); // a number, held between 0 and 1
const posNum = (v, what) => { if (num(v, what) <= 0) throw new RangeError(`${what} must be above 0 (got ${v})`); return v; };
class Vector {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { if (typeof x === 'object') [x, y, z] = arr3(x); this.x = x; this.y = y ?? this.y; this.z = z ?? this.z; return this; }
  copy() { return new Vector(this.x, this.y, this.z); }
  add(v) { const a = typeof v === 'number' ? [v, v, v] : arr3(v); this.set(this.x + a[0], this.y + a[1], this.z + a[2]); return this; }
  sub(v) { const a = typeof v === 'number' ? [v, v, v] : arr3(v); this.set(this.x - a[0], this.y - a[1], this.z - a[2]); return this; }
  mult(n) { this.set(this.x * n, this.y * n, this.z * n); return this; }
  div(n) { return this.mult(1 / n); }
  mag() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const m = this.mag(); return m ? this.mult(1 / m) : this; }
  dist(v) { const a = arr3(v); return Math.hypot(this.x - a[0], this.y - a[1], this.z - a[2]); }
  dot(v) { const a = arr3(v); return this.x * a[0] + this.y * a[1] + this.z * a[2]; }
  cross(v) { const a = arr3(v); return new Vector(this.y * a[2] - this.z * a[1], this.z * a[0] - this.x * a[2], this.x * a[1] - this.y * a[0]); }
  toString() { return `[${this.x}, ${this.y}, ${this.z}]`; }
}
/** A vector that reads and writes somewhere else: `ball.pos.y += 1` moves the ball. */
class LiveVector extends Vector {
  constructor(get, set) {
    super(0, 0, 0);
    Object.defineProperty(this, '_write', { value: set });
    ['x', 'y', 'z'].forEach((k, i) => Object.defineProperty(this, k, {
      enumerable: true, configurable: true,
      get: () => get()[i],
      set: (v) => { const a = get(); a[i] = +v; set(a); },
    }));
  }
  /** One write for all three, so `pos.set(1, 2, 3)` moves a body once. */
  set(x, y, z) {
    const a = typeof x === 'object' ? arr3(x) : [x, y ?? this.y, z ?? this.z];
    this._write(a.map(Number));
    return this;
  }
  copy() { return new Vector(this.x, this.y, this.z); }
}
/** Give `proto` a property `name` that hands out a live vector and accepts [x,y,z] or a vector. */
function liveProperty(proto, name) {
  Object.defineProperty(proto, name, {
    get() { return this._live[name]; },
    set(v) { this._need(); this._live[name].set(arr3(v, name)); },
  });
}
const createVector = (x, y, z) => new Vector(x, y, z);

// ---------------------------------------------------------------- colours
const _c = new THREE.Color();
function parseColor(c) {
  if (typeof c === 'number') { const g = Math.max(0, Math.min(255, c)) / 255; return _c.setRGB(g, g, g, THREE.SRGBColorSpace).clone(); }
  try { return _c.set(String(c)).clone(); } catch { return new THREE.Color('#cccccc'); }
}

// ---------------------------------------------------------------- touch verbs
const asList = (o) => (Array.isArray(o) ? o : [o]);
function touchVerb(self, other, cb, answer) {
  let result = answer.zero;
  for (const o of asList(other)) {
    if (!o || o === self || !o._rec || !self._rec) continue;
    const t = S.phys.touching(self._rec, o._rec);
    const v = answer.of(t);
    if (answer.hit(v)) { if (cb) cb(self, o); result = answer.merge(result, v); }
  }
  return result;
}
const physical = (t) => !!(t && t.physical);
// `merge` combines the answers of several members: "did ANY say yes" for the yes/no verbs, the
// longest count for the counting ones. (It was once `() => true`, which made a Group answer yes
// whenever it was asked, whatever its members said.)
const anyOf = (a, b) => a || b;
const VERBS = {
  collides:    { zero: false, of: (t) => physical(t) && t.began, hit: (v) => v, merge: anyOf },
  colliding:   { zero: 0, of: (t) => (physical(t) ? t.frames : 0), hit: (v) => v > 0, merge: Math.max },
  collided:    { zero: false, of: (t) => physical(t) && t.ended, hit: (v) => v, merge: anyOf },
  overlaps:    { zero: false, of: (t) => !!t && !t.ended, hit: (v) => v, merge: anyOf },
  overlapping: { zero: 0, of: (t) => (t && !t.ended ? t.frames : 0), hit: (v) => v > 0, merge: Math.max },
  overlapped:  { zero: false, of: (t) => !!t && t.ended, hit: (v) => v, merge: anyOf },
};

// ---------------------------------------------------------------- Solid
const COLLIDER_ERR = (v) => new TypeError(`collider must be 'dynamic', 'static', 'kinematic' or 'none' (got ${JSON.stringify(v)})`);
function normCollider(v) {
  const s = String(v).toLowerCase();
  if (s.length === 1) { const m = { d: 'dynamic', s: 'static', k: 'kinematic', n: 'none' }[s]; if (m) return m; }
  if (COLLIDERS.includes(s)) return s;
  throw COLLIDER_ERR(v);
}
const ROUND = new Set(['sphere', 'cylinder', 'capsule', 'cone', 'torus']);
function fit(shape, w, h, d) { // round shapes have one width
  if (shape === 'sphere') return { w, h: w, d: w };
  if (ROUND.has(shape)) return { w, h, d: w };
  return { w, h, d };
}
const DEFAULT_SIZE = { // [w, h, d] multipliers for a single size argument
  box: [1, 1, 1], sphere: [1, 1, 1], cylinder: [1, 1, 1], capsule: [1, 2, 1], cone: [1, 1, 1], torus: [1, 0.35, 1],
};

let nextSolidId = 1;
class Solid {
  constructor(...args) {
    const shape = this.constructor.defaultShape ?? 'box';
    const nums = args.filter((a) => typeof a === 'number');
    const strs = args.filter((a) => typeof a === 'string');
    if (args.length !== nums.length + strs.length) throw new TypeError('new Solid() takes numbers, then an optional collider such as \'static\'');
    let pos, w, h, d;
    if (nums.length === 0) pos = [...S.camTarget];
    else if (nums.length === 3 || nums.length === 4 || nums.length === 6) {
      pos = nums.slice(0, 3);
      if (nums.length === 3) [w, h, d] = DEFAULT_SIZE[shape];
      else if (nums.length === 4) [w, h, d] = DEFAULT_SIZE[shape].map((m) => m * nums[3]);
      else [w, h, d] = nums.slice(3);
    } else throw new TypeError('new Solid() takes x, y, z, then an optional size or w, h, d');
    const size = fit(shape, w ?? 1, h ?? 1, d ?? 1);
    checkSize(shape, size);
    this._id = nextSolidId++;
    this._shape = shape;
    this._color = '#8be9fd';
    this._opacity = 1;
    this._visible = true;
    this._metal = 0;
    this._rough = 0.8;
    this._scale = new Vector(1, 1, 1);
    this._groups = new Set();
    this._removed = false;
    this._collider = strs.length ? normCollider(strs[0]) : 'dynamic';
    this._rec = S.phys.createBody({
      shape, ...size, collider: this._collider, pos, friction: 0.5, bounciness: 0, density: 1, userData: this,
    });
    this._cur = { p: [...pos], q: [0, 0, 0, 1] };
    this._prev = { p: [...pos], q: [0, 0, 0, 1] };
    this._buildMesh();
    this._live = {
      pos: new LiveVector(() => [...this._cur.p], (a) => this._moveTo(a)),
      vel: new LiveVector( // units per frame, like moSHion's pixels per frame
        () => S.phys.getVelocity(this._rec).map((v) => v / 60),
        (a) => S.phys.setVelocity(this._rec, a.map((v) => v * 60))),
      rotation: new LiveVector(() => this._euler(), (a) => this._turnTo(a)), // degrees
      angularVelocity: new LiveVector( // degrees per frame
        () => S.phys.getAngularVelocity(this._rec).map((v) => (v * DEG) / 60),
        (a) => S.phys.setAngularVelocity(this._rec, a.map((v) => v * RAD * 60))),
    };
    S.solids.add(this);
    allSolids.add(this);
  }

  // --- geometry and the three.js mesh
  _geometry() {
    const { w, h, d } = this._rec.def;
    switch (this._shape) {
      case 'box': return new THREE.BoxGeometry(w, h, d);
      case 'sphere': return new THREE.SphereGeometry(w / 2, 24, 16);
      case 'cylinder': return new THREE.CylinderGeometry(w / 2, w / 2, h, 24);
      case 'capsule': return new THREE.CapsuleGeometry(w / 2, Math.max(h - w, 0), 8, 20);
      case 'cone': return new THREE.ConeGeometry(w / 2, h, 24);
      case 'torus': { const g = new THREE.TorusGeometry((w - h) / 2, h / 2, 12, 32); g.rotateX(Math.PI / 2); return g; }
      case 'hull': { // drawn from the triangles Jolt built the hull out of, so what you see is what collides
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(S.phys.triangles(this._rec), 3));
        g.computeVertexNormals();
        return g;
      }
      case 'triangles': {
        const { vertices, triangles } = this._rec.def;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices.flat()), 3));
        g.setIndex(triangles.flat());
        const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals(); // flat shading, like the other shapes' edges
        return flat;
      }
      default: throw new Error(`unknown shape '${this._shape}'`);
    }
  }
  _buildMesh() {
    const geometry = this._geometry();
    if (this._mesh) { this._mesh.geometry.dispose(); this._mesh.geometry = geometry; }
    else {
      this._material = new THREE.MeshStandardMaterial({ color: this._color, metalness: this._metal, roughness: this._rough, side: this._shape === 'triangles' ? THREE.DoubleSide : THREE.FrontSide });
      this._mesh = new THREE.Mesh(geometry, this._material);
      this._mesh.castShadow = this._mesh.receiveShadow = true;
      S.scene.add(this._mesh);
    }
    this._syncVisual();
  }
  _syncVisual() {
    const m = this._mesh;
    m.scale.set(this._scale.x, this._scale.y, this._scale.z);
    m.visible = this._visible;
    this._material.opacity = this._opacity;
    this._material.transparent = this._opacity < 1;
    this._material.metalness = this._metal;
    this._material.roughness = this._rough;
    this._material.color.copy(parseColor(this._color));
  }
  _refresh() { // pull the pose from physics; keep the previous one for interpolation
    const { pos, quat } = S.phys.getPose(this._rec);
    this._prev.p = this._cur.p; this._prev.q = this._cur.q;
    this._cur = { p: pos, q: quat };
  }
  _moveTo(a) {
    S.phys.setPose(this._rec, a, this._cur.q);
    this._cur.p = [...a]; this._prev.p = [...a];
  }
  _turnTo(eulerDeg) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(eulerDeg[0] * RAD, eulerDeg[1] * RAD, eulerDeg[2] * RAD, 'YXZ'));
    const qa = [q.x, q.y, q.z, q.w];
    S.phys.setPose(this._rec, this._cur.p, qa);
    this._cur.q = qa; this._prev.q = [...qa];
  }
  _euler() {
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...this._cur.q), 'YXZ');
    return [e.x * DEG, e.y * DEG, e.z * DEG];
  }
  _rebuild(patch) {
    S.phys.rebuild(this._rec, patch);
    this._buildMesh();
  }
  _need() { if (this._removed) throw new Error('this Solid was removed'); }
  _become(shape, patch) { // turn a freshly made box into a hull or triangle mesh; if it is refused, leave nothing behind
    try {
      this._shape = shape; // first: _rebuild draws the solid from this._shape, so it must already say hull or triangles
      this._rebuild({ shape, ...patch });
      this._material.side = shape === 'triangles' ? THREE.DoubleSide : THREE.FrontSide;
      this._material.needsUpdate = true;
    } catch (e) { this.remove(); throw e; }
  }

  // --- position shortcuts (pos, vel, rotation and angularVelocity are live vectors, defined below the class)
  get x() { return this._cur.p[0]; } set x(v) { this.pos.x = v; }
  get y() { return this._cur.p[1]; } set y(v) { this.pos.y = v; }
  get z() { return this._cur.p[2]; } set z(v) { this.pos.z = v; }

  // --- size and shape
  get w() { return this._rec.def.w; } set w(v) { this._resize({ w: +v }); }
  get h() { return this._rec.def.h; } set h(v) { this._resize({ h: +v }); }
  get d() { return this._rec.def.d; } set d(v) { this._resize({ d: +v }); }
  get diameter() { return this._rec.def.w; } set diameter(v) { this._resize({ w: +v }); }
  _resize(patch) {
    if (this._shape === 'hull' || this._shape === 'triangles') throw new TypeError(`${this._shape === 'hull' ? "a Hull's size comes from its points" : "a TriangleMesh's size comes from its vertices"}; use scale to change how big it looks`);
    const d = this._rec.def;
    const next = { w: d.w, h: d.h, d: d.d, ...patch };
    if (this._shape === 'sphere') { const s = patch.w ?? patch.h ?? patch.d; next.w = next.h = next.d = s; }
    else if (ROUND.has(this._shape)) next.d = next.w = patch.d ?? patch.w ?? next.w;
    checkSize(this._shape, next);
    this._rebuild(next);
  }
  get shape() { return this._shape; }
  set shape(v) {
    const s = v === 'cube' ? 'box' : v;
    if (!PRIMITIVES.includes(s)) throw new TypeError(`shape must be one of ${PRIMITIVES.map((x) => `'${x}'`).join(', ')} (got ${JSON.stringify(v)}); a hull or a triangle mesh is made with new Hull() or new TriangleMesh()`);
    const prev = this._shape, d = this._rec.def;
    this._shape = s;
    try { this._rebuild({ shape: s, ...fit(s, d.w, d.h, d.d) }); } catch (e) { this._shape = prev; throw e; }
  }
  get scale() { return this._scale; }
  set scale(v) { this._scale = typeof v === 'number' ? new Vector(v, v, v) : new Vector(...arr3(v, 'scale')); this._syncVisual(); }
  scaleBy(x, y = x, z = x) { this._scale = new Vector(this._scale.x * x, this._scale.y * y, this._scale.z * z); this._syncVisual(); }

  // --- looks
  get color() { return this._color; } set color(v) { this._color = v; this._syncVisual(); }
  get opacity() { return this._opacity; } set opacity(v) { this._opacity = unit(v, 'opacity'); this._syncVisual(); }
  get visible() { return this._visible; } set visible(v) { this._visible = !!v; this._syncVisual(); }
  get metalness() { return this._metal; } set metalness(v) { this._metal = unit(v, 'metalness'); this._syncVisual(); }
  get roughness() { return this._rough; } set roughness(v) { this._rough = unit(v, 'roughness'); this._syncVisual(); }

  // --- physics settings
  get collider() { return this._collider; }
  set collider(v) { const c = normCollider(v); this._rebuild({ collider: c }); this._collider = c; } // only once physics accepted it
  get bounciness() { return this._rec.def.bounciness; } set bounciness(v) { S.phys.setBounciness(this._rec, nonNeg(v, 'bounciness')); }
  get friction() { return this._rec.def.friction; } set friction(v) { S.phys.setFriction(this._rec, nonNeg(v, 'friction')); }
  get density() { return this._rec.def.density; } set density(v) { this._rebuild({ density: posNum(v, 'density'), mass: null }); }
  get mass() { return this._collider === 'dynamic' ? S.phys.massOf(this._rec) : 0; }
  set mass(v) { posNum(v, 'mass'); if (this._collider === 'dynamic') this._rebuild({ mass: v }); }
  get lockRotation() { return this._rec.def.lockRotation; } set lockRotation(v) { this._rebuild({ lockRotation: v }); }
  /** How fast it loses speed to the air, per second (0.05 by default, so rolling things come to rest). */
  get drag() { return this._rec.def.drag; } set drag(v) { S.phys.setDrag(this._rec, nonNeg(v, 'drag')); }
  get rotationDrag() { return this._rec.def.rotationDrag; } set rotationDrag(v) { S.phys.setRotationDrag(this._rec, nonNeg(v, 'rotationDrag')); }
  /** 1 is normal gravity, 0 weightless, negative falls upward. */
  get gravityScale() { return this._rec.def.gravityScale; } set gravityScale(v) { S.phys.setGravityScale(this._rec, num(v, 'gravityScale')); }
  /** Continuous collision for anything fast enough to jump through a thin wall. */
  get isSuperFast() { return this._rec.def.superFast; } set isSuperFast(v) { S.phys.setSuperFast(this._rec, !!v); }
  /** The fastest it may go, in units per frame like vel; Infinity (or null) for no limit of your own. */
  get maxSpeed() { const m = this._rec.def.maxSpeed; return m == null ? Infinity : m / 60; }
  set maxSpeed(v) { S.phys.setMaxSpeed(this._rec, v == null || v === Infinity ? null : posNum(v, 'maxSpeed') * 60); }
  /** The fastest it may spin, in degrees per frame like angularVelocity. */
  get maxSpin() { const m = this._rec.def.maxSpin; return m == null ? Infinity : (m * DEG) / 60; }
  set maxSpin(v) { S.phys.setMaxSpin(this._rec, v == null || v === Infinity ? null : posNum(v, 'maxSpin') * RAD * 60); }
  /** False keeps it awake even when it stops moving. */
  get allowSleeping() { return this._rec.def.allowSleeping; } set allowSleeping(v) { S.phys.setAllowSleeping(this._rec, !!v); }
  get sleeping() { return S.phys.isAsleep(this._rec); }
  /** A name; solids in groups named with world.ignoreCollisions() pass through each other. null = none. */
  get collisionGroup() { return this._rec.def.group; }
  set collisionGroup(v) { if (v != null && (typeof v !== 'string' || !v)) throw new TypeError(`collisionGroup must be a name like 'bullets', or null (got ${JSON.stringify(v)})`); S.phys.setGroup(this._rec, v); }
  get centerOfMass() { return new Vector(...S.phys.centerOfMass(this._rec)); }
  /** Works out the mass again from the size and density. */
  resetMass() { this._rebuild({ mass: null }); }
  get joints() { return [...S.joints].filter((j) => j._a === this || j._b === this); }

  applyForce(fx, fy, fz) { S.phys.addForce(this._rec, [fx, fy, fz]); }
  applyImpulse(x, y, z) { S.phys.addImpulse(this._rec, [x, y, z]); }
  applyTorque(x, y, z) { S.phys.addTorque(this._rec, [x, y, z]); }
  /** Like applyForce, multiplied by the mass, so heavy and light things speed up the same. */
  applyForceScaled(fx, fy, fz) { const m = this.mass || 1; S.phys.addForce(this._rec, [fx * m, fy * m, fz * m]); }
  /** Push at a point in the world: an off-centre push also spins it. */
  applyForceAt(fx, fy, fz, x, y, z) { S.phys.addForceAt(this._rec, [fx, fy, fz], pt(x, y, z)); }
  applyImpulseAt(ix, iy, iz, x, y, z) { S.phys.addImpulseAt(this._rec, [ix, iy, iz], pt(x, y, z)); }
  /** An instant spin (like applyImpulse, for turning). */
  applyAngularImpulse(x, y, z) { S.phys.addAngularImpulse(this._rec, [x, y, z]); }
  /** For 'kinematic' solids: glides to the point during the next physics step, pushing and carrying
   *  whatever touches it, and stops there. Set pos instead to teleport. Call it every frame to move
   *  along a path. */
  moveTo(x, y, z) { S.phys.moveKinematic(this._rec, pt(x, y, z)); }

  // --- looking and moving
  lookAt(x, y, z) {
    const t = typeof x === 'number' ? [x, y, z] : arr3(x, 'a target');
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...this._cur.p), new THREE.Vector3(...t), new THREE.Vector3(0, 1, 0));
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    S.phys.setPose(this._rec, this._cur.p, [q.x, q.y, q.z, q.w]);
    this._cur.q = [q.x, q.y, q.z, q.w]; this._prev.q = [...this._cur.q];
  }
  distanceTo(x, y, z) { const t = typeof x === 'number' ? [x, y, z] : arr3(x, 'a target'); return Math.hypot(...this._cur.p.map((v, i) => v - t[i])); }
  moveTowards(target, tracking = 0.1) { const t = arr3(target, 'a target'); this._moveTo(this._cur.p.map((v, i) => v + (t[i] - v) * tracking)); }
  moveAway(target, repel = 0.1) { const t = arr3(target, 'a target'); this._moveTo(this._cur.p.map((v, i) => v - (t[i] - v) * repel)); }

  _spawn() { // a fresh Solid like this one, for clone(); Hull and TriangleMesh bring their points along
    const Ctor = this instanceof Floor ? Solid : this.constructor; // Floor's constructor takes a size, not a position
    const c = new Ctor(...this._cur.p, this._rec.def.w, this._rec.def.h, this._rec.def.d, this._collider);
    if (this instanceof Floor) c.shape = 'box';
    return c;
  }
  clone() {
    const c = this._spawn();
    c.color = this._color; c.opacity = this._opacity; c.visible = this._visible;
    c.friction = this.friction; c.bounciness = this.bounciness; c.density = this.density;
    c.drag = this.drag; c.rotationDrag = this.rotationDrag; c.gravityScale = this.gravityScale;
    c.isSuperFast = this.isSuperFast; c.collisionGroup = this.collisionGroup;
    if (this.maxSpeed !== Infinity) c.maxSpeed = this.maxSpeed;
    if (this.maxSpin !== Infinity) c.maxSpin = this.maxSpin;
    c._scale = this._scale.copy(); c._syncVisual();
    c.rotation = this.rotation.copy();
    return c;
  }
  remove() {
    if (this._removed) return;
    this._removed = true;
    for (const j of this.joints) j.remove();
    S.phys.removeBody(this._rec);
    S.scene.remove(this._mesh);
    this._mesh.geometry.dispose(); this._material.dispose();
    S.solids.delete(this);
    for (const g of [...this._groups]) g._drop(this);
    allSolids._drop(this);
  }
  delete() { this.remove(); }
  get removed() { return this._removed; }

  // --- pointer: a ray from the camera through the mouse
  get mouse() { return (this._mouse ??= makeSolidMouse(this)); }
}
for (const name of ['pos', 'vel', 'rotation', 'angularVelocity']) liveProperty(Solid.prototype, name);
for (const verb of Object.keys(VERBS)) {
  Solid.prototype[verb] = function (other, cb) { return touchVerb(this, other, cb, VERBS[verb]); };
}
function checkSize(shape, { w, h, d }) {
  for (const [k, v] of [['w', w], ['h', h], ['d', d]]) if (!(v > 0)) throw new RangeError(`${k} must be above 0 (got ${v})`);
  if (shape === 'torus' && !(h < w)) throw new RangeError(`a torus needs h (the thickness of the ring) smaller than w (across), got h ${h}, w ${w}`);
}
class Cube extends Solid { static defaultShape = 'box'; }
class Sphere extends Solid { static defaultShape = 'sphere'; }
class Cylinder extends Solid { static defaultShape = 'cylinder'; }
class Capsule extends Solid { static defaultShape = 'capsule'; }
class Cone extends Solid { static defaultShape = 'cone'; }
class Torus extends Solid { static defaultShape = 'torus'; }
// A hull is the smallest convex shape around some points: any rock, gem or wedge. It can be
// dynamic. Points are relative to the solid's position.  new Hull(x, y, z, points, collider?)
class Hull extends Solid {
  static defaultShape = 'box';
  constructor(x, y, z, points, collider = 'dynamic') {
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || !Array.isArray(points)) throw new TypeError('new Hull() takes x, y, z, a list of points like [[0, 0, 0], [1, 0, 0], ...], then an optional collider');
    super(x, y, z, 1, collider);
    this._points = points.map((p) => [...arr3(p, 'a point')]);
    this._become('hull', { points: this._points });
  }
  _spawn() { return new Hull(...this._cur.p, this._points, this._collider); }
  get points() { return this._points.map((p) => [...p]); }
}
// A solid is any shape made of triangles: a room, terrain, a bowl. It cannot be dynamic (it has no
// mass), so it is 'static' unless you say 'kinematic'.  new TriangleMesh(x, y, z, vertices, triangles, collider?)
class TriangleMesh extends Solid {
  static defaultShape = 'box';
  constructor(x, y, z, vertices, triangles, collider = 'static') {
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || !Array.isArray(vertices) || !Array.isArray(triangles)) throw new TypeError('new TriangleMesh() takes x, y, z, a list of vertices like [[0, 0, 0], ...], a list of triangles like [[0, 1, 2], ...], then an optional collider');
    super(x, y, z, 1, 'static');
    this._verts = vertices.map((p) => [...arr3(p, 'a vertex')]);
    this._tris = triangles.map((t) => [...t]);
    this._become('triangles', { vertices: this._verts, triangles: this._tris, collider: normCollider(collider) });
    this._collider = this._rec.def.collider;
  }
  _spawn() { return new TriangleMesh(...this._cur.p, this._verts, this._tris, this._collider); }
  get vertices() { return this._verts.map((p) => [...p]); }
  get triangles() { return this._tris.map((t) => [...t]); }
}
/** A big flat static body whose top surface is at y = 0. */
class Floor extends Solid {
  static defaultShape = 'box';
  constructor(size = 40) {
    super(0, -0.5, 0, size, 1, size, 'static');
    this._color = '#44475a'; this._syncVisual();
  }
}

// ---------------------------------------------------------------- joints
// A joint joins two Solids. Angles are in degrees counted from the pose the two were in when the
// joint was made. `anchor` is where it holds, a point in the world (default: the first Solid's
// middle). Making one with a wrong argument throws a TypeError that says what to give.
function jointOptions(name, opt, allowed) {
  if (opt === undefined) return {};
  if (typeof opt !== 'object' || opt === null || Array.isArray(opt)) throw new TypeError(`${name} options are an object like { ${allowed[0]}: ... }`);
  for (const k of Object.keys(opt)) if (!allowed.includes(k)) throw new TypeError(`${name} has no option '${k}' (its options: ${allowed.join(', ')})`);
  return opt;
}
class Joint {
  constructor(kind, a, b, spec) {
    const name = new.target.name;
    for (const [k, v] of [['first', a], ['second', b]]) {
      if (!(v instanceof Solid) || v._removed) throw new TypeError(`new ${name}(a, b) joins two live Solids, but the ${k} one is ${v instanceof Solid ? 'removed' : String(v)}`);
    }
    if (a === b) throw new TypeError(`new ${name}(a, b) needs two different Solids`);
    this._a = a; this._b = b; this._kind = kind; this._removed = false;
    try { this._j = S.phys.createJoint({ kind, a: a._rec, b: b._rec, ...spec }); }
    catch (e) { throw new TypeError(`${name}: ${e.message}`); }
    S.joints.add(this);
  }
  get a() { return this._a; }
  get b() { return this._b; }
  get removed() { return this._removed; }
  /** Takes the joint away; the two Solids carry on free. */
  remove() { if (this._removed) return; this._removed = true; S.phys.removeJoint(this._j); S.joints.delete(this); }
  delete() { this.remove(); }
  _need() { if (this._removed) throw new Error('this joint was removed'); }
}
const angleOk = (v, lo, hi, what) => {
  if (v == null) return null;
  if (num(v, what) < lo || v > hi) throw new RangeError(`${what} must be between ${lo} and ${hi} degrees, counted from where the hinge starts (got ${v})`);
  return v * RAD;
};
/** Pins two Solids together at a point so they turn around a line (`axis`, default up). Like a door. */
class HingeJoint extends Joint {
  constructor(a, b, opt) {
    const o = jointOptions('HingeJoint', opt, ['anchor', 'axis', 'lowerLimit', 'upperLimit', 'friction']);
    super('hinge', a, b, {
      anchor: o.anchor ? arr3(o.anchor, 'anchor') : undefined, axis: o.axis ? arr3(o.axis, 'axis') : undefined,
      lower: angleOk(o.lowerLimit, -180, 0, 'lowerLimit'), upper: angleOk(o.upperLimit, 0, 180, 'upperLimit'),
      friction: o.friction === undefined ? 0 : nonNeg(o.friction, 'friction'),
    });
  }
  /** The smallest angle it may turn to (-180 to 0), or null for no limit. */
  get lowerLimit() { const v = this._j.spec.lower; return v == null ? null : v * DEG; }
  set lowerLimit(v) { this._need(); S.phys.setJointLimits(this._j, angleOk(v, -180, 0, 'lowerLimit'), this._j.spec.upper); }
  get upperLimit() { const v = this._j.spec.upper; return v == null ? null : v * DEG; }
  set upperLimit(v) { this._need(); S.phys.setJointLimits(this._j, this._j.spec.lower, angleOk(v, 0, 180, 'upperLimit')); }
  /** How hard it is to turn (0 swings freely). */
  get friction() { return this._j.spec.friction; }
  set friction(v) { this._need(); S.phys.setJointFriction(this._j, nonNeg(v, 'friction')); }
  /** How far it has turned from where it started, in degrees. */
  get angle() { this._need(); return S.phys.jointValue(this._j) * DEG; }
}
/** Pins two Solids together at a point; they can swing any way around it, like a hanging chain link. */
class BallJoint extends Joint {
  constructor(a, b, opt) {
    const o = jointOptions('BallJoint', opt, ['anchor']);
    super('ball', a, b, { anchor: o.anchor ? arr3(o.anchor, 'anchor') : undefined });
  }
}
/** Keeps two Solids a set distance apart: a stick (default), a rope (`rope: true`: it can slacken but
 *  never stretch) or a spring (`spring: { hz, damping }`). `length` defaults to how far apart they are now. */
class DistanceJoint extends Joint {
  constructor(a, b, opt) {
    const o = jointOptions('DistanceJoint', opt, ['length', 'rope', 'spring']);
    if (o.spring !== undefined && (typeof o.spring !== 'object' || o.spring === null || !(o.spring.hz > 0))) throw new TypeError('spring is { hz, damping }, hz above 0 (about 1 to 3 is bouncy)');
    super('distance', a, b, { length: o.length === undefined ? undefined : nonNeg(o.length, 'length'), rope: !!o.rope, spring: o.spring });
  }
  /** The distance it keeps, which you can change later. */
  get length() { return this._j.spec.max; }
  set length(v) { this._need(); S.phys.setJointLength(this._j, nonNeg(v, 'length')); }
  /** How far apart the two are right now. */
  get distance() { this._need(); return S.phys.jointValue(this._j); }
}
/** Lets the second Solid slide along a line (`axis`, default [1, 0, 0]) on the first, like a drawer.
 *  Limits are distances from where it starts: lowerLimit 0 or less, upperLimit 0 or more. */
class SliderJoint extends Joint {
  constructor(a, b, opt) {
    const o = jointOptions('SliderJoint', opt, ['axis', 'lowerLimit', 'upperLimit']);
    super('slider', a, b, {
      axis: o.axis ? arr3(o.axis, 'axis') : undefined,
      lower: o.lowerLimit == null ? null : num(o.lowerLimit, 'lowerLimit'), upper: o.upperLimit == null ? null : num(o.upperLimit, 'upperLimit'),
    });
  }
  get lowerLimit() { return this._j.spec.lower; }
  set lowerLimit(v) { this._need(); S.phys.setJointLimits(this._j, v == null ? null : num(v, 'lowerLimit'), this._j.spec.upper); }
  get upperLimit() { return this._j.spec.upper; }
  set upperLimit(v) { this._need(); S.phys.setJointLimits(this._j, this._j.spec.lower, v == null ? null : num(v, 'upperLimit')); }
  /** How far it has slid from where it started. */
  get position() { this._need(); return S.phys.jointValue(this._j); }
}
/** Sticks two Solids together where they are, so they move as one. */
class GlueJoint extends Joint {
  constructor(a, b) { super('glue', a, b, {}); }
}

// ---------------------------------------------------------------- Group
class Group extends Array {
  static get [Symbol.species]() { return Array; } // filter/map give plain arrays
  constructor() {
    super();
    Object.defineProperty(this, '_defaults', { value: {}, writable: true });
    const group = this;
    Object.defineProperty(this, 'Solid', { value: class extends Solid {
      constructor(...a) { super(...a); group._join(this); for (const [k, v] of Object.entries(group._defaults)) this[k] = v; }
    } });
    S.groups.add(this);
  }
  _join(a) { if (!this.includes(a)) { Array.prototype.push.call(this, a); a._groups.add(this); } }
  _drop(a) { const i = this.indexOf(a); if (i >= 0) Array.prototype.splice.call(this, i, 1); a._groups.delete(this); }
  newSolid(x, y, z, size) { return new this.Solid(x, y, z, ...(size === undefined ? [] : [size])); }
  push(...as) { for (const a of as) this._join(a); return this.length; }
  add(...as) { return this.push(...as); }
  contains(a) { return this.includes(a); }
  remove(a) { this._drop(a); }
  delete() { for (const a of [...this]) a.remove(); }
  get amount() { return this.length; }
  set amount(n) { while (this.length > n) this[this.length - 1].remove(); while (this.length < n) this.newSolid(0, 0, 0); }
  applyForce(x, y, z) { for (const a of this) a.applyForce(x, y, z); }
  /** Removes members that fell below y = -50 or drifted more than 200 units out, plus `margin`. */
  cull(margin = 0, cb) {
    let n = 0;
    for (const a of [...this]) {
      const [x, y, z] = a._cur.p;
      if (y < -50 - margin || Math.hypot(x, z) > 200 + margin) { n++; if (cb) cb(a, n); else a.remove(); }
    }
    return n;
  }
}
for (const verb of Object.keys(VERBS)) {
  Group.prototype[verb] = function (other, cb) {
    const v = VERBS[verb];
    let result = v.zero;
    for (const a of this) result = v.merge(result, touchVerb(a, other, cb, v));
    return result;
  };
}
for (const key of ['color', 'collider', 'bounciness', 'friction', 'density', 'opacity', 'visible', 'drag', 'rotationDrag', 'gravityScale', 'isSuperFast', 'maxSpeed', 'maxSpin', 'allowSleeping', 'collisionGroup']) {
  Object.defineProperty(Group.prototype, key, {
    get() { return this._defaults[key]; },
    set(v) { this._defaults[key] = v; for (const a of this) a[key] = v; },
  });
}
const allSolids = new Group();

// ---------------------------------------------------------------- input
const norm = (k) => { const s = String(k).toLowerCase(); return s === ' ' ? 'space' : s.replace(/^arrow/, '').replace('control', 'ctrl'); };
const keys = { down: new Map(), pressed: new Set(), released: new Set() };
const kb = {
  presses: (k) => (k === undefined ? keys.pressed.size > 0 : keys.pressed.has(norm(k))),
  pressing: (k) => (k === undefined ? Math.max(0, ...keys.down.values()) : keys.down.get(norm(k)) ?? 0),
  released: (k) => (k === undefined ? keys.released.size > 0 : keys.released.has(norm(k))),
};
const mouse = {
  x: 0, y: 0, moved: { x: 0, y: 0 }, _down: new Map(), _pressed: new Set(), _released: new Set(),
  presses: (b = 'left') => mouse._pressed.has(b),
  pressing: (b = 'left') => mouse._down.get(b) ?? 0,
  released: (b = 'left') => mouse._released.has(b),
  lock() { try { S.renderer.domElement.requestPointerLock?.(); } catch { console.warn('mouse.lock() was blocked by the page'); } },
};
const BUTTON = ['left', 'center', 'right'];
function bindInput() {
  addEventListener('keydown', (e) => {
    const k = norm(e.key);
    if (!keys.down.has(k)) { keys.pressed.add(k); keys.down.set(k, 0); }
    if (['up', 'down', 'left', 'right', 'space'].includes(k)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { const k = norm(e.key); keys.down.delete(k); keys.released.add(k); });
  addEventListener('blur', () => keys.down.clear());
  const el = S.renderer.domElement;
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    mouse.moved.x += e.movementX || 0; mouse.moved.y += e.movementY || 0;
  });
  el.addEventListener('pointerdown', (e) => { const b = BUTTON[e.button] ?? 'left'; if (!mouse._down.has(b)) { mouse._pressed.add(b); mouse._down.set(b, 0); } window.focus(); });
  addEventListener('pointerup', (e) => { const b = BUTTON[e.button] ?? 'left'; mouse._down.delete(b); mouse._released.add(b); });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
function endOfTickInput() {
  for (const [k, n] of keys.down) keys.down.set(k, n + 1);
  for (const [b, n] of mouse._down) mouse._down.set(b, n + 1);
  keys.pressed.clear(); keys.released.clear(); mouse._pressed.clear(); mouse._released.clear();
  mouse.moved.x = mouse.moved.y = 0;
}

// ---------------------------------------------------------------- world, picking
function pickRay(sx, sy) { // a world-space ray from the camera through a screen point
  const el = S.renderer.domElement, w = el.clientWidth, h = el.clientHeight;
  const ndc = new THREE.Vector2((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
  S.cam.updateMatrixWorld(); // the camera may have moved since the last render
  const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, S.cam);
  const o = rc.ray.origin, d = rc.ray.direction;
  return { from: [o.x, o.y, o.z], to: [o.x + d.x * 1000, o.y + d.y * 1000, o.z + d.z * 1000] };
}
const shapeHit = (h) => (h ? { solid: h.rec.userData ?? null, point: new Vector(...h.point), normal: new Vector(...h.normal), fraction: h.fraction } : null);
const pt = (a, b, c) => (typeof a === 'number' ? [a, b, c] : arr3(a, 'a point'));
const groupName = (v) => { if (typeof v !== 'string' || !v) throw new TypeError(`a collision group is a name like 'bullets' (got ${JSON.stringify(v)})`); return v; };
const liveGravity = new LiveVector(() => S.phys.gravity, (a) => { S.phys.gravity = a; });
const world = {
  get gravity() { return liveGravity; },
  set gravity(v) { liveGravity.set(arr3(v, 'gravity')); },
  get allowSleeping() { return S.phys.allowSleeping; }, set allowSleeping(v) { S.phys.allowSleeping = v; },
  autoStep: true,
  physicsUpdate() { S.phys.step(); syncAll(); },
  /** More steps hold stacks and joints steadier and cost more time (default 10). */
  get solverSteps() { return S.phys.solverSteps; }, set solverSteps(v) { S.phys.solverSteps = Math.round(posNum(v, 'solverSteps')); },
  /** Seconds a resting solid waits before it goes to sleep (default 0.5). */
  get sleepDelay() { return S.phys.sleepDelay; }, set sleepDelay(v) { S.phys.sleepDelay = nonNeg(v, 'sleepDelay'); },
  /** Slower than this (units per frame) counts as resting (default 0.0005). */
  get sleepSpeed() { return S.phys.sleepSpeed / 60; }, set sleepSpeed(v) { S.phys.sleepSpeed = nonNeg(v, 'sleepSpeed') * 60; },
  /** Hits slower than this (units per frame) do not bounce (default 0.017); 0 lets everything bounce. */
  get minBounceSpeed() { return S.phys.minBounceSpeed / 60; }, set minBounceSpeed(v) { S.phys.minBounceSpeed = nonNeg(v, 'minBounceSpeed') * 60; },
  /** world.ignoreCollisions('bullets', 'player'): those two groups pass through each other.
   *  One name: members of that group pass through each other. */
  ignoreCollisions(a, b) { S.phys.ignoreCollisions(groupName(a), b === undefined ? undefined : groupName(b)); },
  restoreCollisions(a, b) { S.phys.restoreCollisions(groupName(a), b === undefined ? undefined : groupName(b)); },
  get joints() { return [...S.joints]; },
  getSolidAt(sx, sy) { const r = pickRay(sx, sy); const h = S.phys.rayCast(r.from, r.to); return h?.rec.userData ?? undefined; },
  rayCast(a, b, c, d, e, f) {
    const [from, to] = typeof a === 'number' ? [[a, b, c], [d, e, f]] : [pt(a), pt(b)];
    return shapeHit(S.phys.rayCast(from, to));
  },
  rayCastAll(a, b, c, d, e, f) {
    const [from, to] = typeof a === 'number' ? [[a, b, c], [d, e, f]] : [pt(a), pt(b)];
    return S.phys.rayCastAll(from, to).map(shapeHit);
  },
  explodeAt(x, y, z, radius = 5, magnitude = 10, falloff = 0) {
    const c = typeof x === 'number' ? [x, y, z] : arr3(x, 'a point');
    S.phys.explodeAt(c, radius, magnitude, falloff);
  },
};
function makeSolidMouse(a) {
  const over = () => world.getSolidAt(mouse.x, mouse.y) === a;
  let was = false;
  return {
    hovering: over,
    hovers() { const n = over(); const r = n && !was; was = n; return r; },
    hovered() { const n = over(); const r = !n && was; was = n; return r; },
    presses: (b) => over() && mouse.presses(b),
    pressing: (b) => over() && mouse.pressing(b) > 0,
    released: (b) => over() && mouse.released(b),
  };
}

// ---------------------------------------------------------------- camera, lights, background
const cameraState = { mode: 'free', target: null, opts: {}, orbit: { center: [0, 0, 0], dist: 8, yaw: 0, pitch: 0.4, drag: false } };
S.camTarget = [0, 0, 0];
const camera = {
  get pos() { return new LiveVector(() => S.cam.position.toArray(), (a) => S.cam.position.set(...a)); },
  set pos(v) { S.cam.position.set(...arr3(v)); },
  get x() { return S.cam.position.x; }, set x(v) { S.cam.position.x = v; },
  get y() { return S.cam.position.y; }, set y(v) { S.cam.position.y = v; },
  get z() { return S.cam.position.z; }, set z(v) { S.cam.position.z = v; },
  get fov() { return S.cam.fov; }, set fov(v) { if (num(v, 'fov') <= 0 || v >= 180) throw new RangeError(`fov must be between 0 and 180 degrees (got ${v})`); S.cam.fov = v; S.cam.updateProjectionMatrix(); },
  lookAt(x, y, z) { const t = typeof x === 'number' ? [x, y, z] : arr3(x, 'a target'); S.camTarget = t; S.cam.lookAt(...t); },
  follow(target, opts = {}) { cameraState.mode = 'follow'; cameraState.target = target; cameraState.opts = { distance: 8, height: 4, tracking: 0.1, ...opts }; },
  orbit(target, opts = {}) {
    const c = arr3(target, 'a target');
    const o = S.cam.position;
    Object.assign(cameraState.orbit, {
      center: c, dist: opts.distance ?? (Math.hypot(o.x - c[0], o.y - c[1], o.z - c[2]) || 8), drag: !!opts.drag,
      yaw: Math.atan2(o.x - c[0], o.z - c[2]), pitch: Math.asin((o.y - c[1]) / (Math.hypot(o.x - c[0], o.y - c[1], o.z - c[2]) || 1)),
    });
    cameraState.mode = 'orbit';
  },
  free() { cameraState.mode = 'free'; },
};
// Follow runs once per DRAWN frame, on the interpolated pose the solid is drawn at. Run once per
// physics step on the raw pose (as it first was), the camera moved in 60 Hz jumps while the
// solid glided between them, so the character shook against the view whenever the screen's
// refresh rate was not exactly the physics rate. `tracking` is the share of the gap closed per
// 1/60 s, applied by real elapsed time so it looks the same at any frame rate.
function followCamera(alpha, dtMs) {
  if (cameraState.mode !== 'follow' || !cameraState.target || cameraState.target._removed) return;
  const t = cameraState.target, { distance, height, tracking } = cameraState.opts;
  const pp = t._prev.p, cp = t._cur.p;
  const p = new THREE.Vector3(pp[0] + (cp[0] - pp[0]) * alpha, pp[1] + (cp[1] - pp[1]) * alpha, pp[2] + (cp[2] - pp[2]) * alpha);
  const q = new THREE.Quaternion(...t._prev.q).slerp(new THREE.Quaternion(...t._cur.q), alpha);
  const want = p.clone().add(new THREE.Vector3(0, 0, distance).applyQuaternion(q)).add(new THREE.Vector3(0, height, 0));
  const steps = Math.min(dtMs / (1000 * FIXED_DT), 6);
  S.cam.position.lerp(want, 1 - Math.pow(1 - Math.min(Math.max(tracking, 0), 1), steps));
  S.camTarget = p.toArray(); S.cam.lookAt(p);
}
function updateCamera() {
  const m = cameraState.mode;
  if (m === 'orbit') {
    const o = cameraState.orbit;
    if (o.drag && mouse.pressing('left') > 0) { o.yaw -= mouse.moved.x * 0.01; o.pitch = Math.max(-1.4, Math.min(1.4, o.pitch + mouse.moved.y * 0.01)); }
    const c = o.center;
    S.cam.position.set(c[0] + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), c[1] + o.dist * Math.sin(o.pitch), c[2] + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch));
    S.camTarget = c; S.cam.lookAt(...c);
  }
}
const ambientLight = {
  get color() { return '#' + S.ambient.color.getHexString(); }, set color(v) { S.ambient.color.copy(parseColor(v)); },
  get intensity() { return S.ambient.intensity; }, set intensity(v) { S.ambient.intensity = nonNeg(v, 'intensity'); },
};
const sunLight = {
  get color() { return '#' + S.sun.color.getHexString(); }, set color(v) { S.sun.color.copy(parseColor(v)); },
  get intensity() { return S.sun.intensity; }, set intensity(v) { S.sun.intensity = nonNeg(v, 'intensity'); },
  get direction() { return new LiveVector(() => S.sunDir, (a) => setSunDirection(a)); }, set direction(v) { setSunDirection(arr3(v, 'a direction')); },
  get shadows() { return S.sun.castShadow; }, set shadows(on) { S.sun.castShadow = !!on; S.renderer.shadowMap.enabled = !!on; S.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); },
};
function setSunDirection(a) { S.sunDir = a; placeSun(); }
// The sun's shadow box (40 across) follows what the camera looks at, in whole-unit steps so the
// shadow does not shimmer as it moves, so shadows work wherever the action is.
function placeSun() {
  const d = new THREE.Vector3(...S.sunDir).normalize();
  const t = S.camTarget.map((v) => Math.round(v));
  S.sun.target.position.set(t[0], t[1], t[2]);
  S.sun.position.set(t[0] - d.x * 30, t[1] - d.y * 30, t[2] - d.z * 30);
}
class PointLight {
  constructor(x, y, z, color = '#ffffff', intensity = 30) { this._l = new THREE.PointLight(parseColor(color), intensity, 0, 2); this._l.position.set(x, y, z); S.scene.add(this._l); }
  get pos() { return new LiveVector(() => this._l.position.toArray(), (a) => this._l.position.set(...a)); } set pos(v) { this._l.position.set(...arr3(v)); }
  get color() { return '#' + this._l.color.getHexString(); } set color(v) { this._l.color.copy(parseColor(v)); }
  get intensity() { return this._l.intensity; } set intensity(v) { this._l.intensity = nonNeg(v, 'intensity'); }
  remove() { S.scene.remove(this._l); this._l.dispose?.(); }
}
class SpotLight extends PointLight {
  constructor(x, y, z, color = '#ffffff', intensity = 60) {
    super(x, y, z, color, intensity);
    S.scene.remove(this._l);
    this._l = new THREE.SpotLight(parseColor(color), intensity, 0, Math.PI / 6, 0.3, 2);
    this._l.position.set(x, y, z); S.scene.add(this._l, this._l.target);
  }
  get angle() { return this._l.angle * DEG; } set angle(v) { this._l.angle = v * RAD; }
  lookAt(x, y, z) { const t = typeof x === 'number' ? [x, y, z] : arr3(x, 'a target'); this._l.target.position.set(...t); }
}
function background(c) { S.scene.background = parseColor(c); }

// ---------------------------------------------------------------- 2D layer: HUD
const hudState = { fill: '#ffffff', stroke: null, weight: 1, size: 16, align: 'left' };
const hud = {
  fill: (c, g, b) => { hudState.fill = typeof g === 'number' ? `rgb(${c},${g},${b})` : typeof c === 'number' ? `rgb(${c},${c},${c})` : c; },
  noFill: () => { hudState.fill = null; },
  stroke: (c) => { hudState.stroke = typeof c === 'number' ? `rgb(${c},${c},${c})` : c; },
  noStroke: () => { hudState.stroke = null; },
  strokeWeight: (n) => { hudState.weight = n; },
  textSize: (n) => { hudState.size = n; },
  textAlign: (a) => { hudState.align = a; },
  rect(x, y, w, h) { const c = S.hudCtx; c.lineWidth = hudState.weight; if (hudState.fill) { c.fillStyle = hudState.fill; c.fillRect(x, y, w, h); } if (hudState.stroke) { c.strokeStyle = hudState.stroke; c.strokeRect(x, y, w, h); } },
  circle(x, y, d) { const c = S.hudCtx; c.beginPath(); c.arc(x, y, d / 2, 0, Math.PI * 2); c.lineWidth = hudState.weight; if (hudState.fill) { c.fillStyle = hudState.fill; c.fill(); } if (hudState.stroke) { c.strokeStyle = hudState.stroke; c.stroke(); } },
  line(x1, y1, x2, y2) { const c = S.hudCtx; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = hudState.weight; c.strokeStyle = hudState.stroke ?? hudState.fill ?? '#fff'; c.stroke(); },
  text(s, x, y) { const c = S.hudCtx; c.font = `${hudState.size}px system-ui, sans-serif`; c.textAlign = hudState.align; c.textBaseline = 'top'; if (hudState.stroke) { c.strokeStyle = hudState.stroke; c.lineWidth = hudState.weight; c.strokeText(String(s), x, y); } if (hudState.fill) { c.fillStyle = hudState.fill; c.fillText(String(s), x, y); } },
};
function drawPerf() {
  const c = S.hudCtx, r = S.renderer.info.render;
  const lines = [`${(1000 / S.frameMs).toFixed(0)} fps  ${S.frameMs.toFixed(1)} ms`, `draw calls ${r.calls}   triangles ${r.triangles}`, `bodies ${S.phys.bodyCount}   scale ${S.renderScale.toFixed(2)}`];
  c.save(); c.font = '12px ui-monospace, monospace'; c.textBaseline = 'top'; c.textAlign = 'left';
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(6, 6, 232, 52);
  c.fillStyle = '#50fa7b'; lines.forEach((l, i) => c.fillText(l, 12, 11 + i * 15));
  c.restore();
}

// ---------------------------------------------------------------- canvas, quality, loop
const QUALITY = { low: 0.5, medium: 0.75, high: 1 };
// Sharpness. The canvas is drawn at the screen's own pixel density (up to 2x) so edges and text are
// crisp on sharp screens, but never more than about a 1080p canvas worth of pixels (integrated
// graphics is the target): a small canvas on a sharp screen gets the full density, a full-screen
// one on a 4K display gets less. `quality` then scales the 3D part of that; the HUD stays sharp.
const PIXEL_BUDGET = 2.4e6;
function baseRatio(w, h) {
  const native = Math.min(window.devicePixelRatio || 1, 2);
  return Math.min(native, Math.max(0.75, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h))));
}
function applySize() {
  const el = S.renderer.domElement;
  const [w, h] = S.canvasSize ?? [innerWidth, innerHeight];
  const base = baseRatio(w, h);
  S.hudRatio = base;
  S.renderer.setPixelRatio(base * S.renderScale);
  S.renderer.setSize(w, h, false);
  el.style.width = w + 'px'; el.style.height = h + 'px';
  S.hud.width = Math.round(w * base); S.hud.height = Math.round(h * base);
  S.hud.style.width = w + 'px'; S.hud.style.height = h + 'px';
  S.hudCtx.setTransform(base, 0, 0, base, 0, 0); // HUD code draws in CSS pixels
  S.cam.aspect = w / h; S.cam.updateProjectionMatrix();
  window.width = w; window.height = h;
}
class Canvas { constructor(w, h) { S.canvasSize = [w, h]; applySize(); } }
function setQuality(q) {
  if (q !== 'auto' && !(q in QUALITY)) throw new TypeError(`quality must be 'auto', 'low', 'medium' or 'high' (got ${JSON.stringify(q)})`);
  S.qualityMode = q;
  if (q !== 'auto') { S.renderScale = QUALITY[q]; applySize(); }
}
// Auto quality. Frame time on a 60 Hz screen is pinned at 16.7 ms whether the GPU is idle or
// nearly full, so headroom cannot be read directly. Instead: drop the render scale when frames
// run long, and every so often TRY a step back up; if that makes frames long again, drop
// again and wait longer before the next try.
// Blur is the cost of this, so it must not fire on a one-off: the first frames compile shaders
// and start Jolt (warm-up is ignored), and a single long frame only costs a point that two
// normal frames pay back. Only a run of long frames lowers the scale, and never below 0.7
// (`quality = 'low'` still goes to 0.5 when asked for).
const WARMUP_FRAMES = 150, AUTO_FLOOR = 0.7;
let slow = 0, calm = 0, retryAfter = 300;
function autoQuality() {
  if (S.qualityMode !== 'auto' || S.frames < WARMUP_FRAMES) return;
  const long = S.lastDt > 22;
  slow = long ? slow + 1 : Math.max(0, slow - 2);
  calm = long ? 0 : calm + 1;
  if (slow >= 30 && S.renderScale > AUTO_FLOOR) {
    S.renderScale = Math.max(AUTO_FLOOR, S.renderScale - 0.1); slow = 0; applySize();
    retryAfter = Math.min(retryAfter * 2, 4800); // that was a failed climb, or a real limit: be patient
  } else if (calm >= retryAfter && S.renderScale < 1) {
    S.renderScale = Math.min(1, S.renderScale + 0.05); calm = 0; applySize();
  }
}

function syncAll() { for (const a of S.solids) if (a._collider !== 'static' && (a._collider !== 'dynamic' || S.phys.isAwake(a._rec))) a._refresh(); else { a._prev.p = a._cur.p; a._prev.q = a._cur.q; } }
function render(alpha) {
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  for (const a of S.solids) {
    const m = a._mesh;
    const p = a._prev.p, c = a._cur.p;
    m.position.set(p[0] + (c[0] - p[0]) * alpha, p[1] + (c[1] - p[1]) * alpha, p[2] + (c[2] - p[2]) * alpha);
    q.set(...a._prev.q); q2.set(...a._cur.q); m.quaternion.copy(q.slerp(q2, alpha));
  }
  S.renderer.render(S.scene, S.cam);
}
const hook = (name, ...args) => { const f = window[name]; if (typeof f === 'function') f(...args); };
function fail(e) {
  if (S.halted) return;
  S.halted = true; // stop on the first error, like moSHion, so one mistake is not reported 60 times a second
  window.dispatchEvent(new ErrorEvent('error', { error: e, message: e?.message }));
}

export async function boot() {
  const Jolt = await initJolt({ locateFile: (f) => new URL('./vendor/jolt/' + f, import.meta.url).href });
  S.phys = createPhysics(Jolt, { gravity: [0, 0, 0] });

  const canvas = document.getElementById('canvas') ?? document.body.appendChild(document.createElement('canvas'));
  S.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  S.hud = document.getElementById('hud');
  S.hudCtx = S.hud.getContext('2d');
  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color('#1e1f29');
  S.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  S.cam.position.set(0, 3, 7); S.cam.lookAt(0, 0, 0);
  S.ambient = new THREE.AmbientLight('#ffffff', 0.9); S.scene.add(S.ambient);
  S.sun = new THREE.DirectionalLight('#ffffff', 2.4); S.scene.add(S.sun, S.sun.target);
  S.sun.shadow.camera.left = S.sun.shadow.camera.bottom = -20; S.sun.shadow.camera.right = S.sun.shadow.camera.top = 20; S.sun.shadow.mapSize.set(1024, 1024); S.sun.shadow.bias = -0.0004; S.sun.shadow.normalBias = 0.03;
  setSunDirection([-0.4, -1, -0.6]);
  applySize();
  addEventListener('resize', applySize);
  bindInput();

  Object.assign(window, {
    Solid, Cube, Sphere, Cylinder, Capsule, Cone, Torus, Hull, TriangleMesh, Floor, Group, allSolids, world,
    HingeJoint, BallJoint, DistanceJoint, SliderJoint, GlueJoint, camera, ambientLight, sunLight,
    PointLight, SpotLight, background, Canvas, kb, mouse, Vector, createVector,
    random: (a, b) => (a === undefined ? Math.random() : b === undefined ? Math.random() * a : a + Math.random() * (b - a)),
    degrees: (r) => r * DEG, radians: (d) => d * RAD,
    showPerf: (on = true) => { S.perf = !!on; },
    LEFT: 'left', RIGHT: 'right', CENTER: 'center',
    ...hud,
    STATIC: 'static', DYNAMIC: 'dynamic', KINEMATIC: 'kinematic',
    frameCount: 0, deltaTime: 16.7,
  });
  Object.defineProperty(window, 'quality', { get: () => S.qualityMode, set: setQuality, configurable: true });
  S.autoQuality = autoQuality; // for tests
  window.__spashial = S; // for tests and the sandbox page

  return {
    start() {
      hook('preload');
      hook('setup');
      let last = performance.now(), acc = 0;
      const frame = (now) => {
        requestAnimationFrame(frame);
        if (S.halted) return;
        const dt = Math.min(now - last, 100); last = now;
        S.frameMs += (dt - S.frameMs) * 0.1;
        S.lastDt = dt; S.frames++;
        window.deltaTime = dt;
        acc += dt / 1000;
        try {
          while (acc >= FIXED_DT) {
            acc -= FIXED_DT;
            window.frameCount++;
            hook('update', FIXED_DT);
            updateCamera();
            if (world.autoStep) { S.phys.step(); syncAll(); }
            endOfTickInput();
          }
          followCamera(acc / FIXED_DT, dt);
          placeSun();
          hook('draw');
          render(acc / FIXED_DT);
          S.hudCtx.setTransform(1, 0, 0, 1, 0, 0); S.hudCtx.clearRect(0, 0, S.hud.width, S.hud.height);
          S.hudCtx.setTransform(S.hudRatio, 0, 0, S.hudRatio, 0, 0);
          if (S.perf) drawPerf();
          hook('drawTop');
        } catch (e) { fail(e); }
        autoQuality();
      };
      requestAnimationFrame(frame);
    },
  };
}

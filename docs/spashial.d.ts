// spaSHial API typings. Everything in this file is built and tested; each doc comment is also
// the line the docs reference shows for that name. Keep this file in step with spashial.js.
//
// What is NOT here, because the engine does not do it yet: textures, sounds, glTF models,
// Tiles, billboard text on a solid, online play, and saving. See docs/ "Planned".
//
// Conventions:
//   - Y is UP, X right, Z toward the viewer (right-handed). One unit is about a metre.
//   - Angles are DEGREES. vel, angularVelocity, maxSpeed and maxSpin are per FRAME (60 a second).
//   - Four colliders: 'dynamic' | 'static' | 'kinematic' | 'none'.
//   - Physics steps at a fixed 60 Hz whatever the monitor does.
//
// Type-check a sketch against this file:  tsc --noEmit --allowJs --checkJs docs/spashial.d.ts sketch.js

// ---- vectors ----------------------------------------------------------------

interface Vec3 { x: number; y: number; z: number }

/** A 3D vector with the usual maths, live where it hangs off a Solid:
 *  `ball.pos.set(0, 5, 0)` moves the ball. */
declare class Vector implements Vec3 {
  constructor(x?: number, y?: number, z?: number);
  x: number; y: number; z: number;
  set(x: number, y?: number, z?: number): this;
  copy(): Vector;
  add(v: Vec3 | number): this;
  sub(v: Vec3 | number): this;
  mult(n: number): this;
  mag(): number;
  normalize(): this;
  dist(v: Vec3): number;
  dot(v: Vec3): number;
  cross(v: Vec3): Vector;
}
declare function createVector(x?: number, y?: number, z?: number): Vector;

type Collider = 'dynamic' | 'static' | 'kinematic' | 'none';
type SolidShape = 'box' | 'sphere' | 'cylinder' | 'capsule' | 'cone' | 'torus' | 'hull' | 'triangles';

// ---- Solid: every 3D object ---------------------------------------------------

declare class Solid {
  /** No arguments: a 1x1x1 box in front of the camera. */
  constructor();
  constructor(x: number, y: number, z: number);
  /** One size: a cube (or a sphere of that diameter, with shape 'sphere'). */
  constructor(x: number, y: number, z: number, size: number);
  constructor(x: number, y: number, z: number, w: number, h: number, d: number);
  /** `new Solid(0, 5, 0, 2, 'static')` is a 2-unit static cube. */
  constructor(x: number, y: number, z: number, size: number, collider: Collider);
  constructor(x: number, y: number, z: number, w: number, h: number, d: number, collider: Collider);

  /** Where its centre is, live (see Vector). */
  pos: Vector;
  /** Units per frame at 60 frames a second. */
  vel: Vector;
  x: number; y: number; z: number;

  /** Euler angles in DEGREES, applied Y then X then Z (turn, pitch, roll). A
   *  setter wins over physics for that frame; for a dynamic body prefer forces. */
  rotation: Vector;
  /** Degrees per frame about each axis. */
  angularVelocity: Vector;

  /** Three sizes. Setting one resizes the collider too; a
   *  sphere has one size (`diameter`), a capsule has `diameter` and `h`. */
  w: number; h: number; d: number;
  diameter: number;
  shape: SolidShape;
  /** Visual only: the collider keeps its size. */
  scale: Vector;

  /** Any CSS colour: 'tomato', '#ff79c6'. */
  color: string;
  /** 0 = matt chalk, 1 = polished metal. */
  metalness: number;
  roughness: number;
  opacity: number;
  visible: boolean;

  collider: Collider;
  /** 0 (no bounce, the default) to 1 (bounces back as high). */
  bounciness: number;
  /** How much it grips what it slides on. The default is 0.5.
   *  Two bodies grip with the geometric mean of their frictions, so with a default of 0
   *  nothing in a 3D scene would ever stop sliding. */
  friction: number;
  /** Default 1: a 1-unit cube weighs 1 kg. */
  density: number;
  /** Setting it overrides density; a static, kinematic or 'none' solid reads 0. */
  mass: number;
  /** A cheap way to keep a body upright. true stops it
   *  tipping over (a character); the three axes are `lockRotation.x` etc. */
  lockRotation: boolean | { x?: boolean; y?: boolean; z?: boolean };

  /** How quickly it loses speed to the air, per second. Default 0.05, so a rolling ball comes to
   *  rest; 0 is none. */
  drag: number;
  /** How quickly its spin dies away, per second. Default 0.05. */
  rotationDrag: number;
  /** A multiplier on world gravity for this solid: 1 normal, 0 weightless, -1 falls upward. */
  gravityScale: number;
  /** Continuous collision, for anything fast enough to jump through a thin wall (a bullet).
   *  Costs a little more per frame; leave it off for slow things. */
  isSuperFast: boolean;
  /** The fastest it may go, units per frame like `vel`. Reads back `Infinity` when there is no limit of its own (the default); you may set `null` for the same. */
  maxSpeed: number | null;
  /** The fastest it may spin, degrees per frame like `angularVelocity`. Reads back `Infinity` when there is no limit (the default); you may set `null` for the same. */
  maxSpin: number | null;
  /** false keeps it awake even when it stops moving (default true). */
  allowSleeping: boolean;
  /** True while physics lets it rest because it stopped moving. */
  readonly sleeping: boolean;
  /** A name. After `world.ignoreCollisions('bullets', 'player')`, solids in those two groups pass
   *  through each other. null = in no group (collides with everything). */
  collisionGroup: string | null;
  /** The point it balances on, in world space (a box's is its middle; a hull's may not be). */
  readonly centerOfMass: Vector;
  /** Works the mass out again from size and density, after setting `mass` by hand. */
  resetMass(): void;
  /** Every joint this solid is part of (a copy of the list). */
  readonly joints: Joint[];

  applyForce(fx: number, fy: number, fz: number): void;
  /** Like applyForce, multiplied by the mass, so heavy and light things speed up the same. */
  applyForceScaled(fx: number, fy: number, fz: number): void;
  /** Pushes at a point in the world; an off-centre push also spins it. */
  applyForceAt(fx: number, fy: number, fz: number, x: number, y: number, z: number): void;
  applyForceAt(fx: number, fy: number, fz: number, at: Vec3): void;
  /** An instant kick (newton-seconds); a jump is `applyImpulse(0, 6, 0)`. */
  applyImpulse(ix: number, iy: number, iz: number): void;
  applyImpulseAt(ix: number, iy: number, iz: number, x: number, y: number, z: number): void;
  applyImpulseAt(ix: number, iy: number, iz: number, at: Vec3): void;
  applyTorque(tx: number, ty: number, tz: number): void;
  /** An instant spin, the way applyImpulse is an instant kick. */
  applyAngularImpulse(x: number, y: number, z: number): void;
  /** For 'kinematic' solids (a moving platform). Glides to the point during the next physics step,
   *  pushing and carrying whatever touches it, and stops there; call it every frame to follow a
   *  path. Setting `pos` instead teleports it. Throws for any other collider. */
  moveTo(x: number, y: number, z: number): void;
  moveTo(target: Vec3): void;
  /** Points the body's front (-Z) at a place or body. */
  lookAt(x: number, y: number, z: number): void;
  lookAt(target: Vec3): void;
  distanceTo(x: number, y: number, z: number): number;
  distanceTo(target: Vec3): number;
  moveTowards(target: Vec3, tracking?: number): void;
  moveAway(target: Vec3, repel?: number): void;
  /** Multiplies how big it LOOKS, on top of the current look (the collider keeps its size). */
  scaleBy(x: number, y?: number, z?: number): void;
  clone(): Solid;
  /** Takes it out of the world: it stops drawing and colliding. */
  remove(): void;
  delete(): void;
  readonly removed: boolean;
  /** Pointer interaction by ray from the camera. */
  mouse: SolidMouse;

  // The touch verbs.
  //               first frame   every frame (count)   last frame
  //   physics     collides      colliding             collided
  //   overlap     overlaps*     overlapping           overlapped
  overlaps(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
  colliding(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): number;
  collides(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
  collided(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
  overlapping(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): number;
  overlapped(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
}

interface SolidMouse {
  hovering(): boolean;
  hovers(): boolean;
  hovered(): boolean;
  presses(button?: 'left' | 'center' | 'right'): boolean;
  pressing(button?: 'left' | 'center' | 'right'): boolean;
  released(button?: 'left' | 'center' | 'right'): boolean;
}

/** Friendly shortcuts that are just solids with a shape: `new Cube(0, 1, 0)` is `new Solid(0, 1, 0, 1)`. */
declare class Cube extends Solid {}
declare class Sphere extends Solid {}
declare class Cylinder extends Solid {}
declare class Capsule extends Solid {}
declare class Cone extends Solid {}
/** A donut lying flat. Its collider is a real ring of 16 capsules (see the docs), accurate to about 2 cm,
 *  but it costs several times a sphere: a game should use few of them. */
declare class Torus extends Solid {}
/** The smallest convex shape around some points: a rock, a gem, a wedge. Points are relative to the
 *  solid's position. Needs at least 4 points, not all on one flat plane. Can be 'dynamic' (default).
 *  Its size comes from its points, so `w`, `h`, `d` can be read but not set (use `scale` for looks). */
declare class Hull extends Solid {
  constructor(x: number, y: number, z: number, points: Vec3Like[], collider?: Collider);
  readonly points: number[][];
}
/** Any shape made of triangles: a room, terrain, a bowl. Cannot be 'dynamic' (it has no mass), so it
 *  is 'static' unless you say 'kinematic'. `triangles` are lists of three positions in `vertices`.
 *  Solid from both sides: the order of a triangle's corners does not matter (so a bowl you wind
 *  the "wrong" way still holds things, and a ray from below hits it). Costs twice the triangles. */
declare class TriangleMesh extends Solid {
  constructor(x: number, y: number, z: number, vertices: Vec3Like[], triangles: number[][], collider?: Collider);
  readonly vertices: number[][];
  readonly triangles: number[][];
}
type Vec3Like = Vec3 | [number, number, number];
/** A big flat static body: a floor. `new Floor()` fills the view; `new Floor(40)` is 40 across. */
declare class Floor extends Solid { constructor(size?: number) }

// ---- Group: a list of solids that share settings -------------------------------------------------

declare class Group extends Array<Solid> {
  /** `new coins.Solid(x, y, z)` makes a body with this group's settings, in it. */
  Solid: typeof Solid;
  newSolid(x: number, y: number, z: number, size?: number): Solid;
  // Setting one of these on the group sets it on every member now and on every member made later.
  color: string;
  collider: Collider;
  bounciness: number;
  friction: number;
  density: number;
  opacity: number;
  visible: boolean;
  drag: number;
  rotationDrag: number;
  gravityScale: number;
  isSuperFast: boolean;
  maxSpeed: number | null;
  maxSpin: number | null;
  allowSleeping: boolean;
  collisionGroup: string | null;
  overlaps(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
  colliding(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): number;
  collides(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
  collided(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
  overlapping(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): number;
  overlapped(other: Solid | Group, cb?: (self: Solid, other: Solid) => void): boolean;
  applyForce(fx: number, fy: number, fz: number): void;
  /** Deletes members that fell or flew past `margin` units outside the play area. */
  cull(margin?: number, cb?: (body: Solid, n: number) => void): number;
  add(...bodies: Solid[]): number;
  contains(b: Solid): boolean;
  remove(b: Solid): void;
  delete(): void;
  amount: number;
}
declare const allSolids: Group;


// ---- joints -----------------------------------------
// A joint joins two Solids (at least one must be able to move). Angles are in degrees counted
// from the pose the two were in when the joint was made. `anchor` is where it holds, a point in
// the world; it defaults to the first solid's middle. A wrong argument throws a TypeError that
// says what to give. Removing a Solid removes its joints.

declare class Joint {
  readonly a: Solid;
  readonly b: Solid;
  readonly removed: boolean;
  /** Takes the joint away; the two solids carry on free. */
  remove(): void;
  delete(): void;
}
/** Pins two solids together at a point so they turn around a line (`axis`, default up): a door. */
declare class HingeJoint extends Joint {
  constructor(a: Solid, b: Solid, opts?: { anchor?: Vec3Like; axis?: Vec3Like; lowerLimit?: number; upperLimit?: number; friction?: number });
  /** The smallest angle it may turn to, -180 to 0; null for no limit. */
  lowerLimit: number | null;
  /** The largest angle, 0 to 180; null for no limit. */
  upperLimit: number | null;
  /** How hard it is to turn; 0 swings freely. */
  friction: number;
  /** How far it has turned from where it started, degrees. */
  readonly angle: number;
}
/** Pins two solids together at a point; they swing any way around it, like a chain link. */
declare class BallJoint extends Joint {
  constructor(a: Solid, b: Solid, opts?: { anchor?: Vec3Like });
}
/** Keeps two solids a set distance apart: a stick, a rope (`rope: true`, it can slacken but never
 *  stretch) or a spring (`spring: { hz, damping }`, hz about 1 to 3 is bouncy). `length` defaults to
 *  how far apart they are now. */
declare class DistanceJoint extends Joint {
  constructor(a: Solid, b: Solid, opts?: { length?: number; rope?: boolean; spring?: { hz: number; damping?: number } });
  length: number;
  /** How far apart the two are right now. */
  readonly distance: number;
}
/** Lets the second solid slide along a line on the first, like a drawer. Limits are distances from
 *  where it starts: lowerLimit 0 or less, upperLimit 0 or more. */
declare class SliderJoint extends Joint {
  constructor(a: Solid, b: Solid, opts?: { axis?: Vec3Like; lowerLimit?: number; upperLimit?: number });
  lowerLimit: number | null;
  upperLimit: number | null;
  /** How far it has slid from where it started. */
  readonly position: number;
}
/** Sticks two solids together where they are, so they move as one. */
declare class GlueJoint extends Joint { constructor(a: Solid, b: Solid) }

// ---- world --------------------------------------------------------------------

interface RayHit {
  solid: Solid | null;
  point: Vec3;
  /** Unit length, pointing away from the surface that was hit. */
  normal: Vec3;
  /** 0..1 along the ray. */
  fraction: number;
}

interface World {
  /** Starts at (0, 0, 0): nothing falls until `world.gravity.y = -10`. */
  gravity: Vec3;
  /** The topmost body under a screen point (what the mouse is over), or undefined. */
  getSolidAt(screenX: number, screenY: number): Solid | undefined;
  /** Closest SOLID body on the line (sensors and collider 'none' are looked
   *  through), or null. `world.rayCast(p.pos, { x: p.x, y: p.y - 1.1, z: p.z })` asks "on the ground?". */
  rayCast(from: Vec3, to: Vec3): RayHit | null;
  /** Every body along the line, nearest first. */
  rayCastAll(from: Vec3, to: Vec3): RayHit[];
  /** Radial impulse; falloff 0..1 is the share left at the rim. */
  explodeAt(x: number, y: number, z: number, radius?: number, magnitude?: number, falloff?: number): void;
  allowSleeping: boolean;
  /** Default true. false hands stepping to physicsUpdate(). */
  autoStep: boolean;
  physicsUpdate(step?: number): void;
  /** `world.ignoreCollisions('bullets', 'player')`: solids in those two collisionGroups pass through
   *  each other. With one name, members of that group pass through each other. At most 32 groups. */
  ignoreCollisions(a: string, b?: string): void;
  /** Puts it back. */
  restoreCollisions(a: string, b?: string): void;
  /** More solver steps hold stacks and joints steadier and cost more time. Default 10. */
  solverSteps: number;
  /** Seconds a resting solid waits before it goes to sleep. Default 0.5. */
  sleepDelay: number;
  /** Slower than this (units per frame) counts as resting. Default 0.0005. */
  sleepSpeed: number;
  /** Hits slower than this (units per frame) do not bounce. Default about 0.017; 0 lets every hit bounce. */
  minBounceSpeed: number;
  /** Every joint in the world (a copy of the list). */
  readonly joints: Joint[];
}
declare const world: World;

// ---- camera and light ---------------------------------------------------------

interface Camera {
  pos: Vector;
  x: number; y: number; z: number;
  /** Degrees. Default 60. */
  fov: number;
  /** Points the camera at a place or body. */
  lookAt(x: number, y: number, z: number): void;
  lookAt(target: Vec3): void;
  /** Follows a body from behind and above, smoothly. `tracking` is the share of the gap closed each frame. */
  follow(target: Solid, opts?: { distance?: number; height?: number; tracking?: number }): void;
  /** Circles a point. Mouse drag turns it when `drag` is true. */
  orbit(target: Vec3, opts?: { distance?: number; drag?: boolean }): void;
  /** Stops follow() or orbit() and leaves the camera where it is. */
  free(): void;
}
declare const camera: Camera;

interface AmbientLight { color: string; intensity: number }
interface SunLight {
  color: string;
  intensity: number;
  /** The way the light travels, like [-0.4, -1, -0.6]. Nearly straight down puts a shadow right under things. */
  direction: Vec3;
  /** Off by default. On: solids cast soft shadows, in a box 40 across that follows what the camera looks
   *  at (so it works wherever the action is). Costs some GPU time on integrated graphics. */
  shadows: boolean;
}
declare const ambientLight: AmbientLight;
declare const sunLight: SunLight;
declare class PointLight {
  constructor(x: number, y: number, z: number, color?: string, intensity?: number);
  pos: Vector; color: string; intensity: number; remove(): void;
}
declare class SpotLight {
  constructor(x: number, y: number, z: number, color?: string, intensity?: number);
  pos: Vector; color: string; intensity: number; angle: number; lookAt(target: Vec3): void; remove(): void;
}

/** The sky colour: a CSS colour or a grey 0-255. */
declare function background(c: string | number): void;

// ---- how fast it draws on an integrated GPU -----------------------------------
// The primary target is a desktop with integrated graphics, so cheap is the
// default and every expensive thing is opt-in.

/** 'auto' (default) lowers the render scale when frames run long and raises it
 *  again when there is room. 'low' | 'medium' | 'high' fix it. */
declare let quality: 'auto' | 'low' | 'medium' | 'high';
/** Draws frame time, draw calls and triangle count in a corner. */
declare function showPerf(on?: boolean): void;

// ---- the hooks -------------------------------------------

declare function setup(): void;
/** Before the physics step, 60 times a second whatever the screen does. */
declare function update(step: number): void;
/** After physics, before bodies render: a 2D layer UNDER the scene is not a
 *  thing in 3D, so use this for scene setup that changes each frame (background). */
declare function draw(): void;
/** After the scene renders, in 2D screen space: the HUD. text(), fill(), rect(),
 *  circle() and line() draw on top of the scene. */
declare function drawTop(): void;
declare function preload(): void;
/** `new Canvas(w, h)`: sets the size of the 3D canvas, in CSS pixels. Without it the canvas fills the frame. */
declare class Canvas { constructor(w: number, h: number) }

// ---- input -----------------------------------

interface Kb {
  presses(key?: string): boolean;
  pressing(key?: string): number;
  released(key?: string): boolean;
}
declare const kb: Kb;
interface Mouse {
  x: number; y: number;
  presses(button?: 'left' | 'center' | 'right'): boolean;
  pressing(button?: 'left' | 'center' | 'right'): number;
  released(button?: 'left' | 'center' | 'right'): boolean;
  /** Pointer lock for first-person look: `mouse.lock()`; `mouse.moved` is the turn since last frame. */
  lock(): void;
  moved: { x: number; y: number };
}
declare const mouse: Mouse;

// ---- time and maths ----------------------------------------------------------

declare const frameCount: number;
declare const deltaTime: number;
declare const width: number;
declare const height: number;
declare function random(a?: number, b?: number): number;
declare function degrees(rad: number): number;
declare function radians(deg: number): number;


// ---- the 2D layer for drawTop() ----------------------------------------------------
// These draw on a transparent layer over the finished picture, in CSS pixels from the top left.
// They only mean something inside drawTop() (anything drawn elsewhere is wiped each frame).

/** A fill colour: a CSS colour, a grey 0-255, or (r, g, b). */
declare function fill(c: string | number, g?: number, b?: number): void;
declare function noFill(): void;
declare function stroke(c: string | number): void;
declare function noStroke(): void;
declare function strokeWeight(n: number): void;
/** Text height in pixels. Default 16. */
declare function textSize(n: number): void;
declare function textAlign(a: 'left' | 'center' | 'right'): void;
declare function text(s: string | number, x: number, y: number): void;
declare function rect(x: number, y: number, w: number, h: number): void;
/** `d` is the diameter. */
declare function circle(x: number, y: number, d: number): void;
declare function line(x1: number, y1: number, x2: number, y2: number): void;
declare const LEFT: 'left';
declare const RIGHT: 'right';
declare const CENTER: 'center';
declare const STATIC: 'static';
declare const DYNAMIC: 'dynamic';
declare const KINEMATIC: 'kinematic';

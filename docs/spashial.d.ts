// spaSHial API typings. Everything in this file is built and tested; each doc comment is also
// the line the docs reference shows for that name. Keep this file in step with spashial.js.
//
// What is NOT here, because the engine does not do it yet: height-map terrain, vehicles,
// ragdolls, motorised joints and model animations. See docs/ "Planned".
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
  set(v: Vec3Like): this;
  copy(): Vector;
  add(v: Vec3Like | number): this;
  sub(v: Vec3Like | number): this;
  mult(n: number): this;
  div(n: number): this;
  mag(): number;
  normalize(): this;
  dist(v: Vec3Like): number;
  dot(v: Vec3Like): number;
  cross(v: Vec3Like): Vector;
}
declare function createVector(x?: number, y?: number, z?: number): Vector;

type Collider = 'dynamic' | 'static' | 'kinematic' | 'none';
type SolidShape = 'box' | 'sphere' | 'cylinder' | 'capsule' | 'cone' | 'torus' | 'hull' | 'triangles';

// ---- Solid: every 3D object -------------------------------------------------

declare class Solid {
  /** No arguments: a 1x1x1 box in front of the camera. */
  constructor();
  /** At the camera's target: `new Solid('none')`. */
  constructor(collider: Collider);
  constructor(x: number, y: number, z: number);
  /** One size: a cube (or a sphere of that diameter, with shape 'sphere'). */
  constructor(x: number, y: number, z: number, size: number);
  /** The collider can follow the position: `new Cube(0, 0, 0, 'static')`. */
  constructor(x: number, y: number, z: number, collider: Collider);
  constructor(x: number, y: number, z: number, w: number, h: number, d: number);
  /** `new Solid(0, 5, 0, 2, 'static')` is a 2-unit static cube. */
  constructor(x: number, y: number, z: number, size: number, collider: Collider);
  constructor(x: number, y: number, z: number, w: number, h: number, d: number, collider: Collider);

  /** Where its centre is, live (see Vector). */
  /** Reads a live vector (`a.pos.y += 1` moves it); set a list or a vector: `a.pos = [0, 2, 0]`. */
  get pos(): Vector;
  set pos(v: Vec3Like);
  /** Units per frame at 60 frames a second. */
  get vel(): Vector;
  set vel(v: Vec3Like);
  x: number; y: number; z: number;

  /** Euler angles in DEGREES, applied Y then X then Z (turn, pitch, roll). A
   *  setter wins over physics for that frame; for a dynamic body prefer forces. */
  get rotation(): Vector;
  set rotation(v: Vec3Like);
  /** Degrees per frame about each axis. */
  get angularVelocity(): Vector;
  set angularVelocity(v: Vec3Like);

  /** Three sizes. Setting one resizes the collider too; a
   *  sphere has one size (`diameter`), a capsule has `diameter` and `h`. */
  w: number; h: number; d: number;
  diameter: number;
  get shape(): SolidShape;
  /** 'triangles' cannot be chosen: make a TriangleMesh. 'hull' wraps the solid's model. */
  set shape(v: Exclude<SolidShape, 'triangles'> | 'cube');
  /** How big it is DRAWN (the collider keeps its size). Set a number for all three, or a list. */
  get scale(): Vector;
  set scale(v: number | Vec3Like);
  /** Multiplies the scale: `scaleBy(2)` doubles it, `scaleBy(1, 2, 1)` stretches it up. */
  scaleBy(x: number, y?: number, z?: number): void;

  /** Any CSS colour: 'tomato', '#ff79c6'. */
  get color(): string;
  /** A CSS colour, or a grey 0-255. */
  set color(v: string | number);
  /** A picture wrapped onto the shape: a built-in name (`textureNames()`: 'checker', 'grid', 'bricks',
   *  'planks', 'stripes', 'dots', 'grass', 'stone'), a name given to `registerTexture()`, or a web
   *  address / data: URL. null goes back to the plain colour. An unknown name throws and lists the
   *  choices. A web address shows the plain colour until it arrives (start it in `preload()` to have
   *  it ready before `setup()`). `color` tints the picture; a textured solid whose colour you have not
   *  set draws white, so the picture shows as it is. */
  texture: string | null;
  /** How many times the picture repeats across the shape: set a number, or [across, up] (or a vector);
   *  reading gives a vector with x = across, y = up. Default 1. A hull or triangle mesh gets the picture
   *  projected over its box. */
  get textureRepeat(): Vector;
  set textureRepeat(v: number | [number, number] | Vec3);
  /** A glTF model (.glb or .gltf): a name given to `registerModel()`, or a web address / data: URL.
   *  It draws instead of the shape, fitted inside the solid's w, h, d box (keeping its proportions) and
   *  centred. The collider stays the shape, or set `shape = 'hull'` after the model has loaded to wrap
   *  it. An unknown name throws and says how to give one. A web address shows the shape until it
   *  arrives (start it in `preload()` to have it ready before `setup()`). Its own colours and
   *  pictures are used: `color` and `texture` do not change it. null goes back to the shape. */
  model: string | null;
  /** 0 = matt chalk, 1 = polished metal. */
  metalness: number;
  roughness: number;
  opacity: number;
  visible: boolean;
  /** Draws the collider's outline in green, to see what really touches (a model's hull, a torus's ring of
   *  capsules). The outline follows the solid and is not scaled by `scale`. */
  debug: boolean;

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
   *  tipping over (a character). To lock single axes set an object: `lockRotation = { x: true, z: true }`;
   *  once it is an object its parts can be set one at a time (`lockRotation.y = true`). */
  lockRotation: boolean | { x?: boolean; y?: boolean; z?: boolean };
  /** Keeps it from moving along an axis: `{ z: true }` for a side-scroller, or true for all three. It stops
   *  FORCES and velocity moving it (a 'dynamic' solid); a 'kinematic' one that you move with `moveTo()` or `pos` goes
   *  where you tell it. */
  lockPosition: boolean | { x?: boolean; y?: boolean; z?: boolean };
  /** Billboard label above the body, always facing the camera. */
  text: string | number | null;
  /** Any CSS colour; default white (the letters have a dark edge so they read on any background). */
  textColor: string;
  /** How tall the letters are, in world units. Default 0.6. */
  textSize: number;

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
  /** The fastest it may go, units per frame like `vel`. Infinity (the default) means no limit of your OWN: the
   *  physics engine's own cap still holds, 8.33 units per frame (500 m/s). A bigger number than that raises it. */
  get maxSpeed(): number;
  set maxSpeed(v: number | null);
  /** The fastest it may spin, degrees per frame like `angularVelocity`. Infinity (the default) means the physics
   *  engine's own cap, 45 degrees per frame; a bigger number raises it. */
  get maxSpin(): number;
  set maxSpin(v: number | null);
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
  applyForceAt(fx: number, fy: number, fz: number, at: Vec3Like): void;
  /** An instant kick (newton-seconds): the speed it gives is the impulse divided by the mass, in metres per
   *  second, so for a 1 kg cube `applyImpulse(0, 6, 0)` is a jump of 6 m/s, which reads back as `vel.y = 0.1`
   *  (vel is per frame). Use applyForceScaled / a speed on `vel` for something mass-independent. */
  applyImpulse(ix: number, iy: number, iz: number): void;
  applyImpulseAt(ix: number, iy: number, iz: number, x: number, y: number, z: number): void;
  applyImpulseAt(ix: number, iy: number, iz: number, at: Vec3Like): void;
  applyTorque(tx: number, ty: number, tz: number): void;
  /** An instant spin, the way applyImpulse is an instant kick. */
  applyAngularImpulse(x: number, y: number, z: number): void;
  /** For 'kinematic' solids (a moving platform). Glides to the point during the next physics step,
   *  pushing and carrying whatever touches it, and stops there; call it every frame to follow a
   *  path. Setting `pos` instead teleports it. Throws for any other collider. */
  moveTo(x: number, y: number, z: number): void;
  moveTo(target: Vec3Like): void;
  /** Points the body's front (-Z) at a place or body. */
  lookAt(x: number, y: number, z: number): void;
  lookAt(target: Vec3Like): void;
  distanceTo(x: number, y: number, z: number): number;
  distanceTo(target: Vec3Like): number;
  moveTowards(target: Vec3Like, tracking?: number): void;
  moveAway(target: Vec3Like, repel?: number): void;
  clone(): Solid;
  /** Takes it out of the world: it stops drawing and colliding. */
  remove(): void;
  /** True once it has been removed. */
  readonly removed: boolean;
  delete(): void;
  /** Pointer interaction by ray from the camera. */
  mouse: SolidMouse;

  // The callback of `collides` / `colliding` / `collided` gets a third argument, `hit`: { point, normal, speed } of
  // the first frame of the contact (nothing for a 'none' overlap): break on a hard hit, play a landing sound.
  // The touch verbs. They report the contacts the PHYSICS sees, from
  // the step after something touches: a 'none' zone against anything that moves is the usual overlap, and
  // any two solids that are touching collide. Two 'static' solids never touch in physics, so they never
  // report either (a zone is a 'none' solid), and before the first physics step nothing has touched yet.
  //               first frame   every frame (count)   last frame
  //   physics     collides      colliding             collided
  //   overlap     overlaps*     overlapping           overlapped
  overlaps(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
  colliding(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): number;
  collides(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
  collided(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
  overlapping(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): number;
  overlapped(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
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
  readonly points: [number, number, number][];
}
/** Any shape made of triangles: a room, terrain, a bowl. Cannot be 'dynamic' (it has no mass), so it
 *  is 'static' unless you say 'kinematic'. `triangles` are lists of three positions in `vertices`.
 *  Solid from both sides: the order of a triangle's corners does not matter (so a bowl you wind
 *  the "wrong" way still holds things, and a ray from below hits it). Costs twice the triangles. */
declare class TriangleMesh extends Solid {
  constructor(x: number, y: number, z: number, vertices: Vec3Like[], triangles: number[][], collider?: Collider);
  readonly vertices: [number, number, number][];
  readonly triangles: [number, number, number][];
}
type Vec3Like = Vec3 | [number, number, number];
/** A big flat static body: a floor. `new Floor()` fills the view; `new Floor(40)` is 40 across. */
declare class Floor extends Solid { constructor(size?: number) }

// ---- Group: a list of solids that share settings -------------------------------------------------

declare class Group extends Array<Solid> {
  /** `new coins.Solid(x, y, z)` makes a body with this group's settings, in it. */
  Solid: typeof Solid;
  /** The settings below are what NEW members get; one nobody has set reads `undefined`. */
  newSolid(x: number, y: number, z: number, size?: number): Solid;
  // Setting one of these on the group sets it on every member now and on every member made later.
  color?: string | number;
  texture?: string | null;
  textureRepeat?: number | [number, number] | Vec3;
  model?: string | null;
  collider?: Collider;
  bounciness?: number;
  friction?: number;
  density?: number;
  opacity?: number;
  visible?: boolean;
  drag?: number;
  rotationDrag?: number;
  gravityScale?: number;
  isSuperFast?: boolean;
  maxSpeed?: number | null;
  maxSpin?: number | null;
  allowSleeping?: boolean;
  collisionGroup?: string | null;
  debug?: boolean;
  lockRotation?: boolean | { x?: boolean; y?: boolean; z?: boolean };
  lockPosition?: boolean | { x?: boolean; y?: boolean; z?: boolean };
  mass?: number;
  overlaps(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
  colliding(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): number;
  collides(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
  collided(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
  overlapping(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): number;
  overlapped(other: Solid | Group, cb?: (self: Solid, other: Solid, hit?: Impact) => void): boolean;
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

/** Builds a level from layers of text, bottom layer first. A row's characters run along +x and the
 *  rows along +z (the text reads like a map from above); layers go up +y. (x, y, z) is the middle of
 *  the first cell, `cell` its size (default 1). Each character the legend names becomes one
 *  `group.newSolid()` there, so the group's settings (collider, colour, texture) apply. A space or a
 *  dot is empty; any other character the legend lacks throws and says where it is. One layer can be
 *  given as a plain list of rows. The Tiles object is a Group of everything it made. */
declare class Tiles extends Group {
  constructor(layers: string[][] | string[], x: number, y: number, z: number, cell?: number, legend?: Record<string, Group>);
}

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
  constructor(a: Solid, b: Solid, opts?: { anchor?: Vec3Like; axis?: Vec3Like; lowerLimit?: number | null; upperLimit?: number | null; friction?: number });
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
  constructor(a: Solid, b: Solid, opts?: { axis?: Vec3Like; lowerLimit?: number | null; upperLimit?: number | null });
  lowerLimit: number | null;
  upperLimit: number | null;
  /** How far it has slid from where it started. */
  readonly position: number;
}
/** Sticks two solids together where they are, so they move as one. */
declare class GlueJoint extends Joint { constructor(a: Solid, b: Solid) }

// ---- world --------------------------------------------------------------------

interface RayOptions { ignore?: Solid | Solid[] | Group }
/** The third argument of a collision callback: where, which way and how hard. */
interface Impact {
  /** The place they touched. */
  readonly point: Vector;
  /** Unit length, pointing from the solid you asked toward the other one. */
  readonly normal: Vector;
  /** How fast they were closing along the normal, in units per frame like `vel`. A hard landing is a big number. */
  readonly speed: number;
}
interface RayHit {
  solid: Solid | null;
  point: Vector;
  /** Unit length, pointing away from the surface that was hit. */
  normal: Vector;
  /** 0..1 along the ray. */
  fraction: number;
}

interface World {
  /** Starts at (0, 0, 0): nothing falls until `world.gravity.y = -10`. */
  get gravity(): Vector;
  set gravity(v: Vec3Like);
  /** (It tests the solid's collider shape, not its `scale`; a solid that is hidden, fully transparent or scaled to nothing is skipped.)
   *  The topmost VISIBLE body under a screen point (what the mouse is over), or undefined. A visible `'none'` solid (a coin,
   *  a button) can be pointed at; hide a trigger zone (`visible = false`) to look through it. */
  getSolidAt(screenX: number, screenY: number): Solid | undefined;
  /** Closest SOLID body on the line (sensors and collider 'none' are looked through), or null. A ray that
   *  STARTS inside a solid does not hit that solid, so `world.rayCast(p.pos, [p.x, p.y - 0.6, p.z])` from a
   *  player's centre asks "is there ground under my feet?". To skip a body the ray would cross (the shooter):
   *  `world.rayCast(from, to, { ignore: shooter })` (a Solid or a list); with two points a bare `shooter` works too. */
  rayCast(from: Vec3Like, to: Vec3Like, opts?: RayOptions | Solid | Group): RayHit | null;
  rayCast(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, opts?: RayOptions): RayHit | null;
  /** Every solid along the line, nearest first, each ONCE (a torus or a closed mesh is crossed several times). */
  rayCastAll(from: Vec3Like, to: Vec3Like, opts?: RayOptions | Solid | Group): RayHit[];
  rayCastAll(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, opts?: RayOptions): RayHit[];
  /** Radial impulse; falloff 0..1 is the share left at the rim. */
  explodeAt(x: number, y: number, z: number, radius?: number, magnitude?: number, falloff?: number): void;
  explodeAt(at: Vec3Like, radius?: number, magnitude?: number, falloff?: number): void;
  allowSleeping: boolean;
  /** Default true. false hands stepping to physicsUpdate(), which always advances one fixed 1/60 s step. */
  autoStep: boolean;
  physicsUpdate(): void;
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
  get pos(): Vector;
  set pos(v: Vec3Like);
  x: number; y: number; z: number;
  /** Degrees. Default 60. */
  fov: number;
  /** Points the camera at a place or body. */
  lookAt(x: number, y: number, z: number): void;
  lookAt(target: Vec3Like): void;
  /** Follows a body from behind and above, smoothly. `tracking` is the share of the gap closed each frame. */
  follow(target: Solid, opts?: { distance?: number; height?: number; tracking?: number }): void;
  /** Circles a point. Mouse drag turns it when `drag` is true. */
  orbit(target: Vec3Like, opts?: { distance?: number; drag?: boolean }): void;
  /** Stops follow() or orbit() and leaves the camera where it is. */
  free(): void;
}
declare const camera: Camera;

interface AmbientLight { color: string; intensity: number }
interface SunLight {
  color: string;
  intensity: number;
  /** The way the light travels, like [-0.4, -1, -0.6]. Nearly straight down puts a shadow right under things. */
  get direction(): Vector;
  set direction(v: Vec3Like);
  /** Off by default. On: solids cast soft shadows, in a box 40 across that follows what the camera looks
   *  at (so it works wherever the action is). Costs some GPU time on integrated graphics. */
  shadows: boolean;
}
declare const ambientLight: AmbientLight;
declare const sunLight: SunLight;
declare class PointLight {
  constructor(x: number, y: number, z: number, color?: string, intensity?: number);
  get pos(): Vector; set pos(v: Vec3Like);
  color: string; intensity: number; remove(): void;
}
declare class SpotLight {
  constructor(x: number, y: number, z: number, color?: string, intensity?: number);
  get pos(): Vector; set pos(v: Vec3Like);
  color: string; intensity: number; angle: number; lookAt(x: number, y: number, z: number): void; lookAt(target: Vec3Like): void; remove(): void;
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

// ---- the 2D layer drawn over the picture, in drawTop() --------------------------------------------------
// Pixels from the top-left corner of the picture. Colours: 'tomato', '#ff79c6', a grey 0-255, or r, g, b.
declare function fill(colour: string | number): void;
declare function fill(r: number, g: number, b: number): void;
declare function noFill(): void;
declare function stroke(colour: string | number): void;
declare function noStroke(): void;
declare function strokeWeight(pixels: number): void;
declare function textSize(pixels: number): void;
declare function textAlign(align: 'left' | 'center' | 'right'): void;
/** A rectangle with its top-left corner at (x, y). */
declare function rect(x: number, y: number, w: number, h: number): void;
/** A circle centred on (x, y), `d` pixels across. */
declare function circle(x: number, y: number, d: number): void;
declare function line(x1: number, y1: number, x2: number, y2: number): void;
/** Words or a number, with the top-left of the text at (x, y). */
declare function text(value: string | number, x: number, y: number): void;
declare const LEFT: 'left';
declare const RIGHT: 'right';
declare const CENTER: 'center';
/** The colliders, as words: `new Cube(0, 0, 0, STATIC)`. */
declare const STATIC: 'static';
declare const DYNAMIC: 'dynamic';
declare const KINEMATIC: 'kinematic';

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

// ---- time, maths, saving, textures, models and sound -------------

declare const frameCount: number;
declare const deltaTime: number;
declare const width: number;
declare const height: number;
declare function random(a?: number, b?: number): number;
declare function degrees(rad: number): number;
declare function radians(deg: number): number;
/** Saves a number, text, list or object under a name; it is still there the next time the sketch runs.
 *  A function, `undefined`, something that refers to itself, or more than 100 KB throws and says why.
 *  The host page keeps the values (the preview has no storage of its own): see the embedding guide. */
declare function storeItem(name: string, val: any): void;
/** Reads back a value saved with storeItem(), or null if there is none. */
declare function getItem(name: string): any;
/** Forgets the value saved under a name. */
declare function removeItem(name: string): void;
/** Forgets every value saved with storeItem; saved pictures, sounds, fonts and models are kept. */
declare function clearStorage(): void;
/** The names a `texture` accepts: the built-in patterns and anything given to registerTexture(). */
declare function textureNames(): string[];
/** Gives a picture a name: `registerTexture('hero', 'data:image/png;base64,...')` (or a web address
 *  on a server that allows it, with CORS), then `solid.texture = 'hero'`. A host page uses this to hand a sketch its saved art. */
declare function registerTexture(name: string, source: string): void;
/** Starts loading a texture now. In `preload()`, `setup()` waits for it. */
declare function loadTexture(nameOrUrl: string): { readonly name: string; readonly ready: boolean; readonly failed: boolean };
/** Parts of one sound file to play on their own: `{ jump: [startSeconds, endSeconds] }`. */
interface SoundClips { [name: string]: [number, number] }
/** A sound to play. Browsers only start audio after the first
 *  click or key press in the sketch, so click the picture first. Until then, if the browser still has sound off, `play()` does nothing and says so once (a few browsers, and headless test browsers, allow sound at once). */
declare class Sound {
  constructor(nameOrUrl: string, opts?: { clips?: SoundClips });
  readonly url: string;
  /** Starts a NEW voice every call, so quick repeats overlap. With a clip name, plays just that slice. */
  play(clip?: string): unknown;
  /** The one looping voice (safe to call every frame). Starts when the file arrives. */
  loop(clip?: string): unknown;
  /** Plays once from a place in the world: quieter the further it is from the camera (full volume within
   *  5 units, half at 15) and panned toward the side of the screen it is on. Give x, y, z, a [x, y, z]
   *  list, or anything with x, y and z (a Solid). */
  playAt(x: number, y: number, z: number, clip?: string): unknown;
  playAt(where: Vec3 | [number, number, number], clip?: string): unknown;
  /** Stops it but remembers the place; the next loop() carries on from there. */
  pause(): void;
  /** Stops every voice and forgets the place. */
  stop(): void;
  readonly paused: boolean;
  readonly playing: boolean;
  /** 0 to 1. Setting anything but a number throws. */
  volume: number;
  /** -1 left, 0 centre, 1 right. */
  pan: number;
  /** Speed, which also changes pitch. Above 0. */
  rate: number;
  /** Ramps the volume to `to` over `seconds` (default 0.5). */
  fade(to: number, seconds?: number): Sound;
  /** 0 until the file has loaded, then its length in seconds. */
  readonly duration: number;
  readonly loaded: boolean;
  /** True if the browser refused to start audio. */
  readonly blocked: boolean;
}
/** A built-in sound ('blip', 'coin', 'jump', 'hit', 'explode', 'laser', 'pop', 'thud': made in code, nothing
 *  to download), a name from `registerSound()`, or a sound file's web address / data: URL. In `preload()`,
 *  `setup()` waits for it. A bad name throws and lists the choices; a file that cannot be loaded says so
 *  once and stays silent. */
declare function loadSound(nameOrUrl: string, opts?: { clips?: SoundClips }): Sound;
/** The names `loadSound` accepts: the built-ins and anything given to registerSound(). */
declare function soundNames(): string[];
/** Gives a sound file a name: `registerSound('boom', 'https://.../boom.mp3')` (or a data: URL), then
 *  `loadSound('boom')`. A host page uses this to hand a sketch its sounds. */
declare function registerSound(name: string, source: string): void;
/** The level of everything, 0 to 1. With no argument, reads it. */
declare function masterVolume(level?: number): number;
/** Gives a model a name: `registerModel('ship', 'https://.../ship.glb')`, then `solid.model = 'ship'`.
 *  A host page uses this to hand a sketch its models. */
declare function registerModel(name: string, source: string): void;
/** The names given to registerModel(). */
declare function modelNames(): string[];
/** Starts loading a model now. In `preload()`, `setup()` waits for it. */
declare function loadModel(nameOrUrl: string): { readonly name: string; readonly ready: boolean; readonly failed: boolean };

// ---- online play ----------------------------------------------------------------------------
// Rooms, seats, moves and a lobby. A shared body carries a 3D pose (position AND rotation). A sketch cannot
// reach a server itself, so the HOST PAGE serves the rooms: embed.js does it with no server, between two
// tabs of one browser (see the docs, page Online play).

type MultiplayerMode = 'none' | 'local' | 'coop' | 'versus';
/** Call it in setup(). 'local': several players on one computer (turn-taking). 'coop' and 'versus': online,
 *  with a lobby bar above the picture. Adds `game`, `players`, `turn`, `nextTurn()` and `myTurn()` (and, online,
 *  `seat`) where your sketch has no name of its own. With `{ realtime: true }` bodies can be shared live. */
declare function multiplayer(mode: MultiplayerMode, players?: number, opts?: { realtime?: boolean }): typeof game;
/** After multiplayer() is called: where the game stands. */
declare const game: { readonly mode: MultiplayerMode; readonly players: number; readonly ready: boolean; readonly turn: number;
  readonly seat: number | null; readonly code: string | null; readonly realtime: boolean; readonly status: string };
/** Added by multiplayer() (unless your sketch has a variable of the same name): how many take part, whose turn it is
 *  (0 up), and, online, your seat. */
declare let players: number;
declare let turn: number;
declare let seat: number | null;
/** Passes the turn on to the next player (wraps round) and returns the new turn. */
declare function nextTurn(): number;
/** True when this computer may move now: always for 'local'; in 'versus' only on your seat's turn. */
declare function myTurn(): boolean;
declare const online: {
  /** 'off' | 'connecting' | 'waiting' (alone in the room) | 'ready' | 'closed' | 'error' */
  readonly status: string;
  /** The 4-picture-letter room code, or null. */
  readonly code: string | null;
  /** Your place: 0 is the host. null while you are not in a room. */
  readonly seat: number | null;
  readonly seats: number;
  readonly players: unknown[];
  readonly isHost: boolean;
  /** True in a real-time room (one made with `{ realtime: true }`). */
  readonly live: boolean;
  /** The room code as picture names (one per letter), or null; a lobby uses them to draw the code. */
  readonly codeIcons: string[] | null;
  /** The last problem, in plain words, or null. */
  readonly error: string | null;
  host(players?: number): void;
  join(code: string): void;
  leave(): void;
  /** Sends a move: numbers, booleans and short words only, at most 1 KB. Every move, yours included, comes
   *  back through onMove in the same order for everyone. */
  send(move: unknown): void;
  onMove(fn: (move: any, seat: number) => void): void;
  /** Real-time rooms only. Shares 1 to 8 of your Solids at 15 Hz (a still one once a second): each carries
   *  its position AND rotation, size, shape and colour. Others see it as a ghost Solid (collider 'none',
   *  drawn 100 ms behind and smoothed). A removed Solid is unshared by itself. */
  share(...bodies: Solid[]): void;
  unshare(body?: Solid): void;
  /** The ghosts of each other player's shared Solids, by seat. */
  readonly peers: Record<number, Solid[] | undefined>;
  sharedBy(seat: number): Solid[];
};


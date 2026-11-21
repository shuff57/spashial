/// <reference path="../docs/spashial.d.ts" />
// Representative STUDENT sketches, type-checked against the published declarations by
// tests/types.test.mjs. Every line is something a student can really write and the engine
// really accepts; if the declarations forbid it, that is a bug in the declarations. (Found by a council
// review: seven ordinary lines used to fail to compile.)

// -- making things: every constructor form, a collider after the position, lists and numbers to set
const ground = new Floor();
const wall = new Cube(0, 0, 0, 'static');
const crate = new Cube(1, 2, 3, 2);
const slab = new Cube(0, 0, 0, 4, 0.5, 4, 'static');
const ball = new Sphere(0, 3, 0, 1, 'dynamic');
wall.pos = [0, 1, 2];
wall.pos = { x: 1, y: 2, z: 3 };
wall.pos.y += 1;
crate.vel = [0, 0, 0.1];
crate.rotation = [0, 45, 0];
crate.angularVelocity = [0, 1, 0];
crate.scale = 2;
crate.scale = [1, 2, 1];
if (crate.removed) crate.remove();

// -- physics properties
ball.drag = 0.1; ball.rotationDrag = 0; ball.gravityScale = 0.5; ball.isSuperFast = true;
ball.maxSpeed = 2; ball.maxSpin = null; ball.allowSleeping = false; ball.collisionGroup = 'bullets';
ball.applyForceAt(0, 5, 0, 1, 0, 0);
ball.applyImpulseAt(0, 5, 0, { x: 1, y: 0, z: 0 });
slab.moveTo(1, 2, 3);
world.ignoreCollisions('bullets', 'player');
world.solverSteps = 12;

// -- rays that skip the shooter, and the impact a collision callback gets
const feet = world.rayCast(ball.pos, [ball.x, ball.y - 0.6, ball.z]);
world.rayCast(ball.pos, [0, -1, 0], { ignore: ball });
world.rayCast(0, 0, 0, 0, -1, 0, { ignore: [ball, crate] });
world.rayCast(ball.pos, [0, -1, 0], ball);
world.rayCastAll(0, 5, 0, 0, -5, 0, { ignore: crate })[0]?.solid;
ball.collides(wall, (self, other, hit) => { if (hit && hit.speed > 0.1 && hit.normal.y < -0.5) self.remove(); });
ball.lockPosition = { z: true };
crate.lockPosition = true;

// -- groups cascade every one of those, and Tiles builds a level
const walls = new Group();
walls.collider = 'static'; walls.texture = 'bricks'; walls.textureRepeat = 3; walls.debug = true;
walls.lockRotation = true; walls.lockPosition = { z: true }; walls.mass = 3; walls.drag = 0; walls.collisionGroup = 'world'; walls.opacity = 0.8;
const level = new Tiles(['###', '# #', '###'], 0, 0.5, 0, 1, { '#': walls });
level.amount;
walls.overlaps(ball, (self, other) => { self.remove(); });

// -- joints, textures, models, text, sound, saving
const hinge = new HingeJoint(wall, crate, { anchor: [0, 1, 0], axis: [0, 0, 1], lowerLimit: -45, upperLimit: 45 });
hinge.angle;
new DistanceJoint(wall, crate, { length: 3, rope: true });
new SliderJoint(wall, crate, { axis: [1, 0, 0], lowerLimit: -1, upperLimit: 2 });
registerTexture('hero', 'data:image/png;base64,AAAA');
registerModel('ship', 'https://example.com/ship.glb');
loadModel('ship').ready;
crate.texture = 'hero'; crate.textureRepeat = [2, 2]; crate.model = 'ship'; crate.text = 'score 3'; crate.textColor = 'gold'; crate.debug = true;
const pop = loadSound('coin');
pop.play(); pop.playAt(crate); pop.playAt(1, 2, 3); pop.volume = 0.5;
masterVolume(0.8);
storeItem('best', { n: 1 });
const best: any = getItem('best');
removeItem('best'); clearStorage();

// -- the hooks, the keyboard and the mouse
function preload() { loadSound('jump'); }
function setup() { world.gravity.y = -10; camera.follow(ball, { distance: 9, height: 5 }); sunLight.shadows = true; }
function update() { if (kb.pressing('a')) ball.vel.x = -0.1; if (kb.presses('space')) ball.applyImpulse(0, 7, 0); }
function drawTop() { fill('white'); text('x ' + width, 12, 12); }

// -- online play
multiplayer('local');
multiplayer('local', 3);
multiplayer('coop', 2, { realtime: true });
const game2 = multiplayer('versus', 2);
online.share(ball);
online.onMove((move, seat) => { if (seat === online.seat) nextTurn(); });
if (myTurn() && online.status === 'ready') online.send({ n: turn });
online.peers[0]?.forEach((g) => g.color);

const live: boolean = online.live;
const icons: string[] | null = online.codeIcons;
const mySeat: number | null = online.seat;

// -- vectors and lights accept lists and objects; Group defaults nobody set read as undefined (council round 3)
world.gravity = [0, -10, 0];
camera.pos = [0, 3, 7];
sunLight.direction = [-0.4, -1, -0.6];
new PointLight(0, 1, 0).pos = { x: 0, y: 2, z: 0 };
createVector().set([1, 2, 3]);
createVector(2, 4, 6).div(2).mag();
new SpotLight(0, 2, 0).lookAt(0, 0, 0);
world.rayCast([0, 5, 0], [0, -5, 0])?.point.dist(createVector());
// @ts-expect-error an unset Group default reads as undefined: check it before using it
const unsetMass: number = new Group().mass;

// -- ordinary tuple arguments, null limits, scaleBy, speed limits (council round 4)
const raft = new Cube(0, 0, 0, 'kinematic');
const marker = new Cube(0, 0, 0, 'none');
const aim: [number, number, number] = [1, 2, 3];
raft.moveTo(aim); raft.lookAt(aim); raft.moveTowards(aim, 0.5); raft.moveAway(aim); raft.distanceTo(aim);
raft.applyForceAt(0, 3, 0, aim); raft.applyImpulseAt(0, 3, 0, aim);
camera.lookAt(aim); camera.orbit(aim);
createVector(1, 2, 3).add(aim).sub(aim).dist(aim); createVector().dot(aim); createVector().cross(aim);
marker.scaleBy(2); marker.scaleBy(1, 2, 1);
new SliderJoint(raft, marker, { lowerLimit: null }); new HingeJoint(raft, marker, { upperLimit: null });
const speedCap: number = raft.maxSpeed; raft.maxSpeed = null;
marker.shape = 'sphere'; marker.shape = 'cube';
// @ts-expect-error a triangle mesh is made with new TriangleMesh(), not chosen
marker.shape = 'triangles';
// @ts-expect-error a seat nobody holds has no list of ghosts
const nobody: Solid[] = online.peers[10];
world.explodeAt(createVector(0, 1, 0), 3, 5);
world.explodeAt(0, 1, 0, 3, 5);

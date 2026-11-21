// A wrecking ball on a rope swings into a wall of cubes, then the scene resets and does it again.
let ball, beam, rope;
function build() {
  allSolids.delete();                       // clear the world, joints included
  new Floor(60).color = '#3a3d52';
  beam = new Cube(-2, 10, 0, 6, 0.4, 0.6, 'static');
  beam.color = '#6272a4';
  ball = new Sphere(-7.4, 5.5, 0, 2.2);     // pulled back to the left
  ball.density = 6;                         // heavy
  ball.color = '#ffb86c';
  new DistanceJoint(beam, ball, { length: 7, rope: true });
  rope = new Cube(-2, 8, 0, 0.14, 0.14, 1, 'none');     // a joint is invisible, so draw the rope
  rope.color = '#e6e6d4';
  for (let x = 0; x < 2; x++) for (let z = 0; z < 5; z++) for (let y = 0; y < 7; y++) {
    const c = new Cube(1 + x, 0.5 + y, -2 + z);
    c.color = (x + y + z) % 2 ? '#8be9fd' : '#bd93f9';
  }
}
function setup() {
  world.gravity.y = -10;
  sunLight.shadows = true;
  sunLight.direction = [-0.3, -1, -0.45];
  sunLight.intensity = 1.8;
  ambientLight.intensity = 1.2;
  camera.pos = [3, 6, 19];
  camera.lookAt(0, 3.5, 0);
  build();
}
function update() {
  if (frameCount % 840 === 0) build();      // every 14 seconds, set it up again
  // stretch the rope between the beam and the ball: aim it, then scale its length (a look only)
  const a = beam.pos, b = ball.pos;
  rope.pos = [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
  rope.lookAt(b.x, b.y, b.z);
  rope.scale = [1, 1, beam.distanceTo(b.x, b.y, b.z)];
}

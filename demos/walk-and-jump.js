// A player that cannot tip over, a camera that follows, and a ground check with a ray.
let player;
function setup() {
  world.gravity.y = -10;
  new Floor();
  player = new Cube(0, 2, 0, 1);
  player.color = 'tomato';
  player.lockRotation = true;
  player.friction = 0;
  for (let i = 0; i < 6; i++) {
    const step = new Cube(4 + i * 2, 0.5 + i * 0.5, -3, 2, 1 + i, 2, 'static');
    step.color = '#6272a4';
  }
  camera.follow(player, { distance: 9, height: 5 });
  // A soft shadow under things shows how high the cube is. It follows the camera, so it works anywhere.
  sunLight.shadows = true;
  sunLight.direction = [-0.15, -1, -0.2]; // nearly overhead, so the shadow lands under the cube
  sunLight.intensity = 1.8;
  ambientLight.intensity = 1.2;
}
function update() {
  const speed = 0.12;
  let dx = 0, dz = 0;
  if (kb.pressing('a')) {
    dx -= 1;
  }
  if (kb.pressing('d')) {
    dx += 1;
  }
  if (kb.pressing('w')) {
    dz -= 1;
  }
  if (kb.pressing('s')) {
    dz += 1;
  }
  player.vel.x = dx * speed;
  player.vel.z = dz * speed;
  const onGround = world.rayCast(player.pos, [player.x, player.y - 0.6, player.z]);
  if (kb.presses('space') && onGround) {
    player.applyImpulse(0, 7, 0);
  }
}
function drawTop() {
  fill('white');
  textSize(14);
  text('WASD to move, Space to jump', 12, 12);
}

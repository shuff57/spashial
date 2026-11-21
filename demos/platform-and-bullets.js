// A lift that carries a crate (kinematic + moveTo), and bullets that cannot jump through a thin
// wall (isSuperFast). Bullets are in a collision group so they pass through each other.
let lift, bullets = [];
function setup() {
  world.gravity.y = -10;
  new Floor();
  camera.pos = [0, 7, 16]; camera.lookAt(0, 2, 0);
  lift = new Cube(-5, 0.2, 0, 4, 0.4, 4, 'kinematic');
  lift.color = '#6272a4'; lift.friction = 1;
  const crate = new Cube(-5, 1.4, 0, 1.5);
  crate.color = 'gold'; crate.friction = 1;
  const wall = new Cube(6, 2, 0, 0.1, 4, 10, 'static');
  wall.color = 'tomato';
  world.ignoreCollisions('bullet');
}
function update() {
  lift.moveTo(-5, 1.6 + Math.sin(frameCount * 0.03) * 1.4, 0);
  if (frameCount % 12 === 0) {
    const b = new Sphere(-1, 1 + random(0, 3), random(-3, 3), 0.3);
    b.isSuperFast = true;
    b.collisionGroup = 'bullet';
    b.gravityScale = 0;
    b.vel.x = 2;
    b.born = frameCount;
    bullets.push(b);
  }
  bullets = bullets.filter((b) => { if (frameCount - b.born > 60) { b.remove(); return false; } return true; });
}
function drawTop() {
  fill('white'); textSize(14);
  text('The wall is 0.1 thick and the bullets fly at 120 m/s: isSuperFast stops them.', 12, 12);
}

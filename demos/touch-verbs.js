// A sensor zone ('none') reports overlaps without blocking. Balls turn green inside it.
let zone;
let balls;
let inside = 0;
function setup() {
  world.gravity.y = -10;
  new Floor();
  zone = new Cube(0, 2, 0, 5, 1, 5, 'none');
  zone.color = '#50fa7b';
  zone.opacity = 0.25;
  balls = new Group();
  for (let i = 0; i < 12; i++) {
    const b = new balls.Solid(random(-2, 2), 4 + i * 1.2, random(-2, 2), 0.6);
    b.collider = 'dynamic';
    b.bounciness = 0.5;
  }
  camera.pos = [0, 5, 11];
  camera.lookAt(0, 1.5, 0);
}
function update() {
  inside = 0;
  for (const ball of balls) {
    if (ball.overlaps(zone)) {
      ball.color = 'limegreen';
      inside += 1;
    } else {
      ball.color = 'tomato';
    }
  }
}
function drawTop() {
  fill('white');
  textSize(14);
  text('inside the zone: ' + inside + ' of ' + balls.length, 12, 12);
}

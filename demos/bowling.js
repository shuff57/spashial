// Ten pins and a heavy ball. Left and right aim; Space rolls it; R sets up again.
let ball, aim = 0;
const pins = [];
function rack() {
  for (const p of pins) p.remove();
  pins.length = 0;
  let n = 0;
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i <= row; i++) {
      const p = new Cylinder((i - row / 2) * 1.1, 0.8, -8 - row * 0.95, 0.6, 1.6, 0.6);
      p.color = n++ % 2 ? '#f8f8f2' : '#ff79c6';
      p.density = 0.6;
      pins.push(p);
    }
  }
}
function setup() {
  world.gravity.y = -10;
  const lane = new Cube(0, -0.05, -6, 5, 0.1, 30, 'static');
  lane.color = '#c4a574';
  lane.friction = 0.2;
  new Floor(60).color = '#2a2c3d';
  ball = new Sphere(0, 0.6, 4, 1.2);
  ball.density = 4;
  ball.color = '#6272a4';
  ball.friction = 0.2;
  rack();
  camera.pos = [0, 3.4, 9.5];
  camera.lookAt(0, 0.7, -6);
}
function update() {
  if (kb.pressing('left')) aim = Math.max(-1.8, aim - 0.03);
  if (kb.pressing('right')) aim = Math.min(1.8, aim + 0.03);
  if (ball.y < 0.9 && ball.vel.z > -0.01 && ball.z > 3) ball.x = aim;     // aim before it rolls
  if (kb.presses('space') && ball.z > 3) ball.vel = [aim * 0.012, 0, -0.55];
  if (kb.presses('r')) { ball.pos = [aim, 0.6, 4]; ball.vel = [0, 0, 0]; ball.angularVelocity = [0, 0, 0]; rack(); }
}
function drawTop() {
  fill('white'); textSize(14);
  const down = pins.filter((p) => p.y < 0.5 || Math.abs(p.rotation.x) > 40 || Math.abs(p.rotation.z) > 40).length;
  text('pins down: ' + down + '   (left and right aim, Space rolls, R resets)', 12, 12);
}

// A curved line of dominoes. Press Space to tip the first one.
const dominoes = [];
function setup() {
  world.gravity.y = -10;
  new Floor(40).color = '#3a3d52';
  const count = 28;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const angle = t * Math.PI * 1.1;              // an S-shaped sweep
    const x = -10 + t * 20;
    const z = Math.sin(angle * 2) * 4;
    const d = new Cube(x, 0.8, z, 0.25, 1.6, 1.1);
    d.rotation.y = -Math.atan2(Math.cos(angle * 2) * 8 * (Math.PI * 1.1) / 20, 1) * 57.3;
    d.color = ['#ff79c6', '#8be9fd', '#ffb86c', '#50fa7b'][i % 4];
    d.friction = 0.6;
    dominoes.push(d);
  }
  camera.pos = [0, 12, 14];
  camera.lookAt(0, 0, 0);
}
function update() {
  if (kb.presses('space')) dominoes[0].applyImpulseAt(1.2, 0, 0, dominoes[0].x, dominoes[0].y + 0.7, dominoes[0].z);
}
function drawTop() {
  fill('white'); textSize(14);
  text('Click the picture, then press Space to tip the first domino', 12, 12);
}

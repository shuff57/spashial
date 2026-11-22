// Friction keeps a stack standing. Click the picture and press Space to knock it over.
function setup() {
  world.gravity.y = -10;
  new Floor();
  for (let layer = 0; layer < 8; layer++) {
    const c = new Cube(0, 0.5 + layer, 0);
    if (layer % 2 === 0) {
      c.color = 'tomato';
    } else {
      c.color = 'gold';
    }
    c.friction = 0.6;
  }
  camera.pos = [6, 5, 9];
  camera.lookAt(0, 3, 0);
}
function update() {
  if (kb.presses('space')) {
    world.explodeAt(2, 0.5, 0, 6, 8, 0.3);
  }
}

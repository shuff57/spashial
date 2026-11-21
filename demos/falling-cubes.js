// Nothing falls until you turn gravity on.
function setup() {
  world.gravity.y = -10;
  new Floor();
  new Cube(0, 6, 0).color = 'tomato';
  new Cube(0.4, 8, 0.2, 1.5).color = 'gold';
  new Sphere(-1.5, 7, 0, 1).color = 'skyblue';
  camera.pos = [0, 4, 10];
  camera.lookAt(0, 1, 0);
}

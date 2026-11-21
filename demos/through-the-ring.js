// A ball that fits the hole falls through a torus; a bigger one rests on it.
let ring;
function setup() {
  world.gravity.y = -10;
  new Floor();
  ring = new Torus(0, 2, 0, 2.4, 0.6, 2.4, 'static');
  ring.color = 'orchid';
  new Sphere(0, 7, 0, 0.8).color = 'skyblue';
  new Sphere(0.2, 10, 0, 1.8).color = 'tomato';
  camera.pos = [0, 4, 9];
  camera.lookAt(0, 2, 0);
}

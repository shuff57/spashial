// Every joint joins two Solids. Press space to shove the drawer shut.
let drawer;
function setup() {
  world.gravity.y = -10;
  new Floor();
  camera.pos = [0, 7, 15];
  camera.lookAt(0, 3, 0);

  // A door: a hinge on its left edge, free to swing 90 degrees either way.
  const post = new Cube(-6, 2, 0, 0.3, 4, 0.3, 'static');
  const door = new Cube(-4.9, 2, 0, 2.2, 3.6, 0.2);
  door.color = 'tomato';
  new HingeJoint(post, door, { anchor: [-6, 2, 0], axis: [0, 1, 0], lowerLimit: -90, upperLimit: 90, friction: 1 });
  const ball = new Sphere(-4.5, 2, 6, 1);
  ball.vel.z = -0.15;

  // A weight on a rope: it can swing and slacken, but never stretch.
  const beam = new Cube(0, 9, 0, 4, 0.3, 0.3, 'static');
  const weight = new Sphere(0, 5.5, 0, 1.4);
  weight.color = 'gold';
  new DistanceJoint(beam, weight, { length: 3.5, rope: true });
  weight.applyImpulse(8, 0, 0);

  // A drawer: it slides along z, between 0 and 3 units from where it starts.
  const rail = new Cube(6, 1, -4, 0.2, 0.2, 0.2, 'static');
  drawer = new Cube(6, 1, 0, 2, 1, 2);
  drawer.color = '#8be9fd';
  new SliderJoint(rail, drawer, { axis: [0, 0, 1], lowerLimit: 0, upperLimit: 3 });
  drawer.applyImpulse(0, 0, 8);
}
function update() {
  if (kb.presses('space')) {
    drawer.applyImpulse(0, 0, -14);
  }
}
function drawTop() {
  fill('white');
  textSize(14);
  text('A hinge, a rope and a slider. Space shoves the drawer.', 12, 12);
}

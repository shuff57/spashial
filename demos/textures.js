// A texture is a picture wrapped onto a shape. textureNames() lists the built-in ones.
function setup() {
  world.gravity.y = -10;
  const floor = new Floor();
  floor.texture = 'grass';
  floor.textureRepeat = 14;                      // how many times the picture repeats

  const wall = new Cube(-4, 1.5, 0, 3, 3, 0.5, 'static');
  wall.texture = 'bricks';
  wall.textureRepeat = [3, 3];

  const crate = new Cube(0, 3, 0, 1.6);
  crate.texture = 'planks';

  const ball = new Sphere(3, 4, 0, 1.6);
  ball.texture = 'checker';
  ball.textureRepeat = 3;
  ball.bounciness = 0.6;

  const tinted = new Cylinder(6, 3, 0, 1.4);
  tinted.texture = 'stripes';
  tinted.color = 'tomato';                       // a colour tints the picture

  const rock = new Hull(-1, 3, 4, [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 1.4, 0]]);
  rock.texture = 'stone';                        // hulls and meshes get the picture projected on

  for (const s of [wall, crate, ball, tinted, rock]) s.text = s.texture;   // a label above each one, facing the camera

  camera.pos = [0, 6, 14]; camera.lookAt(0, 1.5, 0);
}
function drawTop() {
  fill('white'); textSize(14);
  text('textureNames(): ' + textureNames().join(', '), 12, 12);
}

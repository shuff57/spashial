// Drag with the mouse to walk the camera around a little still life. Shadows are on.
function setup() {
  world.gravity.y = -10;
  new Floor(30).color = '#3a3d52';
  sunLight.shadows = true;
  sunLight.direction = [-0.35, -1, -0.5];
  sunLight.intensity = 1.8;
  ambientLight.intensity = 1.2;

  const plinth = new Cylinder(0, 0.4, 0, 6, 0.8, 6, 'static');
  plinth.color = '#6272a4';
  const gem = new Hull(0, 1.9, 0, [[0, 1.1, 0], [0, -1.1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]], 'static');
  gem.color = '#ff79c6'; gem.metalness = 0.6; gem.roughness = 0.25;
  const ring = new Torus(2.4, 1.2, 0.8, 1.6, 0.4, 1.6, 'static');
  ring.color = '#ffb86c'; ring.metalness = 0.9; ring.roughness = 0.2;
  const ball = new Sphere(-2.2, 1.3, -0.6, 1, 'static');
  ball.color = '#8be9fd';
  const cone = new Cone(0.4, 1.3, 2.4, 1.2, 1.2, 1.2, 'static');
  cone.color = '#50fa7b';

  camera.orbit([0, 1.5, 0], { distance: 11, drag: true });
}
function drawTop() {
  fill('white'); textSize(14);
  text('Drag to look around', 12, 12);
}

// Six shapes, dropped from the same height.
function setup() {
  world.gravity.y = -10;
  new Floor();
  const kinds = [Cube, Sphere, Cylinder, Capsule, Cone, Torus];
  kinds.forEach((Kind, i) => {
    const a = new Kind(-5 + i * 2, 4 + i * 0.5, 0, 1.2);
    a.color = ['tomato', 'gold', 'limegreen', 'skyblue', 'orchid', 'orange'][i];
  });
  camera.pos = [0, 4, 11];
  camera.lookAt(0, 1, 0);
}

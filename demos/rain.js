// Spawns cubes and spheres, culls the ones that fall away, and shows the performance panel.
let rain;
function setup() {
  world.gravity.y = -10;
  new Floor(30);
  rain = new Group();
  showPerf(true);
  camera.orbit([0, 2, 0], { distance: 16, drag: true });
}
function update() {
  if (frameCount % 3 === 0 && rain.length < 300) {
    const a = new rain.Solid(random(-4, 4), 14, random(-4, 4), 0.7);
    if (frameCount % 2 === 1) {
      a.shape = 'sphere';
    } else {
      a.shape = 'box';
    }
    a.color = ['tomato', 'gold', 'skyblue', 'orchid'][frameCount % 4];
    a.friction = 0.4;
  }
  rain.cull();
}

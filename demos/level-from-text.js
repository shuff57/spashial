// Click the picture, then WASD. Tiles builds the level from text; coins play a sound.
let player, coins, pop, score = 0;
function setup() {
  world.gravity.y = -10;
  new Floor().color = '#2f3142';
  const walls = new Group();
  walls.collider = 'static';
  walls.texture = 'bricks';
  coins = new Group();
  coins.collider = 'none';
  coins.color = 'gold';
  // rows run along z, characters along x, layers go up. A space is empty.
  new Tiles([[
    '#############',
    '#           #',
    '#  c     c  #',
    '#     #     #',
    '#  c     c  #',
    '#           #',
    '#############',
  ]], -6, 0.5, -3, 1, { '#': walls, c: coins });
  player = new Sphere(0, 1, 2, 0.9);
  player.texture = 'checker';
  player.friction = 0.2;
  player.text = 'coins: 0';
  pop = loadSound('coin');
  camera.follow(player, { distance: 7, height: 6 });
}
function update() {
  let dx = 0, dz = 0;
  if (kb.pressing('a')) {
    dx -= 1;
  }
  if (kb.pressing('d')) {
    dx += 1;
  }
  if (kb.pressing('w')) {
    dz -= 1;
  }
  if (kb.pressing('s')) {
    dz += 1;
  }
  player.vel.x = dx * 0.08;
  player.vel.z = dz * 0.08;
  player.overlaps(coins, (p, coin) => {
    coin.remove();
    pop.playAt(coin);
    score++;
    player.text = 'coins: ' + score;
  });
}

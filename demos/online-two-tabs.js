// Open this page in TWO browser tabs. Press "Host a game" in one, then type its 4-letter code
// into "Join" in the other. Each tab moves its own cube (WASD); you see the other player's cube too.
let me;
function setup() {
  world.gravity.y = -10;
  new Floor();
  multiplayer('coop', 2, { realtime: true });     // shows the lobby bar above the picture
  me = new Cube(0, 1, 0, 1.2);
  me.lockRotation = true;
  me.friction = 0;
  online.share(me);                               // everyone else sees this cube, as a ghost
  camera.pos = [0, 8, 13];
  camera.lookAt(0, 1, 0);
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
  me.vel.x = dx * 0.1;
  me.vel.z = dz * 0.1;
  if (online.seat === 0) {
    me.color = 'tomato';
  } else {
    me.color = 'dodgerblue';
  }
}
function drawTop() {
  fill('white');
  textSize(14);
  let message = 'status: ' + online.status;
  if (online.code) {
    message += '   room: ' + online.code;
  }
  text(message, 12, 12);
}

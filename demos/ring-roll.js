// Race through the numbered gates. Shift boosts, Space brakes.
const route = [[0, 2], [4, 0], [2, -4], [-3, -3], [-4, 1]];
let ball;
let rings = [];
let next = 0;
let chime;
let resetUntil = 0;
let charge = 100;
let penalty = 0;
let offs = 0;
let trackStart = [0, 5];
let turnSound;

function setup() {
  world.gravity.y = -10;
  new Floor(14).color = '#242447';
  // Low track markings point from each gate to the next.
  let last = trackStart;
  for (const point of route) {
    const x = point[0] - last[0];
    const z = point[1] - last[1];
    const line = new Cube((last[0] + point[0]) / 2, 0.02, (last[1] + point[1]) / 2, 0.14, 0.025, Math.hypot(x, z), 'none');
    line.rotation.y = Math.atan2(x, z) * 180 / Math.PI;
    line.color = '#c4aae9';
    const road = new Cube(line.x, 0.007, line.z, 2.5, 0.014, Math.hypot(x, z) + 0.35, 'none');
    road.rotation.y = line.rotation.y;
    road.color = '#504577';
    last = point;
  }
  for (const side of [-1, 1]) {
    new Cube(6.8 * side, 0.02, 0, 0.12, 0.04, 13.7, 'none').color = '#aa95f1';
    new Cube(0, 0.02, 6.8 * side, 13.7, 0.04, 0.12, 'none').color = '#aa95f1';
  }
  camera.pos = [0, 15, 10];
  camera.lookAt(0, 0, 0);
  for (let i = 0; i < route.length; i++) {
    const point = route[i];
    const ring = new Torus(point[0], 0.2, point[1], 2.1, 0.17, 2.1, 'none');
    ring.rotation.x = 90;
    ring.text = i + 1;
    rings.push(ring);
  }
  ball = new Sphere(0, 0.65, 5, 1.05);
  ball.color = '#b4a3ff';
  ball.texture = 'checker';
  ball.friction = 0.65;
  ball.maxSpeed = 0.25;
  chime = loadSound('blip');
  turnSound = loadSound('thud');
  restart();
}

function returnBall() {
  let point = [0, 5];
  if (next > 0) {
    point = route[next - 1];
  }
  ball.pos = [point[0], 0.65, point[1]];
  ball.vel = [0, 0, 0];
  ball.angularVelocity = [0, 0, 0];
}

function showRoute() {
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    ring.color = '#8991ae';
    if (i < next) {
      ring.color = '#55c69d';
      ring.text = '✓ ' + (i + 1);
    } else if (i === next) {
      ring.color = '#ffd172';
      ring.text = 'GO ' + (i + 1);
    } else {
      ring.text = i + 1;
    }
  }
}

function restart() {
  next = 0;
  resetUntil = 0;
  charge = 100;
  penalty = 0;
  offs = 0;
  resetRun();
  returnBall();
  showRoute();
}

function update() {
  if (kb.presses('r') || (next === route.length && (kb.presses('enter') || replayPressed()))) {
    restart();
    return;
  }
  if (next === route.length) {
    return;
  }
  if (Math.abs(ball.x) > 6.8 || Math.abs(ball.z) > 6.8) {
    returnBall();
    resetUntil = frameCount + 75;
    penalty += 90;
    offs += 1;
    turnSound.play();
    return;
  }

  let x = 0;
  let z = 0;
  if (kb.pressing('a') || kb.pressing('left')) {
    x -= 1;
  }
  if (kb.pressing('d') || kb.pressing('right')) {
    x += 1;
  }
  if (kb.pressing('w') || kb.pressing('up')) {
    z -= 1;
  }
  if (kb.pressing('s') || kb.pressing('down')) {
    z += 1;
  }
  // Ease into the input direction and slow down when the keys are released.
  if (x !== 0 || z !== 0) {
    startRun();
  }
  const onTrack = distanceToTrack(ball.x, ball.z) < 1.32;
  const brake = kb.pressing('space');
  const boost = kb.pressing('shift') && charge >= 1.6 && onTrack && !brake && (x !== 0 || z !== 0);
  let speed = 0.10;
  let grip = 0.17;
  if (brake) {
    speed = 0.055;
    grip = 0.36;
  } else if (boost) {
    speed = 0.23;
    grip = 0.075;
  } else if (onTrack) {
    speed = 0.14;
  }
  if (boost) {
    charge -= 1.6;
    ball.color = '#ffdb8c';
  } else {
    charge = Math.min(100, charge + 0.52);
    ball.color = '#b4a3ff';
  }
  speed /= Math.max(1, Math.hypot(x, z));
  ball.vel.x += (x * speed - ball.vel.x) * grip;
  ball.vel.z += (z * speed - ball.vel.z) * grip;

  const goal = route[next];
  if (Math.hypot(ball.x - goal[0], ball.z - goal[1]) < 1.05) {
    next += 1;
    if (next === route.length) {
      ball.vel = [0, 0, 0];
      ball.angularVelocity = [0, 0, 0];
      finishRun();
    } else {
      flashUntil = frameCount + 20;
      chime.play();
    }
    showRoute();
  }
}

// Find the closest point along the marked racing line.
function distanceToTrack(x, z) {
  let bestDistance = Infinity;
  let previous = trackStart;
  for (const end of route) {
    const dx = end[0] - previous[0];
    const dz = end[1] - previous[1];
    const t = Math.max(0, Math.min(1, ((x - previous[0]) * dx + (z - previous[1]) * dz) / (dx * dx + dz * dz)));
    bestDistance = Math.min(bestDistance, Math.hypot(x - previous[0] - t * dx, z - previous[1] - t * dz));
    previous = end;
  }
  return bestDistance;
}

// Time starts on your first move. Your best finished run stays in this browser.
let startedAt = null;
let finishedIn = 0;
let best = null;
let record = false;
let flashUntil = 0;
let winSound;
const bestKey = 'arcade.ring-roll.boost.best';

function resetRun() {
  startedAt = null;
  finishedIn = 0;
  record = false;
  flashUntil = 0;
  best = getItem(bestKey);
  if (!winSound) {
    winSound = loadSound('coin');
  }
}

function startRun() {
  if (startedAt === null) {
    startedAt = frameCount;
  }
}

function finishRun() {
  startRun();
  finishedIn = frameCount - startedAt + penalty;
  flashUntil = frameCount + 90;
  winSound.play();
  if (typeof best !== 'number' || finishedIn < best) {
    best = finishedIn;
    record = true;
    storeItem(bestKey, best);
  }
}

function timeLabel(ticks) {
  return (ticks / 60).toFixed(1) + 's';
}

function resultWidth() {
  return Math.min(320, width - 24);
}

function replayPressed() {
  return mouse.presses() && replayHovered();
}

function replayHovered() {
  const top = height / 2 + 44;
  const left = (width - resultWidth()) / 2 + 18;
  return mouse.x >= left && mouse.x <= width - left &&
    mouse.y >= top && mouse.y <= top + 36;
}

function draw() {
  background('#15162b');
  // Pull back in narrow previews so the course stays in view.
  const fov = Math.min(90, Math.max(50, 48 * height / width));
  if (camera.fov !== fov) {
    camera.fov = fov;
  }
}

function drawTop() {
  noStroke();
  textAlign(LEFT);
  if (next === route.length) {
    drawResult();
    return;
  }

  const cardWidth = Math.min(304, width - 24);
  const ticks = startedAt === null ? 0 : frameCount - startedAt + penalty;
  const progress = next;
  fill('#1b1938');
  rect(12, 12, cardWidth, 92);
  fill('#ddc6ff');
  textSize(16);
  text('RING ROLL', 24, 21);
  textAlign(RIGHT);
  textSize(13);
  text(timeLabel(ticks), cardWidth, 22);
  textAlign(LEFT);
  fill('white');
  let message = 'Follow the numbered rings';
  if (frameCount < resetUntil) {
    message = 'Off course  +1.5 seconds';
  }
  text(message, 24, 44);
  textAlign(RIGHT);
  text(progress + ' / ' + route.length, cardWidth, 44);
  textAlign(LEFT);
  fill('#393062');
  rect(24, 64, cardWidth - 24, 5);
  if (progress > 0) {
    fill('#ddc6ff');
    rect(24, 64, (cardWidth - 24) * progress / route.length, 5);
  }
  fill('#e5e8f2');
  textSize(Math.min(12, (cardWidth - 24) / 22));
  text('WASD / arrows  •  Shift boost  •  Space brake', 24, 78);
  fill('#1b1938');
  rect(12, 111, 142, 27);
  fill('#ddc6ff');
  text('BOOST', 23, 118);
  fill('#393062');
  rect(72, 121, 70, 5);
  fill('#ddc6ff');
  rect(72, 121, 70 * charge / 100, 5);
  if (frameCount < flashUntil) {
    fill('#ddc6ff');
    rect(12, 12, 3, 92);
  }
}

function drawResult() {
  const cardWidth = resultWidth();
  const left = (width - cardWidth) / 2;
  const top = height / 2 - 83;
  fill('rgba(8, 11, 20, 0.65)');
  rect(0, 0, width, height);
  fill('#1b1938');
  rect(left, top, cardWidth, 196);
  fill('#ddc6ff');
  rect(left, top, cardWidth, 3);
  textSize(13);
  text('RING ROLL', left + 18, top + 16);
  fill('white');
  textSize(Math.min(25, cardWidth / 11));
  text('Course complete', left + 18, top + 39);
  textSize(14);
  text('Time  ' + timeLabel(finishedIn) + '  •  Off course  ' + offs, left + 18, top + 75);
  fill('#ddc6ff');
  if (record) {
    text('New best time', left + 18, top + 99);
  } else {
    text('Best  ' + timeLabel(best), left + 18, top + 99);
  }
  if (replayHovered()) {
    fill('white');
  }
  rect(left + 18, top + 127, cardWidth - 36, 36);
  fill('#1b1938');
  textAlign(CENTER);
  textSize(16);
  text('Play again', width / 2, top + 135);
  fill('#e5e8f2');
  textSize(12);
  text('Enter to play again', width / 2, top + 172);
  textAlign(LEFT);
}

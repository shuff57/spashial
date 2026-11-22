// Grab every coin before the sentries catch you. Space dashes.
const spots = [[0, 2], [3, 2], [4, 0], [3, -3], [-2, -3], [-4, -1], [-3, 2]];
let player;
let coins = [];
let collected = 0;
let chime;
let zap;
let sentries = [];
let dashUntil = 0;
let dashReady = 0;
let dashBuffer = 0;
let safeUntil = 0;
let hits = 0;
let penalty = 0;

function setup() {
  new Floor(14).color = '#152f35';
  // A checker courtyard, with a low rim and four corner lanterns.
  for (let x = -5; x <= 5; x += 2) {
    for (let z = -5; z <= 5; z += 2) {
      const tile = new Cube(x, 0.01, z, 1.92, 0.02, 1.92, 'none');
      tile.color = '#24515a';
      if ((x + z) % 4 === 0) {
        tile.color = '#2a6165';
      }
    }
  }
  for (const side of [-1, 1]) {
    new Cube(6.2 * side, 0.1, 0, 0.18, 0.2, 12.5, 'none').color = '#78ccad';
    new Cube(0, 0.1, 6.2 * side, 12.5, 0.2, 0.18, 'none').color = '#78ccad';
    for (const far of [-1, 1]) {
      new Cube(6 * side, 0.43, 6 * far, 0.5, 0.86, 0.5, 'none').color = '#2f7075';
      new Sphere(6 * side, 1, 6 * far, 0.36, 'none').color = '#ffe29a';
    }
  }
  camera.pos = [0, 15, 9];
  camera.lookAt(0, 0, 0);
  player = new Cube(0, 0.5, 4, 0.85, 'kinematic');
  player.color = '#7de4ff';
  player.roughness = 0.3;
  player.text = 'YOU';
  player.textSize = 0.25;
  chime = loadSound('coin');
  zap = loadSound('hit');
  for (const name of ['PATROL', 'CHASER']) {
    const sentry = new Sphere(0, 0.52, 0, 0.92, 'none');
    sentry.color = '#fb797b';
    sentry.text = name;
    sentry.textSize = 0.23;
    sentries.push(sentry);
  }
  restart();
}

function restart() {
  for (const coin of coins) {
    if (coin) {
      coin.remove();
    }
  }
  coins = [];
  collected = 0;
  resetRun();
  dashUntil = 0;
  dashReady = 0;
  dashBuffer = 0;
  safeUntil = 0;
  hits = 0;
  penalty = 0;
  sentries[0].pos = [0, 0.52, -2];
  sentries[1].pos = [-5.6, 0.52, -4.8];
  sentries[1].visible = false;
  player.pos = [0, 0.5, 4];
  for (const spot of spots) {
    const coin = new Cylinder(spot[0], 0.45, spot[1], 0.78, 0.18, 0.78, 'none');
    coin.color = '#ffc95a';
    coin.rotation.x = 90;
    coin.metalness = 0.35;
    coins.push(coin);
  }
}

function update() {
  if (kb.presses('r') || (collected === spots.length && (kb.presses('enter') || replayPressed()))) {
    restart();
    return;
  }
  if (collected === spots.length) {
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
  if (x !== 0 || z !== 0) {
    startRun();
    player.rotation.y = Math.atan2(x, z) * 180 / Math.PI;
  }
  if (kb.presses('space') && frameCount >= dashReady) {
    dashBuffer = 5;
  }
  if (dashBuffer > 0) {
    dashBuffer -= 1;
    if (x !== 0 || z !== 0) {
      dashUntil = frameCount + 12;
      dashReady = frameCount + 78;
      dashBuffer = 0;
    }
  }
  const dashing = frameCount < dashUntil;
  let speed = 0.12;
  if (dashing) {
    speed = 0.26;
  }
  speed /= Math.max(1, Math.hypot(x, z));
  const nextX = Math.max(-6, Math.min(6, player.x + x * speed));
  const nextZ = Math.max(-5, Math.min(5, player.z + z * speed));
  player.moveTo(nextX, 0.5, nextZ);
  player.color = '#7de4ff';
  if (dashing || frameCount < safeUntil) {
    player.color = '#fcf1ad';
  }
  if (startedAt !== null) {
    updateSentries(nextX, nextZ);
    if (!dashing && frameCount >= safeUntil && sentries.some((sentry) =>
      sentry.visible && Math.hypot(nextX - sentry.x, nextZ - sentry.z) < 0.85
    )) {
      hits += 1;
      penalty += 120;
      safeUntil = frameCount + 80;
      flashUntil = frameCount + 36;
      player.pos = [0, 0.5, 4];
      zap.play();
      return;
    }
  }

  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    if (coin) {
      coin.rotation.y = frameCount * 3 + i * 15;
      coin.y = 0.48 + Math.sin(frameCount * 0.065 + i) * 0.08;
    }
    if (coin && Math.hypot(nextX - coin.x, nextZ - coin.z) < 0.85) {
      coin.remove();
      coins[i] = null;
      collected += 1;
      if (collected === spots.length) {
        finishRun();
      } else {
        flashUntil = frameCount + 20;
        chime.play();
      }
    }
  }
}

function updateSentries(x, z) {
  const t = (frameCount - startedAt) * 0.025;
  sentries[0].x = Math.sin(t) * 4.4;
  sentries[0].z = -0.9 + Math.cos(t) * 1.7;
  if (collected < 3) {
    return;
  }
  const chaser = sentries[1];
  chaser.visible = true;
  const dx = x - chaser.x;
  const dz = z - chaser.z;
  const speed = 0.064 / Math.max(1, Math.hypot(dx, dz));
  chaser.x += dx * speed;
  chaser.z += dz * speed;
}

// Time starts on your first move. Your best finished run stays in this browser.
let startedAt = null;
let finishedIn = 0;
let best = null;
let record = false;
let flashUntil = 0;
let winSound;
const bestKey = 'arcade.coin-loop.chase.best';

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
  background('#101a24');
  // Pull back in narrow previews so the course stays in view.
  const fov = Math.min(90, Math.max(50, 48 * height / width));
  if (camera.fov !== fov) {
    camera.fov = fov;
  }
}

function drawTop() {
  noStroke();
  textAlign(LEFT);
  if (collected === spots.length) {
    drawResult();
    return;
  }

  const cardWidth = Math.min(304, width - 24);
  const ticks = startedAt === null ? 0 : frameCount - startedAt + penalty;
  const progress = collected;
  fill('#0d2024');
  rect(12, 12, cardWidth, 92);
  fill('#ffe191');
  textSize(16);
  text('COIN LOOP', 24, 21);
  textAlign(RIGHT);
  textSize(13);
  text(timeLabel(ticks), cardWidth, 22);
  textAlign(LEFT);
  fill('white');
  let message = 'Grab the coins, dodge the patrol';
  if (frameCount < safeUntil) {
    message = 'Tagged  +2 seconds';
  } else if (collected >= 3) {
    message = 'Chaser awake';
  }
  text(message, 24, 44);
  textAlign(RIGHT);
  text(progress + ' / ' + spots.length, cardWidth, 44);
  textAlign(LEFT);
  fill('#143b3d');
  rect(24, 64, cardWidth - 24, 5);
  if (progress > 0) {
    fill('#ffe191');
    rect(24, 64, (cardWidth - 24) * progress / spots.length, 5);
  }
  fill('#e5e8f2');
  textSize(Math.min(12, (cardWidth - 24) / 22));
  text('WASD / arrows  •  Space dash  •  R reset', 24, 78);
  fill('#0d2024');
  rect(12, 111, 105, 25);
  fill('#ffe191');
  if (frameCount >= dashReady) {
    text('DASH READY', 23, 116);
  } else {
    text('Dash  ' + timeLabel(dashReady - frameCount), 23, 116);
  }
  if (frameCount < flashUntil) {
    fill('#ffe191');
    rect(12, 12, 3, 92);
  }
}

function drawResult() {
  const cardWidth = resultWidth();
  const left = (width - cardWidth) / 2;
  const top = height / 2 - 83;
  fill('rgba(8, 11, 20, 0.65)');
  rect(0, 0, width, height);
  fill('#0d2024');
  rect(left, top, cardWidth, 196);
  fill('#ffe191');
  rect(left, top, cardWidth, 3);
  textSize(13);
  text('COIN LOOP', left + 18, top + 16);
  fill('white');
  textSize(Math.min(25, cardWidth / 11));
  text('Courtyard cleared', left + 18, top + 39);
  textSize(14);
  text('Time  ' + timeLabel(finishedIn) + '  •  Tags  ' + hits, left + 18, top + 75);
  fill('#ffe191');
  if (record) {
    text('New best time', left + 18, top + 99);
  } else {
    text('Best  ' + timeLabel(best), left + 18, top + 99);
  }
  if (replayHovered()) {
    fill('white');
  }
  rect(left + 18, top + 127, cardWidth - 36, 36);
  fill('#0d2024');
  textAlign(CENTER);
  textSize(16);
  text('Play again', width / 2, top + 135);
  fill('#e5e8f2');
  textSize(12);
  text('Enter to play again', width / 2, top + 172);
  textAlign(LEFT);
}

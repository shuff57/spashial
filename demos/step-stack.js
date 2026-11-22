// Jump between towers. Cracked ledges fall shortly after you land.
const steps = [
  [-5, 0, 3.4],
  [-1.2, 0.55, 3],
  [2.2, 1.1, 3],
  [5.8, 1.65, 3.4],
  [9.65, 1.1, 2.6],
  [13.4, 1.65, 2.9],
  [17, 2.2, 3.4],
];
let player;
let platforms = [];
let checkpoint = 0;
let sinceGround = 99;
let jumpBuffer = 0;
let won = false;
let falls = 0;
let ledges = [];
let pillars = [];
const cracked = [2, 4, 5];
let collapseAt = new Map();
const slabs = new Map();
const pillarChunks = new Map();
const crumbling = new Map();
let savedPlatform = 0;
let crackSound;
let checkpointUntil = 0;
let fallUntil = 0;
let jumpSound;
let checkpointSound;

function setup() {
  world.gravity.y = -10;
  camera.pos = [0, 10, 17];
  camera.lookAt(0, 1, 0);
  jumpSound = loadSound('jump');
  checkpointSound = loadSound('blip');
  crackSound = loadSound('thud');
  // The towers sit in a cloud layer well below the playable ledges.
  new Cube(6, -5, 0, 42, 0.2, 14, 'none').color = '#3e557f';
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const platform = new Cube(step[0], step[1] - 0.25, 0, step[2], 0.5, 4, 'static');
    platform.color = '#98b2e8';
    const pillar = new Cube(step[0], (step[1] - 5) / 2, 0, step[2] - 0.3, step[1] + 4.5, 3.5, 'none');
    pillar.color = '#45567f';
    pillars.push(pillar);
    const ledge = new Cube(step[0], step[1] - 0.07, 2.02, step[2], 0.1, 0.08, 'none');
    ledge.color = '#c1d4ff';
    ledges.push(ledge);
    platform.text = i + 1;
    if (cracked.includes(i)) {
      ledge.color = '#ffbd83';
      platform.color = '#4b3036';
      platform.text = (i + 1) + '  CRACKED';
      slabs.set(i, makeSlabs(step));
      pillarChunks.set(i, makePillarChunks(step));
    }
    platforms.push(platform);
  }
  platforms[3].text = 'CHECKPOINT';
  const exit = platforms.length - 1;
  platforms[exit].color = '#59be93';
  platforms[exit].text = 'EXIT';
  ledges[exit].color = '#8cf3bd';
  for (const side of [-1, 1]) {
    new Cube(17 + side, 3.1, -1.15, 0.14, 1.8, 0.14, 'none').color = '#8cf3bd';
  }
  new Cube(17, 4, -1.15, 2.15, 0.15, 0.15, 'none').color = '#8cf3bd';
  sunLight.shadows = true;
  player = new Cube(0, 0, 0, 0.9);
  player.color = '#ffad78';
  player.lockRotation = true;
  player.friction = 0;
  resetRun();
  respawn();
}

// The edges of neighboring slabs follow the same jagged seams. Leave a
// little space between their tops so the dark stone underneath shows.
function makeSlabs(step) {
  const seams = [
    [-0.5, -0.21, 0.13, 0.5],
    [-0.5, -0.34, 0.24, 0.5],
    [-0.5, -0.09, 0.04, 0.5],
    [-0.5, -0.28, 0.2, 0.5],
  ];
  const pieces = [];
  const colors = ['#b97961', '#d39572', '#bd826d'];
  for (let row = 0; row < seams.length - 1; row++) {
    const front = -2 + row * 4 / 3;
    const back = front + 4 / 3;
    for (let col = 0; col < seams[row].length - 1; col++) {
      const corners = [[seams[row][col], front], [seams[row][col + 1], front],
        [seams[row + 1][col + 1], back], [seams[row + 1][col], back]];
      const centerX = corners.reduce((sum, corner) => sum + corner[0], 0) / 4;
      const centerZ = (front + back) / 2;
      const points = [];
      for (const [x, z] of corners) {
        const dx = (x - centerX) * step[2] * 0.91;
        const dz = (z - centerZ) * 0.91;
        points.push([dx, 0.25, dz], [dx * 0.9, -0.23, dz * 0.9]);
      }
      const x = step[0] + centerX * step[2];
      const y = step[1] - 0.23;
      const solid = new Hull(x, y, centerZ, points, 'none');
      solid.color = colors[(row + 2 * col) % colors.length];
      pieces.push({ solid, x, y, z: centerZ, spread: centerX, twist: row - col });
    }
  }
  return pieces;
}

function makePillarChunks(step) {
  const chunks = [];
  const w = (step[2] - 0.3) / 2;
  const h = (step[1] + 4.5) / 3;
  const d = 1.75;
  const colors = ['#57688d', '#6e7fa4', '#3a496b'];
  for (let tier = 0; tier < 3; tier++) {
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const x = step[0] + side * w / 2;
        const y = step[1] - 0.25 - (tier + 0.5) * h;
        const z = end * d / 2;
        const skew = side * end * 0.13;
        const points = [
          [-w / 2, -h / 2, -d / 2], [w / 2, -h / 2, -d / 2],
          [w / 2, -h / 2, d / 2], [-w / 2, -h / 2, d / 2],
          [-w / 2, h / 2 + skew, -d / 2], [w / 2, h / 2 - skew, -d / 2],
          [w / 2, h / 2 - skew, d / 2], [-w / 2, h / 2 + skew, d / 2],
        ];
        const solid = new Hull(x, y, z, points, 'none');
        solid.color = colors[(tier + (side === end ? 1 : 0)) % colors.length];
        solid.visible = false;
        chunks.push({ solid, x, y, z, side, end, delay: tier * 5 });
      }
    }
  }
  return chunks;
}

function updateCrumble() {
  for (const [index, start] of crumbling) {
    const age = frameCount - start;
    if (age >= 56) {
      for (const { solid } of slabs.get(index)) {
        solid.visible = false;
      }
      for (const { solid } of pillarChunks.get(index)) {
        solid.visible = false;
      }
      crumbling.delete(index);
      continue;
    }
    for (const { solid, x, y, z, spread, twist } of slabs.get(index)) {
      solid.pos = [x + spread * age * 0.07, y - age * age * 0.0037, z + z * age * 0.021];
      solid.rotation = [age * (1.8 + z), age * twist * 1.6, age * spread * 13];
      solid.opacity = Math.max(0, Math.min(1, (46 - age) / 12));
    }
    for (const { solid, x, y, z, side, end, delay } of pillarChunks.get(index)) {
      // Lower tiers stand for a few frames before the break reaches them.
      const fall = Math.max(0, age - delay);
      solid.visible = true;
      solid.pos = [x + side * fall * 0.035, y - fall * fall * 0.0032, z + end * fall * 0.028];
      solid.rotation = [end * fall * 2.5, side * end * fall * 1.6, side * fall * 3.1];
      solid.opacity = Math.max(0, Math.min(1, (46 - fall) / 14));
    }
  }
}

function respawn() {
  for (const index of cracked) {
    platforms[index].collider = 'static';
    platforms[index].visible = true;
    ledges[index].visible = true;
    pillars[index].visible = true;
    for (const { solid } of pillarChunks.get(index)) {
      solid.visible = false;
    }
    ledges[index].color = '#ffbd83';
    for (const { solid, x, y, z } of slabs.get(index)) {
      solid.pos = [x, y, z];
      solid.rotation = [0, 0, 0];
      solid.opacity = 1;
      solid.visible = true;
    }
  }
  collapseAt.clear();
  crumbling.clear();
  checkpoint = savedPlatform;
  const step = steps[savedPlatform];
  player.pos = [step[0], step[1] + 0.6, 0];
  player.vel = [0, 0, 0];
  sinceGround = 99;
  jumpBuffer = 0;
}

function update() {
  updateCrumble();
  if (kb.presses('r') || (won && (kb.presses('enter') || replayPressed()))) {
    savedPlatform = 0;
    checkpoint = 0;
    won = false;
    falls = 0;
    checkpointUntil = 0;
    fallUntil = 0;
    for (let i = 0; i < ledges.length - 1; i++) {
      if (!cracked.includes(i)) {
        ledges[i].color = '#c1d4ff';
      }
    }
    resetRun();
    respawn();
    return;
  }
  if (won) {
    return;
  }
  if (player.y < -2) {
    falls += 1;
    fallUntil = frameCount + 70;
    respawn();
    return;
  }

  for (const [index, deadline] of collapseAt) {
    if (frameCount >= deadline) {
      platforms[index].collider = 'none';
      platforms[index].visible = false;
      ledges[index].visible = false;
      pillars[index].visible = false;
      crumbling.set(index, frameCount);
      collapseAt.delete(index);
      crackSound.play();
    } else if (frameCount % 8 < 4) {
      ledges[index].color = '#ff7069';
    } else {
      ledges[index].color = '#ffe7b4';
    }
  }
  const hit = world.rayCast(player.pos, [player.x, player.y - 0.58, player.z], { ignore: player });
  sinceGround += 1;
  if (hit && player.vel.y <= 0) {
    sinceGround = 0;
    const landed = platforms.indexOf(hit.solid);
    if (cracked.includes(landed) && !collapseAt.has(landed)) {
      collapseAt.set(landed, frameCount + 55);
    }
    if (landed > checkpoint) {
      checkpoint = landed;
      if (landed < platforms.length - 1 && !cracked.includes(landed)) {
        savedPlatform = landed;
        ledges[landed].color = '#8cf3bd';
        checkpointSound.play();
        checkpointUntil = frameCount + 68;
        flashUntil = frameCount + 20;
      }
    }
    if (landed === platforms.length - 1) {
      won = true;
      finishRun();
      player.vel = [0, 0, 0];
      return;
    }
  }

  let direction = 0;
  if (kb.pressing('a') || kb.pressing('left')) {
    direction -= 1;
  }
  if (kb.pressing('d') || kb.pressing('right')) {
    direction += 1;
  }
  if (direction !== 0) {
    startRun();
  }
  player.vel.x = direction * 0.105;
  if (kb.presses('space')) {
    jumpBuffer = 8;
  }
  if (jumpBuffer > 0 && sinceGround <= 6) {
    startRun();
    jumpSound.play();
    player.vel.y = 0.095;
    sinceGround = 99;
    jumpBuffer = 0;
  }
  if (jumpBuffer > 0) {
    jumpBuffer -= 1;
  }
}

// Time starts on your first move. Your best finished run stays in this browser.
let startedAt = null;
let finishedIn = 0;
let best = null;
let record = false;
let flashUntil = 0;
let winSound;
const bestKey = 'arcade.step-stack.cracked.best';

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
  finishedIn = frameCount - startedAt;
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
  background('#354b76');
  const target = Math.max(0, Math.min(12, player.x + 1.8));
  camera.x += (target - camera.x) * 0.075;
  camera.lookAt(camera.x, 1.15, 0);
  // Pull back in narrow previews so the course stays in view.
  const fov = Math.min(90, Math.max(50, 48 * height / width));
  if (camera.fov !== fov) {
    camera.fov = fov;
  }
}

function drawTop() {
  noStroke();
  textAlign(LEFT);
  if (won) {
    drawResult();
    return;
  }

  const cardWidth = Math.min(304, width - 24);
  const ticks = startedAt === null ? 0 : frameCount - startedAt;
  const progress = checkpoint + 1;
  fill('#18253e');
  rect(12, 12, cardWidth, 92);
  fill('#bcd9ff');
  textSize(16);
  text('STEP STACK', 24, 21);
  textAlign(RIGHT);
  textSize(13);
  text(timeLabel(ticks), cardWidth, 22);
  textAlign(LEFT);
  fill('white');
  let message = 'Reach the green exit';
  if (frameCount < fallUntil) {
    message = 'Back at platform ' + (checkpoint + 1);
  } else if (collapseAt.has(checkpoint)) {
    message = 'Ledge breaking! Jump again';
  } else if (frameCount < checkpointUntil) {
    message = 'Checkpoint saved';
  }
  text(message, 24, 44);
  textAlign(RIGHT);
  text(progress + ' / ' + steps.length, cardWidth, 44);
  textAlign(LEFT);
  fill('#293d62');
  rect(24, 64, cardWidth - 24, 5);
  if (progress > 0) {
    fill('#bcd9ff');
    rect(24, 64, (cardWidth - 24) * progress / steps.length, 5);
  }
  fill('#e5e8f2');
  textSize(Math.min(12, (cardWidth - 24) / 22));
  text('A/D or arrows  •  Space jumps  •  R resets', 24, 78);
  if (frameCount < flashUntil) {
    fill('#bcd9ff');
    rect(12, 12, 3, 92);
  }
}

function drawResult() {
  const cardWidth = resultWidth();
  const left = (width - cardWidth) / 2;
  const top = height / 2 - 83;
  fill('rgba(8, 11, 20, 0.65)');
  rect(0, 0, width, height);
  fill('#18253e');
  rect(left, top, cardWidth, 196);
  fill('#bcd9ff');
  rect(left, top, cardWidth, 3);
  textSize(13);
  text('STEP STACK', left + 18, top + 16);
  fill('white');
  textSize(Math.min(25, cardWidth / 11));
  text('Exit reached', left + 18, top + 39);
  textSize(14);
  text('Time  ' + timeLabel(finishedIn) + '  •  Falls  ' + falls, left + 18, top + 75);
  fill('#bcd9ff');
  if (record) {
    text('New best time', left + 18, top + 99);
  } else {
    text('Best  ' + timeLabel(best), left + 18, top + 99);
  }
  if (replayHovered()) {
    fill('white');
  }
  rect(left + 18, top + 127, cardWidth - 36, 36);
  fill('#18253e');
  textAlign(CENTER);
  textSize(16);
  text('Play again', width / 2, top + 135);
  fill('#e5e8f2');
  textSize(12);
  text('Enter to play again', width / 2, top + 172);
  textAlign(LEFT);
}

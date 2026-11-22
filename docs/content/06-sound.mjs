// Page: sound. Block types are listed at the top of 01-start.mjs.
// Every sound demo says "click the picture first": browsers only start audio after the first click or
// key press in the sketch, so each test clicks before it asserts anything about a sound.

export default [
  {
    id: 'sound', group: 'World', title: 'Sound',
    summary: 'Eight built-in sounds made in code, your own files, and sound that comes from a place.',
    blocks: [
      '`loadSound(nameOrAddress)`',
      'Pass a built-in name such as `\'coin\'` or the address of a sound file. The call gives you a Sound. Call `sound.play()` to play it. Eight sounds are built in. They are **made in code**, so nothing downloads: `blip`, `coin`, `explode`, `hit`, `jump`, `laser`, `pop` and `thud`. `soundNames()` lists them, and any you add yourself.',
      { note: '**Click the picture first.** Browsers will not start audio until the person has clicked or pressed a key in the sketch. Until then a `play()` is **skipped** (the log says so once), while a `loop()` waits and starts as soon as sound is allowed. Some browsers start with sound allowed, so a sketch can seem fine on your computer and be silent on another. Play sounds in answer to a click or a key, and every demo on this page says to click first.' },
      { demo: {
        id: 'sound-board', title: 'Play each built-in sound',
        hint: 'Click the picture first, then press 1 to 8.',
        code: `const names = soundNames();        // blip, coin, explode, hit, jump, laser, pop, thud
const sounds = {};
let last = 'click the picture, then press 1 to 8', plays = 0;
function setup() {
  names.forEach((n) => {
    sounds[n] = loadSound(n);
  });
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 0, 0);
}
function update() {
  names.forEach((n, i) => {
    if (kb.presses(String(i + 1))) {
      sounds[n].play();                // a new voice each time, so quick repeats overlap
      last = (i + 1) + ': ' + n;
      plays++;
    }
  });
}
function drawTop() {
  fill('white');
  textSize(20);
  text(last, 12, 12);
}
`,
        steps: [{ click: 'center' }, { wait: 20 }, { press: '1' }, { press: '4' }, { wait: 5 }],
        expect: () => plays === 2 && last === '4: hit' && sounds.blip.blocked === false,
      } },
      { h: 'What a Sound can do' },
      { table: { head: ['Call', 'Does'], rows: [
        ['`sound.play()`', 'Starts a **new voice** each call, so quick repeats overlap (a machine gun, a shower of coins). Skipped, with one message, if the browser still has sound off.'],
        ['`sound.loop()`', 'Plays the one **looping** voice. It is safe to call every frame: nothing doubles up. Starts when the file has arrived.'],
        ['`sound.playAt(x, y, z)`', 'Plays once **from a place** in the world: quieter the further it is from the camera, and panned toward the side of the screen it is on. Give three numbers, `[x, y, z]`, or a Solid.'],
        ['`sound.pause()`', 'Stops it but remembers the place; the next `loop()` carries on from there.'],
        ['`sound.stop()`', 'Stops every voice and forgets the place. It also cancels a `loop()` that was still waiting for its file.'],
        ['`sound.volume`, `sound.pan`, `sound.rate`', 'Volume 0 to 1. Pan -1 (left) to 1 (right). Rate is speed and pitch together, above 0 (2 is twice as fast and an octave up).'],
        ['`sound.fade(to, seconds)`', 'Ramps the volume to `to` over `seconds` (default 0.5).'],
        ['`sound.playing`, `paused`, `loaded`, `blocked`, `duration`', 'What it is doing now. `blocked` is true if the browser refused to start audio. `duration` is 0 until the file has loaded.'],
        ['`masterVolume(level)`', 'The level of everything, 0 to 1. With no number, it reads the level.'],
      ] } },
      { demo: {
        id: 'sound-loop-volume', title: 'A loop, its volume, and a fade',
        hint: 'Click the picture first. Up and down change the volume, F fades out, G fades back in.',
        code: `let hum;
function setup() {
  hum = loadSound('blip');
  hum.volume = 0.4;
  hum.rate = 0.5;                         // slower and lower
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 0, 0);
}
function update() {
  hum.loop();                             // call it every frame: it never doubles up
  if (kb.pressing('up')) {
    hum.volume = Math.min(1, hum.volume + 0.01);
  }
  if (kb.pressing('down')) {
    hum.volume = Math.max(0, hum.volume - 0.01);
  }
  if (kb.presses('f')) {
    hum.fade(0, 1);    // down to silence over a second
  }
  if (kb.presses('g')) {
    hum.fade(0.6, 1);  // and back up
  }
}
function drawTop() {
  fill('white');
  textSize(18);
  let status = 'waiting for a click';
  if (hum.playing) {
    status = 'playing';
  }
  text('volume ' + hum.volume.toFixed(2) + '   ' + status, 12, 12);
}
`,
        steps: [{ click: 'center' }, { wait: 20 }, { press: 'f' }, { wait: 150 }],
        expect: () => hum.playing === true && hum.blocked === false && hum.volume < 0.05,
      } },
      { h: 'Sound from a place' },
      '`playAt` is for things that happen somewhere: a coin picked up, an explosion across the room. The sound gets quieter as the camera moves away (full volume within 5 units, half at 15) and comes out of the left or right as the place moves across the screen.',
      { demo: {
        id: 'sound-playat', title: 'A ball that blips as it crosses the screen',
        hint: 'Click the picture first, and use headphones to hear it move from left to right.',
        code: `let ball, sound, plays = 0;
function setup() {
  new Floor(40);
  sound = loadSound('blip');
  ball = new Sphere(-12, 1, 0, 1.4);
  ball.color = 'gold';
  ball.vel.x = 0.08;                       // 4.8 units a second, with no gravity
  camera.pos = [0, 4, 10];
  camera.lookAt(0, 1, 0);
}
function update() {
  if (ball.x > 12) {
    ball.x = -12;           // round again
  }
  if (frameCount % 30 === 0) {
    sound.playAt(ball);                    // from where the ball is now
    plays++;
  }
}
function drawTop() {
  fill('white');
  textSize(14);
  text('the blip comes from the ball: quieter far away, panned left and right', 12, 12);
}
`,
        steps: [{ click: 'center' }, { wait: 80 }],
        expect: () => plays >= 2 && sound.blocked === false,
      } },
      { h: 'Your own sound files' },
      'Use a web address or a data: URL in place of a name: `loadSound(\'https://.../boom.mp3\')`. Give a file a short name with `registerSound(name, address)` and then `loadSound(name)`. A web address must allow other sites to use it (CORS), because the sketch runs in a sandboxed frame. Start loading in [preload()](#/hooks) and `setup()` waits for it.',
      'One file can hold several sounds. Name the pieces with `clips`, each as `[startSeconds, endSeconds]`, then pass the name to `play`, `loop` or `playAt`:',
      { code: `const fx = loadSound('https://.../effects.mp3', {
  clips: { jump: [0, 0.4], coin: [0.5, 0.9] },
});
fx.play('jump');          // just the first 0.4 seconds` },
      { note: 'Two small differences from moSHion\'s sounds, on purpose: a setter that is given something that is not a number (`sound.volume = \'loud\'`) throws a plain error instead of guessing, and `stop()` also cancels a `loop()` that is still waiting for its file.' },
    ],
  },
];

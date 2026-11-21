// Page: saving. Block types are listed at the top of 01-start.mjs.
// A test step { rerun: true } presses Run again and waits for the new run, so `expect` can check
// that a value saved by the first run is read back by the second.

export default [
  {
    id: 'saving', group: 'World', title: 'Saving',
    summary: 'Keep a high score, or where the player got to, for next time.',
    blocks: [
      'Four functions keep values between runs. A value can be a number, some text, a list or an object (anything that can be written out as JSON).',
      { table: { head: ['Call', 'Does'], rows: [
        ['`storeItem(name, value)`', 'Saves `value` under `name`. It is still there the next time the sketch runs.'],
        ['`getItem(name)`', 'Reads it back, or `null` if nothing is saved under that name.'],
        ['`removeItem(name)`', 'Forgets one value.'],
        ['`clearStorage()`', 'Forgets everything saved with `storeItem`. Saved pictures, sounds, fonts and models are kept.'],
      ] } },
      { demo: {
        id: 'save-hiscore', title: 'A high score that survives a re-run',
        hint: 'Click the picture to score, then press Run again: the best score is still there. R forgets it.',
        code: `let score = 0, best;
function setup() {
  best = getItem('hiscore') || 0;          // null if nothing is saved yet, so fall back to 0
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 0, 0);
}
function update() {
  if (mouse.presses()) score++;
  if (score > best) {
    best = score;
    storeItem('hiscore', best);            // saved the moment it changes
  }
  if (kb.presses('r')) { clearStorage(); best = 0; }
}
function drawTop() {
  fill('white'); textSize(22);
  text('score ' + score + '    best ' + best, 12, 12);
}
`,
        steps: [{ click: 'center' }, { wait: 10 }, { click: 'center' }, { wait: 10 }, { click: 'center' }, { wait: 20 }, { rerun: true }],
        expect: () => score === 0 && best === 3 && getItem('hiscore') === 3,
      } },
      { h: 'Saving a whole game state' },
      'One value can hold a lot: an object with a name, a level and a list of items is saved in one call. This ball remembers where you left it.',
      { demo: {
        id: 'save-state', title: 'A ball that is where you left it',
        hint: 'Click the picture, press Space to push the ball along, then press Run again.',
        code: `let ball;
function setup() {
  world.gravity.y = -10;
  new Floor(40);
  const saved = getItem('ball');                       // { x: 3, pushes: 3 } or null
  ball = new Sphere(saved ? saved.x : -8, 1, 0, 1.6);
  ball.pushes = saved ? saved.pushes : 0;
  camera.pos = [0, 5, 14];
  camera.lookAt(0, 1, 0);
}
function update() {
  if (kb.presses('space')) {
    ball.x += 2;
    ball.pushes++;
    storeItem('ball', { x: ball.x, pushes: ball.pushes });
  }
}
function drawTop() {
  fill('white'); textSize(16);
  text('pushed ' + ball.pushes + ' times', 12, 12);
}
`,
        steps: [{ wait: 20 }, { press: 'Space' }, { wait: 10 }, { press: 'Space' }, { wait: 20 }, { rerun: true }],
        expect: () => ball.pushes === 2 && Math.abs(ball.x - (-4)) < 0.01,
      } },
      { h: 'What cannot be saved' },
      'A function, `undefined`, an object that refers to itself, or more than 100 KB cannot be saved. `storeItem` says why with a plain message instead of failing quietly. See [When something goes wrong](#/errors).',
      { h: 'Where the values are kept' },
      { list: [
        'The sketch runs in a sandboxed frame that has **no storage of its own**, so the page around it (the host) keeps the values and hands them back on the next run. The host has to be written to do that: see [Using it in your own page](#/embedding).',
        'On this site every docs demo has its **own** saved values in your browser, so one demo never overwrites another. In the **sandbox**, every sketch shares one set of names, so use a name that is likely to be yours, such as `\'mygame-hiscore\'`.',
        'Saved values stay in the browser on that computer. Clearing the site\'s data in the browser clears them.',
        'A sketch opened on its own, not in a sandboxed frame, uses the browser\'s own localStorage directly, with the prefix `spashial:`.',
      ] },
    ],
  },
];

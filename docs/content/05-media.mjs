// Pages: textures, models, labels, tiles. Block types are listed at the top of 01-start.mjs.

export default [
  {
    id: 'textures', group: 'Objects', title: 'Textures',
    summary: 'Wrap a picture on a shape: eight patterns drawn in code, or your own pictures.',
    blocks: [
      '`solid.texture = \'bricks\'` wraps a picture round a Solid. Eight patterns are built in. They are **drawn in code**, so nothing downloads and each one tiles without a seam: `checker`, `grid`, `bricks`, `planks`, `stripes`, `dots`, `grass` and `stone`. `textureNames()` lists them (and any you add yourself). `solid.texture = null` goes back to the plain colour.',
      { demo: {
        id: 'texture-patterns', title: 'All eight built-in patterns',
        code: `function setup() {
  world.gravity.y = -10;
  new Floor(20);
  textureNames().forEach((name, i) => {
    const s = new Cube(-6.3 + (i % 4) * 4.2, 1.2, i < 4 ? -2.5 : 2.5, 2.4, 2.4, 2.4, 'static');
    s.texture = name;
    s.text = name;               // a label above it (see Text labels)
  });
  camera.pos = [0, 9, 13];
  camera.lookAt(0, 0.5, 0);
}
`,
        expect: () => textureNames().length === 8 && [...__spashial.solids].filter((s) => s.texture).length === 8,
      } },
      { h: 'Repeat and tint' },
      { list: [
        '`textureRepeat = 4` repeats the picture 4 times across the shape. `textureRepeat = [8, 2]` is 8 times across and 2 up. The default is 1. It reads back as a vector, so `solid.textureRepeat.x` is the "across" number.',
        '`color` **tints** a texture: a red colour on a stone pattern gives red stone. A textured solid whose colour you never set draws **white**, so the picture shows as it is.',
        'A Hull or a TriangleMesh has no flat sides to wrap, so the picture is projected over the box that surrounds it.',
      ] },
      { demo: {
        id: 'texture-tint', title: 'Plain, tinted, repeated and projected',
        code: `let plain, tinted, many, rock;
function setup() {
  world.gravity.y = -10;
  new Floor(24);
  plain = new Sphere(-6, 1.2, 0, 2.2, 'static');
  plain.texture = 'checker';                       // no colour set: drawn as it is
  tinted = new Sphere(-2, 1.2, 0, 2.2, 'static');
  tinted.texture = 'checker';
  tinted.color = 'tomato';                         // a colour tints it
  many = new Sphere(2, 1.2, 0, 2.2, 'static');
  many.texture = 'checker';
  many.textureRepeat = 4;                          // four times across
  rock = new Hull(6, 1.4, 0, [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1], [0, 1.6, 0]], 'static');
  rock.texture = 'stone';                          // projected over its box
  camera.pos = [0, 4, 12];
  camera.lookAt(0, 1, 0);
}
`,
        expect: () => tinted.color === 'tomato' && many.textureRepeat.x === 4 && plain.textureRepeat.x === 1 && rock.shape === 'hull' && rock.texture === 'stone',
      } },
      { h: 'Your own pictures' },
      'A texture can also be a **web address** or a **data: URL** (a picture written out as text). Give a picture a short name once with `registerTexture(name, address)`, then use the name. A picture takes a moment to arrive, so start it in [preload()](#/hooks) with `loadTexture(name)`: `setup()` then waits until it is ready.',
      { demo: {
        id: 'texture-own', title: 'Draw a picture in code and wrap it on a crate',
        code: `let crate;
function makeStamp() {                       // a small picture, drawn on a canvas
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffb86c'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#282a36'; g.lineWidth = 6; g.strokeRect(3, 3, 58, 58);
  g.fillStyle = '#282a36'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('S', 32, 35);
  return c.toDataURL();                      // the picture as a data: URL
}
function preload() {
  registerTexture('stamp', makeStamp());     // a name for it
  loadTexture('stamp');                      // setup() waits until it is ready
}
function setup() {
  world.gravity.y = -10;
  new Floor();
  crate = new Cube(0, 4, 0, 2);
  crate.texture = 'stamp';
  crate.bounciness = 0.4;
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 1.5, 0);
}
`,
        steps: [{ wait: 120 }],
        expect: () => crate.texture === 'stamp' && loadTexture('stamp').ready === true && crate.y < 1.5,
      } },
      { list: [
        'A web address must be on a server that allows other sites to use it (CORS), because the sketch runs in a sandboxed frame. A data: URL always works.',
        'Until a web picture arrives the solid keeps its colour. If it cannot be loaded, you get one message in the log ("The texture ... could not be loaded.") and the colour stays.',
        'An unknown name throws and lists the names that do exist: see [When something goes wrong](#/errors).',
        'A Group passes `texture`, `textureRepeat` and `model` to every member, now and later (see [Groups](#/groups)). That is how a whole [level](#/tiles) gets one texture.',
      ] },
    ],
  },

  {
    id: 'models', group: 'Objects', title: 'Models',
    summary: 'Draw a glTF model instead of a shape, and choose what it collides as.',
    blocks: [
      'A **glTF** model (a `.glb` or `.gltf` file, the common format for 3D models on the web) can be drawn in place of a shape. Give `solid.model` a web address, a data: URL, or a name you gave to `registerModel(name, address)`. `modelNames()` lists the names, and `solid.model = null` goes back to the shape.',
      { list: [
        'The model is **fitted inside the Solid\'s box** (its `w`, `h` and `d`), keeping its proportions, and centred. Resize the Solid and the model resizes with it.',
        'The **collider stays the shape** (a box unless you changed it). A model does not make a body behave like its picture: that is on purpose, so it is cheap and predictable.',
        '`solid.shape = \'hull\'` **after the model has loaded** wraps the model with a hull collider, so the body is the model\'s own outline. Before it has loaded this throws a plain error.',
        'Start loading in [preload()](#/hooks) with `loadModel(name)`: `setup()` waits for it.',
        'Not supported: animations (a model is shown in one still pose), and a model keeps its **own** colours and pictures, so `color` and `texture` do not change it.',
      ] },
      'You do not need a model file to try this. The demo builds a tiny `.glb` in memory (the `makeGlb` helper), then draws it twice: once with the plain box collider, and once wrapped in a hull so it topples onto one of its faces.',
      { demo: {
        id: 'model-fit', title: 'A crystal model, with and without a hull collider',
        from: 'models',
        steps: [{ wait: 260 }],
        expect: () => {
          const m = [...__spashial.solids].filter((s) => s.model === 'crystal');
          const boxed = m.find((s) => s.shape === 'box'), wrapped = m.find((s) => s.shape === 'hull');
          return m.length === 2 && !!boxed && !!wrapped && Math.abs(boxed.y - 1.2) < 0.2 && modelNames().includes('crystal');
        },
      } },
    ],
  },

  {
    id: 'labels', group: 'Objects', title: 'Text labels',
    summary: 'A word or a number floating above a Solid, always facing you.',
    blocks: [
      '`solid.text = \'score 3\'` puts a label above a Solid. It always faces the camera, follows the Solid, hides when the Solid is hidden, goes when the Solid is removed, and is copied by `clone()`. A number works as well as a string, and `solid.text = null` takes it away.',
      { table: { head: ['Property', 'Meaning', 'Default'], rows: [
        ['`text`', 'The words, a string or a number', '`null` (no label)'],
        ['`textColor`', 'Any CSS colour. The letters have a dark edge, so they read on any background.', '`\'#ffffff\'`'],
        ['`textSize`', 'How tall the letters are, in **world units** (so a label gets smaller as you move away)', '0.6'],
      ] } },
      { demo: {
        id: 'label-basics', title: 'A label that follows a bouncing ball',
        code: `let ball;
function setup() {
  world.gravity.y = -10;
  new Floor();
  ball = new Sphere(0, 6, 0, 1.2);
  ball.bounciness = 0.8;
  ball.textColor = 'gold';
  ball.textSize = 0.5;
  const sign = new Cube(3.5, 0.5, 0, 'static');
  sign.text = 'a plain label';             // white, 0.6 tall by default
  camera.pos = [0, 4, 12];
  camera.lookAt(0, 2.5, 0);
}
function update() {
  ball.text = 'height ' + ball.y.toFixed(1);   // change it as often as you like
}
`,
        steps: [{ wait: 60 }],
        expect: () => /^height \d/.test(ball.text) && ball.textSize === 0.5,
      } },
      { demo: {
        id: 'label-clone', title: 'Labels are copied by clone and hide with their Solid',
        hint: 'Click the picture, then press Space to clone and H to hide.',
        code: `let box;
function setup() {
  world.gravity.y = -10;
  new Floor();
  box = new Cube(0, 2, 0, 1.4);
  box.text = 'I am a box';
  camera.pos = [0, 4, 10];
  camera.lookAt(0, 1.5, 0);
}
function update() {
  if (kb.presses('space')) {
    const copy = box.clone();                 // the label comes with it
    copy.pos = [random(-3, 3), 4, random(-1, 1)];
  }
  if (kb.presses('h')) box.visible = !box.visible;     // the label hides with it
}
`,
        steps: [{ wait: 20 }, { press: 'Space' }, { wait: 5 }],
        expect: () => allSolids.filter((s) => s.text === 'I am a box').length === 2,
      } },
      { note: 'A label is drawn in the 3D world, so it belongs to a Solid and can sit behind other things. For scores and messages that stay put on the screen, use [the HUD](#/hud).' },
    ],
  },

  {
    id: 'tiles', group: 'Objects', title: 'Tiles: a level from text',
    summary: 'Draw a level as rows of letters and let the engine build it.',
    blocks: [
      '`new Tiles(layers, x, y, z, cell, legend)` builds a level from text. Each character is one cell, and the **legend** says which Group each character belongs to. It works like a map seen from above.',
      { list: [
        '**Rows of characters** run along +x (left to right). **The rows** run along +z (toward you). **Layers** go up +y, bottom layer first.',
        '`(x, y, z)` is the **middle of the first cell**, and `cell` is how big each cell is (default 1).',
        'A **space** or a **dot** is empty. Any other character must be in the legend, or the level throws and **nothing is made** (the whole level is checked first, so a typo never leaves half a level behind).',
        'Each cell is made with `group.newSolid()`, so the group\'s collider, colour, texture and the rest apply. Set up the group first, and the whole level follows.',
        'One layer can be a plain list of rows. For several layers, give a list of lists.',
        'The Tiles object is itself a Group of everything it made, so `level.length` and `level.delete()` work.',
      ] },
      { demo: {
        id: 'tiles-basic', title: 'Walls and coins from five rows of text',
        code: `const walls = new Group();
walls.collider = 'static';
walls.color = '#6272a4';
const coins = new Group();
coins.collider = 'none';
coins.color = 'gold';
let level;
function setup() {
  world.gravity.y = -10;
  new Floor(20);
  level = new Tiles([
    '#########',
    '#   c   #',
    '# ##.## #',
    '#   c   #',
    '#########',
  ], -4, 0.5, -2, 1, { '#': walls, c: coins });
  camera.pos = [0, 9, 6];
  camera.lookAt(0, 0, 0);
}
`,
        expect: () => level.length === 30 && walls.length === 28 && coins.length === 2,
      } },
      { h: 'Layers and bigger cells' },
      'To build upward, give a list of layers. This one has a floor layer and two layers of a pillar, with cells 2 across, and a texture set on each group before the level is built.',
      { demo: {
        id: 'tiles-layers', title: 'A floor with a pillar, in three layers',
        code: `const floorTiles = new Group();
floorTiles.collider = 'static';
floorTiles.texture = 'grid';
const pillars = new Group();
pillars.collider = 'static';
pillars.texture = 'stone';
function setup() {
  new Floor(30).color = '#2f3142';
  new Tiles([
    ['#####', '#####', '#####'],          // layer 0, the floor
    ['.....', '..p..', '.....'],          // layer 1
    ['.....', '..p..', '.....'],          // layer 2, on top of it
  ], -4, 1, -2, 2, { '#': floorTiles, p: pillars });    // cells 2 across
  camera.pos = [8, 9, 12];
  camera.lookAt(0, 2, 0);
}
`,
        expect: () => floorTiles.length === 15 && pillars.length === 2 && Math.abs(Math.max(...pillars.map((s) => s.y)) - 5) < 0.01 && pillars[0].w === 2 && floorTiles[0].texture === 'grid',
      } },
      { h: 'A level you can play' },
      'Put it together with a player, the keyboard, a sound and a label: walk the ball over the coins to collect them.',
      { demo: {
        id: 'tiles-game', title: 'Collect the coins',
        from: 'level-from-text',
        hint: 'Click the picture, then use W A S D.',
        steps: [{ click: 'center' }, { wait: 30 }, { down: 'd' }, { down: 'w' }, { wait: 60 }, { up: 'd' }, { up: 'w' }, { wait: 5 }],
        expect: () => score >= 1 && player.text === 'coins: ' + score,
      } },
      { note: 'The wrong character is the most common mistake, and the message says where it is: the layer, the row and the column. See [When something goes wrong](#/errors).' },
    ],
  },
];

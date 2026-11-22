// Page: online. Block types are listed at the top of 01-start.mjs.
// A demo with `tabs: 2` needs two tabs: the test opens two sandbox pages in one browser, hosts a room in
// the first and joins it from the second, then runs `steps` in the first tab and `stepsB` in the second, and
// runs `expect` in BOTH tabs (it can look at `online.seat` to tell them apart).

export default [
  {
    id: 'online', group: 'World', title: 'Online play',
    summary: 'Rooms, moves and shared bodies, and an honest account of how far they reach here.',
    blocks: [
      { note: '**The honest limit.** On this site online play works between **two tabs of the same browser**, on the same site. There is no server. The tab that hosts a room *is* the room: if it is closed or reloaded the room closes, and another computer can never join. That is enough to try a game out, to run a classroom demo on one machine, and to test. Playing with someone on another computer needs a server to hold the room. Your own page can supply one: see [Using it in your own page](#/embedding).' },
      'A sketch asks for online play with `multiplayer(mode, players)` and talks through the global `online`. The sketch never touches the network itself: the page around it (the host) serves the rooms, and this site\'s host draws the **lobby bar** above the picture.',
      { h: 'multiplayer(mode, players)' },
      { table: { head: ['Mode', 'What it is'], rows: [
        ['`\'none\'`', 'One player. The default.'],
        ['`\'local\'`', 'Two to four people on **one computer**, taking turns. No second tab, no lobby.'],
        ['`\'coop\'` and `\'versus\'`', 'Online, with a lobby bar. Players on the same team (`coop`) or against each other (`versus`).'],
      ] } },
      'Call it in `setup()`. It adds `game`, `players`, `turn`, `nextTurn()` and `myTurn()` (and, online, `seat`) to the sketch, wherever your sketch has no name of its own. `{ realtime: true }` as a third argument lets players share bodies live (see below). A bad argument throws a plain error.',
      { demo: {
        id: 'online-local-turns', title: 'Taking turns on one computer',
        hint: 'Click the picture to place a cube. The turn passes to the other player.',
        code: `let placed = 0;
function setup() {
  multiplayer('local', 2);                  // two players, one computer, turn-taking
  world.gravity.y = -10;
  new Floor(12);
  camera.pos = [0, 6, 11];
  camera.lookAt(0, 1, 0);
}
function update() {
  if (mouse.presses() && myTurn()) {
    const c = new Cube(random(-3, 3), 6, random(-1, 1), 1.2);
    if (turn === 0) {
      c.color = 'tomato';
    } else {
      c.color = 'skyblue';
    }
    placed++;
    nextTurn();                                       // pass the turn on
  }
}
function drawTop() {
  fill('white');
  textSize(20);
  text('player ' + (turn + 1) + ' to place a cube    (' + placed + ' placed)', 12, 12);
}
`,
        steps: [{ click: 'center' }, { wait: 4 }, { click: 'center' }, { wait: 4 }, { click: 'center' }, { wait: 4 }],
        expect: () => placed === 3 && turn === 1 && players === 2,
      } },
      { h: 'Rooms' },
      { table: { head: ['Call or property', 'Meaning'], rows: [
        ['`online.host(players?)`', 'Opens a room and becomes seat 0. The lobby bar\'s **Host a game** button does the same.'],
        ['`online.join(code)`', 'Joins a room by its 4-letter code. The lobby bar\'s box and **Join** button do the same.'],
        ['`online.leave()`', 'Leaves the room.'],
        ['`online.status`', '`\'off\'`, `\'connecting\'`, `\'waiting\'` (alone in the room), `\'ready\'`, `\'closed\'` or `\'error\'`.'],
        ['`online.code`, `seat`, `seats`, `isHost`', 'The room\'s code, your place (0 is the host), how many places there are, and whether you are the host. `code` and `seat` are `null` until you are in a room.'],
        ['`online.players`, `online.error`', 'Who is in the room, and the last problem in plain words (or `null`).'],
      ] } },
      { h: 'Moves' },
      'A **move** is a small piece of game data: numbers, true or false, and short words (a name, `\'left\'`). It is at most 1 KB, and a player can send 30 in 10 seconds. It is **not** a chat: long free text is refused. `online.send(move)` sends one, and `online.onMove(fn)` runs `fn(move, seat)` for every move. **Every move comes back to everyone, the sender included, in the same order**, so all players can apply the same list and stay in step.',
      { demo: {
        id: 'online-moves', title: 'A counter two tabs add to together',
        hint: 'Open this page in a second tab. Host in one, join with the code in the other, then click the picture in either.',
        tabs: 2,
        code: `let total = 0, last = 'host a game, or join one, then click the picture';
function setup() {
  multiplayer('coop', 2);                       // the lobby bar appears above the picture
  online.onMove((move, seat) => {               // runs for every move, yours included
    total += move.n;
    last = 'seat ' + seat + ' added ' + move.n;
  });
  camera.pos = [0, 3, 8];
  camera.lookAt(0, 0, 0);
}
function update() {
  if (mouse.presses() && online.status === 'ready') {
    online.send({ n: 1 });
  }
}
function drawTop() {
  fill('white');
  textSize(22);
  text('total ' + total, 12, 12);
  textSize(15);
  text(last, 12, 44);
}
`,
        steps: [{ click: 'center' }, { wait: 6 }, { click: 'center' }, { wait: 6 }],
        stepsB: [{ wait: 30 }, { click: 'center' }, { wait: 6 }],
        expect: () => total === 3,
      } },
      { h: 'Shared bodies' },
      'In a room made with `{ realtime: true }`, `online.share(solid)` shares up to **8** of your Solids. Other players see each one as a **ghost**: a Solid with `collider = \'none\'`, drawn a tenth of a second behind and smoothed, with the shared body\'s position **and rotation**, size, shape and colour. A body is sent 15 times a second while it moves, and once a second while it is still. The ghosts of other players are in `online.peers`, which is an object by seat number, and `online.sharedBy(seat)` lists one player\'s. `online.unshare(solid)` stops sharing, and removing a Solid unshares it by itself.',
      { demo: {
        id: 'online-share', title: 'Each tab moves its own cube, and sees the other\'s',
        from: 'online-two-tabs',
        hint: 'Open this page in a second tab. Host in one, join in the other, click the picture, then use W A S D.',
        tabs: 2,
        steps: [{ click: 'center' }, { wait: 10 }, { down: 'd' }, { wait: 50 }, { up: 'd' }, { wait: 10 }],
        stepsB: [{ click: 'center' }, { wait: 70 }],
        expect: () => (online.seat === 0 ? me.x > 1.5 : !!(online.peers[0] && online.peers[0][0] && online.peers[0][0].x > 1.5)),
      } },
      { h: 'Good to know' },
      { list: [
        'Ghosts are real Solids, so they can be looked at, labelled and read, but they do not collide: a ghost\'s collider is `\'none\'`. Use `overlaps` to notice one.',
        'A shared body is only ever sent by the player who made it. Each player owns their own.',
        'Rooms have 2 to 4 places, the host is seat 0, a code is four letters, and a room lasts up to 3 hours.',
        'Closing or reloading the **host** tab closes the room for everyone.',
      ] },
    ],
  },
];

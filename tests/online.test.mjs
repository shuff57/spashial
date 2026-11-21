// Tests for spaSHial online play: public/spashial/online.js (the iframe half) wired to
// public/spashial/online-local-host.js (the host-page half, no server) over a REAL BroadcastChannel.
//
//   node tests/online.test.mjs        prints "N passed, M failed", exits 1 on any failure
//
// No dependencies. Time is fake (every client reads one clock the test moves with advance()), the
// messages between an iframe and its host page are structuredClone'd and delivered on a later turn of
// the event loop (as postMessage does), and the channel between two host pages is Node's own.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createOnline } from '../online.js';
import { createLocalHost } from '../online-local-host.js';

// ---- a way to know the event loop has gone quiet -----------------------------------------------
let activity = 0;
const RealBC = globalThis.BroadcastChannel;
globalThis.BroadcastChannel = class CountingChannel extends RealBC {
  constructor(name) {
    super(name);
    this.addEventListener('message', () => { activity++; });
  }

  postMessage(m) { activity++; super.postMessage(m); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle() {
  let last;
  do { last = activity; await sleep(4); } while (activity !== last);
}

// ---- fakes the engine would supply ---------------------------------------------------------------
const IDENTITY = [0, 0, 0, 1];
const makeBody = (props = {}) => ({ x: 0, y: 0, z: 0, q: IDENTITY, w: 1, h: 1, dp: 1, sh: 'box', c: 'tomato', v: true, ...props });
function readBody(b) {
  if (!b || typeof b !== 'object' || b.deleted || typeof b.x !== 'number') throw new TypeError('not a live Solid');
  return { ...b };
}
const makeGhost = (st) => ({ ...st, updates: 0, removed: false });
const updateGhost = (g, st) => { Object.assign(g, st); g.updates++; };
const removeGhost = (g) => { g.removed = true; };

const COUNTS = { passed: 0, failed: 0, skipped: 0 };
// Two tests compare this code with files of the shCode course repository (moSHion's extras.js and its
// lib/room-icons.ts), which are not part of this repository: they are skipped here, and run in shCode.
class Skip extends Error {}
const needs = (url, what) => { if (!existsSync(url)) throw new Skip(`needs ${what}, which is not in this repository`); };
async function test(name, fn) {
  try { await fn(); COUNTS.passed++; } catch (e) {
    if (e instanceof Skip) { COUNTS.skipped++; console.log(`SKIP  ${name}\n      ${e.message}`); return; }
    COUNTS.failed++;
    console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}

// ---- online.js alone, with a scripted host page ------------------------------------------------------
function scripted({ post } = {}) {
  const sent = [];
  const logs = [];
  const target = {};
  const clock = { t: 5000 };
  const env = {
    post: post || ((m) => { sent.push(structuredClone(m)); return true; }),
    now: () => clock.t, readBody, makeGhost, updateGhost, removeGhost, target,
    log: (level, text) => logs.push([level, text]),
  };
  const o = createOnline(env);
  const run = sent[0]?.run;
  return { ...o, sent, logs, target, clock, run, deliver: (m) => o.receive({ run, ...m }) };
}
const lastOp = (s, op) => [...s.sent].reverse().find((m) => m.op === op);

// ---- the world: clients (iframe + host page) sharing a clock and a channel -------------------------------
function makeWorld() {
  const channelName = `spashial-test-${Math.random().toString(36).slice(2)}`;
  const clock = { t: 10_000 };
  let seed = 12345;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const clients = [];
  const world = {
    clock, clients,
    addClient(label) {
      const c = { label, posted: [], logs: [], target: {}, moves: [] };
      const later = (fn) => setImmediate(() => { activity++; fn(); });
      c.host = createLocalHost({
        channelName, now: () => clock.t, random, interval: () => () => {},
        send: (m) => { const copy = structuredClone(m); later(() => c.receive(copy)); },
      });
      const o = createOnline({
        post: (m) => { c.posted.push(m); const copy = structuredClone(m); activity++; later(() => c.host.receive(copy)); return true; },
        now: () => clock.t, readBody, makeGhost, updateGhost, removeGhost, target: c.target,
        log: (level, text) => c.logs.push([level, text]),
      });
      Object.assign(c, o);
      c.online.onMove((move, seat) => c.moves.push({ move, seat }));
      clients.push(c);
      return c;
    },
    /** Move the clock, run every timer once, and wait for everything it set going to land. */
    async advance(ms, only = clients) {
      clock.t += ms;
      for (const c of only) { c.host.tick(); c.tick(); }
      await settle();
    },
    async dispose() {
      for (const c of clients) c.host.dispose();
      await settle();
    },
  };
  return world;
}

async function inWorld(fn) {
  const w = makeWorld();
  try { await fn(w); } finally { await w.dispose(); }
}

/** Two clients in one room. `realtime`: a real-time lobby room (online.share and ghosts). */
async function pair({ mode = 'coop', players = 2, realtime = false } = {}, w) {
  const A = w.addClient('A');
  const B = w.addClient('B');
  for (const c of [A, B]) c.multiplayer(mode, players, realtime ? { realtime: true } : undefined);
  await settle();
  A.host.actions.host();
  await settle();
  B.host.actions.join(A.online.code);
  await settle();
  return { A, B };
}

const TOO_MANY = 'Too many moves at once: at most 30 every 10 seconds. Send a move when something changes, not every frame.';
const NOT_FOUND = 'No room has that code in your classes. Check the code with the person hosting.';

// =============================================================================================================
// online.js on its own: messages up, validation, state
// =============================================================================================================

await test('hello is posted at load, with the preview-online source and a run id', () => {
  const s = scripted();
  assert.equal(s.sent[0].source, 'preview-online');
  assert.equal(s.sent[0].op, 'hello');
  assert.equal(typeof s.sent[0].run, 'string');
});

await test('with no host page (post returns false) host() says so instead of waiting', () => {
  const s = scripted({ post: () => false });
  s.online.host();
  assert.equal(s.online.status, 'error');
  assert.match(s.online.error, /only works when the game runs inside a page/);
});

await test('host() asks the page for a 2-seat room named spashial, status connecting', () => {
  const s = scripted();
  s.online.host();
  const m = lastOp(s, 'host');
  assert.equal(m.game, 'spashial');
  assert.equal(m.seats, 2);
  assert.equal(typeof m.id, 'number');
  assert.equal('live' in m, false);
  assert.equal(s.online.status, 'connecting');
});

await test('host(3) asks for 3 seats', () => {
  const s = scripted();
  s.online.host(3);
  assert.equal(lastOp(s, 'host').seats, 3);
});

await test('host() with a wrong player count throws a plain TypeError / RangeError', () => {
  const s = scripted();
  assert.throws(() => s.online.host(1), (e) => e instanceof RangeError && /2 to 4/.test(e.message));
  assert.throws(() => s.online.host(5), RangeError);
  assert.throws(() => s.online.host(2.5), RangeError);
  assert.throws(() => s.online.host('3'), (e) => e instanceof TypeError && /number of players/.test(e.message));
  assert.equal(s.sent.filter((m) => m.op === 'host').length, 0);
});

await test('join() takes text and sends it as typed', () => {
  const s = scripted();
  assert.throws(() => s.online.join(1234), (e) => e instanceof TypeError && /online\.join\('BHKE'\)/.test(e.message));
  s.online.join('bhke');
  assert.equal(lastOp(s, 'join').code, 'bhke');
});

await test('a host reply fills code, seat, seats and codeIcons and says waiting', () => {
  const s = scripted();
  s.online.host(3);
  s.deliver({ source: 'preview-online-reply', id: lastOp(s, 'host').id, ok: true, result: { code: 'BHKE', seat: 0, seats: 3, codeIcons: ['star', 'bat', 'fish', 'key'] } });
  assert.equal(s.online.code, 'BHKE');
  assert.equal(s.online.seat, 0);
  assert.equal(s.online.seats, 3);
  assert.deepEqual(s.online.codeIcons, ['star', 'bat', 'fish', 'key']);
  assert.equal(s.online.status, 'waiting');
  assert.equal(s.online.isHost, true);
});

await test('a failed join sets status error and the page\'s own words in online.error', () => {
  const s = scripted();
  s.online.join('ABCD');
  s.deliver({ source: 'preview-online-reply', id: lastOp(s, 'join').id, ok: false, error: 'That room is full.' });
  assert.equal(s.online.status, 'error');
  assert.equal(s.online.error, 'That room is full.');
  assert.ok(s.logs.some(([l, t]) => l === 'error' && t === 'That room is full.'));
});

await test('send() before a room does not post: it sets online.error', () => {
  const s = scripted();
  s.online.send({ a: 1 });
  assert.equal(s.sent.some((m) => m.op === 'send'), false);
  assert.match(s.online.error, /not in a room yet/);
});

await test('onMove() needs a function', () => {
  const s = scripted();
  assert.throws(() => s.online.onMove('nope'), (e) => e instanceof TypeError && /takes a function/.test(e.message));
});

await test('moves apply once each, in seq order, to every handler; a throwing handler does not drop the rest', () => {
  const s = scripted();
  s.online.host();
  s.deliver({ source: 'preview-online-reply', id: lastOp(s, 'host').id, ok: true, result: { code: 'ABCD', seat: 0, seats: 2 } });
  const got = [];
  s.online.onMove(() => { throw new Error('boom'); });
  s.online.onMove((m, seat) => got.push([m, seat]));
  s.deliver({ source: 'preview-online-update', code: 'ABCD', events: [{ seq: 1, seat: 0, data: 'a' }, { seq: 2, seat: 1, data: 'b' }] });
  s.deliver({ source: 'preview-online-update', code: 'ABCD', events: [{ seq: 2, seat: 1, data: 'b' }, { seq: 3, seat: 0, data: 'c' }] });
  assert.deepEqual(got, [['a', 0], ['b', 1], ['c', 0]]);
  assert.equal(s.logs.filter(([l, t]) => l === 'error' && /boom/.test(t)).length, 3);
});

await test('messages for another run or another room are ignored', () => {
  const s = scripted();
  s.online.host();
  s.deliver({ source: 'preview-online-reply', id: lastOp(s, 'host').id, ok: true, result: { code: 'ABCD', seat: 0, seats: 2 } });
  s.receive({ run: 'someone-else', source: 'preview-online-update', code: 'ABCD', state: 'ready' });
  s.deliver({ source: 'preview-online-update', code: 'WXYZ', state: 'ready' });
  assert.equal(s.online.status, 'waiting');
  s.deliver({ source: 'preview-online-update', code: 'ABCD', state: 'ready', seat: 0, seats: 2, players: [{ seat: 0, name: 'x', left: false }] });
  assert.equal(s.online.status, 'ready');
  assert.equal(s.online.players.length, 1);
});

await test('the lobby\'s room message puts the run in a room, and code null takes it out', () => {
  const s = scripted();
  s.deliver({ source: 'preview-online-room', code: 'ABCD', codeIcons: ['coin', 'star', 'heart', 'gem'], seat: 1, seats: 3, live: true });
  assert.equal(s.online.code, 'ABCD');
  assert.equal(s.online.seat, 1);
  assert.equal(s.online.live, true);
  assert.equal(s.online.status, 'waiting');
  s.deliver({ source: 'preview-online-room', code: null });
  assert.equal(s.online.code, null);
  assert.equal(s.online.status, 'off');
  assert.equal(s.online.seat, null);
});

await test('share(): 0 or more than 8 Solids is a plain TypeError; a non-Solid and a repeat too', () => {
  const s = scripted();
  const bodies = Array.from({ length: 9 }, () => makeBody());
  assert.throws(() => s.online.share(), (e) => e instanceof TypeError && /takes 1 to 8 Solids/.test(e.message));
  assert.throws(() => s.online.share(...bodies), (e) => e instanceof TypeError && /takes 1 to 8 Solids \(got 9\)/.test(e.message));
  assert.throws(() => s.online.share({ nope: 1 }), (e) => e instanceof TypeError && /argument 1 is not one/.test(e.message));
  assert.throws(() => s.online.share(bodies[0], bodies[0]), (e) => e instanceof TypeError && /same Solid twice/.test(e.message));
});

await test('share() outside a real-time room says what to call, once', () => {
  const s = scripted();
  s.online.share(makeBody());
  s.online.share(makeBody());
  assert.equal(s.logs.filter(([, t]) => /real-time room/.test(t)).length, 1);
  assert.match(s.online.error, /multiplayer\('coop', 2, \{ realtime: true \}\)/);
});

await test('share() past 8 Solids across calls is a RangeError that says how to free one', () => {
  const s = scripted();
  s.multiplayer('coop', 2, { realtime: true });
  s.online.share(...Array.from({ length: 8 }, () => makeBody()));
  assert.throws(() => s.online.share(makeBody()), (e) => e instanceof RangeError && /at most 8 Solids in all/.test(e.message) && /unshare/.test(e.message));
});

await test('multiplayer() rejects a wrong mode and wrong players in plain words', () => {
  const s = scripted();
  assert.throws(() => s.multiplayer('team', 2), (e) => e instanceof TypeError && /'none', 'local', 'coop' or 'versus'/.test(e.message));
  assert.throws(() => s.multiplayer('local', 'two'), TypeError);
  assert.throws(() => s.multiplayer('local', 1), (e) => e instanceof RangeError && /2 to 4/.test(e.message));
  assert.throws(() => s.multiplayer('versus', 2.5), RangeError);
  s.multiplayer('local', 2); // a refused call did not use up the one call
  assert.equal(s.target.players, 2);
});

await test('multiplayer() twice logs an error and keeps the first call', () => {
  const s = scripted();
  const g = s.multiplayer('local', 3);
  s.multiplayer('coop', 2);
  assert.equal(g.mode, 'local');
  assert.ok(s.logs.some(([l, t]) => l === 'error' && /only be called once/.test(t)));
});

await test("multiplayer('local', 3): players, turn, nextTurn() wraps, myTurn() is always true, no seat", () => {
  const s = scripted();
  const g = s.multiplayer('local', 3);
  const t = s.target;
  assert.equal(t.players, 3);
  assert.equal(t.turn, 0);
  assert.deepEqual([t.nextTurn(), t.nextTurn(), t.nextTurn(), t.nextTurn()], [1, 2, 0, 1]);
  assert.equal(t.turn, 1);
  assert.equal(t.myTurn(), true);
  assert.equal('seat' in t, false);
  assert.equal(g.status, 'ready');
  assert.equal(g.ready, true);
  assert.equal(g.seat, null);
  assert.equal(t.game, g);
  assert.equal(s.sent.some((m) => m.op === 'lobby'), false);
});

await test("multiplayer('none') is one player: only game is added", () => {
  const s = scripted();
  const g = s.multiplayer('none');
  assert.equal(g.players, 1);
  assert.equal(g.status, 'off');
  assert.deepEqual(Object.keys(s.target), ['game']);
});

await test('multiplayer() leaves a name the sketch already has alone, and says so', () => {
  const s = scripted();
  s.target.turn = 'mine';
  s.multiplayer('local', 2);
  assert.equal(s.target.turn, 'mine');
  assert.ok(s.logs.some(([l, t]) => l === 'warn' && /already has its own turn/.test(t)));
  assert.equal(typeof s.target.nextTurn, 'function');
});

await test('a sketch can assign to turn: it becomes its own plain variable', () => {
  const s = scripted();
  s.multiplayer('local', 2);
  s.target.turn = 5;
  assert.equal(s.target.turn, 5);
});

await test("multiplayer('versus', 2) posts the lobby message; realtime is added only when asked", () => {
  const a = scripted();
  a.multiplayer('versus', 2);
  const lobby = lastOp(a, 'lobby');
  assert.equal(lobby.mode, 'versus');
  assert.equal(lobby.players, 2);
  assert.equal('realtime' in lobby, false);
  const b = scripted();
  b.multiplayer('coop', 3, { realtime: true });
  assert.deepEqual([lastOp(b, 'lobby').realtime, lastOp(b, 'lobby').players], [true, 3]);
});

await test("{ realtime: true } on 'local' is ignored with a warning", () => {
  const s = scripted();
  const g = s.multiplayer('local', 2, { realtime: true });
  assert.equal(g.realtime, false);
  assert.ok(s.logs.some(([l, t]) => l === 'warn' && /realtime/.test(t)));
});

await test('the message names are the ones moSHion uses (extras.js), no more and no fewer', () => {
  const names = (text, re) => new Set([...text.matchAll(re)].map((m) => m[1]));
  // Only the online half of extras.js: its save()/load() section below uses ops of its own.
  needs(new URL('../public/moshion/extras.js', import.meta.url), 'the shCode copy of moSHion\'s extras.js');
  const mo = readFileSync(new URL('../public/moshion/extras.js', import.meta.url), 'utf8').split('// ---- save / load / saved')[0];
  const me = readFileSync(new URL('../online.js', import.meta.url), 'utf8');
  // The header comment of online.js lists them too, so compare code only: strip // comments.
  const code = (t) => t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const sources = /'(preview-online[a-z-]*)'/g;
  const ops = /(?:ask|tell|up)\('(\w+)'|op: '(\w+)'/g;
  const opNames = (t) => new Set([...t.matchAll(ops)].map((m) => m[1] || m[2]));
  assert.deepEqual([...names(code(me), sources)].sort(), [...names(code(mo), sources)].sort());
  assert.deepEqual([...opNames(code(me))].sort(), [...opNames(code(mo))].sort());
});

// =============================================================================================================
// two tabs, one room, over a real BroadcastChannel
// =============================================================================================================

await test('host() makes a 4-letter code from the picture alphabet, status waiting, seat 0, four icons', () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.online.host();
  assert.equal(A.online.status, 'connecting');
  await settle();
  assert.match(A.online.code, /^[ABCDEFGHJKMNPQRS]{4}$/);
  assert.equal(A.online.status, 'waiting');
  assert.equal(A.online.seat, 0);
  assert.equal(A.online.seats, 2);
  assert.equal(A.online.codeIcons.length, 4);
  assert.deepEqual(A.online.players, [{ seat: 0, name: 'Player 1', left: false }]);
}));

await test('the picture letters and icon names are the ones in lib/room-icons.ts', async () => {
  needs(new URL('../lib/room-icons.ts', import.meta.url), 'shCode\'s lib/room-icons.ts');
  const src = readFileSync(new URL('../lib/room-icons.ts', import.meta.url), 'utf8');
  const icons = [...src.match(/ROOM_ICONS = \[([\s\S]*?)\] as const/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  const letters = src.match(/ROOM_CODE_LETTERS = '(\w+)'/)[1];
  assert.equal(icons.length, 16);
  // Make rooms whose codes use every letter: the random source is scripted after the 12 digits of the tab id.
  const seen = [];
  let calls = 0;
  const script = [...Array(12).fill(0.5)];
  for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) script.push((r * 4 + i + 0.5) / 16);
  const sentDown = [];
  const host = createLocalHost({ channelName: `spashial-icons-${Math.random()}`, now: () => 0, random: () => script[calls++], interval: () => () => {}, send: (m) => sentDown.push(m) });
  for (let r = 0; r < 4; r++) {
    host.receive({ source: 'preview-online', run: 'r', id: r + 1, op: 'host', seats: 2 });
    const reply = sentDown.find((m) => m.source === 'preview-online-reply' && m.id === r + 1);
    seen.push([reply.result.code, reply.result.codeIcons]);
  }
  host.dispose();
  assert.equal(seen.map((s) => s[0]).join(''), letters);
  assert.deepEqual(seen.flatMap((s) => s[1]), icons);
});

await test('a second tab joins by code: both are ready and both see both players', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  assert.equal(A.online.status, 'ready');
  assert.equal(B.online.status, 'ready');
  assert.equal(B.online.seat, 1);
  assert.equal(B.online.isHost, false);
  assert.equal(A.online.players.length, 2);
  assert.deepEqual(B.online.players.map((p) => p.seat), [0, 1]);
  assert.equal(B.online.code, A.online.code);
}));

await test('join by code works typed in lower case with a dash', () => inWorld(async (w) => {
  const A = w.addClient('A');
  const B = w.addClient('B');
  A.online.host();
  await settle();
  B.online.join(`${A.online.code.slice(0, 2)}-${A.online.code.slice(2)}`.toLowerCase());
  await settle();
  assert.equal(B.online.status, 'ready');
  assert.equal(B.online.code, A.online.code);
}));

await test('a malformed code gets the 4-pictures message, no waiting', () => inWorld(async (w) => {
  const B = w.addClient('B');
  B.online.join('ZZ');
  await settle();
  assert.equal(B.online.status, 'error');
  assert.equal(B.online.error, 'A room code is 4 pictures (4 letters, like BHKE).');
}));

await test('a well-formed code nobody hosts gives moSHion\'s "no room has that code" once the wait is up', () => inWorld(async (w) => {
  const A = w.addClient('A');
  const B = w.addClient('B');
  A.online.host();
  await settle();
  B.online.join(A.online.code === 'ABCD' ? 'BCDE' : 'ABCD');
  await settle();
  assert.equal(B.online.status, 'connecting');
  await w.advance(1600);
  assert.equal(B.online.status, 'error');
  assert.equal(B.online.error, NOT_FOUND);
}));

await test('a third join to a 2-seat room is refused: "That room is full."', () => inWorld(async (w) => {
  const { A } = await pair({}, w);
  const C = w.addClient('C');
  C.online.join(A.online.code);
  await settle();
  assert.equal(C.online.status, 'error');
  assert.equal(C.online.error, 'That room is full.');
  assert.equal(A.online.players.length, 2);
}));

await test('a 3-seat room takes a third player', () => inWorld(async (w) => {
  const { A } = await pair({ players: 3 }, w);
  assert.equal(A.online.status, 'waiting');
  const C = w.addClient('C');
  C.online.join(A.online.code);
  await settle();
  assert.equal(C.online.seat, 2);
  assert.equal(A.online.status, 'ready');
  assert.equal(C.online.status, 'ready');
}));

await test('host(5) never reaches the page; hosting 4 seats works', () => inWorld(async (w) => {
  const A = w.addClient('A');
  assert.throws(() => A.online.host(5), RangeError);
  A.online.host(4);
  await settle();
  assert.equal(A.online.seats, 4);
}));

await test('moves arrive in the same order on both sides with the right seats, the sender\'s included', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  A.online.send({ n: 1 });
  B.online.send({ n: 2 });
  A.online.send({ n: 3 });
  B.online.send('four');
  await settle();
  // Which of A's and B's moves the host numbers first depends on which message reaches it first;
  // what must hold is that both tabs get one list, every move once, each seat's own moves in order.
  assert.equal(A.moves.length, 4);
  assert.deepEqual(A.moves, B.moves);
  assert.deepEqual(A.moves.filter((m) => m.seat === 0).map((m) => m.move), [{ n: 1 }, { n: 3 }]);
  assert.deepEqual(A.moves.filter((m) => m.seat === 1).map((m) => m.move), [{ n: 2 }, 'four']);
}));

await test('every move is numbered by the host tab: sends from two tabs at once still give one order', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  for (let i = 0; i < 10; i++) { A.online.send(i); B.online.send(100 + i); }
  await settle();
  assert.equal(A.moves.length, 20);
  assert.deepEqual(A.moves, B.moves);
  assert.deepEqual(A.moves.filter((m) => m.seat === 0).map((m) => m.move), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
}));

await test('a move with no value sends null', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  A.online.send();
  await settle();
  assert.deepEqual(B.moves, [{ move: null, seat: 0 }]);
}));

await test('a player who joins late is replayed every earlier move (a polling room)', () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.online.host(3);
  await settle();
  A.online.send('first');
  A.online.send('second');
  await settle();
  const B = w.addClient('B');
  B.online.join(A.online.code);
  await settle();
  assert.deepEqual(B.moves, [{ move: 'first', seat: 0 }, { move: 'second', seat: 0 }]);
}));

await test('bad moves are refused in plain words and nothing is delivered', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  const cases = [
    [{ 'a b': 1 }, /cannot be a name in a move/],
    [{ list: [[[[[1]]]]] }, /nested at most 4 levels/],
    ['x'.repeat(21), /at most 20 letters/],
    ['two words', /cannot have spaces/],
    [Array.from({ length: 65 }, (_, i) => i), /at most 64 items/],
    [{ a: 'abcdefghij', b: 'abcdefghij', c: 'abcdefghij' }, /at most 24 letters of words in all/],
    [Array.from({ length: 64 }, () => 0.1234567890123456), /bytes; this one is/],
  ];
  for (const [move, re] of cases) {
    A.online.error = null;
    A.online.send(move);
    await settle();
    assert.match(A.online.error, re, JSON.stringify(move).slice(0, 40));
  }
  assert.deepEqual(B.moves, []);
}));

await test('a move that cannot be sent at all (a function) sets an error and keeps online working', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  A.online.send(() => 1);
  assert.match(A.online.error, /would not take that/);
  A.online.send('fine');
  await settle();
  assert.deepEqual(B.moves, [{ move: 'fine', seat: 0 }]);
}));

await test('30 moves in 10 seconds is the limit per seat: the 31st is refused, and a later one is fine', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  for (let i = 0; i < 31; i++) A.online.send(i);
  await settle();
  assert.equal(A.moves.length, 30);
  assert.equal(A.online.error, TOO_MANY);
  B.online.send('other'); // another seat has its own allowance
  await settle();
  assert.equal(A.moves.length, 31);
  await w.advance(10_001);
  A.online.error = null;
  A.online.send('again');
  await settle();
  assert.equal(A.online.error, null);
  assert.equal(A.moves.at(-1).move, 'again');
}));

await test('leave() takes the sender out; sending after says it is not in a room', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  B.online.leave();
  await settle();
  assert.equal(B.online.status, 'off');
  assert.equal(B.online.code, null);
  B.online.send('x');
  assert.match(B.online.error, /not in a room yet/);
  assert.equal(A.online.players.find((p) => p.seat === 1).left, true);
  assert.equal(A.online.status, 'waiting');
}));

await test('a seat freed by leave() can be taken by a new tab', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  B.online.leave();
  await settle();
  const C = w.addClient('C');
  C.online.join(A.online.code);
  await settle();
  assert.equal(C.online.seat, 1);
  assert.equal(A.online.status, 'ready');
}));

await test('the same tab joining again (a rerun) gets its own seat back', () => inWorld(async (w) => {
  const { A, B } = await pair({ players: 3 }, w);
  const C = w.addClient('C');
  C.online.join(A.online.code);
  await settle();
  assert.equal(C.online.seat, 2);
  // A rerun of B's sketch: a new run id, then it asks to join the same code.
  B.host.receive({ source: 'preview-online', run: 'rerun', op: 'hello' });
  B.host.receive({ source: 'preview-online', run: 'rerun', id: 99, op: 'join', code: A.online.code });
  await settle();
  assert.equal(A.online.players.filter((p) => !p.left).length, 3);
  assert.equal(A.online.players.find((p) => p.seat === 1).left, false);
}));

await test('the host leaving closes the room for the other tab: status closed, no error, ghosts gone', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  A.online.leave();
  await settle();
  assert.equal(B.online.status, 'closed');
  assert.equal(B.online.error, null);
  B.online.send('x'); // the room is gone: the page has nothing to send it to
  await settle();
  assert.match(B.online.error, /Not in a room yet/);
}));

await test('a host tab that is closed (dispose on pagehide) closes the room at once', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  A.host.dispose();
  await settle();
  assert.equal(B.online.status, 'closed');
}));

await test('a host tab that just vanishes closes the room after 5 seconds, not before', () => inWorld(async (w) => {
  const { B } = await pair({}, w);
  await w.advance(4000, [B]);
  assert.equal(B.online.status, 'ready');
  await w.advance(1100, [B]);
  assert.equal(B.online.status, 'closed');
}));

await test('a living host keeps the room open: its beats reset the 5 second clock', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  for (let i = 0; i < 12; i++) await w.advance(1000);
  assert.equal(B.online.status, 'ready');
  assert.equal(A.online.status, 'ready');
}));

await test('a room closes after 3 hours', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  await w.advance(3 * 60 * 60 * 1000 + 1, [A]);
  assert.equal(A.online.status, 'closed');
  assert.equal(B.online.status, 'closed');
}));

await test('joining a room that just closed says why, while its host tab still remembers it', () => inWorld(async (w) => {
  const { A } = await pair({}, w);
  const code = A.online.code;
  A.online.leave();
  await settle();
  const C = w.addClient('C');
  C.online.join(code);
  await settle();
  assert.equal(C.online.error, 'That room has closed. Ask for a new code.');
}));

await test('a host\'s own new room closes the old one (one room per tab)', () => inWorld(async (w) => {
  const { A, B } = await pair({}, w);
  const old = A.online.code;
  A.online.host();
  await settle();
  assert.notEqual(A.online.code, old);
  assert.equal(B.online.status, 'closed');
}));

await test('a code another tab is hosting is never handed out again', () => inWorld(async (w) => {
  const A = w.addClient('A');
  const B = w.addClient('B');
  A.online.host();
  await settle();
  const taken = A.online.code;
  // B's random source is the same stream, so ask many times: none may equal A's code while A's beats are heard.
  for (let i = 0; i < 40; i++) {
    B.online.host();
    await settle();
    assert.notEqual(B.online.code, taken);
  }
}));

// ---- the lobby bar -----------------------------------------------------------------------------------------

await test("multiplayer('versus', 2) gives the page a lobby bar; Host and Join put each run in a room", () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.multiplayer('versus', 2);
  await settle();
  assert.deepEqual({ ...A.host.lobby }, { mode: 'versus', realtime: false, players: 2, room: null, busy: false, error: null, notice: null });
  A.host.actions.host();
  await settle();
  assert.equal(A.host.lobby.room.hosting, true);
  assert.equal(A.host.lobby.room.code, A.online.code);
  assert.equal(A.online.status, 'waiting');
  const B = w.addClient('B');
  B.multiplayer('versus', 2);
  await settle();
  B.host.actions.join(A.online.code);
  await settle();
  assert.equal(A.host.lobby.room.state, 'ready');
  assert.equal(B.host.lobby.room.hosting, false);
  assert.equal(A.online.status, 'ready');
  assert.equal(B.online.status, 'ready');
  assert.equal(B.target.seat, 1);
}));

await test("'versus': myTurn() is true only for the seat whose turn it is, and nextTurn() in onMove keeps both boards in step", () => inWorld(async (w) => {
  const { A, B } = await pair({ mode: 'versus' }, w);
  for (const c of [A, B]) c.online.onMove(() => c.target.nextTurn());
  assert.deepEqual([A.target.myTurn(), B.target.myTurn()], [true, false]);
  A.online.send('move1');
  await settle();
  assert.deepEqual([A.target.turn, B.target.turn], [1, 1]);
  assert.deepEqual([A.target.myTurn(), B.target.myTurn()], [false, true]);
  B.online.send('move2');
  await settle();
  assert.deepEqual([A.target.myTurn(), B.target.myTurn()], [true, false]);
}));

await test("'versus' is not myTurn() until the room is full", () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.multiplayer('versus', 2);
  await settle();
  A.host.actions.host();
  await settle();
  assert.equal(A.target.myTurn(), false);
  assert.equal(A.target.game.ready, false);
}));

await test("'coop': anyone may move any time once the room is ready", () => inWorld(async (w) => {
  const { A, B } = await pair({ mode: 'coop' }, w);
  assert.deepEqual([A.target.myTurn(), B.target.myTurn()], [true, true]);
  assert.equal(A.target.game.ready, true);
  assert.equal(A.target.game.code, A.online.code);
}));

await test('the lobby refuses a bad code in plain words and joins nothing', () => inWorld(async (w) => {
  const B = w.addClient('B');
  B.multiplayer('versus', 2);
  await settle();
  B.host.actions.join('hmm');
  assert.equal(B.host.lobby.error, 'A room code is 4 pictures (4 letters, like BHKE).');
  assert.equal(B.online.code, null);
}));

await test('the lobby shows "no room has that code" after the wait for an unknown code, and can try again', () => inWorld(async (w) => {
  const B = w.addClient('B');
  B.multiplayer('versus', 2);
  await settle();
  B.host.actions.join('ABCD');
  assert.equal(B.host.lobby.busy, true);
  await settle();
  await w.advance(1600);
  assert.equal(B.host.lobby.busy, false);
  assert.equal(B.host.lobby.error, NOT_FOUND);
}));

await test('the lobby bar hears when the room closes: "Room ABCD closed."', () => inWorld(async (w) => {
  const { A, B } = await pair({ mode: 'versus' }, w);
  const code = A.online.code;
  A.host.actions.leave();
  await settle();
  assert.equal(B.host.lobby.room, null);
  assert.equal(B.host.lobby.notice, `Room ${code} closed.`);
  assert.equal(B.online.status, 'closed');
  assert.equal(A.online.status, 'off');
  assert.equal(A.online.code, null);
}));

await test('a joiner\'s rerun asks for the lobby again and takes its seat back without asking', () => inWorld(async (w) => {
  const { A, B } = await pair({ mode: 'versus' }, w);
  B.host.receive({ source: 'preview-online', run: 'rerun', op: 'hello' });
  B.host.receive({ source: 'preview-online', run: 'rerun', op: 'lobby', mode: 'versus', players: 2 });
  await settle();
  assert.equal(B.host.lobby.room.code, A.online.code);
  assert.equal(B.host.lobby.room.seat, 1);
  assert.equal(A.online.status, 'ready');
}));

await test('a host\'s rerun closes its room (a classmate must not wait on a host who is gone)', () => inWorld(async (w) => {
  const { A, B } = await pair({ mode: 'versus' }, w);
  A.host.receive({ source: 'preview-online', run: 'rerun', op: 'hello' });
  await settle();
  assert.equal(B.online.status, 'closed');
}));

// ---- real-time: shared bodies ------------------------------------------------------------------------------

const shares = (c) => c.posted.filter((m) => m.op === 'share');

await test("a real-time lobby room is live: hosting sends live:true, share() sends nothing while alone", () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.multiplayer('coop', 2, { realtime: true });
  await settle();
  assert.equal(A.host.lobby.realtime, true);
  A.host.actions.host();
  await settle();
  assert.equal(A.online.live, true);
  A.online.share(makeBody());
  await w.advance(100);
  assert.equal(shares(A).length, 0);
}));

await test('a shared body reaches the other tab as a ghost with the 3D payload', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const body = makeBody({ x: 1.23456, y: 2, z: -3, q: [0, 0, 0, 1], vx: 1, vy: 0, vz: 0, w: 2, h: 3, dp: 4, sh: 'sphere', c: '#ff79c6' });
  A.online.share(body);
  await w.advance(70);
  const msg = shares(A)[0];
  assert.deepEqual(Object.keys(msg.list[0]).sort(), ['c', 'dp', 'h', 'id', 'q', 'sh', 'v', 'vx', 'vy', 'vz', 'w', 'x', 'y', 'z']);
  assert.equal(msg.list[0].x, 1.235);
  assert.equal(msg.list[0].id, 0);
  const ghost = B.online.sharedBy(0)[0];
  assert.ok(ghost, 'ghost made');
  assert.equal(ghost.sh, 'sphere');
  assert.equal(ghost.c, '#ff79c6');
  assert.deepEqual([ghost.w, ghost.h, ghost.dp], [2, 3, 4]);
  assert.equal(ghost.v, true);
  assert.deepEqual(B.online.peers[0], [ghost]);
  assert.equal(A.online.peers[1], undefined, 'a player sees ghosts of the others, not of itself');
}));

await test('fields a body does not have are omitted from the message (no velocity, no colour)', () => inWorld(async (w) => {
  const { A } = await pair({ realtime: true }, w);
  A.online.share(makeBody({ c: undefined, sh: undefined }));
  await w.advance(70);
  const o = shares(A)[0].list[0];
  assert.equal('vx' in o, false);
  assert.equal('c' in o, false);
  assert.equal('sh' in o, false);
  assert.equal(o.v, true);
}));

await test('a colour that is not a colour is never sent (a body cannot carry a sentence)', () => inWorld(async (w) => {
  const { A } = await pair({ realtime: true }, w);
  A.online.share(makeBody({ c: 'hello there my friends' }));
  await w.advance(70);
  assert.equal('c' in shares(A)[0].list[0], false);
}));

await test('a ghost moves between two updates (interpolating 100 ms behind the newest)', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const body = makeBody();
  A.online.share(body);
  await w.advance(70);
  body.x = 10;
  await w.advance(70);
  await w.advance(10);
  const ghost = B.online.sharedBy(0)[0];
  assert.equal(ghost.x, 0, 'still at the first state: the second is not 100 ms old yet');
  await w.advance(50);
  assert.ok(Math.abs(ghost.x - (10 * 30) / 70) < 0.01, `x was ${ghost.x}`);
}));

await test('a ghost turns by slerp, the short way round, between two orientations', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const body = makeBody();
  A.online.share(body);
  await w.advance(70);
  const s = Math.SQRT1_2;
  body.q = [0, s, 0, s]; // 90 degrees about y
  await w.advance(70);
  await w.advance(60);
  const g = B.online.sharedBy(0)[0];
  const f = 30 / 70; // clock - 100 ms sits 30 ms into the 70 ms between the two updates
  const half = (f * Math.PI) / 4;
  const want = [0, Math.sin(half), 0, Math.cos(half)];
  g.q.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 2e-3, `q[${i}] ${v} vs ${want[i]}`));
  assert.ok(Math.abs(Math.hypot(...g.q) - 1) < 1e-6, 'stays a unit quaternion');
}));

await test('the sign of a quaternion does not make a ghost spin the long way', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const body = makeBody({ q: [0, 0, 0, 1] });
  A.online.share(body);
  await w.advance(70);
  body.q = [0, 0, 0, -1]; // the same turn, written the other way
  await w.advance(70);
  await w.advance(60);
  const g = B.online.sharedBy(0)[0];
  assert.ok(Math.abs(Math.abs(g.q[3]) - 1) < 1e-6, `q ${g.q}`);
}));

await test('past the newest update a ghost carries on along its velocity for at most 150 ms, then holds', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  A.online.share(makeBody({ vx: 2, vy: 0, vz: 0 }));
  await w.advance(70);
  await w.advance(200); // 100 ms past the one update
  const g = B.online.sharedBy(0)[0];
  assert.ok(Math.abs(g.x - 0.2) < 1e-6, `x ${g.x}`);
  await w.advance(100);
  assert.ok(Math.abs(g.x - 0.3) < 1e-6, `x ${g.x} (held at +150 ms)`);
}));

await test('a body that has not moved is sent again after 1 second, not before', () => inWorld(async (w) => {
  const { A } = await pair({ realtime: true }, w);
  A.online.share(makeBody());
  await w.advance(100);
  const first = shares(A).length;
  assert.equal(first, 1);
  for (let i = 0; i < 9; i++) await w.advance(100);
  assert.equal(shares(A).length, first, '900 ms later: nothing');
  await w.advance(100);
  assert.equal(shares(A).length, first + 1, 'a full second later: once');
}));

await test('a moving body is sent at most 15 times a second, however often the frame ticks', () => inWorld(async (w) => {
  const { A } = await pair({ realtime: true }, w);
  const body = makeBody();
  A.online.share(body);
  await w.advance(100);
  const before = shares(A).length;
  for (let i = 0; i < 60; i++) { body.x += 1; await w.advance(16); } // 60 frames, ~1 s
  const sent = shares(A).length - before;
  assert.ok(sent >= 12 && sent <= 16, `sent ${sent}`);
}));

await test('only the bodies that changed are in a message', () => inWorld(async (w) => {
  const { A } = await pair({ realtime: true }, w);
  const a = makeBody();
  const b = makeBody();
  A.online.share(a, b);
  await w.advance(100);
  assert.equal(shares(A).at(-1).list.length, 2);
  b.y = 5;
  await w.advance(100);
  assert.deepEqual(shares(A).at(-1).list.map((o) => o.id), [1]);
}));

await test('ids follow the order shared; several bodies make several ghosts, in id order', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  A.online.share(makeBody({ x: 1 }), makeBody({ x: 2 }), makeBody({ x: 3 }));
  await w.advance(100);
  assert.deepEqual(shares(A)[0].list.map((o) => [o.id, o.x]), [[0, 1], [1, 2], [2, 3]]);
  assert.equal(B.online.sharedBy(0).length, 3);
  await w.advance(200);
  assert.deepEqual(B.online.sharedBy(0).map((g) => g.x), [1, 2, 3]);
}));

await test('unshare(body) removes its ghost and frees the id for the next body', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const a = makeBody();
  const b = makeBody();
  A.online.share(a, b);
  await w.advance(100);
  const ghostB = B.online.sharedBy(0)[1];
  A.online.unshare(b);
  await settle();
  assert.equal(ghostB.removed, true);
  assert.equal(B.online.sharedBy(0).length, 1);
  const c = makeBody();
  A.online.share(c);
  await w.advance(100);
  assert.equal(shares(A).at(-1).list[0].id, 1);
}));

await test('a deleted body is unshared by itself and its ghost goes', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const a = makeBody();
  A.online.share(a);
  await w.advance(100);
  const ghost = B.online.sharedBy(0)[0];
  a.deleted = true;
  await w.advance(100);
  assert.equal(ghost.removed, true);
  assert.deepEqual(B.online.sharedBy(0), []);
}));

await test('a player leaving takes its ghosts off the others\' screens; a rejoin starts fresh', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  B.online.share(makeBody());
  await w.advance(100);
  const ghost = A.online.sharedBy(1)[0];
  assert.ok(ghost);
  B.online.leave();
  await settle();
  assert.equal(ghost.removed, true);
  assert.deepEqual(A.online.peers, {});
}));

await test('the room closing takes every ghost away', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  A.online.share(makeBody());
  await w.advance(100);
  const ghost = B.online.sharedBy(0)[0];
  A.online.leave();
  await settle();
  assert.equal(ghost.removed, true);
  assert.deepEqual(B.online.peers, {});
}));

await test('a look change (colour, size, visibility) reaches the ghost', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const body = makeBody();
  A.online.share(body);
  await w.advance(100);
  Object.assign(body, { c: 'gold', w: 5, v: false });
  await w.advance(100);
  await w.advance(20); // the ghost is restyled on the next frame
  const g = B.online.sharedBy(0)[0];
  assert.deepEqual([g.c, g.w, g.v], ['gold', 5, false]);
}));

await test('in a real-time room a late joiner is not replayed old moves; later ones arrive', () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.multiplayer('coop', 3, { realtime: true });
  await settle();
  A.host.actions.host();
  await settle();
  A.online.send('old');
  await settle();
  const B = w.addClient('B');
  B.multiplayer('coop', 3, { realtime: true });
  await settle();
  B.host.actions.join(A.online.code);
  await settle();
  assert.deepEqual(B.moves, []);
  A.online.send('new');
  await settle();
  assert.deepEqual(B.moves, [{ move: 'new', seat: 0 }]);
}));

await test('real-time moves use the 30 a second, burst 60 bucket (not the polling 30 per 10 s)', () => inWorld(async (w) => {
  const { A } = await pair({ realtime: true }, w);
  for (let i = 0; i < 70; i++) A.online.send(i);
  await settle();
  assert.equal(A.moves.length, 60);
  assert.equal(A.online.error, 'Too many messages: at most 30 a second. Send a move when something changes.');
  await w.advance(1000);
  A.online.send('later');
  await settle();
  assert.equal(A.moves.at(-1).move, 'later');
}));

await test('a malformed share (from a hand-written message) is refused in plain words and is not relayed', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  const bad = (list) => A.host.receive({ source: 'preview-online', run: A.posted[0].run, op: 'share', list });
  bad([{ id: 0, x: 1, y: 2, z: 3, q: [0, 0, 0, 1], extra: 'a sentence' }]);
  await settle();
  assert.match(A.online.error, /"extra" is not part of a shared sprite/);
  A.online.error = null;
  bad([{ id: 0, x: 1, y: 2, z: 3, q: [0, 0, 1] }]);
  await settle();
  assert.match(A.online.error, /q must be a rotation/);
  A.online.error = null;
  bad(Array.from({ length: 9 }, (_, id) => ({ id, x: 0, y: 0, z: 0, q: IDENTITY })));
  await settle();
  assert.match(A.online.error, /at most 8 sprites/);
  assert.deepEqual(B.online.peers, {});
}));

const SIX = 'A 3D shared body uses q for rotation and dp for depth, not r or d.';
const sendShare = (c, list) => c.host.receive({ source: 'preview-online', run: c.posted[0].run, op: 'share', list });
const body3d = (extra = {}) => ({ id: 0, x: 1, y: 2, z: 3, q: IDENTITY, ...extra });

await test('a 3D body with `d` is refused with the server\'s sentence and not relayed', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  sendShare(A, [body3d({ d: 2 })]);
  await settle();
  assert.equal(A.online.error, SIX);
  assert.deepEqual(B.online.peers, {});
}));

await test('a 3D body with `r` is refused with the server\'s sentence and not relayed', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  sendShare(A, [body3d({ r: 45 })]);
  await settle();
  assert.equal(A.online.error, SIX);
  assert.deepEqual(B.online.peers, {});
}));

await test('the same body with `dp` is relayed; a 3D and a flat entry in one list are not', () => inWorld(async (w) => {
  const { A, B } = await pair({ realtime: true }, w);
  sendShare(A, [body3d({ dp: 2 })]);
  await settle();
  assert.equal(A.online.error, null);
  assert.equal(B.online.sharedBy(0).length, 1);
  sendShare(A, [body3d(), { id: 1, x: 0, y: 0 }]);
  await settle();
  assert.equal(A.online.error, 'Share flat sprites or 3D bodies in one list, not both.');
}));

await test('the rotation must be a unit quaternion and the shape a short lowercase name', () => inWorld(async (w) => {
  const { A } = await pair({ realtime: true }, w);
  const refusedWith = async (extra, re) => { A.online.error = null; sendShare(A, [body3d(extra)]); await settle(); assert.match(A.online.error, re); };
  await refusedWith({ q: [0, 0, 0, 2] }, /q must be a rotation/);
  await refusedWith({ q: [0, 0, 0, 0] }, /q must be a rotation/);
  await refusedWith({ sh: 'Box' }, /shape must be a name of 1 to 12 lowercase letters/);
  await refusedWith({ sh: 'abcdefghijklm' }, /shape must be a name/);
  await refusedWith({ dp: -1 }, /dp must be a size/);
}));

await test('a share from a tab that is not in the room is not relayed', () => inWorld(async (w) => {
  const { B } = await pair({ realtime: true }, w);
  const C = w.addClient('C');
  C.multiplayer('coop', 2, { realtime: true });
  await settle();
  C.online.share(makeBody());
  await w.advance(200);
  assert.deepEqual(B.online.peers, {});
}));

await test('share() in a polling room (no realtime option) warns and sends nothing', () => inWorld(async (w) => {
  const { A } = await pair({}, w);
  A.online.share(makeBody());
  await w.advance(200);
  assert.equal(shares(A).length, 0);
  assert.ok(A.logs.some(([, t]) => /real-time room/.test(t)));
}));

await test('a malformed shared state from the network is ignored; the sketch is not stopped', () => {
  const s = scripted();
  s.multiplayer('coop', 2, { realtime: true });
  s.deliver({ source: 'preview-online-room', code: 'ABCD', seat: 0, seats: 2, live: true });
  s.deliver({ source: 'preview-online-share', code: 'ABCD', seat: 1, list: [null, { id: 99, x: 0, y: 0, z: 0 }, { id: 0, x: 'a', y: 0, z: 0 }, { id: 1, x: 1, y: 2, z: 3, q: 'nope', w: -4, c: 'a sentence here', sh: 'BOX!' }] });
  const ghost = s.online.sharedBy(1);
  assert.equal(ghost.length, 1);
  assert.deepEqual([ghost[0].x, ghost[0].q, 'w' in ghost[0], 'c' in ghost[0], 'sh' in ghost[0]], [1, [0, 0, 0, 1], false, false, false]);
});

await test('a ghost the engine cannot make is logged, not thrown', () => {
  const sent = [];
  const logs = [];
  const o = createOnline({
    post: (m) => { sent.push(m); return true; }, now: () => 0, readBody, makeGhost: () => { throw new Error('no model'); }, updateGhost, removeGhost,
    log: (l, t) => logs.push([l, t]), target: {},
  });
  o.multiplayer('coop', 2, { realtime: true });
  const run = sent[0].run;
  o.receive({ run, source: 'preview-online-room', code: 'ABCD', seat: 0, seats: 2, live: true });
  o.receive({ run, source: 'preview-online-share', code: 'ABCD', seat: 1, list: [{ id: 0, x: 0, y: 0, z: 0 }] });
  assert.deepEqual(o.online.peers, {});
  assert.ok(logs.some(([l, t]) => l === 'warn' && /no model/.test(t)));
});

await test('a seat\'s own share echo is never turned into a ghost on that seat', () => {
  const s = scripted();
  s.deliver({ source: 'preview-online-room', code: 'ABCD', seat: 0, seats: 2, live: true });
  s.deliver({ source: 'preview-online-share', code: 'ABCD', seat: 0, list: [{ id: 0, x: 0, y: 0, z: 0, q: IDENTITY }] });
  assert.deepEqual(s.online.peers, {});
});

// ---- the local host on its own --------------------------------------------------------------------------------

await test('createLocalHost needs send(), and says what to give', () => {
  assert.throws(() => createLocalHost({}), (e) => e instanceof TypeError && /needs send\(msg\)/.test(e.message));
});

await test('two channels with different names are different worlds', () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.online.host();
  await settle();
  const other = makeWorld();
  try {
    const B = other.addClient('B');
    B.online.join(A.online.code);
    await settle();
    await other.advance(1600);
    assert.equal(B.online.error, NOT_FOUND);
  } finally {
    await other.dispose();
  }
}));

await test('a disposed host page answers nothing and does not throw when messages still arrive', () => inWorld(async (w) => {
  const A = w.addClient('A');
  A.host.dispose();
  A.host.receive({ source: 'preview-online', run: 'x', id: 1, op: 'host' });
  A.host.tick();
  A.host.dispose();
}));

await test('an unknown op with an id is answered with a plain error', () => {
  const replies = [];
  const host = createLocalHost({ channelName: `spashial-unknown-${Math.random()}`, now: () => 0, interval: () => () => {}, send: (m) => replies.push(m) });
  host.receive({ source: 'preview-online', run: 'r', id: 7, op: 'dance' });
  host.dispose();
  assert.deepEqual(replies, [{ source: 'preview-online-reply', id: 7, ok: false, error: 'Unknown online request "dance".', run: 'r' }]);
});

console.log(`${COUNTS.passed} passed, ${COUNTS.failed} failed${COUNTS.skipped ? `, ${COUNTS.skipped} skipped (they compare with shCode files)` : ''}`);
process.exit(COUNTS.failed ? 1 : 0);

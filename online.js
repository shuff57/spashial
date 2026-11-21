// spaSHial's online play: the same `online` and `multiplayer()` a student already knows from moSHion
// (public/moshion/extras.js), with ONE difference: a shared body (online.share) carries a 3D pose
// instead of x, y and rotation. Everything else (room codes, seats, moves, the lobby, statuses,
// errors) behaves as in moSHion, and the messages that cross the iframe boundary have moSHion's
// names, so shCode's existing preview host (lib/moshion-online.ts) can serve both engines.
//
// This file knows nothing about three.js, the DOM or the network. The engine gives it a small `env`
// and calls two functions; the page around the game does the talking to a server (or to
// online-local-host.js, which needs no server):
//
//   const { online, multiplayer, tick, receive } = createOnline(env)
//
//   env.post(msg)             send msg UP to the host page (window.parent.postMessage). Return false
//                             when there is no host page: online then says so instead of waiting.
//   env.now()                 milliseconds (performance.now); the 15 Hz send and the 100 ms delay use it
//   env.readBody(solid)       the solid's state as { x, y, z, q: [qx,qy,qz,qw], vx, vy, vz, w, h, dp, sh, c, v }
//                             in metres and metres per second (vx.. optional). THROWS if solid is not a
//                             Solid or has been deleted: that is how a deleted body stops being shared.
//   env.makeGhost(state)      a Solid for a peer's body: collider 'none', not simulated. state has the
//                             wire fields (id, x, y, z, q, w, h, dp, sh, c, v).
//   env.updateGhost(g, state) move/restyle it (called every tick; the same wire fields)
//   env.removeGhost(g)        delete it
//   env.log(level, text)      the sketch console ('warn' | 'error')
//   optional: env.target      where multiplayer() puts game, players, turn, nextTurn, myTurn, seat
//                             (default globalThis); env.taken(name) -> true if the sketch already has
//                             that name (moSHion also checks the sketch's own top-level let/const)
//
//   online      the object given to the sketch (host, join, send, onMove, leave, share, unshare,
//               peers, sharedBy, status, code, codeIcons, seat, seats, players, error, live, isHost)
//   multiplayer(mode, players, { realtime }) the one-line setup; returns `game`
//   tick()      once per drawn frame: sends shared bodies (15 Hz) and moves the ghosts
//   receive(m)  every message coming DOWN from the host page
//
// Messages (every one carries `run`: the id of this run of the sketch, so a rerun starts clean; the
// host page answers only the run it knows, and receive() drops any other)
//
//   UP    { source: 'preview-online', run, id?, op, ... }
//     op 'hello'                         at load, no reply
//     op 'host'    { id, game, seats, live? }   reply result: { code, seat, seats, codeIcons? }
//     op 'join'    { id, code }                 reply result: the same
//     op 'send'    { id, data }                 a move; game data only (numbers, true/false, short words)
//     op 'leave'   { id }
//     op 'lobby'   { mode, players, realtime? } multiplayer('versus' | 'coop', n): the page shows its
//                                               lobby bar; no reply
//     op 'share'   { list: [Shared] }           up to 8 bodies, no reply (a real-time room only)
//     op 'unshare' { id? }                      one body's id, or all of mine; no reply
//   DOWN  { source, run, ... }
//     'preview-online-reply'   { id, ok, result?, error? }              answers one of the ops with an id
//     'preview-online-update'  { code, seat?, seats?, state?, players?, events?, live?, seqBase?, error? }
//                              state 'waiting' | 'ready' | 'closed' | 'error' | 'connecting';
//                              events [{ seq, seat, data }] are moves, applied once each in seq order;
//                              seqBase: a real-time room counts moves from here (earlier ones are not replayed)
//     'preview-online-room'    { code, codeIcons?, seat, seats, live }  the lobby bar put this run in a
//                              room (code null: took it out)
//     'preview-online-share'   { code, seat, list: [Shared] }           another seat's bodies
//     'preview-online-unshare' { code, seat, id? }                      one of its bodies, or all of them
//
//   Shared (the only thing that differs from moSHion's): { id, x, y, z, q: [qx,qy,qz,qw], vx?, vy?, vz?,
//   w, h, dp, sh?, c?, v }: id 0..7 (lowest free; kept until unshared), metres, metres per second, q a
//   unit quaternion, w/h/dp the body's width, height and depth in metres (dp, not d: the server refuses
//   a 3D body with r or d, which are the flat sprite's rotation and diameter), sh the shape name ('box'),
//   c a CSS colour, v visible.
//
// Differences from moSHion, on purpose:
// - A wrong ARGUMENT throws a plain-words TypeError/RangeError (spaSHial's style, like Sound and
//   Texture), where moSHion logs and carries on. A wrong STATE (send before host/join, share outside
//   a real-time room) still sets online.error and logs, and a network problem only ever sets
//   online.status / online.error: the sketch is never stopped by the connection.
// - online.peers[seat] is an ARRAY of ghosts (a 3D game shares several bodies per player), where
//   moSHion's holds the first sprite. sharedBy(seat) is the same list.
// - share() takes several Solids at once; the ids follow the order they were shared in.
// - A move handler that throws is logged and the next handler still runs (moSHion rethrows on a timer;
//   this file has no timers of its own).

const SHARE_HZ = 15; // lib/live-protocol.ts SHARE_HZ
const SHARE_MS = Math.round(1000 / SHARE_HZ);
const KEEPALIVE_MS = 1000; // a body that has not moved is sent once a second, so a late joiner sees it
const PEER_DELAY_MS = 100; // ghosts are drawn this far in the past, between two updates
const EXTRAPOLATE_MS = 150; // past the newest update a ghost carries on along its velocity this long, then holds
const MAX_SHARED = 8; // lib/live-protocol.ts MAX_SHARED
const MAX_SAMPLES = 12;
const MODES = ['none', 'local', 'coop', 'versus'];
const IDENTITY = [0, 0, 0, 1];
// Same colour rule as lib/live-protocol.ts: a name, #hex, or rgb()/hsl() with numbers only. Anything
// else is not sent, so a colour can never carry a sentence.
const COLOR_RE = /^(?:[a-z]{3,20}|#[0-9a-f]{3,8}|(?:rgba?|hsla?)\(\s*-?[\d.]+%?(?:\s*,\s*-?[\d.]+%?){2,3}\s*\))$/i;
const SHAPE_RE = /^[a-z]{1,12}$/; // lib/live-protocol.ts SHAPE_RE
const NO_HOST = 'Online play only works when the game runs inside a page that offers it (the shCode preview or the spaSHial sandbox).';

const show = (v) => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Millimetres and 1e-4 of a unit quaternion are far below what the eye sees, and rounding makes
// "has it changed?" stable: a body at rest compares equal frame after frame.
const round = (n, places) => { const k = 10 ** places; return Math.round(n * k) / k; };

function unitQuat(q) {
  if (!Array.isArray(q) || q.length !== 4 || !q.every(finite)) return IDENTITY.slice();
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return n > 1e-6 ? q.map((v) => v / n) : IDENTITY.slice();
}

// Spherical interpolation the short way round (q and -q are the same turn).
function slerp(a, b, f) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  if (dot > 0.9995) return unitQuat(a.map((v, i) => v + (sign * b[i] - v) * f)); // nearly equal: a straight blend is exact enough, and sin(0) is a division by zero
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - f) * theta) / s;
  const wb = (Math.sin(f * theta) / s) * sign;
  return a.map((v, i) => wa * v + wb * b[i]);
}

const lerp = (a, b, f) => a + (b - a) * f;

/** A peer's shared state as the room relayed it, checked; null for anything that is not one. The room
 *  checks too, but a message from the network is never trusted to be well formed. */
function cleanState(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.id) || raw.id < 0 || raw.id >= MAX_SHARED) return null;
  if (!finite(raw.x) || !finite(raw.y) || !finite(raw.z)) return null;
  const size = (v) => (finite(v) && v >= 0 ? v : undefined);
  const look = { id: raw.id, v: raw.v !== false };
  for (const [k, v] of [['w', size(raw.w)], ['h', size(raw.h)], ['dp', size(raw.dp)]]) if (v !== undefined) look[k] = v;
  if (typeof raw.sh === 'string' && SHAPE_RE.test(raw.sh)) look.sh = raw.sh;
  if (typeof raw.c === 'string' && raw.c.length <= 40 && COLOR_RE.test(raw.c)) look.c = raw.c;
  const num = (v) => (finite(v) ? v : 0);
  return { look, pose: { x: raw.x, y: raw.y, z: raw.z, q: unitQuat(raw.q), vx: num(raw.vx), vy: num(raw.vy), vz: num(raw.vz) } };
}

export function createOnline(env) {
  const run = Math.random().toString(36).slice(2) + Math.floor(env.now()).toString(36); // one id per run, so a rerun starts clean
  const target = env.target ?? globalThis;
  let nextId = 1;
  const pending = new Map(); // request id -> function(reply)
  const moveFns = [];
  let lastSeq = 0;
  const mine = []; // [{ body, id, last, at }]: the bodies this computer shares
  let lastShareAt = -Infinity;
  const ghosts = new Map(); // seat -> Map(id -> { ghost, samples, look })
  let warnedShare = false;
  const mp = { called: false, mode: 'none', players: 1, turn: 0, online: false, realtime: false };

  const online = {
    status: 'off',
    code: null,
    codeIcons: null,
    seat: null,
    seats: 0,
    players: [],
    error: null,
    live: false,
    host(seats) {
      if (seats !== undefined) {
        if (typeof seats !== 'number') throw new TypeError(`online.host(players) takes the number of players, 2 to 4 (got ${show(seats)})`);
        if (!Number.isInteger(seats) || seats < 2 || seats > 4) throw new RangeError(`online.host(players) takes a whole number from 2 to 4 (got ${seats})`);
      }
      online.status = 'connecting';
      online.error = null;
      const body = { game: 'spashial', seats: seats === undefined ? 2 : seats };
      if (mp.realtime) body.live = true;
      ask('host', body, entered);
    },
    join(code) {
      if (typeof code !== 'string') throw new TypeError(`online.join(code) takes the room code as text, like online.join('BHKE') (got ${show(code)})`);
      online.status = 'connecting';
      online.error = null;
      ask('join', { code }, entered);
    },
    send(move) {
      if (!online.code) { fail('online.send(): not in a room yet. Call online.host() or online.join(code) first.'); return; }
      ask('send', { data: move === undefined ? null : move });
    },
    onMove(fn) {
      if (typeof fn !== 'function') throw new TypeError('online.onMove() takes a function: online.onMove((move, seat) => { ... })');
      moveFns.push(fn);
    },
    leave() {
      ask('leave', {}, () => {
        online.status = 'off';
        online.code = null;
        online.codeIcons = null;
        online.seat = null;
        online.players = [];
        online.live = false;
        removeGhosts();
      });
    },
    share(...bodies) {
      if (bodies.length < 1 || bodies.length > MAX_SHARED) throw new TypeError(`online.share() takes 1 to ${MAX_SHARED} Solids (got ${bodies.length})`);
      bodies.forEach((b, i) => {
        try { env.readBody(b); } catch (e) { throw new TypeError(`online.share() takes Solids: argument ${i + 1} is not one (${e.message})`); }
        if (bodies.indexOf(b) !== i) throw new TypeError(`online.share() was given the same Solid twice (arguments ${bodies.indexOf(b) + 1} and ${i + 1})`);
      });
      if (!mp.realtime) {
        if (!warnedShare) {
          warnedShare = true;
          fail("online.share() needs a real-time room: call multiplayer('coop', 2, { realtime: true }) in setup() first.");
        }
        return;
      }
      const fresh = bodies.filter((b) => !mine.some((m) => m.body === b)); // sharing a body again changes nothing
      if (mine.length + fresh.length > MAX_SHARED) throw new RangeError(`online.share(): you can share at most ${MAX_SHARED} Solids in all (you share ${mine.length} already; online.unshare(solid) frees one)`);
      for (const body of fresh) {
        let id = 0;
        while (mine.some((m) => m.id === id)) id++;
        mine.push({ body, id, last: '', at: 0 });
      }
    },
    unshare(body) {
      for (let i = mine.length - 1; i >= 0; i--) {
        if (body === undefined || mine[i].body === body) {
          up('unshare', { id: mine[i].id });
          mine.splice(i, 1);
        }
      }
    },
    sharedBy(seat) {
      const byId = ghosts.get(seat);
      if (!byId) return [];
      return [...byId.keys()].sort((a, b) => a - b).map((id) => byId.get(id).ghost).filter((g) => g.removed !== true); // a ghost the sketch just deleted is not listed
    },
  };
  // worked out when it is read, from the same list, so it can never show a ghost sharedBy() would not
  Object.defineProperty(online, 'peers', { enumerable: true, get() {
    const out = {};
    for (const seat of ghosts.keys()) { const list = online.sharedBy(seat); if (list.length) out[seat] = list; }
    return out;
  } });
  Object.defineProperty(online, 'isHost', { enumerable: true, get: () => online.seat === 0 });

  // ---- talking to the host page ---------------------------------------------

  function fail(msg) {
    online.error = msg;
    env.log('error', msg);
  }

  /** true: sent. false: there is no host page (env.post said so). null: env.post threw, which for a
   *  structured-clone postMessage means the message held something that cannot be sent (a function). */
  function post(msg) {
    try { return env.post({ source: 'preview-online', run, ...msg }) !== false; } catch { return null; }
  }
  let hasHost = post({ op: 'hello' }) === true;

  function up(op, body) {
    if (hasHost) post({ op, ...body });
  }

  function ask(op, body, done) {
    if (!hasHost) {
      online.status = 'error';
      fail(NO_HOST);
      return;
    }
    const id = nextId++;
    pending.set(id, (reply) => {
      if (reply.ok) { if (done) done(reply.result || {}); return; }
      if (op === 'host' || op === 'join') online.status = 'error';
      fail(reply.error || 'Online play failed.');
    });
    const sent = post({ id, op, ...body });
    if (sent === true) return;
    pending.delete(id);
    if (op === 'host' || op === 'join') online.status = 'error';
    if (sent === false) { hasHost = false; fail(NO_HOST); return; }
    fail(`online.${op}(): the page would not take that. A move can only hold numbers, true/false, short words, lists and objects.`);
  }

  function entered(r) {
    lastSeq = 0;
    online.code = r.code;
    online.codeIcons = r.codeIcons || null;
    online.seat = r.seat;
    online.seats = r.seats;
    online.status = 'waiting';
  }

  // ---- shared bodies: out ----------------------------------------------------

  function snapshot(body, id) {
    const s = env.readBody(body); // throws once the body is deleted
    const o = { id, x: round(s.x, 3), y: round(s.y, 3), z: round(s.z, 3), q: unitQuat(s.q).map((v) => round(v, 4)) };
    if (finite(s.vx) && finite(s.vy) && finite(s.vz)) { o.vx = round(s.vx, 3); o.vy = round(s.vy, 3); o.vz = round(s.vz, 3); }
    for (const k of ['w', 'h', 'dp']) o[k] = finite(s[k]) && s[k] > 0 ? Math.max(0.001, round(s[k], 3)) : 0; // a 0.4 mm cube is still a cube, not a size of 0
    if (typeof s.sh === 'string' && SHAPE_RE.test(s.sh)) o.sh = s.sh;
    if (typeof s.c === 'string' && s.c.length <= 40 && COLOR_RE.test(s.c)) o.c = s.c;
    o.v = s.v !== false;
    return o;
  }

  function othersHere() {
    return online.players.some((p) => !p.left && p.seat !== online.seat);
  }

  function shareOut(t) {
    if (t - lastShareAt < SHARE_MS) return;
    lastShareAt = t;
    // Nobody else to see it: send nothing (every message counts against the room's allowance).
    if (!hasHost || !online.live || !online.code || online.status === 'closed' || online.status === 'error' || !othersHere()) return;
    const list = [];
    for (let i = mine.length - 1; i >= 0; i--) {
      const m = mine[i];
      let snap;
      try { snap = snapshot(m.body, m.id); } catch { up('unshare', { id: m.id }); mine.splice(i, 1); continue; }
      const key = JSON.stringify(snap);
      if (key !== m.last || t - m.at >= KEEPALIVE_MS) { m.last = key; m.at = t; list.push(snap); }
    }
    if (list.length) up('share', { list: list.reverse() });
  }

  // ---- shared bodies: in (ghosts) --------------------------------------------

  function guard(what, fn) {
    try { return fn(); } catch (e) { env.log('warn', `online: could not ${what} (${e && e.message ? e.message : e})`); return undefined; }
  }

  function poseAt(samples, t) {
    const last = samples[samples.length - 1];
    if (t >= last.t) {
      // Past the newest update: carry on along its velocity a little, then hold.
      const dt = Math.min(t - last.t, EXTRAPOLATE_MS) / 1000;
      return { x: last.x + last.vx * dt, y: last.y + last.vy * dt, z: last.z + last.vz * dt, q: last.q };
    }
    if (t <= samples[0].t) return samples[0];
    let i = samples.length - 2;
    while (i > 0 && samples[i].t > t) i--;
    const a = samples[i];
    const b = samples[i + 1];
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), q: slerp(a.q, b.q, f) };
  }

  function place(rec, now) {
    if (!rec.samples.length) return;
    const p = poseAt(rec.samples, now - PEER_DELAY_MS);
    guard('move a peer\'s body', () => env.updateGhost(rec.ghost, { ...rec.look, x: p.x, y: p.y, z: p.z, q: p.q }));
  }

  /** A sketch can delete a peer's ghost (it is an ordinary Solid). Forget those, so peers does not list a
   *  dead body and the next frame does not try to move it; the peer's next share makes a fresh one. */
  function pruneRemoved() {
    for (const [seat, byId] of [...ghosts]) {
      for (const [id, rec] of [...byId]) if (rec.ghost && rec.ghost.removed === true) byId.delete(id);
      if (!byId.size) ghosts.delete(seat);
    }
  }

  function onShare(seat, list) {
    if (typeof seat !== 'number' || seat === online.seat || !Array.isArray(list) || !list.length) return;
    pruneRemoved();
    const byId = ghosts.get(seat) || new Map();
    ghosts.set(seat, byId);
    const t = env.now();
    for (const raw of list) {
      const st = cleanState(raw);
      if (!st) continue;
      let rec = byId.get(st.look.id);
      if (!rec) {
        const ghost = guard('make a peer\'s body', () => env.makeGhost({ ...st.look, x: st.pose.x, y: st.pose.y, z: st.pose.z, q: st.pose.q }));
        if (ghost === undefined) continue;
        rec = { ghost, samples: [], look: st.look };
        byId.set(st.look.id, rec);
      }
      rec.look = st.look;
      const prev = rec.samples[rec.samples.length - 1];
      // After a still spell (one update a second), start the move from "just now", not a second ago.
      if (prev && t - prev.t > SHARE_MS * 3) rec.samples.push({ ...prev, t: t - SHARE_MS, vx: 0, vy: 0, vz: 0 });
      rec.samples.push({ t, ...st.pose });
      while (rec.samples.length > MAX_SAMPLES) rec.samples.shift();
      if (rec.samples.length === 1) place(rec, t);
    }
    if (!byId.size) ghosts.delete(seat);
  }

  /** Delete the ghosts of one seat (or of every seat), or one of them. */
  function removeGhosts(seat, id) {
    for (const [s, byId] of [...ghosts]) {
      if (seat !== undefined && s !== seat) continue;
      for (const [i, rec] of [...byId]) {
        if (id !== undefined && i !== id) continue;
        guard('remove a peer\'s body', () => env.removeGhost(rec.ghost));
        byId.delete(i);
      }
      if (!byId.size) ghosts.delete(s);
    }
  }

  function tick() {
    const t = env.now();
    pruneRemoved();
    shareOut(t);
    for (const byId of ghosts.values()) for (const rec of byId.values()) place(rec, t);
  }

  // ---- messages down from the host page ---------------------------------------

  function applyMoves(events) {
    for (const ev of events) {
      if (!ev || ev.seq <= lastSeq) continue; // never apply a move twice
      lastSeq = ev.seq;
      for (const fn of moveFns) {
        // One handler that throws must not drop the moves after it: both boards would then miss them.
        try { fn(ev.data, ev.seat); } catch (err) { env.log('error', `online.onMove handler threw: ${err && err.message ? err.message : err}`); }
      }
    }
  }

  function onRoom(d) {
    // The page's lobby bar (multiplayer('versus' | 'coop')) put this run in a room, or took it out
    // (code null). Moves replay from the start.
    lastSeq = 0;
    mp.turn = 0;
    online.error = null;
    online.live = d.live === true;
    removeGhosts();
    if (d.code) {
      online.code = d.code;
      online.codeIcons = d.codeIcons || null;
      online.seat = typeof d.seat === 'number' ? d.seat : null;
      if (typeof d.seats === 'number') { online.seats = d.seats; mp.players = d.seats; }
      online.status = 'waiting';
    } else {
      online.status = 'off';
      online.code = null;
      online.codeIcons = null;
      online.seat = null;
      online.players = [];
    }
  }

  function onUpdate(d) {
    if (d.live === true) online.live = true;
    // A real-time room counts moves from where it is now (moves made before you came are not replayed).
    if (typeof d.seqBase === 'number') lastSeq = d.seqBase;
    if (d.players) {
      online.players = d.players;
      if (online.live) {
        const here = new Set(d.players.filter((p) => !p.left).map((p) => p.seat));
        for (const seat of [...ghosts.keys()]) if (!here.has(seat)) removeGhosts(seat);
      }
    }
    if (typeof d.seat === 'number') online.seat = d.seat;
    if (typeof d.seats === 'number') { online.seats = d.seats; if (mp.online) mp.players = d.seats; }
    if (d.state) online.status = d.state;
    if (d.state === 'closed') removeGhosts();
    if (d.error) online.error = d.error;
    applyMoves(d.events || []);
  }

  function receive(d) {
    if (!d || typeof d !== 'object' || d.run !== run) return;
    if (d.source === 'preview-online-reply') {
      const fn = pending.get(d.id);
      pending.delete(d.id);
      if (fn) fn(d);
    } else if (d.source === 'preview-online-room') {
      onRoom(d);
    } else if (d.source === 'preview-online-share' || d.source === 'preview-online-unshare') {
      if (d.code !== online.code) return;
      if (d.source === 'preview-online-share') onShare(d.seat, d.list);
      else if (typeof d.seat === 'number') removeGhosts(d.seat, typeof d.id === 'number' ? d.id : undefined);
    } else if (d.source === 'preview-online-update' && d.code === online.code) {
      onUpdate(d);
    }
  }

  // ---- multiplayer(mode, players) ---------------------------------------------
  //
  //   multiplayer('none')          one player (the same as not calling it)
  //   multiplayer('local', 3)      2-4 players take turns at one keyboard
  //   multiplayer('versus', 2)     online, turn-based, against each other
  //   multiplayer('coop', 3)       online, same side, anyone may move any time
  //   multiplayer('coop', 2, { realtime: true })   a real-time room: online.share() and ghosts
  //
  // Adds (only where the sketch has no name of its own) players, turn, nextTurn(), myTurn() and, online,
  // seat. `game` is always there after the call. The online modes get the page's lobby bar, so the
  // sketch itself never calls online.host() / online.join().

  const isReady = () => (mp.online ? online.status === 'ready' : true);
  function myTurn() {
    if (mp.mode === 'versus') return online.status === 'ready' && online.seat === mp.turn;
    if (mp.mode === 'coop') return online.status === 'ready';
    return true;
  }
  function nextTurn() {
    mp.turn = (mp.turn + 1) % (mp.players > 0 ? mp.players : 1);
    return mp.turn;
  }

  const game = {};
  Object.defineProperties(game, {
    mode: { enumerable: true, get: () => mp.mode },
    players: { enumerable: true, get: () => mp.players },
    ready: { enumerable: true, get: isReady },
    turn: { enumerable: true, get: () => mp.turn },
    seat: { enumerable: true, get: () => (mp.online ? online.seat : null) },
    code: { enumerable: true, get: () => (mp.online ? online.code : null) },
    realtime: { enumerable: true, get: () => mp.realtime },
    status: { enumerable: true, get: () => (mp.online ? online.status : (mp.mode === 'none' ? 'off' : 'ready')) },
  });

  function provide(name, desc) {
    if (name in target || (env.taken && env.taken(name))) {
      env.log('warn', `multiplayer(): your sketch already has its own ${name}, so multiplayer() leaves it alone and does not add one.`);
      return;
    }
    desc.configurable = true;
    desc.enumerable = true;
    // `turn = 5` in the sketch makes the name the sketch's own plain variable.
    if (desc.get && !desc.set) desc.set = (v) => Object.defineProperty(target, name, { value: v, writable: true, configurable: true, enumerable: true });
    Object.defineProperty(target, name, desc);
  }

  function multiplayer(mode, players, options) {
    if (mp.called) {
      env.log('error', `multiplayer() can only be called once, in setup(). The first call (${show(mp.mode)}) stays.`);
      return game;
    }
    const m = typeof mode === 'string' ? mode.trim().toLowerCase() : mode;
    if (!MODES.includes(m)) throw new TypeError(`multiplayer(mode, players): the mode must be 'none', 'local', 'coop' or 'versus' (got ${show(mode)})`);
    let n = 1;
    if (m !== 'none') {
      n = players === undefined ? 2 : players;
      if (typeof n !== 'number') throw new TypeError(`multiplayer(${show(m)}, players): players must be a number, 2 to 4 (got ${show(players)})`);
      if (!Number.isInteger(n) || n < 2 || n > 4) throw new RangeError(`multiplayer(${show(m)}, players): players must be a whole number from 2 to 4 (got ${n})`);
    }
    mp.called = true;
    mp.mode = m;
    mp.players = n;
    mp.turn = 0;
    mp.online = m === 'versus' || m === 'coop';
    const wantsRealtime = !!(options && typeof options === 'object' && options.realtime === true);
    if (wantsRealtime && !mp.online) env.log('warn', `multiplayer(): { realtime: true } is for the online modes, 'coop' and 'versus'. Ignored for ${show(m)}.`);
    mp.realtime = wantsRealtime && mp.online;

    provide('game', { value: game, writable: true });
    if (m !== 'none') {
      provide('players', { get: () => mp.players });
      provide('turn', { get: () => mp.turn });
      provide('nextTurn', { value: nextTurn, writable: true });
      provide('myTurn', { value: myTurn, writable: true });
    }
    if (mp.online) {
      provide('seat', { get: () => online.seat });
      up('lobby', { mode: m, players: n, ...(mp.realtime ? { realtime: true } : {}) });
    }
    return game;
  }

  return { online, multiplayer, tick, receive };
}

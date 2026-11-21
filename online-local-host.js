// The HOST PAGE half of spaSHial online play with NO server: it answers the messages online.js posts
// up (see the table at the top of online.js; the names are moSHion's, which lib/moshion-online.ts
// serves from /api/rooms) and plays them between two TABS of the same browser and origin over a
// BroadcastChannel. The standalone sandbox page, the public GitHub-Pages demos and the tests use it.
//
//   const host = createLocalHost({ channelName?, send(msg), now(), random(), interval?, onLobby? })
//   host.receive(msg)   a message UP from the iframe (online.js): window 'message' handler calls this
//   host.dispose()      leave the room and close the channel; call it on 'pagehide' so the others hear
//                       at once (a tab that just vanishes is noticed after HOST_GONE_MS instead)
//   host.tick()         what the timer runs every TICK_MS (beats, timeouts); a test calls it by hand
//   host.lobby          the lobby bar's state (multiplayer('versus' | 'coop')), or null; onLobby(view)
//                       fires on every change. host.actions.host() / .join(code) / .leave() are what
//                       the bar's buttons press, exactly as MoshionLobby does with lib/moshion-online.ts.
//
// THE HONEST LIMIT. There is no server, so the tab that hosts a room IS the room: it holds the seats
// and the move log, numbers every move (so every tab applies the same list in the same order, the
// sender's own move included, like moSHion's polling rooms), and relays real-time state. If that tab
// is closed, or asleep for 5 seconds, the room closes for everyone; if no tab is hosting, nothing
// exists and a code finds nothing. Rooms reach only tabs of this browser and origin (a different
// computer cannot join), so this is for trying a game out, a classroom demo on one machine, and
// tests: the real classroom path is /api/rooms and the live Durable Object.
//
// (The files named below, lib/ and functions/, are in the shCode repository, not in a standalone copy of this one.)
// The rules are the server's, ported rather than imported (this file must run as plain JS on a page
// with no build): functions/_shared/rooms.ts (2-4 seats, the host is seat 0, a code is 4 picture
// letters, 30 moves per 10 s per seat, 3000 moves, 3-hour rooms), lib/game-data.ts (checkGameData),
// lib/live-protocol.ts (the 30/s burst-60 bucket of a real-time room, checkShared with its 3D bodies).
//
// Wire messages between tabs (all carry `from`: the sender tab's id):
//   to the room's tab   join send leave share-up unshare-up {code, req?, ...}   answered by
//   reply               {to, req, ok, error?, ...}                              (to = the asker's id)
//   from the room's tab state move share unshare closed {code, ...} to everyone, error {to, code, error},
//                       beat {code} every BEAT_MS (what makes a vanished host noticeable)
// A tab follows only the room it is in, and only messages from that room's own tab.

const TICK_MS = 500;
const BEAT_MS = 1000;
const HOST_GONE_MS = 5000; // a host tab silent this long has gone: the room closes
const REQUEST_MS = 1500; // a tab that does not answer a join or a move in this time is not there
const CLOSED_KEEP_MS = 60_000; // a closed room still answers "closed" this long, so a late join says why
const ROOM_TTL_MS = 3 * 60 * 60 * 1000;
const MAX_EVENTS = 3000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 10_000;
const LIVE_RATE_PER_SEC = 30;
const LIVE_BURST = 60;
const MAX_FRAME = 4096;
const MAX_SHARED = 8;

// The ONE list is lib/room-icons.ts; the order is the code, so this copy must match it (the test
// reads that file and compares).
const ROOM_ICONS = ['coin', 'star', 'heart', 'gem', 'key', 'slime', 'bee', 'bat', 'ghost', 'fish', 'frog', 'mushroom', 'cactus', 'crate', 'bomb', 'apple'];
const ROOM_CODE_LETTERS = 'ABCDEFGHJKMNPQRS';
const CODE_RE = /^[ABCDEFGHJKMNPQRS]{4}$/;
const REQUESTS = new Set(['join', 'send', 'leave', 'share-up', 'unshare-up']);

// moSHion's words (functions/api/rooms/**), kept so a sketch reads the same text on both servers.
const BAD_CODE = 'A room code is 4 pictures (4 letters, like BHKE).';
const NOT_FOUND = 'No room has that code in your classes. Check the code with the person hosting.';
const CLOSED_JOIN = 'That room has closed. Ask for a new code.';
const CLOSED_SEND = 'That room has closed.';
const FULL = 'That room is full.';
const NOT_IN_ROOM = 'You are not in that room.';
const BAD_SEATS = 'A room has 2 to 4 players.';
const ROOM_FULL_OF_MOVES = 'This room is full of moves. Start a new room.';
const TOO_MANY = `Too many moves at once: at most ${RATE_LIMIT} every ${RATE_WINDOW_MS / 1000} seconds. Send a move when something changes, not every frame.`;
const TOO_MANY_LIVE = `Too many messages: at most ${LIVE_RATE_PER_SEC} a second. Send a move when something changes.`;
const NOT_YET = 'Not in a room yet: call online.host() or online.join(code) first.';
const UNREACHABLE = 'The tab that hosts this room is not answering. It may have closed.';

// ---- the rules, ported ---------------------------------------------------------------

/** lib/game-data.ts checkGameData: the reason in the course's words, or null when the move is fine. */
function checkGameData(v) {
  const MAX_STRING = 20;
  const MAX_TEXT_PER_MOVE = 24;
  const MAX_EVENT_BYTES = 1024;
  let text = 0;
  function walk(x, depth) {
    if (x === null || typeof x === 'boolean') return null;
    if (typeof x === 'number') return Number.isFinite(x) ? null : 'Numbers must be ordinary numbers.';
    if (typeof x === 'string') {
      if (/\s/.test(x)) return 'A word in a move cannot have spaces: a move is game data (numbers, true/false, one-word labels), not a message.';
      text += x.length;
      return x.length <= MAX_STRING ? null : `Words in a move can be at most ${MAX_STRING} letters. Send numbers, true/false and short words.`;
    }
    if (depth >= 4) return 'A move can be nested at most 4 levels deep.';
    if (Array.isArray(x)) {
      if (x.length > 64) return 'A list in a move can hold at most 64 items.';
      for (const y of x) { const e = walk(y, depth + 1); if (e) return e; }
      return null;
    }
    if (typeof x === 'object') {
      const keys = Object.keys(x);
      if (keys.length > 32) return 'An object in a move can have at most 32 names.';
      for (const k of keys) {
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,19}$/.test(k)) return `"${k.slice(0, 20)}" cannot be a name in a move: use letters, digits and _ (up to 20).`;
        const e = walk(x[k], depth + 1);
        if (e) return e;
      }
      return null;
    }
    return 'A move can only hold numbers, true/false, short words, lists and objects.';
  }
  const e = walk(v, 0);
  if (e) return e;
  if (text > MAX_TEXT_PER_MOVE) return `A move can hold at most ${MAX_TEXT_PER_MOVE} letters of words in all. Send numbers for the game, not messages.`;
  const size = new TextEncoder().encode(JSON.stringify(v)).length;
  return size > MAX_EVENT_BYTES ? `A move can be at most ${MAX_EVENT_BYTES} bytes; this one is ${size}.` : null;
}

const COLOR_RE = /^(?:[a-z]{3,20}|#[0-9a-f]{3,8}|(?:rgba?|hsla?)\(\s*-?[\d.]+%?(?:\s*,\s*-?[\d.]+%?){2,3}\s*\))$/i;
const TEXTURE_RE = /^[A-Za-z0-9_-]{1,20}$/;
const SHARED_KEYS_2D = new Set(['id', 'x', 'y', 'r', 'vx', 'vy', 'w', 'h', 'd', 'c', 'tx', 'v']);
const SHARED_KEYS_3D = new Set(['id', 'x', 'y', 'z', 'q', 'vx', 'vy', 'vz', 'w', 'h', 'dp', 'sh', 'c', 'tx', 'v']);
const KEYS_ONLY_3D = ['z', 'q', 'vz', 'dp', 'sh']; // an entry is 3D exactly when it carries one of these
const SHAPE_RE = /^[a-z]{1,12}$/;
const COORD = 1e6;
const SIZE = 1e4;
const Q_COMPONENT_MAX = 1.0001;
const Q_LENGTH_SLACK = 0.01;

/**
 * lib/live-protocol.ts checkShared, ported rule for rule (scripts/test-spashial-online-agrees.mjs feeds
 * both the same lists and fails if they ever disagree on accept or refuse): 1 to 8 entries, distinct
 * ids 0-7, one kind per list (flat sprites or 3D bodies), numbers finite and in range, a 3D body's q a
 * rotation (4 numbers, each at most 1.0001, length within 0.01 of 1), a shape of 1-12 lowercase
 * letters, `dp` for depth (a 3D body with r or d is refused), a colour that is a colour. A body is a
 * pose, never words.
 */
export function checkShared(list) { // exported only so the agreement test can reach it
  if (!Array.isArray(list) || list.length === 0) return 'Nothing to share.';
  if (list.length > MAX_SHARED) return `You can share at most ${MAX_SHARED} sprites.`;
  const ids = new Set();
  let kind3D = null; // set by the first entry; the rest must agree
  for (const o of list) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return 'A shared sprite must be an object.';
    for (const k of Object.keys(o)) if (!SHARED_KEYS_2D.has(k) && !SHARED_KEYS_3D.has(k)) return `"${k.slice(0, 20)}" is not part of a shared sprite.`;
    const is3D = KEYS_ONLY_3D.some((k) => k in o);
    if (is3D && ('r' in o || 'd' in o)) return 'A 3D shared body uses q for rotation and dp for depth, not r or d.';
    if (kind3D === null) kind3D = is3D;
    else if (is3D !== kind3D) return 'Share flat sprites or 3D bodies in one list, not both.';
    if (!Number.isInteger(o.id) || o.id < 0 || o.id >= MAX_SHARED) return 'A shared sprite needs an id from 0 to 7.';
    if (ids.has(o.id)) return 'Two shared sprites have the same id.';
    ids.add(o.id);
    for (const k of is3D ? ['x', 'y', 'z', 'vx', 'vy', 'vz'] : ['x', 'y', 'r', 'vx', 'vy']) {
      const n = o[k];
      if (n === undefined && k !== 'x' && k !== 'y' && k !== 'z') continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > COORD) return `A shared sprite's ${k} must be an ordinary number.`;
    }
    if (is3D) {
      const q = o.q;
      if (!Array.isArray(q) || q.length !== 4 || q.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > Q_COMPONENT_MAX)
        || Math.abs(Math.hypot(...q) - 1) > Q_LENGTH_SLACK) {
        return "A 3D shared body's q must be a rotation: 4 numbers whose length is 1.";
      }
      if (o.sh !== undefined && (typeof o.sh !== 'string' || !SHAPE_RE.test(o.sh))) return "A 3D shared body's shape must be a name of 1 to 12 lowercase letters.";
    }
    for (const k of is3D ? ['w', 'h', 'dp'] : ['w', 'h', 'd']) {
      const n = o[k];
      if (n === undefined) continue;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > SIZE) return `A shared sprite's ${k} must be a size from 0 to ${SIZE}.`;
    }
    if (o.c !== undefined && (typeof o.c !== 'string' || o.c.length > 40 || !COLOR_RE.test(o.c))) return "A shared sprite's colour must be a colour.";
    if (o.tx !== undefined && (typeof o.tx !== 'string' || !TEXTURE_RE.test(o.tx))) return "A shared sprite's texture must be a texture name.";
    if (o.v !== undefined && typeof o.v !== 'boolean') return "A shared sprite's visible must be true or false.";
  }
  return null;
}

const normalizeCode = (raw) => {
  const c = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(c) ? c : null;
};

/** The 4 picture names of a picture code, or null. */
const codeIcons = (code) => (code && CODE_RE.test(code) ? [...code].map((ch) => ROOM_ICONS[ROOM_CODE_LETTERS.indexOf(ch)]) : null);

const defaultInterval = (fn, ms) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

export function createLocalHost({ channelName = 'spashial-online', send, now = Date.now, random = Math.random, interval = defaultInterval, onLobby = () => {} }) {
  if (typeof send !== 'function') throw new TypeError('createLocalHost({ send }) needs send(msg): a function that posts a message down to the game iframe');
  if (typeof BroadcastChannel !== 'function') throw new Error('Playing between two tabs needs BroadcastChannel, which this browser does not have.');

  const letter = () => ROOM_CODE_LETTERS[Math.floor(random() * ROOM_CODE_LETTERS.length)];
  const device = Array.from({ length: 12 }, () => Math.floor(random() * 36).toString(36)).join(''); // this tab: a seat is a tab
  const channel = new BroadcastChannel(channelName);
  let run = null; // the sketch run being served; a new one starts clean
  let cur = null; // the room this tab's sketch is in: { code, hostDevice, authority, seat, seats, live, beatAt, state, players, backlog, seqBase }
  const rooms = new Map(); // rooms THIS tab hosts: the open one and, for a while, closed ones (code -> room)
  const heard = new Map(); // codes other tabs host (code -> when last heard): never hand out one in use
  const pending = new Map(); // req -> { done, deadline, kind }
  let nextReq = 1;
  let lastBeat = -Infinity;
  let rejoin = null; // a joined lobby room to take again when a rerun asks for the lobby (the seat is still ours)
  let lobbyView = null;
  let disposed = false;

  const openRoom = () => [...rooms.values()].find((r) => !r.closed) || null;

  // ---- the two directions out ---------------------------------------------------

  function down(msg) {
    try { send({ ...msg, run }); } catch { /* the page is going */ }
  }

  /** To the other tabs only. */
  function tell(msg) {
    channel.postMessage({ ...msg, from: device });
  }

  /** To the other tabs, and to this tab's own sketch the same way (a channel never echoes to its sender). */
  function emit(msg) {
    tell(msg);
    onWire({ ...msg, from: device });
  }

  /** Ask the tab that hosts the room; `done(reply)` once it answers or the time is up. */
  function request(kind, body, done) {
    // Only a request that wants an answer carries a req: a room does not reply to a share it was sent 15 times a second.
    const req = nextReq++;
    if (done) pending.set(req, { done, deadline: now() + REQUEST_MS, kind });
    tell({ k: kind, ...(done ? { req } : {}), ...body });
  }

  /** The same, for a room this tab may itself host (then it is answered on the spot). */
  function toAuthority(kind, body, done) {
    if (cur.authority) {
      const r = serve({ k: kind, from: device, code: cur.code, ...body });
      if (done) done(r);
    } else {
      request(kind, { code: cur.code, ...body }, done);
    }
  }

  // ---- the room (this tab is the authority) ------------------------------------

  function newCode() {
    let code = '';
    for (let tries = 0; tries < 50; tries++) {
      code = Array.from({ length: 4 }, letter).join('');
      if (!heard.has(code) && !rooms.has(code)) return code;
    }
    return code;
  }

  function roomState(room) {
    if (room.closed || now() >= room.expiresAt) return 'closed';
    return room.players.filter((p) => !p.left).length >= room.seats ? 'ready' : 'waiting';
  }

  const publicPlayers = (room) => [...room.players].sort((a, b) => a.seat - b.seat).map((p) => ({ seat: p.seat, name: `Player ${p.seat + 1}`, left: p.left }));
  const seatOf = (room, dev) => room.players.find((p) => p.device === dev && !p.left);
  const announce = (room) => emit({ k: 'state', code: room.code, state: roomState(room), seats: room.seats, players: publicPlayers(room) });

  function closeRoom(room) {
    room.closed = true;
    room.closedAt = now();
    emit({ k: 'closed', code: room.code });
  }

  /** The server's rate rules: a sliding 30 per 10 s in a polling room, the 30/s burst-60 bucket in a real-time one. */
  function rateProblem(room, seat, t) {
    if (room.live) {
      const b = room.limits.get(seat) || { tokens: LIVE_BURST, at: t };
      b.tokens = Math.min(LIVE_BURST, b.tokens + (Math.max(0, t - b.at) / 1000) * LIVE_RATE_PER_SEC);
      b.at = t;
      room.limits.set(seat, b);
      if (b.tokens < 1) return TOO_MANY_LIVE;
      b.tokens -= 1;
      return null;
    }
    const recent = (room.limits.get(seat) || []).filter((at) => at > t - RATE_WINDOW_MS);
    room.limits.set(seat, recent);
    if (recent.length >= RATE_LIMIT) return TOO_MANY;
    recent.push(t);
    return null;
  }

  function joinRoom(room, dev) {
    if (roomState(room) === 'closed') return { ok: false, error: CLOSED_JOIN };
    let p = room.players.find((q) => q.device === dev);
    if (p) {
      p.left = false;
    } else {
      // A seat nobody holds now (never taken, or its player left) is free.
      let seat = 0;
      while (seat < room.seats && room.players.some((q) => q.seat === seat && !q.left)) seat++;
      if (seat >= room.seats) return { ok: false, error: FULL };
      room.players = room.players.filter((q) => q.seat !== seat);
      p = { seat, device: dev, left: false };
      room.players.push(p);
    }
    return {
      ok: true, seat: p.seat, seats: room.seats, live: room.live, game: room.game, state: roomState(room), players: publicPlayers(room), seq: room.seq,
      // A polling room replays every move to a newcomer; a real-time room counts from now (seq).
      log: room.live ? [] : room.log.slice(),
    };
  }

  function sendMove(room, m) {
    const p = seatOf(room, m.from);
    if (!p) return { ok: false, error: NOT_IN_ROOM };
    if (roomState(room) === 'closed') return { ok: false, error: CLOSED_SEND };
    if (!('data' in m)) return { ok: false, error: 'Nothing to send.' };
    const problem = checkGameData(m.data);
    if (problem) return { ok: false, error: problem };
    if (!room.live && room.log.length >= MAX_EVENTS) return { ok: false, error: ROOM_FULL_OF_MOVES };
    const limited = rateProblem(room, p.seat, now());
    if (limited) return { ok: false, error: limited };
    const seq = ++room.seq;
    if (!room.live) room.log.push({ seq, seat: p.seat, data: m.data });
    emit({ k: 'move', code: room.code, seq, seat: p.seat, data: m.data });
    return { ok: true, seq };
  }

  function leaveSeat(room, dev) {
    const p = seatOf(room, dev);
    if (!p) return { ok: true };
    p.left = true;
    emit({ k: 'unshare', code: room.code, seat: p.seat });
    announce(room);
    return { ok: true };
  }

  /** A refused real-time message is told to its sender, and the room goes on. */
  function refuse(dev, room, error) {
    if (dev === device) down({ source: 'preview-online-update', code: room.code, error, events: [] });
    else tell({ k: 'error', to: dev, code: room.code, error });
    return { ok: false, error };
  }

  function relayShare(room, m) {
    if (!room.live) return { ok: true }; // only a real-time room has sockets for this; a polling room drops it
    const p = seatOf(room, m.from);
    if (!p) return { ok: false, error: NOT_IN_ROOM };
    if (JSON.stringify({ t: 'share', list: m.list ?? null }).length > MAX_FRAME) return refuse(m.from, room, 'That message is too big.');
    const problem = checkShared(m.list);
    if (problem) return refuse(m.from, room, problem);
    const limited = rateProblem(room, p.seat, now());
    if (limited) return refuse(m.from, room, limited);
    emit({ k: 'share', code: room.code, seat: p.seat, list: m.list });
    return { ok: true };
  }

  function relayUnshare(room, m) {
    const p = seatOf(room, m.from);
    if (!p || !room.live) return { ok: true };
    if (m.id !== undefined && (!Number.isInteger(m.id) || m.id < 0 || m.id >= MAX_SHARED)) return refuse(m.from, room, 'unshare needs an id from 0 to 7.');
    emit({ k: 'unshare', code: room.code, seat: p.seat, ...(m.id === undefined ? {} : { id: m.id }) });
    return { ok: true };
  }

  /** What the room says to one request, or null when this tab hosts no such room. */
  function serve(m) {
    const room = rooms.get(m.code);
    if (!room) return null;
    switch (m.k) {
      case 'join': return joinRoom(room, m.from);
      case 'send': return sendMove(room, m);
      case 'leave': return leaveSeat(room, m.from);
      case 'share-up': return relayShare(room, m);
      default: return relayUnshare(room, m);
    }
  }

  function answer(m) {
    const r = serve(m);
    if (r === null) return;
    if (m.req) tell({ k: 'reply', to: m.from, req: m.req, code: m.code, ...r });
    // After the reply, so the newcomer already has its seat when it hears who is here.
    if (m.k === 'join' && r.ok) announce(rooms.get(m.code));
  }

  // ---- messages between tabs -----------------------------------------------------

  function onReply(m) {
    if (m.to !== device) return;
    const p = pending.get(m.req);
    if (!p) return;
    pending.delete(m.req);
    p.done(m);
  }

  function onWire(m) {
    if (!m || typeof m !== 'object') return;
    if (REQUESTS.has(m.k)) { answer(m); return; }
    if (m.k === 'reply') { onReply(m); return; }
    if (m.k === 'beat' && typeof m.code === 'string') heard.set(m.code, now());
    if (m.k === 'closed') heard.delete(m.code);
    if (!cur || m.code !== cur.code || m.from !== cur.hostDevice) return;
    cur.beatAt = now();
    if (m.k === 'state') {
      cur.seats = m.seats;
      cur.state = m.state;
      cur.players = m.players;
      down({ source: 'preview-online-update', code: cur.code, seat: cur.seat, seats: m.seats, state: m.state, players: m.players, events: [], ...(cur.live ? { live: true } : {}) });
      patchRoom({ seat: cur.seat, seats: m.seats, state: m.state, players: m.players });
    } else if (m.k === 'move') {
      down({ source: 'preview-online-update', code: cur.code, events: [{ seq: m.seq, seat: m.seat, data: m.data }] });
    } else if (m.k === 'share') {
      if (m.seat !== cur.seat) down({ source: 'preview-online-share', code: cur.code, seat: m.seat, list: m.list }); // to every OTHER seat
    } else if (m.k === 'unshare') {
      down({ source: 'preview-online-unshare', code: cur.code, seat: m.seat, ...(m.id === undefined ? {} : { id: m.id }) });
    } else if (m.k === 'error') {
      if (m.to === device) down({ source: 'preview-online-update', code: cur.code, error: m.error, events: [] });
    } else if (m.k === 'closed') {
      roomEnded();
    }
  }

  /** The room this tab was in is over (the host left or went, or it ran out): tell the sketch, drop it. */
  function roomEnded() {
    const code = cur.code;
    down({ source: 'preview-online-update', code, state: 'closed', events: [] });
    cur = null;
    if (lobbyView?.room?.code === code) roomGone(code);
  }

  channel.onmessage = (e) => { if (!disposed) onWire(e.data); };

  // ---- entering and leaving a room -----------------------------------------------

  /** Leave the room this tab's sketch is in. A host leaving closes the room for everyone. */
  function leaveCurrent() {
    const c = cur;
    if (!c) return;
    cur = null; // so the room's own 'closed' does not come back to this sketch as an update
    if (c.authority) closeRoom(rooms.get(c.code));
    else tell({ k: 'leave', code: c.code });
  }

  function startHosting(seats, live, game, done) {
    const n = seats === undefined ? 2 : Number(seats);
    if (!Number.isInteger(n) || n < 2 || n > 4) { done({ ok: false, error: BAD_SEATS }); return; }
    leaveCurrent(); // one room per run
    const t = now();
    const room = { code: newCode(), game: typeof game === 'string' && game ? game : 'spashial', seats: n, live, expiresAt: t + ROOM_TTL_MS, seq: 0, log: [], players: [{ seat: 0, device, left: false }], closed: false, limits: new Map() };
    rooms.set(room.code, room);
    cur = { code: room.code, game: room.game, hostDevice: device, authority: true, seat: 0, seats: n, live, beatAt: t, state: 'waiting', players: publicPlayers(room), backlog: [], seqBase: 0 };
    beat(t);
    done({ ok: true });
  }

  function startJoining(raw, done) {
    const code = normalizeCode(raw);
    if (!code) { done({ ok: false, error: BAD_CODE }); return; }
    request('join', { code }, (r) => {
      if (!r.ok) { done({ ok: false, error: r.error }); return; }
      leaveCurrent(); // the old room only goes once the new one said yes
      cur = { code, game: r.game, hostDevice: r.from, authority: false, seat: r.seat, seats: r.seats, live: r.live, beatAt: now(), state: r.state, players: r.players, backlog: r.log, seqBase: r.seq };
      done({ ok: true });
    });
  }

  /** The first thing the sketch hears of a room it has just entered: who is here and, in a polling room, every move so far. */
  function pushState() {
    down({
      source: 'preview-online-update', code: cur.code, seat: cur.seat, seats: cur.seats, state: cur.state, players: cur.players,
      events: cur.live ? [] : cur.backlog, ...(cur.live ? { live: true, seqBase: cur.seqBase } : {}),
    });
    cur.backlog = [];
  }

  // ---- what the sketch asks ------------------------------------------------------

  const reply = (id, r) => down({ source: 'preview-online-reply', id, ...r });

  function entered(id, r) {
    if (!r.ok) { reply(id, r); return; }
    reply(id, { ok: true, result: { code: cur.code, seat: cur.seat, seats: cur.seats, game: cur.game, live: cur.live, kind: 'game', codeIcons: codeIcons(cur.code) } });
    pushState();
  }

  function onOp(d) {
    if (d.op === 'host') {
      startHosting(d.seats, d.live === true, d.game, (r) => entered(d.id, r));
    } else if (d.op === 'join') {
      startJoining(d.code, (r) => entered(d.id, r));
    } else if (d.op === 'send') {
      if (!cur) { reply(d.id, { ok: false, error: NOT_YET }); return; }
      toAuthority('send', 'data' in d ? { data: d.data } : {}, (r) => reply(d.id, r.ok ? { ok: true, result: { seq: r.seq } } : { ok: false, error: r.error }));
    } else if (d.op === 'leave') {
      if (cur && cur.code === rejoin) rejoin = null;
      patch({ room: null });
      leaveCurrent();
      reply(d.id, { ok: true });
    } else if (d.op === 'share' && cur?.live) {
      toAuthority('share-up', { list: d.list });
    } else if (d.op === 'unshare' && cur?.live) {
      toAuthority('unshare-up', { id: d.id });
    } else if (d.op === 'lobby') {
      onLobbyOp(d);
    } else if (typeof d.id === 'number') {
      reply(d.id, { ok: false, error: `Unknown online request "${d.op}".` });
    }
  }

  /** A new run of the sketch starts from nothing: it leaves a room it hosted (which closes it), and
   *  keeps a seat it joined (same tab, so a rerun's join gives the seat back). */
  function newRun(r) {
    if (cur?.authority) leaveCurrent();
    else cur = null;
    run = typeof r === 'string' ? r : null;
    if (lobbyView) show(null);
  }

  function receive(d) {
    if (disposed || !d || typeof d !== 'object' || d.source !== 'preview-online' || typeof d.op !== 'string') return;
    if (d.run !== run) newRun(d.run);
    if (d.op !== 'hello') onOp(d);
  }

  // ---- the lobby bar (multiplayer('versus' | 'coop')) ---------------------------

  const show = (view) => { lobbyView = view; onLobby(view); };
  const patch = (p) => { if (lobbyView) show({ ...lobbyView, ...p }); };
  const patchRoom = (p) => { if (lobbyView?.room) show({ ...lobbyView, room: { ...lobbyView.room, ...p } }); };

  /** The lobby's room closed (the host left, it ran out): back to Host / Join. */
  function roomGone(code) {
    if (rejoin === code) rejoin = null;
    patch({ room: null, notice: `Room ${code} closed.` });
  }

  function onLobbyOp(d) {
    const n = Number(d.players);
    if ((d.mode !== 'versus' && d.mode !== 'coop') || !Number.isInteger(n) || n < 2 || n > 4) return;
    show({ mode: d.mode, realtime: d.realtime === true, players: n, room: null, busy: false, error: null, notice: null });
    if (rejoin) actions.join(rejoin); // a joiner's rerun: take the same seat again without asking
  }

  function lobbyEnter(start, hosting) {
    if (!lobbyView || lobbyView.busy) return;
    patch({ busy: true, error: null, notice: null });
    const forRun = run;
    start((r) => {
      if (forRun !== run || !lobbyView) return; // a rerun happened meanwhile
      if (!r.ok) {
        patch({ busy: false, error: r.error });
        if (!hosting) rejoin = null;
        return;
      }
      rejoin = hosting ? null : cur.code;
      down({ source: 'preview-online-room', code: cur.code, codeIcons: codeIcons(cur.code), seat: cur.seat, seats: cur.seats, live: cur.live });
      patch({ busy: false, error: null, notice: null, room: { code: cur.code, seat: cur.seat, seats: cur.seats, state: cur.state, players: cur.players, hosting } });
      pushState();
    });
  }

  const actions = {
    host() {
      if (lobbyView) lobbyEnter((done) => startHosting(lobbyView.players, lobbyView.realtime, 'spashial', done), true);
    },
    join(raw) {
      if (!lobbyView) return;
      const code = normalizeCode(raw);
      if (!code) { patch({ error: BAD_CODE }); return; }
      lobbyEnter((done) => startJoining(code, done), false);
    },
    leave() {
      if (!lobbyView?.room) return;
      rejoin = null;
      patch({ room: null, busy: false, error: null, notice: null });
      leaveCurrent();
      down({ source: 'preview-online-room', code: null });
    },
  };

  // ---- time: beats, timeouts, expiry ---------------------------------------------

  function beat(t) {
    const room = openRoom();
    if (!room) return;
    lastBeat = t;
    tell({ k: 'beat', code: room.code });
  }

  function tick() {
    if (disposed) return;
    const t = now();
    const room = openRoom();
    if (room && t >= room.expiresAt) closeRoom(room);
    else if (room && t - lastBeat >= BEAT_MS) beat(t);
    // The tab that hosts our room has gone quiet: it is gone, and so is the room.
    if (cur && !cur.authority && t - cur.beatAt >= HOST_GONE_MS) roomEnded();
    for (const [req, p] of [...pending]) {
      if (t < p.deadline) continue;
      pending.delete(req);
      // Nobody answering a join is how an unknown code looks without a server to say so.
      p.done({ ok: false, error: p.kind === 'join' ? NOT_FOUND : UNREACHABLE });
    }
    for (const [code, at] of [...heard]) if (t - at >= HOST_GONE_MS) heard.delete(code);
    for (const [code, r] of [...rooms]) if (r.closed && t - r.closedAt >= CLOSED_KEEP_MS) rooms.delete(code);
  }

  const stop = interval(tick, TICK_MS);

  function dispose() {
    if (disposed) return;
    leaveCurrent();
    disposed = true;
    stop();
    channel.close();
  }

  return { receive, dispose, tick, actions, get lobby() { return lobbyView; } };
}

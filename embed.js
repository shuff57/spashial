// Runs a spaSHial sketch inside a sandboxed iframe, the way a host page is meant to.
//
//   import { runSketch, localStore } from './embed.js';
//   const run = runSketch(iframeElement, 'function setup() { new Cube(); }', {
//     store: localStore('my-game'),     // optional: keeps what the sketch saves with storeItem()
//     onReady() {}, onLog(type, text) {}, onError({ name, message, line, snippet }) {},
//   });
//   run.stop();     // blank the frame (frees the WebGL context and the physics world)
//
// The iframe is sandboxed WITHOUT allow-same-origin, so the sketch gets an opaque origin: it
// cannot read this page, its storage or its cookies. The sketch travels over postMessage
// (see runner.html), so its size is not limited by the URL.
//
// Saving: the sandboxed frame has no storage of its own, so the HOST keeps what the sketch saves.
// One request/init round trip carries the sketch AND the saved values:
//   frame -> host   { source: 'preview-storage-request' }
//   host  -> frame  { source: 'preview-storage-init', code, data: { name: '<json>' } }
//   frame -> host   { source: 'preview-storage', op: 'set' | 'remove' | 'clear', key, value }  (every change)
// A `store` is { read() -> { name: json }, apply(message) }. localStore() makes one on localStorage.
//
// Online play: a sketch that calls multiplayer() or online.host() needs a HOST PAGE to serve its rooms,
// because the frame cannot reach a server. runSketch serves them with online-local-host.js, which needs
// NO server: it plays between TWO TABS OF THE SAME BROWSER on the same site (a BroadcastChannel). The tab
// that hosts a room IS the room: close or reload it and the room closes, and another computer can never
// join. Pass `onLobby(view, actions)` and call renderLobby() to draw the lobby bar the sketch asks for.
//   frame -> host   { source: 'preview-online', ... }          host -> frame   { source: 'preview-online-*', ... }
export const SANDBOX = 'allow-scripts allow-downloads allow-modals';
const RUNNER = new URL('./runner.html', import.meta.url).href;
let serial = 0;

/** A store on this page's localStorage under one key. Give every sketch its own key, so two sketches
 *  never overwrite each other's saved values. Without localStorage (private browsing) it keeps nothing. */
export function localStore(key) {
  const read = () => { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } };
  const write = (o) => { try { localStorage.setItem(key, JSON.stringify(o)); } catch { /* storage refused */ } };
  return {
    read,
    apply(m) {
      const o = read();
      if (m.op === 'set') o[m.key] = m.value;
      else if (m.op === 'remove') delete o[m.key];
      else if (m.op === 'clear') for (const k of Object.keys(o)) if (!(m.keep || []).some((p) => k.startsWith(p))) delete o[k];
      write(o);
    },
  };
}

const hosts = new Set();
if (typeof addEventListener === 'function') addEventListener('pagehide', () => { for (const h of hosts) h.dispose(); });

/** Draws the lobby bar into `el` (give it class "lobby"): Host a game, or a code box and Join, or the room's
 *  code and Leave. `view` is what runSketch's onLobby receives; null hides the bar. */
export function renderLobby(el, view, actions) {
  el.classList.toggle('on', !!view);
  if (!view) { el.replaceChildren(); return; }
  const make = (tag, props = {}, text = '') => Object.assign(document.createElement(tag), props, text ? { textContent: text } : {});
  const kids = [make('strong', {}, `Online (${view.mode}, ${view.players} players${view.realtime ? ', real-time' : ''})`)];
  if (view.room) {
    kids.push(make('span', { className: 'code' }, view.room.code), make('span', {}, `seat ${view.room.seat + 1} of ${view.room.seats} \u00b7 ${view.room.state}`));
    const leave = make('button', { className: 'btn small' }, 'Leave'); leave.onclick = () => actions.leave(); kids.push(leave);
  } else {
    const host = make('button', { className: 'btn small', disabled: view.busy }, 'Host a game'); host.onclick = () => actions.host();
    const code = make('input', { placeholder: 'CODE', maxLength: 4 }); code.setAttribute('aria-label', 'Room code');
    const join = make('button', { className: 'btn small', disabled: view.busy }, 'Join'); join.onclick = () => actions.join(code.value);
    kids.push(host, make('span', {}, 'or'), code, join);
  }
  if (view.error) kids.push(make('span', { className: 'err' }, view.error));
  if (view.notice) kids.push(make('span', { className: 'note' }, view.notice));
  if (!view.room) kids.push(make('span', { className: 'note' }, 'Open this page in a second tab to play together.'));
  el.replaceChildren(...kids);
}

export function runSketch(frame, code, handlers = {}) {
  frame.setAttribute('sandbox', SANDBOX);
  frame.setAttribute('allow', 'autoplay; fullscreen; gamepad; clipboard-write');
  const store = handlers.store;
  // The online host is made the first time the sketch asks for one, so a sketch that never goes online costs nothing.
  let host = null, hostLoading = null;
  const actions = { host: () => host?.actions.host(), join: (c) => host?.actions.join(c), leave: () => host?.actions.leave() };
  const getHost = () => (hostLoading ??= import('./online-local-host.js').then(({ createLocalHost }) => {
    host = createLocalHost({ send: (m) => frame.contentWindow?.postMessage(m, '*'), onLobby: (v) => handlers.onLobby?.(v, actions) });
    hosts.add(host);
    return host;
  }));
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.source === 'preview-online') getHost().then((h) => h.receive(m));
    else if (m.source === 'preview-storage-request') frame.contentWindow.postMessage({ source: 'preview-storage-init', code, data: store ? store.read() : {} }, '*');
    else if (m.source === 'preview-storage') store?.apply(m);
    else if (m.source === 'preview-ready') handlers.onReady?.();
    else if (m.source === 'preview-console') handlers.onLog?.(m.type, (m.args || []).join(' '));
    else if (m.source === 'preview-error') handlers.onError?.(m.error || {});
  };
  window.addEventListener('message', onMessage);
  frame.src = `${RUNNER}?r=${++serial}`;
  return {
    stop() {
      window.removeEventListener('message', onMessage);
      if (host) { host.dispose(); hosts.delete(host); }
      handlers.onLobby?.(null, actions);
      frame.src = 'about:blank';
    },
  };
}

/** base64url of a UTF-8 string, for share links (the sketch is in the #hash, which is never sent to a server). */
export function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromBase64Url(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

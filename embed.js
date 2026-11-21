// Runs a spaSHial sketch inside a sandboxed iframe, the way a host page is meant to.
//
//   import { runSketch } from './embed.js';
//   const run = runSketch(iframeElement, 'function setup() { new Cube(); }', {
//     onReady() {}, onLog(type, text) {}, onError({ name, message, line, snippet }) {},
//   });
//   run.stop();     // blank the frame (frees the WebGL context and the physics world)
//
// The iframe is sandboxed WITHOUT allow-same-origin, so the sketch gets an opaque origin: it
// cannot read this page, its storage or its cookies. The sketch travels over postMessage
// (see runner.html), so its size is not limited by the URL.
export const SANDBOX = 'allow-scripts allow-downloads allow-modals';
const RUNNER = new URL('./runner.html', import.meta.url).href;
let serial = 0;

export function runSketch(frame, code, handlers = {}) {
  frame.setAttribute('sandbox', SANDBOX);
  frame.setAttribute('allow', 'autoplay; fullscreen; gamepad; clipboard-write');
  const onMessage = (e) => {
    if (e.source !== frame.contentWindow) return;
    const m = e.data || {};
    if (m.source === 'preview-storage-request') frame.contentWindow.postMessage({ source: 'preview-storage-init', code }, '*');
    else if (m.source === 'preview-ready') handlers.onReady?.();
    else if (m.source === 'preview-console') handlers.onLog?.(m.type, (m.args || []).join(' '));
    else if (m.source === 'preview-error') handlers.onError?.(m.error || {});
  };
  window.addEventListener('message', onMessage);
  frame.src = `${RUNNER}?r=${++serial}`;
  return {
    stop() {
      window.removeEventListener('message', onMessage);
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

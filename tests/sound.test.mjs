// Tests for sound.js. Plain Node, no browser and no packages: Node has no Web Audio,
// so a small fake AudioContext records what the sound system asks of it (which nodes, which values,
// which start() arguments) and the tests read that back. Run: node tests/sound.test.mjs
import assert from 'node:assert/strict';
import { createSoundSystem, synthesize, spatial, BUILTIN_SOUNDS } from '../sound.js';

// ---------------------------------------------------------------- the fake Web Audio
class FakeParam {
  constructor(value = 1) { this.value = value; this.calls = []; }
  cancelScheduledValues(t) { this.calls.push(['cancel', t]); }
  setValueAtTime(v, t) { this.calls.push(['set', v, t]); }
  linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); }
}
class FakeNode { connect(to) { this.to = to; return to; } }
class FakeSource extends FakeNode {
  constructor(ctx) { super(); this.ctx = ctx; this.playbackRate = new FakeParam(1); this.startArgs = null; this.stopped = 0; this.onended = null; }
  start(...args) { if (this.ctx.failStart) throw new Error('not allowed to start'); this.startArgs = args; }
  stop() { this.stopped++; }
}
class FakeContext {
  static last = null;
  static initialState = 'running';
  constructor() {
    this.sampleRate = 44100; this.currentTime = 0; this.state = FakeContext.initialState; this.destination = {};
    this.resumed = 0; this.failStart = false;
    this.sources = []; this.gains = []; this.panners = []; // the first gain is the master
    FakeContext.last = this;
  }
  createGain() { const g = Object.assign(new FakeNode(), { gain: new FakeParam(1) }); this.gains.push(g); return g; }
  createStereoPanner() { const p = Object.assign(new FakeNode(), { pan: new FakeParam(0) }); this.panners.push(p); return p; }
  createBufferSource() { const s = new FakeSource(this); this.sources.push(s); return s; }
  createBuffer(channels, length, sampleRate) { const data = new Float32Array(length); return { length, duration: length / sampleRate, getChannelData: () => data }; }
  decodeAudioData() { return Promise.resolve({ duration: 2 }); }
  resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
}
// a data: URL "downloads" fine; anything else is offline
const fakeFetch = async (url) => (String(url).startsWith('data:') ? { ok: true, arrayBuffer: async () => new ArrayBuffer(4) } : Promise.reject(new Error('offline')));
const DATA = 'data:audio/wav;base64,AAAA';

function fresh(options) {
  FakeContext.last = null; FakeContext.initialState = 'running';
  globalThis.AudioContext = FakeContext;
  delete globalThis.webkitAudioContext;
  delete globalThis.window;
  globalThis.fetch = fakeFetch;
  const sys = createSoundSystem(options);
  return { sys, ctx: () => FakeContext.last };
}
// What a voice looks like in the fake: voice i is sources[i], its panner i, its gain i + 1 (after the master).
const voice = (ctx, i) => ({ src: ctx.sources[i], gain: ctx.gains[i + 1].gain, pan: ctx.panners[i].pan });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} is not near ${b}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function capture(level, fn) {
  const real = console[level], lines = [];
  console[level] = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console[level] = real; }
  return lines;
}

// ---------------------------------------------------------------- tests
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// -- the built-in sounds, as plain samples
for (const name of BUILTIN_SOUNDS) {
  test(`synthesize('${name}') is finite, within 0.2 to 0.8, 0.1 to 0.8 s long, and ends in silence`, () => {
    for (const rate of [22050, 44100, 48000]) {
      const s = synthesize(name, rate);
      assert.ok(s instanceof Float32Array);
      let peak = 0;
      for (const v of s) { assert.ok(Number.isFinite(v) && v >= -1 && v <= 1); peak = Math.max(peak, Math.abs(v)); }
      assert.ok(peak >= 0.2 && peak <= 0.8, `${name} at ${rate} peaks at ${peak}`);
      const seconds = s.length / rate;
      assert.ok(seconds >= 0.1 - 1e-9 && seconds <= 0.8, `${name} lasts ${seconds} s`);
      assert.ok(s.slice(-50).every((v) => v === 0), `${name} at ${rate} does not end in silence`);
      assert.ok(Math.abs(s[0]) < 0.05, `${name} starts with a click`);
    }
  });
}
test('synthesize is deterministic', () => {
  for (const name of BUILTIN_SOUNDS) assert.deepEqual(synthesize(name, 44100), synthesize(name, 44100));
});
test('the built-in sounds are different from each other', () => {
  const lengths = new Set(BUILTIN_SOUNDS.map((n) => synthesize(n, 44100).length));
  assert.ok(lengths.size >= 6);
});
test('synthesize refuses an unknown name (listing the choices) and a bad sample rate', () => {
  assert.throws(() => synthesize('boom', 44100), (e) => e instanceof TypeError && BUILTIN_SOUNDS.every((n) => e.message.includes(`'${n}'`)));
  assert.throws(() => synthesize('blip', 0), RangeError);
  assert.throws(() => synthesize('blip', 'fast'), TypeError);
});

// -- names
test('soundNames is sorted and includes built-in and registered names', () => {
  const { sys } = fresh();
  sys.registerSound('zap', DATA); sys.registerSound('apple', DATA);
  const names = sys.soundNames();
  assert.deepEqual(names, [...names].sort());
  for (const n of [...BUILTIN_SOUNDS, 'zap', 'apple']) assert.ok(names.includes(n), n);
  assert.equal(new Set(names).size, names.length);
});
test('registerSound refuses a bad name or address', () => {
  const { sys } = fresh();
  for (const bad of [undefined, '', 5, null, {}]) assert.throws(() => sys.registerSound(bad, DATA), TypeError);
  for (const bad of [undefined, '', 5, null]) assert.throws(() => sys.registerSound('x', bad), TypeError);
});
test('an unknown name throws a TypeError that lists the built-in and registered sounds', () => {
  const { sys } = fresh();
  sys.registerSound('boom', DATA);
  assert.throws(() => sys.loadSound('bleep'), (e) => e instanceof TypeError && e.message.includes("'bleep'") && BUILTIN_SOUNDS.every((n) => e.message.includes(`'${n}'`)) && e.message.includes("'boom'"));
  for (const bad of ['', 5, null, undefined]) assert.throws(() => sys.loadSound(bad), TypeError);
});
test('anything that looks like an address is accepted, and one that cannot load does not throw', async () => {
  const { sys } = fresh();
  const urls = ['a.wav', './x', '../x', '/x', 'https://example.invalid/y', 'http://example.invalid', 'blob:abc', 'x.MP3', 'x.ogg?v=2', 'x.m4a', 'x.flac'];
  const logged = await capture('error', async () => {
    for (const u of [...urls, DATA]) {
      const s = sys.loadSound(u);
      await s.ready;
    }
  });
  assert.equal(logged.length, urls.length); // every one but the data: URL failed, and said so
});
test('a registered name wins over a built-in of the same name', async () => {
  const tracked = [];
  const { sys } = fresh({ track: (p) => tracked.push(p) });
  sys.registerSound('blip', DATA);
  const s = sys.loadSound('blip');
  assert.equal(tracked.length, 1);
  await s.ready;
  assert.equal(s.duration, 2); // the decoded fake, not the 0.12 s built-in
});

// -- loading
test('a built-in sound is loaded at once and nothing is tracked', () => {
  const tracked = [];
  const { sys } = fresh({ track: (p) => tracked.push(p) });
  const s = sys.loadSound('coin');
  assert.equal(s.loaded, true);
  assert.ok(s.duration > 0.3 && s.duration < 0.4);
  assert.equal(tracked.length, 0);
  assert.ok(new sys.Sound('blip').loaded);
});
test('track() receives the loading promise; the sound is loaded once it resolves, and play() before that is a no-op said once', async () => {
  const tracked = [];
  const { sys, ctx } = fresh({ track: (p) => tracked.push(p) });
  sys.registerSound('boom', DATA);
  const s = sys.loadSound('boom');
  assert.equal(tracked.length, 1);
  assert.ok(tracked[0] instanceof Promise);
  assert.equal(s.loaded, false);
  const warned = await capture('warn', async () => { assert.equal(s.play(), null); assert.equal(s.play(), null); });
  assert.equal(warned.length, 1);
  assert.equal(ctx().sources.length, 0);
  await tracked[0];
  assert.equal(s.loaded, true);
  assert.equal(s.duration, 2);
  assert.ok(s.play());
  assert.equal(ctx().sources.length, 1);
});
test('a system with no track callback still loads', async () => {
  const { sys } = fresh();
  const s = sys.loadSound(DATA);
  await s.ready;
  assert.equal(s.loaded, true);
});
test('a failing load logs once, does not throw, and play() is silent', async () => {
  const tracked = [];
  const { sys, ctx } = fresh({ track: (p) => tracked.push(p) });
  const url = 'https://example.invalid/boom.wav';
  const logged = await capture('error', async () => {
    const a = sys.loadSound(url), b = sys.loadSound(url);
    assert.equal(await a.ready, null);
    await b.ready;
    assert.equal(a.loaded, false);
    assert.equal(a.duration, 0);
    assert.equal(a.error, 'offline');
    assert.equal(a.play(), null);
    assert.equal(a.loop(), null);
  });
  assert.deepEqual(logged, [`The sound '${url}' could not be loaded.`]);
  assert.equal(ctx().sources.length, 0);
  assert.equal(tracked.length, 2); // a failed load still ends, so setup() is never held up
  await Promise.all(tracked);
});
test('a long address is cut to its first 60 characters in the message; an HTTP error counts as a failure', async () => {
  const { sys } = fresh();
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  const url = `https://example.invalid/${'a'.repeat(100)}.wav`;
  const logged = await capture('error', async () => { const s = sys.loadSound(url); await s.ready; assert.equal(s.error, 'HTTP 404'); });
  assert.equal(logged.length, 1);
  assert.ok(logged[0].startsWith(`The sound '${url.slice(0, 60)}`) && logged[0].endsWith(`could not be loaded.`));
  assert.ok(!logged[0].includes(url));
});

// -- playing
test('play() twice makes two voices, each started', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.play(); s.play();
  assert.equal(ctx().sources.length, 2);
  assert.ok(ctx().sources.every((src) => src.startArgs !== null));
  assert.equal(s.playing, true);
});
test('a voice that ends is forgotten', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.play();
  ctx().sources[0].onended();
  assert.equal(s.playing, false);
});
test('a voice starts with the sound\'s own volume, pan and rate', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.volume = 0.5; s.pan = -0.3; s.rate = 2;
  s.play();
  const v = voice(ctx(), 0);
  assert.equal(v.gain.value, 0.5); assert.equal(v.pan.value, -0.3); assert.equal(v.src.playbackRate.value, 2);
});
test('volume, pan and rate setters validate and clamp, and change voices already sounding', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.loop();
  const v = voice(ctx(), 0);
  s.volume = 1.5; assert.equal(s.volume, 1); s.volume = -1; assert.equal(s.volume, 0); s.volume = 0.25; assert.equal(v.gain.value, 0.25);
  s.pan = 3; assert.equal(s.pan, 1); s.pan = -3; assert.equal(s.pan, -1); s.pan = 0.5; assert.equal(v.pan.value, 0.5);
  s.rate = 1.5; assert.equal(s.rate, 1.5); assert.equal(v.src.playbackRate.value, 1.5);
  assert.throws(() => { s.volume = 'loud'; }, (e) => e instanceof TypeError && e.message.startsWith('volume must be a number (got "loud")'));
  assert.throws(() => { s.volume = NaN; }, TypeError);
  assert.throws(() => { s.pan = undefined; }, TypeError);
  assert.throws(() => { s.rate = 0; }, RangeError);
  assert.throws(() => { s.rate = -1; }, RangeError);
  assert.throws(() => { s.rate = '2'; }, TypeError);
  assert.equal(s.rate, 1.5); // a refused value changes nothing
});

// -- loop, stop, pause
test('loop() starts one looping voice and is safe to call every frame; stop() ends it', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('coin');
  s.loop(); s.loop(); s.loop();
  assert.equal(ctx().sources.length, 1);
  assert.equal(ctx().sources[0].loop, true);
  assert.equal(s.playing, true);
  s.stop();
  assert.equal(ctx().sources[0].stopped, 1);
  assert.equal(s.playing, false);
  assert.equal(s.paused, false);
  s.loop();
  assert.equal(ctx().sources.length, 2);
});
test('pause() keeps the place: a one-shot carries on from it, once', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('coin');
  const total = s.duration;
  s.play();
  ctx().currentTime = 0.1;
  s.pause();
  assert.equal(s.paused, true); assert.equal(s.playing, false); assert.equal(ctx().sources[0].stopped, 1);
  s.play();
  assert.equal(s.paused, false);
  near(ctx().sources[1].startArgs[1], 0.1);
  near(ctx().sources[1].startArgs[2], total - 0.1);
  assert.equal(ctx().sources[1].loop, false);
});
test('pause() keeps the loop\'s place, and a speed change in the middle does not move it', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('coin');
  s.loop();
  ctx().currentTime = 0.1;
  s.rate = 2;           // 0.1 s in so far, at speed 1
  ctx().currentTime = 0.2; // another 0.1 s of the clock is 0.2 s of sound
  s.pause();
  s.loop();
  assert.equal(ctx().sources[1].loop, true);
  near(ctx().sources[1].startArgs[1], 0.3);
});
test('stop() forgets the paused place', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('coin');
  s.loop(); ctx().currentTime = 0.2; s.pause(); s.stop();
  assert.equal(s.paused, false);
  s.loop();
  assert.equal(ctx().sources[1].startArgs[1], 0);
});
test('pausing twice keeps the first place', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('coin');
  s.loop(); ctx().currentTime = 0.1; s.pause(); ctx().currentTime = 0.25; s.pause();
  s.loop();
  near(ctx().sources[1].startArgs[1], 0.1);
});
test('a one-shot that has finished leaves nothing to resume', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.play(); ctx().currentTime = 5; s.pause();
  assert.equal(s.paused, false);
});
test('loop() before the file has arrived starts when it lands; stop() or pause() first holds it back', async () => {
  const { sys, ctx } = fresh();
  sys.registerSound('music', DATA);
  const a = sys.loadSound('music');
  assert.equal(a.loop(), null);
  assert.equal(a.playing, false);
  await a.ready;
  assert.equal(a.playing, true);
  assert.equal(ctx().sources[0].loop, true);

  const b = sys.loadSound('music');
  b.loop(); b.stop();
  await b.ready;
  assert.equal(b.playing, false);

  const c = sys.loadSound('music');
  c.loop(); c.pause();
  assert.equal(c.paused, true);
  await c.ready;
  assert.equal(c.playing, false);
  c.loop();
  assert.equal(c.playing, true);
  assert.equal(c.paused, false);
});

// -- fade
test('fade() schedules a ramp from the audible volume, returns the sound, and fixes the volume', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.play();
  ctx().currentTime = 1;
  assert.equal(s.fade(0.25, 2), s);
  const kinds = voice(ctx(), 0).gain.calls.map((c) => c[0]);
  assert.deepEqual(kinds, ['cancel', 'set', 'ramp']);
  assert.deepEqual(voice(ctx(), 0).gain.calls[2], ['ramp', 0.25, 3]);
  assert.equal(s.volume, 0.25);
  s.play(); // a voice made after the fade starts at the new volume
  assert.equal(voice(ctx(), 1).gain.value, 0.25);
});
test('fade() defaults to half a second', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.loop(); s.fade(0.5);
  assert.deepEqual(voice(ctx(), 0).gain.calls.at(-1), ['ramp', 0.5, 0.5]);
});
test('fading to 0 stops the voices when it lands, unless the sound was faded back up', async () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.play(); s.fade(0, 0.01);
  await sleep(40);
  assert.equal(ctx().sources[0].stopped, 1);
  assert.equal(s.playing, false);

  const t = sys.loadSound('blip');
  t.play(); t.fade(0, 0.01); t.fade(1, 0.01);
  await sleep(40);
  assert.equal(ctx().sources[1].stopped, 0);
});
test('fade() validates', () => {
  const { sys } = fresh();
  const s = sys.loadSound('blip');
  assert.throws(() => s.fade('quiet'), TypeError);
  assert.throws(() => s.fade(0.5, -1), RangeError);
  assert.throws(() => s.fade(0.5, 'soon'), TypeError);
  assert.equal(s.fade(5).volume, 1); // held between 0 and 1
});

// -- clips
test('clips play the right slice', async () => {
  const { sys, ctx } = fresh();
  const s = new sys.Sound(DATA, { clips: { jump: [1, 1.5], boom: [0.5, 0.75] } });
  await s.ready;
  s.play('jump');
  assert.deepEqual(ctx().sources[0].startArgs, [0, 1, 0.5]);
  s.play('boom');
  assert.deepEqual(ctx().sources[1].startArgs, [0, 0.5, 0.25]);
  s.play();
  assert.deepEqual(ctx().sources[2].startArgs, [0, 0, 2]);
});
test('an unknown clip name, even one every object has, plays nothing', async () => {
  const { sys, ctx } = fresh();
  const s = new sys.Sound(DATA, { clips: { jump: [1, 1.5] } });
  await s.ready;
  for (const name of ['nope', 'constructor', 'toString']) assert.equal(s.play(name), null);
  assert.equal(s.loop('nope'), null);
  assert.equal(ctx().sources.length, 0);
});
test('a looping clip loops just that slice, and pause carries on inside it', async () => {
  const { sys, ctx } = fresh();
  const s = new sys.Sound(DATA, { clips: { jump: [1, 1.5] } });
  await s.ready;
  s.loop('jump');
  assert.equal(ctx().sources[0].loopStart, 1); assert.equal(ctx().sources[0].loopEnd, 1.5);
  ctx().currentTime = 0.2;
  s.pause();
  s.loop(); // no name: the paused clip
  assert.equal(ctx().sources[1].loopStart, 1);
  near(ctx().sources[1].startArgs[1], 1.2);
});
test('a bad clip is refused in plain words', () => {
  const { sys } = fresh();
  for (const bad of [5, [1], [2, 1], [1, 1], ['a', 'b'], [-1, 1], null]) {
    assert.throws(() => new sys.Sound('blip', { clips: { x: bad } }), (e) => e instanceof TypeError && e.message.includes("'x'"));
  }
});

// -- sound in space
const LISTENER = { pos: [0, 0, 0], right: [1, 0, 0] };
test('spatial(): at the listener, full volume, centred', () => {
  const r = spatial(LISTENER, [0, 0, 0]);
  assert.equal(r.gain, 1); assert.equal(r.pan, 0);
  const near3 = spatial(LISTENER, [3, 0, 0]);
  assert.equal(near3.gain, 1); // full volume within 5 units
});
test('spatial(): 15 units straight ahead is half volume and centred', () => {
  const r = spatial(LISTENER, [0, 0, -15]);
  near(r.gain, 0.5); near(r.pan, 0);
});
test('spatial(): to the right pans right (and left pans left), 0.9 at most', () => {
  const r = spatial(LISTENER, [10, 0, 0]);
  near(r.pan, 0.9); assert.ok(r.gain > 0.5);
  near(spatial(LISTENER, [-10, 0, 0]).pan, -0.9);
  near(spatial(LISTENER, [100, 0, 0]).pan, 0.9);
  near(spatial(LISTENER, [0.5, 0, 0]).pan, 0.45); // closer than 1 unit, the pan eases toward centre instead of jumping
});
test('spatial(): far away is nearly silent, and a turned listener changes the ear', () => {
  assert.ok(spatial(LISTENER, [100, 0, 0]).gain < 0.15);
  const turned = { pos: [0, 0, 0], right: [0, 0, -1] }; // facing +x with right toward -z
  near(spatial(turned, [0, 0, -10]).pan, 0.9);
  near(spatial(turned, [10, 0, 0]).pan, 0);
  near(spatial({ pos: [5, 0, 5], right: [1, 0, 0] }, [20, 0, 5]).gain, 0.5); // distance is from the listener, not the origin
});
test('playAt() takes an array, three numbers or an object, and sets distance volume and pan', () => {
  const { sys, ctx } = fresh();
  sys.setListener(() => LISTENER);
  const s = sys.loadSound('blip');
  s.playAt([10, 0, 0]);
  s.playAt(10, 0, 0);
  s.playAt({ x: -10, y: 0, z: 0 });
  s.playAt({ get x() { return 10; }, y: 0, z: 0 }); // a Solid reads its position through getters
  for (const i of [0, 1, 3]) { near(voice(ctx(), i).gain.value, 1 / 1.5); near(voice(ctx(), i).pan.value, 0.9); }
  near(voice(ctx(), 2).pan.value, -0.9);
});
test('playAt() with a clip, in either form', async () => {
  const { sys, ctx } = fresh();
  const s = new sys.Sound(DATA, { clips: { jump: [1, 1.5] } });
  await s.ready;
  s.playAt([0, 0, 0], 'jump');
  s.playAt(1, 2, 3, 'jump');
  assert.deepEqual(ctx().sources[0].startArgs, [0, 1, 0.5]);
  assert.deepEqual(ctx().sources[1].startArgs, [0, 1, 0.5]);
  assert.equal(s.playAt([0, 0, 0], 'nope'), null);
});
test('the sound\'s volume and pan are laid over a voice at a place', () => {
  const { sys, ctx } = fresh();
  sys.setListener(() => LISTENER);
  const s = sys.loadSound('blip');
  s.volume = 0.5;
  s.playAt([10, 0, 0]);
  near(voice(ctx(), 0).gain.value, 0.5 / 1.5);
  s.volume = 1;
  near(voice(ctx(), 0).gain.value, 1 / 1.5); // the distance is kept
  s.pan = 0.5;
  assert.equal(voice(ctx(), 0).pan.value, 1); // 0.5 + 0.9, held at 1
  s.fade(0.5);
  near(voice(ctx(), 0).gain.calls.at(-1)[1], 0.5 / 1.5);
});
test('with no listener, or one that answers nothing, playAt() is full volume and centred; setListener(null) clears', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  s.playAt([100, 0, 0]);
  assert.equal(voice(ctx(), 0).gain.value, 1); assert.equal(voice(ctx(), 0).pan.value, 0);
  sys.setListener(() => null);
  s.playAt([100, 0, 0]);
  assert.equal(voice(ctx(), 1).gain.value, 1);
  sys.setListener(() => LISTENER);
  s.playAt([100, 0, 0]);
  assert.ok(voice(ctx(), 2).gain.value < 0.15);
  sys.setListener(null);
  s.playAt([100, 0, 0]);
  assert.equal(voice(ctx(), 3).gain.value, 1);
});
test('the listener is asked at play time, every time', () => {
  const { sys, ctx } = fresh();
  let asked = 0, x = 0;
  sys.setListener(() => { asked++; return { pos: [x, 0, 0], right: [1, 0, 0] }; });
  const s = sys.loadSound('blip');
  s.playAt([30, 0, 0]);
  x = 30;
  s.playAt([30, 0, 0]);
  assert.equal(asked, 2);
  assert.ok(voice(ctx(), 0).gain.value < voice(ctx(), 1).gain.value);
  assert.equal(voice(ctx(), 1).gain.value, 1);
});
test('playAt() and setListener() refuse what they cannot use', () => {
  const { sys } = fresh();
  const s = sys.loadSound('blip');
  for (const bad of [[], ['x'], [1, 2], [1, 2, NaN], 'here', null, { x: 1, y: 2 }, { x: 1, y: 2, z: 'a' }]) {
    assert.throws(() => s.playAt(bad), TypeError, JSON.stringify(bad));
  }
  assert.throws(() => s.playAt(), TypeError);
  assert.throws(() => s.playAt(1, 2), TypeError);
  assert.throws(() => sys.setListener('camera'), TypeError);
});

// -- master volume
test('masterVolume() reads, sets and validates, before and after audio starts', () => {
  const { sys, ctx } = fresh();
  assert.equal(sys.masterVolume(), 1);
  assert.equal(sys.masterVolume(0.4), 0.4);
  assert.equal(ctx(), null); // nothing started audio yet
  sys.loadSound('blip');
  assert.equal(ctx().gains[0].gain.value, 0.4);
  assert.equal(sys.masterVolume(2), 1); assert.equal(ctx().gains[0].gain.value, 1);
  assert.equal(sys.masterVolume(-1), 0);
  assert.equal(sys.masterVolume(), 0);
  assert.throws(() => sys.masterVolume('loud'), TypeError);
  assert.throws(() => sys.masterVolume(NaN), TypeError);
  assert.equal(sys.masterVolume(), 0); // unchanged by the refused values
});

// -- the browser's audio lock
test('before the first click or key, play() does nothing and says why once; unlockAudio() turns sound on', () => {
  const { sys, ctx } = fresh();
  FakeContext.initialState = 'suspended';
  const s = sys.loadSound('blip');
  return capture('warn', async () => {
    assert.equal(s.play(), null); assert.equal(s.play(), null);
    assert.equal(ctx().sources.length, 0);
    sys.unlockAudio(); sys.unlockAudio();
    assert.equal(ctx().state, 'running');
    assert.ok(s.play());
  }).then((warned) => assert.equal(warned.length, 1));
});
test('loop() is allowed before the first gesture and the gesture resumes the context', () => {
  const { sys, ctx } = fresh();
  FakeContext.initialState = 'suspended';
  const s = sys.loadSound('blip');
  assert.ok(s.loop());
  assert.equal(ctx().resumed, 1); // asking to start resumes (a no-op in a browser until a real gesture)
  assert.equal(ctx().sources.length, 1);
});
test('the first click, key or touch on the page unlocks audio, once', () => {
  FakeContext.last = null; FakeContext.initialState = 'suspended';
  globalThis.AudioContext = FakeContext; globalThis.fetch = fakeFetch;
  const added = [], removed = [];
  globalThis.window = { addEventListener: (...a) => added.push(a), removeEventListener: (...a) => removed.push(a) };
  try {
    const sys = createSoundSystem();
    assert.deepEqual(added.map((a) => a[0]).sort(), ['keydown', 'pointerdown', 'touchstart']);
    assert.ok(added.every((a) => a[2].capture === true));
    const s = sys.loadSound('blip');
    assert.equal(FakeContext.last.state, 'suspended');
    added[0][1]();
    assert.equal(FakeContext.last.state, 'running');
    assert.deepEqual(removed.map((a) => a[0]).sort(), ['keydown', 'pointerdown', 'touchstart']);
    assert.ok(s.play());
  } finally { delete globalThis.window; }
});
test('a browser that refuses start() marks the sound blocked and does not throw', () => {
  const { sys, ctx } = fresh();
  const s = sys.loadSound('blip');
  ctx().failStart = true;
  assert.equal(s.play(), null);
  assert.equal(s.blocked, true);
  assert.equal(s.playing, false);
  assert.equal(s.loop(), null);
});

// -- no Web Audio at all
test('with no AudioContext at all, nothing throws and everything is silent', async () => {
  fresh();
  delete globalThis.AudioContext;
  const tracked = [];
  const quiet = createSoundSystem({ track: (p) => tracked.push(p) });
  const s = quiet.loadSound('coin');
  assert.equal(s.loaded, false); assert.equal(s.duration, 0); assert.equal(s.playing, false);
  assert.equal(s.play(), null); assert.equal(s.play('x'), null); assert.equal(s.loop(), null);
  assert.equal(s.playAt([1, 2, 3]), null);
  s.pause(); s.stop();
  s.volume = 0.5; s.pan = 0.5; s.rate = 2;
  assert.equal(s.volume, 0.5);
  assert.equal(s.fade(0.2), s);
  assert.equal(quiet.masterVolume(0.5), 0.5);
  quiet.unlockAudio(); quiet.setListener(() => LISTENER);
  const u = quiet.loadSound('./nothing.wav');
  assert.equal(await u.ready, null);
  assert.equal(await s.ready, null);
  assert.deepEqual(quiet.soundNames(), [...BUILTIN_SOUNDS].sort());
  assert.throws(() => quiet.loadSound('bleep'), TypeError); // a wrong name is still said, so a typo is never silent
});
test('webkitAudioContext is used when AudioContext is missing', () => {
  fresh();
  delete globalThis.AudioContext;
  globalThis.webkitAudioContext = FakeContext;
  assert.equal(createSoundSystem().loadSound('blip').loaded, true);
});

// ---------------------------------------------------------------- run
let passed = 0, failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e && e.message || e).split('\n').join('\n     ')}`); }
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

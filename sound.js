// spaSHial's sound: the same Sound a student already knows from moSHion (play, loop, pause, stop,
// volume, pan, rate, fade, clips, masterVolume), plus playAt(), which plays a sound AT a place in
// the world: quieter the farther it is from the camera, and in the left or right ear it is on.
// Built on the Web Audio API and knows nothing about three.js: spashial.js hands it two things,
// a `track` callback (so setup() waits for sounds still downloading) and a listener function (where
// the camera is), and that is all the two need to know about each other.
//
// The built-in sounds are synthesized here, into a buffer, the first time they are used. They are
// not files: the preview runs on an opaque origin, where every fetch needs CORS, so a file the
// engine ships could not be loaded. A synthesized sound is also ready at once, with nothing to
// wait for, and it is the same on every computer.
//
// Three facts about Web Audio shape the rest (moSHion's notes, kept because they are still true):
// 1. The context starts SUSPENDED until the player clicks or presses a key, so one first gesture
//    anywhere on the page turns it on. A sketch never has to think about it.
// 2. A sound must be fetched and DECODED before it can play. A play() before that is a silent
//    no-op, not a queued sound: an effect that arrives 300 ms late is worse than none.
// 3. A source node plays once. Every play() builds a new one, which is what makes overlapping
//    shots free.
//
//   const { Sound, loadSound, soundNames, registerSound, masterVolume, unlockAudio, setListener } = createSoundSystem({ track })
//   synthesize('coin', 44100)  ->  a Float32Array of samples, no audio needed (the tests use this)
//   spatial(listener, point)   ->  { gain, pan }, the maths behind playAt()

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const show = (v) => { try { return JSON.stringify(v) ?? String(v); } catch { return String(v); } };
function num(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${what} must be a number (got ${show(v)})`);
  return v;
}
const nonNeg = (v, what) => { if (num(v, what) < 0) throw new RangeError(`${what} cannot be below 0 (got ${v})`); return v; };
const posNum = (v, what) => { if (num(v, what) <= 0) throw new RangeError(`${what} must be above 0 (got ${v})`); return v; };

// ---------------------------------------------------------------- built-in sounds
// Each recipe returns { seconds, peak, sample(t, p) }: `t` is the time in seconds, `p` how far
// through the sound it is (0 to 1). The recipe is a function of the sample rate and is called afresh
// for every render, so anything it keeps (the noise seed, a filter's memory) starts the same each
// time: the same name always makes the same samples.

function rng(seed) { // the same seed always gives the same noise
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const attack = (t) => Math.min(1, t / 0.003); // 3 ms in, so a sound never starts with a click
// The phase of a note that glides from f0 to f1 Hz over T seconds (valid for t up to T).
const sweep = (f0, f1, T, t) => TAU * (f0 * t + (f1 - f0) * t * t / (2 * T));
// One-pole low-pass filter over noise: what turns a hiss into a rumble.
function rumble(sampleRate, cutoff, seed) {
  const rand = rng(seed), k = 1 - Math.exp(-TAU * cutoff / sampleRate);
  let y = 0;
  return () => (y += k * (rand() * 2 - 1 - y));
}

const SYNTH = {
  blip: () => ({ seconds: 0.1, peak: 0.6, sample: (t) => Math.sin(TAU * 880 * t) * attack(t) * Math.exp(-t * 30) }),
  coin: () => { // two bright notes, the second a fourth higher, ringing together like a bell
    const note = (f, t, decay) => (t < 0 ? 0 : (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * 2 * f * t)) * attack(t) * Math.exp(-decay * t));
    return { seconds: 0.35, peak: 0.6, sample: (t) => note(988, t, 7) + note(1319, t - 0.07, 6) };
  },
  jump: () => ({ seconds: 0.22, peak: 0.6, sample: (t, p) => { const ph = sweep(260, 780, 0.22, t); return (Math.sin(ph) + 0.3 * Math.sin(3 * ph)) * attack(t) * (1 - p); } }),
  hit: (sr) => { // a burst of noise on a low thump
    const noise = rumble(sr, 4000, 7);
    return { seconds: 0.14, peak: 0.75, sample: (t) => (noise() * 3 * Math.exp(-t * 35) + Math.sin(TAU * 110 * t) * Math.exp(-t * 25)) * attack(t) };
  },
  explode: (sr) => { // a long fall of rumbling noise over a deep note
    const noise = rumble(sr, 900, 3);
    return { seconds: 0.75, peak: 0.75, sample: (t, p) => (noise() * 5 + 0.8 * Math.sin(TAU * 55 * t)) * attack(t) * (1 - p) ** 2.5 };
  },
  laser: () => ({ seconds: 0.25, peak: 0.6, sample: (t, p) => { const ph = sweep(1800, 220, 0.25, t); return (Math.sin(ph) + 0.5 * Math.sin(2 * ph)) * attack(t) * (1 - p) ** 0.7; } }),
  pop: () => ({ seconds: 0.09, peak: 0.7, sample: (t) => Math.sin(sweep(700, 180, 0.09, t)) * attack(t) * Math.exp(-t * 45) }),
  thud: (sr) => {
    const noise = rumble(sr, 300, 11);
    return { seconds: 0.3, peak: 0.75, sample: (t) => (Math.sin(sweep(100, 40, 0.3, t)) * Math.exp(-t * 12) + 2 * noise() * Math.exp(-t * 60)) * attack(t) };
  },
};
export const BUILTIN_SOUNDS = Object.keys(SYNTH);

const RELEASE = 0.01; // every sound fades to exactly zero over its last 10 ms, then 20 ms of silence
const PAD = 0.02;     // follow it, so even a sound cut short never ends on a click

export function synthesize(name, sampleRate) {
  if (!Object.hasOwn(SYNTH, name)) throw new TypeError(`there is no built-in sound called '${name}'. The built-in ones are ${BUILTIN_SOUNDS.map((n) => `'${n}'`).join(', ')}`);
  posNum(sampleRate, 'the sample rate');
  const { seconds, peak, sample } = SYNTH[name](sampleRate);
  const body = Math.round(seconds * sampleRate), release = Math.round(RELEASE * sampleRate);
  const out = new Float32Array(body + Math.round(PAD * sampleRate));
  let top = 0;
  for (let i = 0; i < body; i++) {
    const v = sample(i / sampleRate, i / body) * Math.min(1, (body - 1 - i) / release);
    out[i] = v;
    top = Math.max(top, Math.abs(v));
  }
  for (let i = 0; i < body; i++) out[i] *= peak / top; // every sound peaks where its recipe says, whatever the maths gave
  return out;
}

// ---------------------------------------------------------------- sound in space
// Full volume within 5 units, half at 15, a tenth at 95. The pan is how far to the listener's
// right (or left) the sound is, as a share of its distance, kept short of a hard 1 so a sound is
// never in one ear only.
//   listener: { pos: [x, y, z], right: [x, y, z] }   point: [x, y, z]
export function spatial(listener, point) {
  const d = [0, 1, 2].map((i) => point[i] - listener.pos[i]);
  const dist = Math.hypot(d[0], d[1], d[2]);
  const side = d[0] * listener.right[0] + d[1] * listener.right[1] + d[2] * listener.right[2];
  return { gain: 1 / (1 + Math.max(0, dist - 5) / 10), pan: clamp(side / Math.max(dist, 1), -1, 1) * 0.9 };
}
function toPoint(v) {
  const p = Array.isArray(v) ? v.slice(0, 3) : v && typeof v === 'object' ? [v.x, v.y, v.z] : [];
  if (p.length !== 3 || !p.every((n) => Number.isFinite(n))) throw new TypeError(`playAt needs a position: three numbers, [x, y, z], or an object with x, y and z (got ${show(v)})`);
  return p;
}

// ---------------------------------------------------------------- the sound system
const looksLikeUrl = (k) => /^(data:|blob:|https?:|\/|\.\/|\.\.\/)/.test(k) || /\.(wav|mp3|ogg|m4a|flac)(\?|#|$)/i.test(k);
const shorten = (s) => (s.length > 60 ? `${s.slice(0, 60)}...` : s);

export function createSoundSystem({ track } = {}) {
  const registered = new Map(); // names the host gave: name -> address or data: URL
  const builtinBuffers = new Map();
  const said = new Set(); // messages already printed: play() is often called from draw(), 60 times a second
  let ctx = null, master = null, masterVol = 1, gestureSeen = false, listener = null;

  function sayOnce(key, message, level = 'warn') {
    if (said.has(key)) return;
    said.add(key);
    console[level](message);
  }

  // Made on first use, not at import: a page with no sound never starts audio, and nothing here
  // touches Web Audio until a sketch asks for a sound. No Web Audio at all: every sound is silent.
  function context() {
    if (ctx) return ctx;
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = masterVol;
    master.connect(ctx.destination);
    return ctx;
  }
  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  /** Call from a click or key press: browsers only start audio from inside one. Safe to call again. */
  function unlockAudio() {
    gestureSeen = true;
    resume();
  }
  // The first click, key or touch anywhere on the page turns sound on, in the capture phase so a
  // sketch that stops the event still does. One time only: the first gesture removes them all.
  if (typeof window !== 'undefined' && window.addEventListener) {
    const types = ['pointerdown', 'keydown', 'touchstart'];
    const onGesture = () => { for (const t of types) window.removeEventListener(t, onGesture, true); unlockAudio(); };
    for (const t of types) window.addEventListener(t, onGesture, { capture: true, passive: true });
  }

  function masterVolume(v) {
    if (v === undefined) return masterVol;
    masterVol = clamp(num(v, 'masterVolume'), 0, 1);
    if (master) master.gain.value = masterVol;
    return masterVol;
  }

  const soundNames = () => [...new Set([...BUILTIN_SOUNDS, ...registered.keys()])].sort();
  /** Gives a name to a sound, like registerTexture: `loadSound('boom')` then loads it. It wins over a built-in of the same name. */
  function registerSound(name, source) {
    if (typeof name !== 'string' || !name) throw new TypeError(`registerSound(name, url) needs a name like 'boom' (got ${show(name)})`);
    if (typeof source !== 'string' || !source) throw new TypeError(`registerSound('${name}', url) needs an address or a data: URL (got ${show(source)})`);
    registered.set(name, source);
  }
  /** Where a name or address comes from: { url } to fetch, or { builtin } to synthesize. */
  function resolve(key) {
    if (typeof key !== 'string' || !key) throw new TypeError(`a sound needs a name or an address (got ${show(key)})`);
    if (registered.has(key)) return { url: registered.get(key) };
    if (Object.hasOwn(SYNTH, key)) return { builtin: key };
    if (looksLikeUrl(key)) return { url: key };
    throw new TypeError(`there is no sound called '${key}'. The sounds are ${soundNames().map((n) => `'${n}'`).join(', ')}; or give a web address or a data: URL`);
  }
  function builtinBuffer(c, name) {
    let buf = builtinBuffers.get(name);
    if (!buf) {
      const data = synthesize(name, c.sampleRate);
      buf = c.createBuffer(1, data.length, c.sampleRate);
      buf.getChannelData(0).set(data);
      builtinBuffers.set(name, buf);
    }
    return buf;
  }
  async function fetchAndDecode(c, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return c.decodeAudioData(await res.arrayBuffer());
  }

  /** The engine gives this a function that says where the camera is: () => ({ pos: [x, y, z], right: [x, y, z] }). */
  function setListener(fn) {
    if (fn !== null && typeof fn !== 'function') throw new TypeError(`setListener needs a function that returns { pos, right } (got ${show(fn)})`);
    listener = fn;
  }

  class Sound {
    /** A built-in or registered name, or an address. `opts.clips` names parts of one file: { jump: [startSeconds, endSeconds] }. */
    constructor(source, opts) {
      const where = resolve(source);
      this.url = source;
      this.blocked = false; // the browser refused to start a voice
      this.error = null;
      this._volume = 1;
      this._rate = 1;
      this._pan = 0;
      this._buffer = null;
      this._loading = false;
      this._voices = [];      // one-shot voices still sounding, oldest first
      this._loopVoice = null; // the one looping voice
      this._paused = false;
      this._pausedAt = null;  // { pos, clip }: the place pause() will carry on from
      this._wantLoop = null;  // { clip }: a loop() that came before the file had arrived
      this._clips = null;
      if (opts && opts.clips) {
        this._clips = new Map(Object.entries(opts.clips).map(([name, c]) => {
          if (!Array.isArray(c) || c.length !== 2 || !c.every((n) => Number.isFinite(n)) || c[0] < 0 || c[1] <= c[0]) {
            throw new TypeError(`the clip '${name}' must be [startSeconds, endSeconds] with the end after the start (got ${show(c)})`);
          }
          return [name, { start: c[0], end: c[1] }];
        }));
      }
      this.ready = this._load(where);
    }

    _load(where) {
      const c = context();
      if (!c) return Promise.resolve(null);
      if (where.builtin) {
        this._buffer = builtinBuffer(c, where.builtin);
        return Promise.resolve(this._buffer);
      }
      if (typeof fetch !== 'function') return Promise.resolve(null);
      this._loading = true;
      const loaded = fetchAndDecode(c, where.url).then(
        (buf) => { this._buffer = buf; this._loading = false; return buf; },
        (e) => {
          // A missing or unplayable file must not take the sketch down: the sound stays silent, and
          // the console says so once per file (a wrong name or a file on another website used to
          // fail with nothing on screen at all).
          this._loading = false;
          this.error = e && e.message ? e.message : String(e);
          sayOnce(`load:${where.url}`, `The sound '${shorten(where.url)}' could not be loaded.`, 'error');
          return null;
        },
      );
      if (track) track(loaded);
      return loaded;
    }

    get loaded() { return this._buffer !== null; }
    get duration() { return this._buffer ? this._buffer.duration : 0; }
    get playing() { return this._voices.length > 0 || this._loopVoice !== null; }
    get paused() { return this._paused; }
    get volume() { return this._volume; }
    get pan() { return this._pan; }
    get rate() { return this._rate; }

    // A voice at a place keeps its own distance volume and pan, and the sound's volume and pan are
    // laid over them: `volume` scales it, `pan` leans it.
    _gainOf(v) { return this._volume * (v.at ? v.at.gain : 1); }
    _panOf(v) { return clamp(this._pan + (v.at ? v.at.pan : 0), -1, 1); }
    _allVoices() { return this._loopVoice ? [...this._voices, this._loopVoice] : this._voices; }

    set volume(v) {
      this._volume = clamp(num(v, 'volume'), 0, 1);
      for (const voice of this._allVoices()) voice.gain.gain.value = this._gainOf(voice);
    }
    set pan(v) {
      this._pan = clamp(num(v, 'pan'), -1, 1);
      for (const voice of this._allVoices()) if (voice.panner) voice.panner.pan.value = this._panOf(voice);
    }
    set rate(v) {
      posNum(v, 'rate');
      // Each voice's place is worked out from the audio clock at the OLD speed first, then the
      // speed changes: otherwise a change in the middle of a sound would move where pause() resumes.
      const now = ctx ? ctx.currentTime : 0;
      for (const voice of this._allVoices()) {
        const pos = this._position(voice, now);
        if (pos !== null) { voice.anchor.from = pos; voice.anchor.at = now; }
        voice.src.playbackRate.value = v;
      }
      this._rate = v;
    }

    /** Source -> panner -> gain -> master, one chain per voice, so a fade or pan on one shot cannot disturb another. */
    _voice(at) {
      const src = ctx.createBufferSource();
      src.buffer = this._buffer;
      src.playbackRate.value = this._rate;
      const gain = ctx.createGain();
      const voice = { src, gain, panner: null, at, clip: undefined, anchor: null };
      gain.gain.value = this._gainOf(voice);
      let head = src;
      if (typeof ctx.createStereoPanner === 'function') { // missing on older Safari: panning is a nicety, the sound is not
        voice.panner = ctx.createStereoPanner();
        voice.panner.pan.value = this._panOf(voice);
        head.connect(voice.panner);
        head = voice.panner;
      }
      head.connect(gain);
      gain.connect(master);
      return voice;
    }

    // null = the whole file, undefined = a name this sound does not have. A mistyped clip name plays
    // nothing rather than the whole file, which would blast every sound in the sheet at once: silence
    // is the failure you can debug.
    _clip(name) {
      if (!name || !this._clips) return null;
      return this._clips.get(name);
    }

    /** Starts a NEW voice each call, so quick repeats overlap. With a clip name, plays just that slice. */
    play(clipName) { return this._play(clipName, null); }

    /**
     * Plays once AT a place: playAt(x, y, z), playAt([x, y, z]) or playAt(solid). Quieter with distance
     * from the camera and in the ear it is on. With no camera yet it plays at full volume, centred.
     */
    playAt(...args) {
      const numbers = typeof args[0] === 'number';
      const point = toPoint(numbers ? args.slice(0, 3) : args[0]);
      const l = listener && listener();
      return this._play(numbers ? args[3] : args[1], l ? spatial(l, point) : null);
    }

    _play(clipName, at) {
      if (clipName === undefined && this._pausedAt) clipName = this._pausedAt.clip; // carry on with the clip that was paused
      if (this._buffer && ctx.state === 'suspended' && !gestureSeen) {
        // Loaded, but the browser still has sound off. Started now, the voice would wait in the
        // suspended context and sound at the first click, late: a jump chime from setup() going off
        // when the player first presses a key. Skipped, and said once.
        sayOnce(`locked:${this.url}`, `${this._label()}.play() did nothing: sound turns on after the first click or key press. ` +
          'Play it on an event (a key press, a hit) instead of in setup(), or use .loop() for music, which starts at the first click.');
        return null;
      }
      if (!this._buffer) {
        if (this._loading) {
          sayOnce(`early:${this.url}`, `${this._label()}.play() did nothing: the sound has not finished loading yet. ` +
            'Play it on an event (a key press, a hit) instead of in setup(), or use .loop() for music, which starts once it has loaded.');
        }
        return null;
      }
      const clip = this._clip(clipName);
      if (clip === undefined) return null;
      return this._start(clip, clipName, false, at);
    }

    /**
     * Starts the one looping voice. Safe to call from draw(): a second call changes nothing. Unlike
     * play(), a loop() that comes before the file has arrived is remembered and starts when it lands,
     * because `music.loop()` in setup() always runs before the download finishes. (A looping track a
     * beat late is right; a coin chime 300 ms late is not.)
     */
    loop(clipName) {
      if (this._loopVoice) return this._loopVoice.src;
      if (clipName === undefined && this._pausedAt) clipName = this._pausedAt.clip;
      if (!this._buffer) {
        if (!this._loading) return null; // a failed or impossible load: nothing is coming
        if (!this._pausedAt) this._paused = false; // asking again after a pause() that came first: the student wants it after all
        if (!this._wantLoop) {
          this.ready.then(() => {
            const want = this._wantLoop;
            this._wantLoop = null;
            if (want && this._buffer && !this._loopVoice && !this._paused) this.loop(want.clip);
          });
        }
        this._wantLoop = { clip: clipName };
        return null;
      }
      const clip = this._clip(clipName);
      if (clip === undefined) return null;
      return this._start(clip, clipName, true, null);
    }

    _start(clip, clipName, looping, at) {
      resume();
      // A paused sound carries on from where it stopped, to the end of the sound or clip (once, for
      // play()); a different clip than the one paused starts afresh.
      const lo = clip ? clip.start : 0, hi = clip ? clip.end : this._buffer.duration;
      const from = this._resumeFrom(clipName, lo, hi);
      const begin = from ?? lo;
      const voice = this._voice(at);
      voice.src.loop = looping;
      if (looping && clip) { voice.src.loopStart = lo; voice.src.loopEnd = hi; }
      try {
        voice.src.start(0, begin, looping ? undefined : Math.max(0, hi - begin));
      } catch {
        this.blocked = true;
        return null;
      }
      voice.clip = clipName;
      voice.anchor = { from: begin, at: ctx.currentTime, lo, hi, looping };
      if (looping) this._loopVoice = voice; else this._voices.push(voice);
      voice.src.onended = () => {
        if (this._loopVoice === voice) this._loopVoice = null;
        const i = this._voices.indexOf(voice);
        if (i >= 0) this._voices.splice(i, 1);
      };
      return voice.src;
    }

    // A BufferSource cannot be paused, and a stopped one cannot be restarted, so pause() remembers
    // WHERE the sound was and the next play() or loop() starts a new source there. Where is worked
    // out from the audio clock, never counted in frames: each voice keeps an anchor (the place in the
    // file, and the clock then).
    // The place kept is the loop's, else the newest one-shot still sounding (music started with
    // play()); every other voice just stops, since a short effect has nothing worth carrying on.
    // Pausing twice keeps the first place; stop() forgets it.
    pause() {
      const live = this._loopVoice || this._voices[this._voices.length - 1];
      if (live) {
        const pos = this._position(live, ctx.currentTime);
        if (pos !== null) this._pausedAt = { pos, clip: live.clip };
      }
      if (this._pausedAt || this._wantLoop) this._paused = true;
      this._stopVoices();
    }

    /** Stops every voice, forgets the paused place, and cancels a loop() still waiting for its file. */
    stop() {
      this._paused = false;
      this._pausedAt = null;
      this._wantLoop = null;
      this._stopVoices();
    }

    _stopVoices() {
      for (const voice of this._allVoices()) { try { voice.src.stop(); } catch { /* already ended */ } }
      this._voices = [];
      this._loopVoice = null;
    }

    // Where a paused sound picks up, or null to start from the beginning. Used once: the pause is
    // over either way.
    _resumeFrom(clipName, lo, hi) {
      const at = this._pausedAt;
      this._paused = false;
      this._pausedAt = null;
      return at && clipName === at.clip && at.pos >= lo && at.pos < hi ? at.pos : null;
    }

    // Seconds into the file this voice is at now, or null once a one-shot has finished.
    _position(voice, now) {
      const a = voice.anchor;
      const pos = a.from + Math.max(0, now - a.at) * this._rate;
      if (a.looping) return a.hi > a.lo && pos >= a.hi ? a.lo + ((pos - a.lo) % (a.hi - a.lo)) : pos;
      return pos >= a.hi ? null : pos;
    }

    /**
     * Ramps to a volume over `seconds` (0.5 by default) and returns the sound. Fading to 0 stops the
     * voices when it lands, so a silent source is not left running.
     */
    fade(to, seconds = 0.5) {
      const target = clamp(num(to, 'the volume to fade to'), 0, 1);
      nonNeg(seconds, 'the fade time');
      const now = ctx ? ctx.currentTime : 0;
      this._volume = target;
      for (const voice of this._allVoices()) {
        // Start from what you can hear now: a second fade begun mid-ramp would otherwise jump to
        // wherever the first one was scheduled to be.
        const g = voice.gain.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(this._gainOf(voice), now + seconds);
      }
      if (target === 0) setTimeout(() => { if (this._volume === 0) this.stop(); }, seconds * 1000);
      return this;
    }

    _label() { return `loadSound('${shorten(this.url)}')`; }
  }

  /** A sound by built-in or registered name, or by address. A URL that cannot load stays silent instead of throwing. */
  function loadSound(nameOrUrl, opts) { return new Sound(nameOrUrl, opts); }

  return { Sound, loadSound, soundNames, registerSound, masterVolume, unlockAudio, setListener };
}

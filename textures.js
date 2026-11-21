// spaSHial's built-in textures: patterns drawn on a canvas when first used. Nothing to download
// (the preview runs on an opaque origin, where every fetch needs CORS), and every one tiles, so
// `solid.textureRepeat = [10, 10]` repeats it without seams. They know nothing about three.js:
// spashial.js wraps the canvas in a texture.
//
//   drawBuiltin('bricks')  ->  a 256 x 256 <canvas>

export const BUILTIN_TEXTURES = ['checker', 'grid', 'bricks', 'planks', 'stripes', 'dots', 'grass', 'stone'];

// the same seed always draws the same picture
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hex = (r, g, b) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
const roundRect = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };

// value noise that wraps at the edges, so it tiles: `cells` random values per side
function tileableNoise(size, cells, seed) {
  const rand = rng(seed), grid = Array.from({ length: cells * cells }, rand);
  const at = (i, j) => grid[((j % cells) * cells) + (i % cells)];
  const out = new Float32Array(size * size), step = cells / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x * step, fy = y * step, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const top = at(i, j) * (1 - su) + at(i + 1, j) * su, bot = at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su;
    out[y * size + x] = top * (1 - sv) + bot * sv;
  }
  return out;
}

const DRAW = {
  checker(g, s) {
    const n = 8, c = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? '#8a8fa8' : '#e6e8f2'; g.fillRect(x * c, y * c, c, c); }
  },
  grid(g, s) {
    g.fillStyle = '#e6e8f2'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#6272a4';
    const n = 8, c = s / n;
    for (let i = 0; i < n; i++) { g.fillRect(i * c, 0, 2, s); g.fillRect(0, i * c, s, 2); } // lines at the top and left only, so the tile repeats cleanly
  },
  bricks(g, s) {
    const r = rng(11), rows = 8, h = s / rows, w = s / 4, gap = 4;
    g.fillStyle = '#cfc8bb'; g.fillRect(0, 0, s, s); // mortar
    for (let row = 0; row < rows; row++) for (let col = -1; col < 4; col++) {
      const x = col * w + (row % 2 ? w / 2 : 0), shade = 0.85 + r() * 0.3;
      g.fillStyle = hex(178 * shade, 84 * shade, 62 * shade);
      for (const dx of [0, s]) g.fillRect(x - dx + gap / 2, row * h + gap / 2, w - gap, h - gap); // drawn twice so a brick that crosses the edge wraps
    }
  },
  planks(g, s) {
    const r = rng(23), boards = 4, h = s / boards;
    for (let b = 0; b < boards; b++) {
      const shade = 0.8 + r() * 0.35;
      g.fillStyle = hex(168 * shade, 118 * shade, 70 * shade); g.fillRect(0, b * h, s, h);
      g.fillStyle = 'rgba(70, 40, 20, 0.22)';
      for (let k = 0; k < 14; k++) g.fillRect(r() * s, b * h + 4 + r() * (h - 8), 20 + r() * 80, 1 + r() * 1.5); // grain
      g.fillStyle = '#4a2e16'; g.fillRect(0, b * h, s, 3); // the seam
    }
  },
  stripes(g, s) {
    const img = g.createImageData(s, s), period = 64;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const on = (x + y) % period < period / 2, i = (y * s + x) * 4;
      img.data[i] = on ? 250 : 40; img.data[i + 1] = on ? 200 : 42; img.data[i + 2] = on ? 40 : 54; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  },
  dots(g, s) {
    g.fillStyle = '#f2e9c9'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#d9534f';
    const n = 4, c = s / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.beginPath(); g.arc(x * c + c / 2, y * c + c / 2, c * 0.28, 0, Math.PI * 2); g.fill(); }
  },
  grass(g, s) {
    const big = tileableNoise(s, 8, 5), fine = tileableNoise(s, 32, 9), img = g.createImageData(s, s);
    for (let i = 0; i < s * s; i++) {
      const v = 0.55 * big[i] + 0.45 * fine[i], k = 0.7 + v * 0.6;
      img.data[i * 4] = 70 * k; img.data[i * 4 + 1] = 150 * k; img.data[i * 4 + 2] = 62 * k; img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  },
  stone(g, s) {
    const r = rng(41), n = 4, c = s / n, gap = 5;
    g.fillStyle = '#4b4f5c'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const t = 118 + r() * 60; g.fillStyle = hex(t, t, t + 8);
      roundRect(g, x * c + gap, y * c + gap, c - gap * 2, c - gap * 2, 16);
    }
  },
};

/** A new canvas with the named pattern drawn on it. */
export function drawBuiltin(name, size = 256) {
  if (!DRAW[name]) throw new Error(`there is no built-in texture '${name}'`);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  DRAW[name](c.getContext('2d'), size);
  return c;
}

#!/usr/bin/env node
// Refresh vendor/ from node_modules (run after bumping jolt-physics or three in package.json).
//
//   npm install && npm run vendor
//
// vendor/ IS committed: the site is plain static files with no build step, as moSHion's is.
//
//   vendor/jolt/   jolt-physics.wasm.js + .wasm  (JoltPhysics.js 1.1.1, MIT). The single-threaded
//                  build on purpose: the multithreaded one needs SharedArrayBuffer, which needs
//                  COOP/COEP headers on every page, and GitHub Pages cannot send them.
//   vendor/three/  three.module.min.js + three.core.min.js (three.js, MIT). The module imports
//                  './three.core.min.js' by that exact name.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  ['node_modules/jolt-physics/dist/jolt-physics.wasm.js', 'vendor/jolt/jolt-physics.wasm.js'],
  ['node_modules/jolt-physics/dist/jolt-physics.wasm.wasm', 'vendor/jolt/jolt-physics.wasm.wasm'],
  ['node_modules/jolt-physics/LICENSE', 'vendor/jolt/LICENSE'],
  ['node_modules/three/build/three.module.min.js', 'vendor/three/three.module.min.js'],
  ['node_modules/three/build/three.core.min.js', 'vendor/three/three.core.min.js'],
  ['node_modules/three/LICENSE', 'vendor/three/LICENSE'],
];
const missing = FILES.filter(([src]) => !existsSync(path.join(root, src)));
if (missing.length) {
  console.error('missing from node_modules (run npm install):\n' + missing.map(([s]) => '  ' + s).join('\n'));
  process.exit(1);
}
let total = 0;
for (const [src, dest] of FILES) {
  const to = path.join(root, dest);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(path.join(root, src), to);
  total += statSync(to).size;
}
console.log(`vendor: ${FILES.length} files, ${(total / 1048576).toFixed(1)} MB`);

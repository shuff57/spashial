#!/usr/bin/env node
// The published declarations (docs/spashial.d.ts) must accept the sketches students really write.
//   node tests/types.test.mjs
// Runs tsc --strict over tests/types-probe.ts and exits 1 with tsc's own messages if anything
// a student can legally write is a type error. (A council review found seven such lines.)
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const noTypes = mkdtempSync(path.join(tmpdir(), 'spashial-types-')); // an empty typeRoots: only OUR declarations, not @types/node
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const r = spawnSync(process.execPath, [tsc, '--noEmit', '--strict', '--target', 'es2022', '--lib', 'es2022,dom', '--typeRoots', noTypes,
  'docs/spashial.d.ts', 'tests/types-probe.ts'], { cwd: root, encoding: 'utf8' });
if (r.status === 0) { console.log('1 passed, 0 failed  (the probe sketches type-check against spashial.d.ts)'); process.exit(0); }
console.log(`${r.stdout}${r.stderr}`.trim());
console.log('\n0 passed, 1 failed');
process.exit(1);

#!/usr/bin/env node
// Deploy the committed site to Cloudflare Pages, project `spashial` (https://spashial.lefthanddev.com).
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node scripts/deploy-cloudflare.mjs
//
// The token needs Account > Cloudflare Pages > Edit. It is read from the environment and never written
// anywhere. Only COMMITTED files are published (it exports HEAD), minus the tests and tooling, so what
// goes live is exactly what GitHub Pages serves.
//
// WHY A SEPARATE WORKING DIRECTORY: `wrangler pages deploy <dir>` looks for `./functions` and
// `./wrangler.toml` in the CURRENT directory, not in <dir>. Run from another project's checkout (say a
// sibling that has Pages Functions) and it would try to attach that project's functions to this site.
// So wrangler is started from an empty directory, with the bundle as its only input.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error('Set CLOUDFLARE_API_TOKEN (Account > Cloudflare Pages > Edit) and, if the token cannot read the account, CLOUDFLARE_ACCOUNT_ID.');
  process.exit(1);
}
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
const subject = git('log', '-1', '--format=%s');

const work = mkdtempSync(path.join(tmpdir(), 'spashial-deploy-'));
const site = path.join(work, 'site');
const cwd = path.join(work, 'cwd');
mkdirSync(site); mkdirSync(cwd);
try {
  const tarball = path.join(work, 'head.tar');
  execFileSync('git', ['-C', root, 'archive', '--format=tar', '-o', tarball, 'HEAD']);
  execFileSync('tar', ['-x', '-f', tarball, '-C', site]);
  for (const p of ['tests', 'scripts', 'package.json', 'package-lock.json', '.github', '.gitignore']) rmSync(path.join(site, p), { recursive: true, force: true });
  console.log(`Deploying ${sha.slice(0, 7)} (${subject}) to the Cloudflare Pages project "spashial"...`);
  execFileSync('npx', ['--yes', 'wrangler@4', 'pages', 'deploy', site, '--project-name', 'spashial', '--branch', 'main',
    '--commit-hash', sha, '--commit-message', subject.slice(0, 100), '--commit-dirty=true'], { cwd, stdio: 'inherit', env: process.env });
} finally {
  rmSync(work, { recursive: true, force: true });
}

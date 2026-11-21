// Checks the docs against themselves, against docs/spashial.d.ts, and against the running engine.
//   node tests/docs.test.mjs
//
// 1. content rules: unique ids, a test for every demo, no dashes in visible text, links that resolve
// 2. the reference table and docs/spashial.d.ts agree, in both directions
// 3. every name and default the reference states is true of the engine (needs the browser)
//
// When this fails after you added a property to the engine, it is telling you which of the three
// places (engine, spashial.d.ts, reference-data.mjs) is out of step. See reference-data.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { pages, groups, REFERENCE, GLOBALS, GLOBAL_VALUES } from '../docs/content/index.mjs';
import ts from 'typescript';
import { start, reporter } from './launch.mjs';

const t = reporter('docs: content, typings and engine agree');
const dts = readFileSync(new URL('../docs/spashial.d.ts', import.meta.url), 'utf8');

// ---------------------------------------------------------------- 1. content rules
t.section('content rules');
const ids = pages.map((p) => p.id);
t.check('every page id is unique and URL safe', new Set(ids).size === ids.length && ids.every((i) => /^[a-z0-9-]+$/.test(i)), ids);
t.check('every page is in a known group', pages.every((p) => groups.includes(p.group)));
t.check('every page has a title, a summary and blocks', pages.every((p) => p.title && p.summary && p.blocks?.length));

const demos = [];
const strings = [];
const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object' && !(v instanceof RegExp)) Object.values(v).forEach(walk); };
const KINDS = ['h', 'list', 'code', 'note', 'table', 'demo', 'physics', 'reference'];
let badBlocks = [];
for (const p of pages) {
  walk([p.title, p.summary]);
  for (const b of p.blocks) {
    if (typeof b === 'string') { strings.push(b); continue; }
    if (!KINDS.some((k) => k in b)) badBlocks.push(`${p.id}: ${JSON.stringify(b).slice(0, 50)}`);
    if (b.demo) demos.push({ page: p.id, ...b.demo }); else walk(b);
  }
}
for (const d of demos) strings.push(d.title, d.hint ?? '', d.code ?? '');
t.check('every block is a known kind', !badBlocks.length, badBlocks);

const demoIds = demos.map((d) => d.id);
t.check('every demo id is unique', new Set(demoIds).size === demoIds.length, demoIds.filter((x, i) => demoIds.indexOf(x) !== i));
t.check('every demo has a title and either code or a demos/ file', demos.every((d) => d.title && (d.code || d.from)), demos.filter((d) => !(d.title && (d.code || d.from))).map((d) => d.id));
t.check('every demo `from` file exists', demos.filter((d) => d.from).every((d) => existsSync(new URL(`../demos/${d.from}.js`, import.meta.url))), demos.filter((d) => d.from && !existsSync(new URL(`../demos/${d.from}.js`, import.meta.url))).map((d) => d.from));
t.check('every demo has a test: an `expect` that must be true, or an `error` it must raise', demos.every((d) => typeof d.expect === 'function' || d.error), demos.filter((d) => !(typeof d.expect === 'function' || d.error)).map((d) => d.id));
t.check('an error demo says which message and line', demos.filter((d) => d.error).every((d) => d.error.message instanceof RegExp && Number.isInteger(d.error.line)));
const bare = pages.filter((p) => !demos.some((d) => d.page === p.id) && !['reference', 'embedding'].includes(p.id) && !p.blocks.some((b) => b.physics));
t.check('every page has at least one demo (the reference is generated; embedding is host-page code)', !bare.length, bare.map((p) => p.id));

// text rules for the reference too
for (const o of REFERENCE) { strings.push(o.title, o.intro); for (const m of o.members) strings.push(m.text, m.try ?? '', m.tryUpdate ?? ''); }
for (const g of [...GLOBALS, ...GLOBAL_VALUES]) strings.push(g.text);
const dashes = strings.filter((s) => /[–—]/.test(s));
t.check('no em dash or en dash anywhere in the docs text or demos', !dashes.length, dashes.slice(0, 3).map((s) => s.slice(0, 60)));
const nonAscii = strings.filter((s) => /[^\x00-\x7F]/.test(s));
t.check('no non-ASCII characters in the docs text or demos', !nonAscii.length, nonAscii.slice(0, 3).map((s) => s.slice(0, 60)));
const codeInLink = strings.filter((s) => /\[[^\]]*`[^\]]*\]\(/.test(s));
t.check('no link label contains a code span (the text formatter would print the link as raw text)', !codeInLink.length, codeInLink.slice(0, 2).map((s) => s.slice(0, 80)));
const links = strings.flatMap((s) => [...s.matchAll(/\]\(#\/([a-z0-9-]+)/g)].map((m) => m[1]));
const badLinks = links.filter((l) => !ids.includes(l));
t.check(`every link to a page resolves (${links.length} links)`, !badLinks.length, badLinks);
t.check('no leftover Mesh or Asset names in the docs (the 3D object is a Solid)', !strings.some((s) => /\b(Asset|allAssets|Mesh|allMeshes|getMeshAt|newMesh)\b/.test(s.replace(/TriangleMesh/g, ''))), strings.filter((s) => /\b(Asset|Mesh)\b/.test(s.replace(/TriangleMesh/g, ''))).slice(0, 2));

// ---------------------------------------------------------------- 2. reference <-> typings
t.section('the reference and docs/spashial.d.ts');
const SOURCE = { // reference object -> its declaration in the typings
  Solid: 'class Solid', Group: 'class Group', Hull: 'class Hull', TriangleMesh: 'class TriangleMesh', Sound: 'class Sound', online: 'const online',
  HingeJoint: 'class HingeJoint', BallJoint: 'class BallJoint', DistanceJoint: 'class DistanceJoint', SliderJoint: 'class SliderJoint', GlueJoint: 'class GlueJoint',
  world: 'interface World', camera: 'interface Camera', kb: 'interface Kb', mouse: 'interface Mouse',
  ambientLight: 'interface AmbientLight', sunLight: 'interface SunLight', PointLight: 'class PointLight', SpotLight: 'class SpotLight',
};
// Members the typings have that the reference deliberately covers in a sentence, not a row.
const COVERED = { camera: ['y', 'z'], Group: ['Solid'] };
// Read the typings with the TypeScript compiler, so one-line members and inheritance are handled right.
const sf = ts.createSourceFile('spashial.d.ts', dts, ts.ScriptTarget.ES2022, true);
const decls = new Map(); const topLevel = [];
for (const st of sf.statements) {
  if (ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) {
    const own = new Set();
    for (const m of st.members) if (!ts.isConstructorDeclaration(m) && m.name && ts.isIdentifier(m.name)) own.add(m.name.text);
    const base = st.heritageClauses?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression.getText(sf);
    decls.set(st.name.text, { own, base });
    topLevel.push(st.name.text);
  } else if (ts.isFunctionDeclaration(st)) topLevel.push(st.name.text);
  else if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => {
    topLevel.push(d.name.text);
    // `declare const online: { ... }` is an object type, not a class: read its members the same way
    if (d.type && ts.isTypeLiteralNode(d.type)) decls.set(d.name.text, { own: new Set(d.type.members.filter((m) => m.name && ts.isIdentifier(m.name)).map((m) => m.name.text)), base: undefined });
  });
  else if (ts.isTypeAliasDeclaration(st)) topLevel.push(st.name.text);
}
const ownMembers = (name) => decls.get(name)?.own ?? null;
const allMembers = (name) => { const d = decls.get(name); if (!d) return null; const all = new Set(d.own); if (d.base && decls.has(d.base)) for (const n of allMembers(d.base)) all.add(n); return all; };
for (const o of REFERENCE) {
  const decl = SOURCE[o.object].split(' ')[1];
  const own = ownMembers(decl), all = allMembers(decl);
  t.check(`${o.object}: has a declaration in docs/spashial.d.ts`, !!own, decl);
  if (!own) continue;
  const rows = o.members.map((m) => m.name);
  t.check(`${o.object}: no duplicate rows`, new Set(rows).size === rows.length, rows.filter((x, i) => rows.indexOf(x) !== i));
  t.check(`${o.object}: every reference row is in the typings`, rows.every((n) => all.has(n)), rows.filter((n) => !all.has(n)));
  const missing = [...own].filter((n) => !rows.includes(n) && !(COVERED[o.object] ?? []).includes(n));
  t.check(`${o.object}: every member the typings declare for it has a reference row`, !missing.length, missing);
}
const known = new Set([...REFERENCE.map((o) => o.object), ...GLOBALS.map((g) => g.name), ...GLOBAL_VALUES.map((g) => g.name),
  'setup', 'update', 'draw', 'drawTop', 'preload', 'Vector', 'Cube', 'Sphere', 'Cylinder', 'Capsule', 'Cone', 'Torus', 'Floor', 'Joint', 'World', 'Camera', 'Kb', 'Mouse', 'AmbientLight', 'SunLight', 'RayHit', 'SolidMouse',
  'LEFT', 'RIGHT', 'CENTER', 'STATIC', 'DYNAMIC', 'KINEMATIC', 'Vec3', 'Vec3Like', 'Collider', 'SolidShape', 'SoundClips', 'MultiplayerMode',
  // argument types, documented on the rows that take them (rayCast's { ignore }, a touch callback's hit)
  'RayOptions', 'Impact',
  // added to the sketch by multiplayer(), so they do not exist until it is called: documented on the multiplayer row and the Online play page
  'game', 'players', 'turn', 'seat', 'nextTurn', 'myTurn']);
const undocumented = topLevel.filter((n) => !known.has(n));
t.check('every global declared in the typings is documented somewhere', !undocumented.length, undocumented);

// ---------------------------------------------------------------- 3. the reference against the engine
t.section('the reference against the running engine');
const env = await start();
try {
  const page = await env.page();
  await page.goto(env.base + '/sandbox.html');
  await page.evaluate(() => window.examplesReady);
  await page.fill('#code', 'function setup() {}');
  await page.click('#run');
  await page.waitForFunction(() => document.getElementById('log').innerText.includes('running'), null, { timeout: 90000 });
  const frame = page.frames().find((f) => f.url().includes('runner.html'));
  const spec = REFERENCE.map((o) => ({ object: o.object, rows: o.members.map((m) => ({ name: m.name, kind: m.kind, def: m.default })) }));
  const out = await frame.evaluate((spec) => {
    const protos = { Solid, Group, Hull, TriangleMesh, HingeJoint, BallJoint, DistanceJoint, SliderJoint, GlueJoint, PointLight, SpotLight };
    const objs = { world, camera, kb, mouse, ambientLight, sunLight, online, Sound: loadSound('coin') };   // Sound is checked on an instance (some members are per-instance)
    const has = (o, n) => { for (let p = o; p && p !== Object.prototype && p !== Array.prototype; p = Object.getPrototypeOf(p)) if (Object.getOwnPropertyNames(p).includes(n)) return true; return false; };
    const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-6);
    const missing = [], wrong = [];
    const c = new Cube(0, 3, 0);
    for (const { object, rows } of spec) {
      for (const r of rows) {
        const holder = protos[object] ? protos[object].prototype : objs[object];
        if (!holder || !has(holder, r.name)) { missing.push(`${object}.${r.name}`); continue; }
        if (r.def === undefined) continue;
        const live = object === 'Solid' ? c : objs[object];
        if (!live) continue;
        if (!same(live[r.name], r.def)) wrong.push(`${object}.${r.name} is ${JSON.stringify(live[r.name])}, docs say ${String(r.def)}`);
      }
    }
    return { missing, wrong };
  }, spec);
  t.check('every documented name exists on the engine', !out.missing.length, out.missing);
  t.check('every documented default is what the engine really has', !out.wrong.length, out.wrong);
  const globals = await frame.evaluate((names) => names.filter((n) => typeof window[n] === 'undefined'), [...GLOBALS, ...GLOBAL_VALUES].map((g) => g.name));
  t.check('every documented global function and value exists', !globals.length, globals);
  const absent = await frame.evaluate(() => ['Asset', 'Mesh', 'allAssets', 'allMeshes', 'getMeshAt'].filter((n) => typeof window[n] !== 'undefined'));
  t.check('the old names Asset and Mesh are gone from the engine', !absent.length, absent);
} finally { await env.close(); }
t.done();

// Builds a tiny .glb in memory so this example needs no file. A real sketch uses a .glb file:
// solid.model = 'https://.../ship.glb', or registerModel('ship', url) then solid.model = 'ship'.
function makeGlb(tris) {
  const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    const [a, b, c] = t, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(...n) || 1; n = n.map((x) => x / len);
    t.forEach((p, k) => { pos.set(p, i * 9 + k * 3); nor.set(n, i * 9 + k * 3); });
  });
  const bin = new Uint8Array(pos.byteLength * 2);
  bin.set(new Uint8Array(pos.buffer), 0); bin.set(new Uint8Array(nor.buffer), pos.byteLength);
  const all = tris.flat(), count = tris.length * 3;
  const min = [0, 1, 2].map((k) => Math.min(...all.map((p) => p[k]))), max = [0, 1, 2].map((k) => Math.max(...all.map((p) => p[k])));
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.4, 0.9, 1, 1], metallicFactor: 0.3, roughnessFactor: 0.4 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength }, { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count, type: 'VEC3', min, max }, { bufferView: 1, componentType: 5126, count, type: 'VEC3' }] });
  const jb = new TextEncoder().encode(json + ' '.repeat((4 - json.length % 4) % 4)), total = 20 + jb.length + 8 + bin.length;
  const out = new DataView(new ArrayBuffer(total));
  out.setUint32(0, 0x46546C67, true); out.setUint32(4, 2, true); out.setUint32(8, total, true);
  out.setUint32(12, jb.length, true); out.setUint32(16, 0x4E4F534A, true); new Uint8Array(out.buffer).set(jb, 20);
  out.setUint32(20 + jb.length, bin.length, true); out.setUint32(24 + jb.length, 0x004E4942, true); new Uint8Array(out.buffer).set(bin, 28 + jb.length);
  return URL.createObjectURL(new Blob([out.buffer]));
}
// A crystal: two pyramids base to base, as triangles (three corners each).
function crystal() {
  const top = [0, 1.5, 0], bottom = [0, -1.5, 0], r = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]], t = [];
  for (let i = 0; i < 4; i++) { t.push([top, r[(i + 1) % 4], r[i]]); t.push([bottom, r[i], r[(i + 1) % 4]]); }
  return t;
}

function preload() {
  registerModel('crystal', makeGlb(crystal()));   // a name for the model
  loadModel('crystal');                           // setup() waits until it has loaded
}
function setup() {
  world.gravity.y = -10;
  new Floor();
  camera.pos = [0, 5, 11]; camera.lookAt(0, 1.5, 0);

  // A model draws instead of the shape and is fitted inside the solid's box. The collider is still the box...
  const boxed = new Solid(-2.5, 4, 0, 1.6, 2.4, 1.6);
  boxed.model = 'crystal';

  // ...unless you wrap the model: shape = 'hull' makes the collider hug it.
  const wrapped = new Solid(2.5, 4, 0, 1.6, 2.4, 1.6);
  wrapped.model = 'crystal';
  wrapped.shape = 'hull';
  wrapped.friction = 0.6;
  wrapped.rotation.z = 20;                        // tilted a little, so it topples onto a face
}
function drawTop() {
  fill('white'); textSize(14);
  text('modelNames(): ' + modelNames().join(', '), 12, 12);
}

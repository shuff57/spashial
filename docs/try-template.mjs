// The sketch a reference row's "Try it" button runs. Shared by docs/index.html and the tests, so
// the tests run exactly what a reader would.
//
// `c` is a tomato cube 3 units up, `floor` is the floor, and gravity is on. Both are declared at the
// top of the sketch, so update() can use them as well as setup(). A row's `try` lines go at the end
// of setup(); its `tryUpdate` lines go in update().
export const tryCode = (r) => `let c, floor;                    // c is the cube this row is about
function setup() {
  world.gravity.y = -10;
  floor = new Floor();
  c = new Cube(0, 3, 0);
  c.color = 'tomato';
  camera.pos = [0, 3, 9];
  camera.lookAt(0, 1.5, 0);
${(r.try ?? '').split('\n').filter(Boolean).map((l) => '  ' + l).join('\n')}
}${r.tryUpdate ? `
function update() {
${r.tryUpdate.split('\n').map((l) => '  ' + l).join('\n')}
}` : ''}
`;

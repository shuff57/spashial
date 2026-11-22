function preload() {
  registerModel('crystal', 'assets/crystal.glb');
  loadModel('crystal');                           // setup() waits until it has loaded
}
function setup() {
  world.gravity.y = -10;
  new Floor();
  camera.pos = [0, 5, 11];
  camera.lookAt(0, 1.5, 0);

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
  fill('white');
  textSize(14);
  text('modelNames(): ' + modelNames().join(', '), 12, 12);
}

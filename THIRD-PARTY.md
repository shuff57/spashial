# Third-party software

spaSHial ships these two libraries, unmodified, in `vendor/`. Both are MIT licensed. The full licence
text of each sits beside its files and is the one that applies.

| Library | Version | Files | Licence | Copyright |
| --- | --- | --- | --- | --- |
| [three.js](https://threejs.org/) | 0.185.1 | `vendor/three/three.module.min.js`, `vendor/three/three.core.min.js` | MIT, [vendor/three/LICENSE](vendor/three/LICENSE) | 2010-2026 three.js authors |
| [JoltPhysics.js](https://github.com/jrouwe/JoltPhysics.js) (the WebAssembly build of [Jolt Physics](https://github.com/jrouwe/JoltPhysics)) | 1.1.1 | `vendor/jolt/jolt-physics.wasm.js`, `vendor/jolt/jolt-physics.wasm.wasm` | MIT, [vendor/jolt/LICENSE](vendor/jolt/LICENSE) | 2022-2024 Jorrit Rouwe |

The Jolt build is the single-threaded one on purpose. The multithreaded build needs `SharedArrayBuffer`,
which needs special isolation headers on every page, and GitHub Pages cannot send them.

To refresh them, change the versions in `package.json`, then run `npm install && npm run vendor`.

The development dependencies in `package.json` (Playwright, TypeScript) are used only to run the tests
and are not part of what is served.

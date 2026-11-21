# Where the engine's files came from

The engine was written and tested in the shCode course repository
([github.com/shuff57/shCode](https://github.com/shuff57/shCode), branch `spaSHial`) and released here as
a standalone project. This file records what was copied, so a newer copy can be brought in without
guessing.

| | |
| --- | --- |
| Source | shCode, branch `spaSHial`, `public/spashial/` |
| Commit | `580fe72e` ("online play (online, multiplayer, 3D shared bodies) with a no-server two-tab host and the 3D live protocol") |
| Copied unchanged | `spashial.js`, `physics.js`, `textures.js`, `sound.js`, `online.js`, `online-local-host.js`; `tests/physics.test.mjs`, `tests/sound.test.mjs` and `tests/online.test.mjs` (only import paths, first comment lines and, in the online test, two skips differ) |
| Copied with changes | `runner.html` (see below) |
| Rewritten for this repository | `sandbox.html` (the examples moved out into `demos/`, and the page keeps saved values), the typings (`docs/spashial.d.ts`: the source spec with what is not built removed, comments made standalone, and the 2D drawing calls added) |
| Engine tests in the source repo | 147 physics tests, 57 sound tests, 94 online tests and 167 browser checks (the port here runs 175: two per example, and there are 17 examples here). This repository ports all four (`tests/physics.test.mjs`, `tests/sound.test.mjs`, `tests/online.test.mjs`, `tests/browser.test.mjs`). Two online tests compare the code with shCode's own files (moSHion's `extras.js`, `lib/room-icons.ts`); they are skipped here. |

## The changes to `runner.html`

The source runner takes the sketch from the address (`?code=<base64url>`) and asks the host for saved
values. Here ONE round trip carries both, because GitHub Pages refuses addresses much over 6 KB (so a long
sketch cannot ride in the address). It is the same bridge moSHion uses:

```
frame -> host   { source: 'preview-storage-request' }
host  -> frame  { source: 'preview-storage-init', code: '<the sketch>', data: { name: '<json>' } }
frame -> host   { source: 'preview-storage', op: 'set' | 'remove' | 'clear', key, value }   (every change)
```

`code` and `data` are both optional in the answer. If the host does not answer within 400 ms the frame
falls back to `?code=` (waiting a quarter of a second for saved values). The frame has no localStorage of
its own, so the host keeps what the sketch saves: `embed.js` has `localStore(key)` for that, and the
sandbox, the docs (one store per demo) and the landing page all use it.

`start()` can return a promise, when `preload()` asked for pictures, models or sounds. The runner waits for
it before it announces `preview-ready`. That line is as in the source.

## Online play: the host half

A sketch cannot reach a server, so the page around it (the host) serves its rooms. `online-local-host.js`
does it with **no server**, between two tabs of one browser on the same site (a `BroadcastChannel`): the
tab that hosts a room is the room, so closing or reloading it closes the room, and another computer can
never join. `embed.js` wires it in: `runSketch` makes the host the first time a sketch asks for online
play, `onLobby(view, actions)` gets the lobby state and `renderLobby(element, view, actions)` draws the
bar. The messages are moSHion's (`preview-online` up, `preview-online-reply`, `-update`, `-room`, `-share`
and `-unshare` down), so a host written for shCode's classroom rooms serves a sketch here too.
`online-local-host.js` was written for shCode: its header mentions files that are not in this repository.

## Bringing in a newer engine

1. Copy `spashial.js`, `physics.js`, `textures.js`, `sound.js`, `online.js` and `online-local-host.js` over this repository's. Re-apply the
   `runner.html` changes if `runner.html` changed in the source.
2. If `scripts/build-spashial-vendor.mjs` gained files, add them to `scripts/build-vendor.mjs` and run
   `npm run vendor`.
3. Edit `docs/spashial.d.ts` to match the source spec, leaving out anything the engine does not do yet.
4. Add or change the rows in `docs/content/reference-data.mjs`. See [docs/README.md](docs/README.md).
5. Move any new example out of the source `sandbox.html` into `demos/` and `demos/index.json`.
6. Port any new tests, then run `npm test`. `tests/docs.test.mjs` names the file that is out of step.
7. Update the commit in the table above.

## The libraries

Jolt and three.js (with its glTF loader) are in `vendor/` and refreshed with `npm run vendor`. See
[THIRD-PARTY.md](THIRD-PARTY.md).

# Where the engine's files came from

The engine was written and tested in the shCode course repository
([github.com/shuff57/shCode](https://github.com/shuff57/shCode), branch `spaSHial`) and released here as
a standalone project. This file records what was copied, so a newer copy can be brought in without
guessing.

| | |
| --- | --- |
| Source | shCode, branch `spaSHial`, `public/spashial/` |
| Commit | `7c1fcee1` ("a TriangleMesh is solid from both sides (winding no longer matters)") |
| Copied unchanged | `spashial.js`, `physics.js`, `tests/physics.test.mjs` (only its import path and first two comment lines differ) |
| Copied with one change | `runner.html`: the sketch can arrive over `postMessage` as well as in `?code=` (see below) |
| Rewritten for this repository | `sandbox.html` (the 13 examples moved out into `demos/`), the typings (`docs/spashial.d.ts`, the source spec with everything that is not built removed) |
| Engine tests in the source repo | 147 physics tests and 106 browser checks. This repository ports both (`tests/physics.test.mjs`, `tests/browser.test.mjs`). |

## The one change to `runner.html`

In the source the sketch always rides in the address (`?code=<base64url>`). GitHub Pages refuses
addresses much over 6 KB, so a long sketch would fail there. Here the frame asks its host for the sketch:

```
frame -> host   { source: 'preview-storage-request' }
host  -> frame  { source: 'preview-storage-init', code: '<the sketch>' }
```

If the host does not answer within 400 ms the frame falls back to `?code=`. This is the same bridge
moSHion uses. Everything else (the globals, `preview-ready`, `preview-console`, `preview-error`, the
boot order) is as in the source.

## Bringing in a newer engine

1. Copy `spashial.js` and `physics.js` over this repository's. Re-apply the `runner.html` change if
   `runner.html` changed in the source.
2. Edit `docs/spashial.d.ts` to match the source spec, leaving out anything the engine does not do yet.
3. Add or change the rows in `docs/content/reference-data.mjs`. See [docs/README.md](docs/README.md).
4. Port any new tests, then run `npm test`. `tests/docs.test.mjs` names the file that is out of step.
5. Update the commit in the table above.

## The libraries

Jolt and three.js are in `vendor/` and refreshed with `npm run vendor`. See [THIRD-PARTY.md](THIRD-PARTY.md).

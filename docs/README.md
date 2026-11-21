# The docs

The docs site is `index.html` here. It has no build step: it imports the pages straight from
`content/` as ES modules, so what you edit is what is served and what the tests read.

```
docs/
  index.html               the site (sidebar, search, live demo cards)
  spashial.d.ts            the typings, for editors and for the tests
  try-template.mjs         the sketch a reference row's "Try it" button runs
  content/
    index.mjs              the pages in reading order, and the sidebar groups
    01-start.mjs ...       the pages, one file per area
    reference-data.mjs     ONE ROW PER NAME. The reference page and the physics tables come from here.
```

## Writing a page

A page is `{ id, group, title, summary, blocks }`. The `id` is its permanent address (`#/forces`), so
never rename one. Blocks are plain strings (paragraphs) or one of `{ h }`, `{ list }`, `{ code }`,
`{ note }`, `{ table }`, `{ demo }`, `{ physics }`, `{ reference }`. The list is at the top of
`content/01-start.mjs`. Text marks: `` `code` ``, `**bold**` and `[label](#/page-id)`.

**Every demo is a test.** A `{ demo }` must carry either an `expect` function, which runs inside the
sketch after the demo's scripted `steps` and must return true, or an `error` it is meant to raise. That
is what keeps a page honest: `tests/docs-demos.test.mjs` runs the demo in a browser, presses the keys and
moves the mouse, and fails if what the page says is not true. Write the `expect` about the claim the
page makes ("the locked cube does not tip"), not about the code running.

Rules the tests enforce: unique page and demo ids, no em dash or en dash and no non-ASCII character in
any text, every link to a page resolves, and no leftover `Asset` or `Mesh` names (the 3D object is a
`Solid`).

## Adding a property to the engine

Say the engine gains `solid.stickiness`.

1. Implement it in `spashial.js` (and `physics.js` if it reaches Jolt, with a test in
   `tests/physics.test.mjs`).
2. Add it to the `Solid` class in `spashial.d.ts`, with a doc comment written for a beginner.
3. Add one row to the `Solid` members in `content/reference-data.mjs`:

   ```js
   { name: 'stickiness', kind: 'property', type: 'number', default: 0, group: 'physics',
     text: 'How much it sticks to what it touches. 0 is not at all.',
     try: 'c.stickiness = 1;' },
   ```

   `group: 'physics'` puts it in the physics table, and `try` gives it a **Try it** button that runs
   that line on a cube. `default` is checked against a new `Cube()`; `units` is shown beside the type.
4. If it deserves teaching, add a demo to a page.
5. Run `node tests/docs.test.mjs`. It fails if the name is missing from the typings or the engine, if a
   typed member has no row, or if the default is wrong.

The same three steps apply to `world`, `camera`, `Group` and the joints; their rows are in the same file.

## Running the docs on their own

```sh
node scripts/serve.mjs        # http://127.0.0.1:8180/docs/
node tests/docs.test.mjs      # the docs agree with the typings and the engine
node tests/docs-demos.test.mjs
```

`ONLY=bounce node tests/docs-demos.test.mjs` runs just the demos whose id contains "bounce", and
`DEBUG_EXPR='({ x: ball.x })'` prints an expression from inside the sketch after the demo's steps.

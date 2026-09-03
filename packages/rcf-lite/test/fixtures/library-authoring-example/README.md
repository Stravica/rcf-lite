# Worked-example library authoring fixture

Minimum-viable external blueprint library the `docs/library-authoring.md` document walks through. This directory doubles as the fixture body for `test/blueprint/library-authoring-example.test.js`; the doc and the loader both bind against the same on-disk shape so a change to one that leaves the other stale trips the suite.

Layout:

- `library.json` at the root with `libraryPrefix: "wla"`, AC band 60000..60999, ADR suffix block 6000..6099, and one declared blueprint.
- `blueprints/example-standard/` - a single, deliberately small blueprint whose contributions stamp inside the declared bands.

Nothing in this library is intended for real project consumption; the WSD library ships separately.

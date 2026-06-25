# rcf-build-lite

RCF Build Lite — CLI, MCP server, `rcf view`, and `rcf build` SDD adapter for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf). First consumer of `@stravica/rcf-schemas`.

> **Status:** Phase 0 scaffold. Phase 2 (hand-write Build Lite's own PRD against the published schemas) starts after Phase 1 ships the schemas.

## RCF tree

This repo dogfoods RCF: Build Lite's own PRD, requirements, user stories, acceptance criteria, TAD slice and Build Sequence live as JSON under [`rcf/`](./rcf), validated against [`@stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas). The roots are declared in [`rcf/manifest.json`](./rcf/manifest.json); every other document is discovered by walking the parent id lists from those roots. The tree doubles as the canonical RCF example consumers can read.

Phase 2 is JSON authoring only. The runtime (CLI, view, MCP, build adapter) lands in Phases 3 to 7. The validation test at `test/rcf-tree.test.js` exercises every document against its schema plus referential integrity across the tree.

## Depends on

This repo consumes [`@stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas) — the language-neutral JSON Schema contract every RCF tool keys to. The package is published to GitHub Packages; resolving the `@stravica` scope requires the `.npmrc` in this repo plus a token with `read:packages`. See `test/schemas-smoke.test.js` for the import + validation path.

## License

Apache 2.0 — see [LICENSE](./LICENSE).

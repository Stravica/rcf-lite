# rcf-build-lite

RCF Build Lite — CLI, MCP server, `rcf view`, and `rcf build` SDD adapter for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf). First consumer of `@stravica/rcf-schemas`.

> **Status:** Phase 0 scaffold. Phase 2 (hand-write Build Lite's own PRD against the published schemas) starts after Phase 1 ships the schemas.

## Depends on

This repo consumes [`@stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas) — the language-neutral JSON Schema contract every RCF tool keys to. The package is published to GitHub Packages; resolving the `@stravica` scope requires the `.npmrc` in this repo plus a token with `read:packages`. See `test/schemas-smoke.test.js` for the import + validation path.

## License

Apache 2.0 — see [LICENSE](./LICENSE).

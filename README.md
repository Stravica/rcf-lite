# rcf-build-lite

RCF Build Lite - CLI, MCP server, `rcf view`, and `rcf build` SDD adapter for the [Requirements Confidence Framework (RCF)](https://stravica.ai/rcf). First consumer of `@stravica/rcf-schemas`.

> **Status:** Phase 3. Document store foundations (FBS-001 + FBS-002) and visual review surface (FBS-003 + FBS-004) shipped. CRUD verbs land in Phase 4.

## RCF tree

This repo dogfoods RCF: Build Lite's own PRD, requirements, user stories, acceptance criteria, TAD slice and Build Sequence live as JSON under [`rcf/`](./rcf), validated against [`@stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas). The roots are declared in [`rcf/manifest.json`](./rcf/manifest.json); every other document is discovered by walking the parent id lists from those roots. The tree doubles as the canonical RCF example consumers can read.

## rcf view

Render the on-disk RCF tree as a Mermaid diagram and a browsable static HTML page so a non-coding owner can review what is specified without reading any JSON.

### Install

After cloning the repo:

```sh
pnpm install
pnpm run vendor   # copies node_modules/mermaid/dist/mermaid.min.js into src/view/vendored/
```

The vendored Mermaid bundle (version `11.6.0`, see `scripts/vendor-mermaid.mjs`) is checked into source so the rendered page is browsable offline with no network at view-time.

### Usage

From the repo root or any subdirectory:

```sh
pnpm run rcf-view              # render the live tree
pnpm exec rcf-view --strict    # CI mode: refuse to write on a broken tree
pnpm exec rcf-view --help      # full flag and exit-code reference
```

Output lands at `<project-root>/.rcf-view/`:

- `index.html` - the assembled page
- `style.css` - the stylesheet
- `mermaid.min.js` - the vendored client-side renderer

Open `.rcf-view/index.html` in a browser; no server required.

The default mode renders broken trees with visible markers (broken nodes in the diagram, broken-document banners in the page) and exits `3`. Pass `--strict` to refuse the render on tree errors. Exit code `3` is set in both modes when the tree is broken; only output presence differs.

### Flags

| Flag | Default | Effect |
|---|---|---|
| `--strict` | off | Refuse to write output on a broken tree. Exit code is still `3`. |
| `--quiet` | off | Suppress non-error stdout. |
| `--verbose` | off | Per-document and per-output-file log lines on stdout. |
| `--help` | off | Print the help and exit `0`. |

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. Output written. |
| `1` | Render failure (IO error or unexpected runtime). |
| `2` | Usage error (unknown flag, no project root found). |
| `3` | Validation failure or broken references. Output is still written under the default; `--strict` suppresses it. |

## Depends on

This repo consumes [`@stravica/rcf-schemas`](https://github.com/Stravica/rcf-schemas) - the language-neutral JSON Schema contract every RCF tool keys to. The package is published to GitHub Packages; resolving the `@stravica` scope requires the `.npmrc` in this repo plus a token with `read:packages`. See `test/schemas-smoke.test.js` for the import + validation path.

## License

Apache 2.0 - see [LICENSE](./LICENSE).

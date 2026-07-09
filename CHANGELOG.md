# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, breaking changes are signalled by a minor version bump.

## [0.1.0] - 2026-07-08

First public release.

### Added

- Schema-validated document chain: every RCF document type (PRD, requirements, user stories, acceptance criteria, TAD, build sequence) lives as JSON in your repository, validated against the [`@stravica-ai/rcf-schemas`](https://github.com/Stravica/rcf-schemas) contract.
- Dogfooded `rcf/` tree: this repository's own PRD, requirements, stories, acceptance criteria, TAD and build queue, built and maintained with the tool itself.
- `rcf view`: live HTML rendering of the full document graph in the browser.
- Unified `rcf` CLI with full create, read, update and delete coverage across the document chain.
- Traceability queries: coverage, trace forward and back through the chain, and impact analysis from any node.
- `rcf build`: SDD adapter that turns the build queue into staged, executable spec bundles.
- `rcf mcp`: MCP server exposing the toolset to coding agents, backed by the agent guidance pack in `guidance/`.
- Documentation set: install, getting started, how it works, and why it exists, under `docs/`.

[0.1.0]: https://github.com/Stravica/rcf-build-lite/releases/tag/v0.1.0

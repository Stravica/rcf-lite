# Managed canonical assets

This directory holds the canonical texts that `rcf init` seeds and
`rcf doctor` maintains across upgrades. Each asset ships with the
package, so a consumer project always renders against the version it
installed. If you are reading this because you want to see what init or
doctor writes into an installed project, see the files below.

## What lives here

- `agent-instructions-block.md`: the managed block that `rcf init`
  writes into `CLAUDE.md` and `AGENTS.md` inside
  `<!-- rcf:managed:begin -->` / `<!-- rcf:managed:end -->` markers, and
  that `rcf doctor` maintains. This is user-facing product copy: read
  it as if landing on a stranger's repo, because that is the reader
  who sees it first. British English, no em-dashes, banned-tells
  baseline honoured.
- `agent-instructions-block.hash`: SHA-256 of the block text above,
  generated at package build time by `scripts/gen-managed-artefacts.mjs`
  and shipped in the tarball. `rcf doctor` reads this to decide whether
  an installed project's block is stale.
- `README.md`: this file. Explains the contract.

## The managed-block contract

- **Inside the markers** (managed): rewritten wholesale on every
  `rcf init` and `rcf doctor --fix`. Operator hand-edits to this region
  are discarded on --fix. The canonical text ships with the package
  and can change between minor versions.
- **Outside the markers** (operator): never touched by tooling. Any
  operator prose, sections, imports or file additions are preserved
  byte-for-byte. If the managed block is at the end of a file and the
  operator adds a section beneath it, that section stays.
- **Drift detection is warn-only.** `rcf doctor` never writes; it
  reports and exits 0 clean, 3 dirty. `rcf doctor --fix` is the only
  path that repairs.
- **Never auto-repair.** No hook, no post-install script, no `rcf init`
  or `rcf validate` sub-call invokes `--fix` implicitly. Init writes
  the block on a fresh scaffold; doctor maintains an existing project.
  Both are operator-typed.

## Reading the canonical text from a consumer project

The block is exposed through the existing `rcf guidance` verb:

```
rcf guidance managed/agent-instructions-block
```

The `.hash` file is deliberately not addressable through guidance; it
is metadata the doctor reads, not prose an operator reads.

## Contributing to the canonical text

Edits to `agent-instructions-block.md` land through the normal RCF
change flow (a spec that names the wording change, a rule that stays
British English and honours the banned-tells baseline). The
`scripts/gen-managed-artefacts.mjs` script regenerates
`agent-instructions-block.hash` and the mirrored fragment inside
`guidance/harness-template.md`; run it via the package build (the
`prepublishOnly` hook wires it into a release). Test AC-1.14 asserts
the harness-template fragment byte-matches this block after
regeneration.

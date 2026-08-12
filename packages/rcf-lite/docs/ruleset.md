# Shared standards ruleset (v1)

The rcf-lite umbrella package bundles a single machine-readable ruleset that
build-lite consumes as an admissibility gate. When `rcf-define-lite` ships
inside the same umbrella, it will consume the same artefact as an
elicitation checklist. Build-lite runs it as a gate; define-lite grows it
as a discipline.

Requirements provenance:
`projects/rcf-build-lite/docs/2026-08-06_build-lite-nextver-requirements.md`
(canonical since 2026-08-12).

Ratifications: `2026-08-11` ruling-sheet items 1, 2, 3, 4, 6, 7, 8, 11, 14,
15, 16, 17, 19.

## Artefact location

The ruleset ships inside the umbrella at `src/ruleset/ruleset.json` and is
loaded via the `#ruleset` import specifier:

```js
import { getRuleset } from '#ruleset';

const ruleset = await getRuleset();
console.log(ruleset.rulesetVersion); // stamped at load time from package.json
```

## Version policy (NV-BL-SR-02)

The ruleset carries no separate semver. Its version IS the rcf-lite
umbrella package version. The loader stamps `rulesetVersion` at read time
from `package.json`; the on-disk JSON does not carry a version field of its
own.

A chain declares the ruleset version it was authored against per
`DL-REQ-VALIDATE-03`. Drift handling splits at the stage:

- Define stage: warning with acknowledgement (DL-REQ-VALIDATE-03).
- Build stage: refusal on behaviour-changing drift (NV-BL-ADM-06).

## Content at v1 (NV-BL-SR-03)

- `admissibilityRules[]`: `NV-BL-ADM-01` through `NV-BL-ADM-06`. Every
  rule refuses by default (ruling-sheet item 1).
- `gateRules[]`: `NV-BL-GATE-01` through `NV-BL-GATE-04`.
- `scopeTagVocabulary`: references `@stravica-ai/rcf-schemas` common
  `$defs.scopeTag`. The vocabulary itself lives on the schemas; the ruleset
  points at it rather than owning it (ruling-sheet item 11). Values:
  `library`, `runtime`, `deployed`, `unclassified` (the migration state).
- `sourceCommentMarkers[]`: the ratified NV-BL-ADM-04 marker vocabulary
  (`TODO`, `FIXME`, `XXX`, `HACK`, `placeholder`, `v1 refinement`,
  `deferred`, `stub`), all case-insensitive.
- `tcTemplateFamily[]`: the three NV-BL-GATE-03 surfaces
  (`TCT-SERVER-BOOT`, `TCT-CLI-INVOKE`, `TCT-CONTAINER-RUN`).
- `rulingConsistencyChecks[]`: the light-mechanical NV-BL-GATE-04 family
  (`RCC-EXTERNAL-RESOURCE-CONTRADICTION`,
  `RCC-TIER-CAPABILITY-MISMATCH`). Deep probabilistic checks live in
  define-lite under DL-REQ-VALIDATE-04.
- `toolScope`: chain admissibility AND traceability/query tools
  (ruling-sheet item 1 addendum).

## Consumers

- **Build-lite admissibility lint.** Refuses chains that fail any rule
  before build starts (NV-BL-ADM-05). Override channel is
  recorded-in-chain; source-comment markers use a narrower ADR-only
  channel (NV-BL-ADM-04, ruling-sheet item 16).
- **Verify per-AC scope check.** Consumes `scopeTagVocabulary` so a
  fixture-scope TC bound to a runtime-scope AC surfaces as
  `SCOPE-MISMATCH` per the NV-BL-GATE-01 pull-in.
- **Traceability/query tools.** A tool that would present a chain marked
  refusable by the ruleset must refuse or surface the refusal; hiding
  it is the same class of defect as a silent build (ruling-sheet item 1
  addendum).
- **`rcf-define-lite` (fenced).** From the first umbrella release that
  includes the define payload, define-lite consumes the same artefact
  from the same umbrella version and grows subsequent versions through
  the umbrella release process.

## Migration state

Chains authored before scope tags land carry `scope: unclassified` on ACs
and TCs. The lint tolerates unclassified for one release cycle and refuses
thereafter (NV-BL-ADM-03 trade-off). Build-lite's own generator output is
covered by this migration state until `rcf-define-lite` ships and can take
over elicitation (per ruling-sheet item 3).

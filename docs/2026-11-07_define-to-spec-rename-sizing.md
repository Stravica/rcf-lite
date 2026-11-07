# Sizing: renaming `rcf define` to `rcf spec`

Date: 2026-11-07. Head: `65365d2a` (the 0.41.0 FINALISE commit on `release/0.41.0`). Documents only: nothing here changes code.

The change being sized: the requirements doc set is called "the spec"; the command group `rcf define <verb>` becomes `rcf spec <verb>`; `rcf define` stays as an alias for a few releases; DEFINE stays the name of the round stage. So every DEFINE-as-stage mention stays, and only the command group, and the text that names it, moves.

## 1. Size at a glance

Every line in the repository matching `define` as a word (letters-only boundaries, so `rcf_define_ledger`, `define-intent.md` and `DEFINE:` match, `defined` and `definition` do not) was found and classified: **6,795 lines**. Of those, **2,807 lines in 494 files change**; the rest stay (DEFINE stage, release history, plain English) or are owner decisions (section 3).

| Kind | Lines to change | Of which regenerated | Files | Kept on purpose | Owner decisions | Kept (stage / history / English) |
|---|---:|---:|---:|---:|---:|---|
| Verbs: dispatch table, group help, per-verb `Usage:` | 37 | 0 | 18 | 11 | 10 | 3 / 0 / 0 |
| Error messages and hints | 96 | 0 | 34 | 1 | 0 | (in other source) |
| Other source: comments, payload strings, metadata, scripts | 73 | 0 | 39 | 6 | 78 | 92 / 0 / 6 |
| MCP tool names and descriptions | 3 | 0 | 1 | 0 | 19 | 3 / 0 / 0 |
| Managed block (CLAUDE.md / AGENTS.md template) | 9 | 0 | 2 | 0 | 2 | 8 / 0 / 0 |
| Docs, guidance, playbooks, CHANGELOG instructions, CI | 210 | 0 | 27 | 0 | 48 | 47 / 175 / 2 |
| Tests, goldens, snapshots | 1,629 | 935 | 113 | 212 | 555 | 1,091 / 0 / 7 |
| rcf-lite's own requirements tree (`rcf/`, `.rcf/`) | 594 | 0 | 219 | 392 | 349 | 844 / 0 / 2 |
| Blueprints and probe packs | 156 | 0 | 72 | 0 | 0 | 0 / 10 / 15 |
| **Total** | **2,807** | **935** | **494** (unique) | **622** | **1,061** | |

"Kept on purpose" means the old spelling must survive: the old-form hint table in `bin/rcf.js`, stored verification reports and verdicts (they record what actually ran), and compatibility fixtures that test old managed blocks. Full file:line lists are in Appendix A.

What the numbers say:

- **The code change is small.** The group is one key in `GROUPS` (`bin/rcf.js:95`), plus `GROUP_ORDER`, `GROUP_HELP`, `HELP_MAP` and the top-level help (`src/cli/help.js:65, 92, 192, 224, 303, 323`). The fourteen subverbs keep their names: create, read, update, delete, link, unlink, validate, design, blueprint, standards, ledger, readiness, questions, freeze. Fourteen per-verb `Usage: rcf define ...` strings live in their handler modules and move with them.
- **Hints are spread out.** 96 user-facing lines across 34 source files tell the user to run `rcf define ...`, some assembled at run time (blueprint conflict and companion renderers, build and design hints, readiness and questions output). Two of those surfaces are machine-readable: the `command` fields in `rcf define questions --json` and the `commands[]` array in blueprint conflict results. Their values change.
- **Most of the volume is regenerated, not hand-edited.** 803 of the 935 regenerated lines are one viewer golden (`test/view/fixtures/phase-3-6-static.html`), rebuilt by `node scripts/regen-phase-3-6-baseline.mjs` from the tree. The rest are the queue, coverage and bundle goldens (recorders named in `rcf/separation.json` and `test/_harness/goldens.js`) and the managed-block hash (`pnpm run build:managed`).
- **It is criteria-bearing.** 415 live AC, REQ, US, TS and TC lines in 126 files of rcf-lite's own tree name the command, and the delivery-ci-workflows blueprint ships criteria (27 lines) and a CI asset that require `rcf define validate`. Re-pointing that wording is a criteria change, so it runs through TEST, not as a docs chore.
- **Tests find the group by lookup, not only by text.** `test/cli/help-parity.test.js:47` requires every `GROUPS` verb to have a `HELP_MAP` entry with byte-identical help, `test/docs/verbs.test.js` derives valid groups from `GROUP_HELP`, and `test/query/questions.test.js:202` derives verbs from `HELP_MAP.define`. Many invocations are argv arrays (`['define', 'validate']`), so a text-only replace of `rcf define` misses them. Viewer tests that reject visible `rcf define` text (`test/view/readiness-layout.test.js:534`, `readiness-tables.test.js:282-346`) must also reject `rcf spec`, or command text can reach the viewer without a red.
- **rcf-lite's own CI calls the old form**: `.github/workflows/ci.yml:54, 57` run `node bin/rcf.js define validate` (with and without `--base`).

## 2. The alias

There is no group alias mechanism today. The 0.10.0 reorganisation was a deliberate clean break ("no aliases, no shims", `bin/rcf.js:2-7`), and `OLD_FLAT_MAP` (`bin/rcf.js:156-182`) is a failure hint, not dispatch. So this is the first alias, and it should be small:

- **Dispatch.** `GROUPS.spec` holds the fourteen handlers. A one-entry `DEPRECATED_GROUPS = { define: 'spec' }` is resolved before the group lookup in `main()`: write the notice, swap `first` for `spec`, and carry on with the same argv. One path covers `rcf define <verb>`, bare `rcf define`, `rcf define --help` and `rcf define <unknown>`. No handler changes.
- **Notice, stderr only.** One line, once per invocation: `[warn] deprecated 'rcf define' is now 'rcf spec'; the alias is removed in <version>.` Exit codes and stdout stay byte-identical to `rcf spec`, `--json` included. Stderr is required, not preferred: a real consumer gate spawns `define validate --json`, accepts exit 0 or 3, and parses stdout as JSON with a text fallback. A notice on stdout makes the JSON parse fail, the text fallback finds no issue lines, and the gate passes with real issues present. No environment switch to silence it: the notice is the migration signal.
- **Help.** Top-level help lists `spec` only, with one line under it: `define  alias of spec, removed in <version>`. `rcf help define [verb]` prints the `spec` help plus the stderr notice. `HELP_MAP` and `GROUP_HELP` carry `spec` only, so help parity holds.
- **MCP.** The MCP server does not go through CLI dispatch, so there is no notice there. Tool names are section 3, decision 4.
- **Lifetime.** Releases come every two to three days, so "a few releases" needs a floor in time as well as count: at least three minor releases **and** at least 30 days after the alias ships, whichever is later. The release that removes it is `breaking: true` with `minAgentAction: rewrite-shell-invocations`, and `rcf define ...` then exits 2 with `Try 'rcf spec <verb>'`, the same shape as today's old-flat hints.

## 3. Decisions the rename does not settle

The CLI alias covers typed commands only. Each of these is a separate name with its own consumers. The recommendation is to keep the stage-named ones, because DEFINE stays the stage.

1. **`rcf/define/` on disk** (freeze record, four ledgers): keep. It belongs to the DEFINE stage, and moving it needs a migration or a dual-read path in every installed project. The retired `rcf/define/backstop.json` warning keeps working either way.
2. **Gate ids `define.discovery`, `define.shapes`, `define.consistency` and so on**: keep. These are DEFINE-stage gates, and users type them into `rcf define freeze --ack`.
3. **The `[error] refused define:` error family** (`src/cli/_door.js:67`, intake, journey): keep. It is the DEFINE-stage refusal, and the MCP wrappers strip it by exact prefix (`src/mcp/tools.js:1237, 1507`).
4. **MCP names `rcf_define_questions`, `rcf_define_readiness`, `rcf_define_ledger` (tools) and `rcf_define_intent`, `rcf_define_litmus` (prompts)**: the one real choice. Agents pair tool names with CLI verbs, so the lean is to rename them to `rcf_spec_*` and keep the old names callable but unlisted for the same window. Tool lookup is by exact name (`src/mcp/tools.js:1112, 1601`), so a rename without callable old names breaks any agent that follows an un-refreshed managed block, which names two of them. Keeping them as they are is also defensible. Either way it is the owner's ruling, made before round S1 freezes.
5. **Guidance topics `define-intent`, `define-intake`, `define-draft-shapes`, `define-litmus`** (users type them into `rcf guidance <topic>`) and the `define-*` capability tags: keep, because they describe DEFINE-stage work. The commands inside those topics do change.
6. **`src/define/` and `test/define/` module paths**: keep. They are internal and stage-named. `scripts/blueprint-r11-sweep.mjs:30` imports from `src/define/` directly.
7. **The placeholder package name `rcf-define-lite`** in `pnpm-workspace.yaml`: owner's call.
8. **"Grouped by the five RCF stages"** (top-level help, `GROUP_ORDER` comment, package description): once the group is called `spec`, the group names no longer match the stage names. Suggested help line: `spec  Author the spec (the DEFINE stage).`

## 4. What breaks for a consumer on 0.40.x or 0.41.0

Two consumer projects were swept at their main heads (CI, scripts, hooks, package scripts, agent and command files, MCP config, managed blocks). Their findings are given here by shape, not by name.

**Upgrading to the alias release, with the notice on stderr:**

1. **Nothing that calls `rcf define <verb>` breaks.** CI steps running `rcf define validate` (one consumer runs it twice, plus a `package.json` script) and the JSON-parsing validate gate above keep working. A stdout notice would silently disable that gate (section 2).
2. **A new stderr line appears.** Scripts that need empty or exact stderr from `rcf define` would notice it. Neither consumer has one; rcf-lite's own tests do.
3. **Machine-readable command strings change**: the `command` fields from `questions --json` and the blueprint conflict `commands[]` now say `rcf spec ...`. A consumer that matches those strings must accept both.
4. **The managed block goes stale until it is refreshed.** It keeps teaching `rcf define` (seven command lines and two MCP names per copy, four copies across the two consumers), which works through the alias. `rcf init` refreshes only CLAUDE.md when both files exist (`src/setup/agent-setup.js:308-319`); `rcf doctor --fix` refreshes both (`src/cli/doctor.js:382-417`). The release note should say `doctor --fix`, not only rerun init. Local edits inside the markers are lost, as they are today.
5. **MCP.** No break if the old names stay callable. Neither consumer lists rcf tool names in an MCP permission allowlist.
6. **Hooks are unaffected.** The consumers' hooks run only `rcf-lite feedback hook`.
7. **Version guards fail first, on any upgrade.** These are a CI `rcf --version` string assert, a validate baseline's `capturedUnder`, exact version pins in `package.json` and `.mcp.json` (`rcf init` keeps an existing `.mcp.json` entry), and one consumer's bound test that asserts the pin. They are not caused by the rename, but they land in the same bump PR.
8. **From 0.40.x, 0.41.0 comes too.** A 0.40.x consumer also takes 0.41.0's breaking change (test strength becomes a recorded report; `build finalise` and `build verdict test` exit 0 where 0.40.1 exited 4), and its managed block is already stale under 0.41.0's hash. That upgrade is a round, not a chore.
9. **Copied blueprint text keeps the old form.** 34 command lines in 18 blueprint contribution files already copied into consumer trees still say `rcf define`, and so does the CI step the delivery-ci-workflows blueprint materialises. They stay true while the alias lives.

**When the alias is removed:**

10. **Old calls fail at dispatch with exit 2.** That covers CI steps and package scripts. The validate gate turns any exit other than 0 or 3 into its own exit 2: red and loud, which is the right failure.
11. **Consumer tests fail.** Tests that assert the gate's exact argv (`['define', 'validate', '--json']`, with and without `--base`) have to change together with the gate.
12. **Agent and command prompt files go stale.** One consumer has 33 such lines naming `rcf define ...`, plus 16 in a prompt document in its tree, which become wrong instructions. Names like `rcf-define-stage` and `/rcf-define` are that consumer's own DEFINE-stage names, not the CLI group.
13. **Consumer criteria need re-pointing.** Consumer criteria and bound-test strings that name `rcf define` (one hint string found), and the copied blueprint contributions, become consumer-side criteria work.
14. **On-disk data is unaffected,** unless decision 1 moves `rcf/define/`.

## 5. One-page plan

Three rounds. Two ship in the alias release (0.42.0 if nothing else claims it); one removes the alias later. S1 must merge before S2, because the docs lint reads valid groups from `GROUP_HELP`, so docs naming `rcf spec` fail until the group exists.

**Before S1: owner rulings** on section 3, decisions 4, 7 and 8 (the others default to keep), and on the alias floor (three minors and 30 days).

**Round S1: the spec group and the alias** (criteria-bearing; about 220 source lines plus the tests that follow them)

| Step | What | Type |
|---|---|---|
| 1 | `rcf spec <verb>` runs all fourteen subverbs with the same exit codes and stdout bytes as 0.41.0 `rcf define <verb>` | Promise |
| 2 | `rcf define ...` (verb, bare, `--help`, unknown verb) behaves as `rcf spec ...` and adds exactly one deprecation line on stderr; stdout and exit code unchanged, `--json` included | Promise |
| 3 | Top-level help lists `spec` with the alias line; `rcf help define [verb]` serves the spec help; help parity holds | Promise |
| 4 | Hints, errors and machine-readable command strings name `rcf spec` (96 hint lines plus payload strings) | Promise |
| 5 | The managed block teaches `rcf spec`; hash and mirror regenerated; feed entry `minAgentAction: rerun-init`, with the note naming `rcf doctor --fix` for repos with both files | Promise |
| 6 | MCP per decision 4 (renamed, with old names callable but unlisted, or unchanged) and descriptions re-worded | Promise |
| 7 | Test argv arrays and help assertions move to `spec`; viewer "no visible command" patterns cover `rcf spec`; new alias tests | Hygiene (test upkeep) |
| 8 | Comments, package description, own CI step | Hygiene |

**Round S2: the wording sweep** (criteria re-pointed; about 1,900 lines plus the test wording that follows, 935 of them regenerated)

| Step | What | Type |
|---|---|---|
| 1 | Own-tree criteria naming the command (415 lines, 126 files) re-pointed to `rcf spec` through `rcf spec update`; their bound tests re-run in TEST | Criteria (same promise, new wording) |
| 2 | Delivery-ci-workflows blueprint criteria and its CI asset; the other blueprint contributions and probes (156 lines) | Criteria for that blueprint; hygiene for the rest |
| 3 | Docs, guidance topics, playbooks, CHANGELOG instruction lines (210 lines); history lines untouched | Hygiene |
| 4 | Regenerate goldens with their recorders (viewer baseline, queue, coverage, bundles); stored reports, verdicts and compatibility fixtures untouched | Hygiene (regenerate, never hand-edit) |

**Round S3: remove the alias** (at least three minors and 30 days after S1; small)

| Step | What | Type |
|---|---|---|
| 1 | `rcf define ...` exits 2 with `Try 'rcf spec <verb>'`; feed entry `breaking: true`, `minAgentAction: rewrite-shell-invocations` | Promise |
| 2 | Old MCP names retired (if renamed in S1); alias line dropped from help; alias tests replaced by exit-2 tests | Promise |
| 3 | Release note lists what consumers must rewrite (section 4, items 10 to 13) | Hygiene |

Risk to watch: S2 is mostly mechanical, and a bulk replace would corrupt the 2,088 DEFINE-stage lines, which share the token. Use the classified list in Appendix A, not a regex.

## Appendix A: every line, by kind (file: line numbers)

"R" marks lines that regenerate from a recorder rather than being edited by hand.

<details><summary><b>Verbs: command table, group help and per-verb help</b>: 37 lines to change in 18 files (0 regenerated), 11 kept on purpose, 10 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `packages/rcf-lite/bin/rcf.js`: 3, 95
- `packages/rcf-lite/src/cli/blueprint-library.js`: 63, 83
- `packages/rcf-lite/src/cli/blueprint.js`: 48, 78, 123, 188
- `packages/rcf-lite/src/cli/build.js`: 138
- `packages/rcf-lite/src/cli/create.js`: 49
- `packages/rcf-lite/src/cli/delete.js`: 18
- `packages/rcf-lite/src/cli/design.js`: 71, 78, 80-83
- `packages/rcf-lite/src/cli/freeze.js`: 86, 131
- `packages/rcf-lite/src/cli/help.js`: 65, 92, 192, 224, 303, 323
- `packages/rcf-lite/src/cli/ledger.js`: 57
- `packages/rcf-lite/src/cli/link.js`: 18, 28
- `packages/rcf-lite/src/cli/questions.js`: 39, 47
- `packages/rcf-lite/src/cli/read.js`: 16
- `packages/rcf-lite/src/cli/readiness.js`: 63, 127
- `packages/rcf-lite/src/cli/standards.js`: 10
- `packages/rcf-lite/src/cli/ui-classify.js`: 26
- `packages/rcf-lite/src/cli/update.js`: 41
- `packages/rcf-lite/src/cli/validate.js`: 38

Kept on purpose (alias text, old-form hints, recorded evidence):

- `packages/rcf-lite/bin/rcf.js`: 163-172
- `packages/rcf-lite/src/cli/build.js`: 185

Owner decision (data paths, MCP names, guidance topics, gate ids, module paths):

- `packages/rcf-lite/src/cli/freeze.js`: 90, 105-107
- `packages/rcf-lite/src/cli/help.js`: 104, 211, 220
- `packages/rcf-lite/src/cli/journey.js`: 126
- `packages/rcf-lite/src/cli/ledger.js`: 60, 138

</details>

<details><summary><b>Error messages and hints</b>: 96 lines to change in 34 files (0 regenerated), 1 kept on purpose, 0 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `packages/rcf-lite/src/blueprint/capabilities.js`: 108, 112, 125, 129, 151, 154, 170, 173
- `packages/rcf-lite/src/blueprint/companions.js`: 419-420, 430, 433
- `packages/rcf-lite/src/blueprint/conflicts.js`: 215-216, 219, 221, 223, 232, 283, 293, 298, 313
- `packages/rcf-lite/src/blueprint/disposition-ledger.js`: 194
- `packages/rcf-lite/src/blueprint/remove-resolution.js`: 59
- `packages/rcf-lite/src/blueprint/shelf-resolver.js`: 125, 275, 286, 293
- `packages/rcf-lite/src/blueprint/supersede.js`: 103, 208
- `packages/rcf-lite/src/build/mark.js`: 93, 109
- `packages/rcf-lite/src/cli/_door.js`: 70
- `packages/rcf-lite/src/cli/blueprint-library.js`: 539, 599, 664, 721
- `packages/rcf-lite/src/cli/blueprint.js`: 535
- `packages/rcf-lite/src/cli/build.js`: 712, 1017, 1036-1037, 1064, 1195-1196
- `packages/rcf-lite/src/cli/create.js`: 179
- `packages/rcf-lite/src/cli/delete.js`: 67
- `packages/rcf-lite/src/cli/design.js`: 232
- `packages/rcf-lite/src/cli/doctor.js`: 824, 862
- `packages/rcf-lite/src/cli/freeze.js`: 437, 509
- `packages/rcf-lite/src/cli/intake.js`: 204
- `packages/rcf-lite/src/cli/link.js`: 80
- `packages/rcf-lite/src/cli/preflight.js`: 125
- `packages/rcf-lite/src/cli/readiness.js`: 214, 545, 573, 589
- `packages/rcf-lite/src/cli/req-baseline.js`: 136
- `packages/rcf-lite/src/cli/req-classify.js`: 89
- `packages/rcf-lite/src/cli/ui-classify.js`: 101, 103
- `packages/rcf-lite/src/cli/update.js`: 110
- `packages/rcf-lite/src/cli/validate.js`: 283
- `packages/rcf-lite/src/core/store/writer.js`: 1395, 1637
- `packages/rcf-lite/src/define/validate-findings.js`: 73, 94, 111, 153, 167, 179, 203, 225, 239, 255
- `packages/rcf-lite/src/design/writer.js`: 183, 193
- `packages/rcf-lite/src/query/questions.js`: 370-371, 390, 409-410, 464-467, 484, 501, 519
- `packages/rcf-lite/src/query/readiness.js`: 477-478
- `packages/rcf-lite/src/query/refuse-on-admissibility.js`: 203
- `packages/rcf-lite/src/view/components-fixture.js`: 117
- `packages/rcf-lite/src/view/doc-renderers/architecture.js`: 21

Kept on purpose (alias text, old-form hints, recorded evidence):

- `packages/rcf-lite/src/build/backstop.js`: 22

</details>

<details><summary><b>Other source: comments, identifiers, payload strings, package metadata, scripts</b>: 73 lines to change in 39 files (0 regenerated), 6 kept on purpose, 78 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `packages/rcf-lite/package.json`: 5
- `packages/rcf-lite/scripts/stage-blueprint-shelf.mjs`: 5
- `packages/rcf-lite/src/blueprint/apply.js`: 51, 329, 375
- `packages/rcf-lite/src/blueprint/companions.js`: 442
- `packages/rcf-lite/src/blueprint/conflicts.js`: 48-49, 61, 206, 346
- `packages/rcf-lite/src/blueprint/dispositions.js`: 1
- `packages/rcf-lite/src/blueprint/library-cache.js`: 5
- `packages/rcf-lite/src/blueprint/library-registry.js`: 3
- `packages/rcf-lite/src/blueprint/loader.js`: 88, 236
- `packages/rcf-lite/src/blueprint/remove-resolution.js`: 1
- `packages/rcf-lite/src/blueprint/shelf-resolver.js`: 1
- `packages/rcf-lite/src/blueprint/supersede.js`: 1, 9, 16, 245
- `packages/rcf-lite/src/build/bundle.js`: 293, 296
- `packages/rcf-lite/src/build/queue.js`: 140
- `packages/rcf-lite/src/cli/_door.js`: 4-5
- `packages/rcf-lite/src/cli/blueprint-library.js`: 1, 131
- `packages/rcf-lite/src/cli/blueprint.js`: 200, 259, 744, 916
- `packages/rcf-lite/src/cli/create.js`: 41, 314
- `packages/rcf-lite/src/cli/freeze.js`: 1
- `packages/rcf-lite/src/cli/ledger.js`: 1, 593
- `packages/rcf-lite/src/cli/questions.js`: 1, 7, 14
- `packages/rcf-lite/src/cli/readiness.js`: 1, 55, 211
- `packages/rcf-lite/src/cli/validate.js`: 224
- `packages/rcf-lite/src/core/errors/index.js`: 53
- `packages/rcf-lite/src/core/store/validator.js`: 152, 179
- `packages/rcf-lite/src/core/store/walker.js`: 147, 335, 884
- `packages/rcf-lite/src/core/store/writer.js`: 82, 135, 1177
- `packages/rcf-lite/src/define/freeze-record.js`: 233
- `packages/rcf-lite/src/define/ledgers.js`: 52, 775
- `packages/rcf-lite/src/define/validate-findings.js`: 1
- `packages/rcf-lite/src/query/delta.js`: 18
- `packages/rcf-lite/src/query/gates.js`: 510, 1119
- `packages/rcf-lite/src/query/readiness.js`: 12
- `packages/rcf-lite/src/query/refuse-on-admissibility.js`: 21, 73
- `packages/rcf-lite/src/ruleset/ruleset.json`: 56, 74
- `packages/rcf-lite/src/verify/engine/catalog.js`: 100
- `packages/rcf-lite/src/view/doc-renderers/architecture.js`: 7
- `packages/rcf-lite/src/view/html-page.js`: 477, 852, 862, 865
- `packages/rcf-lite/src/view/readiness/tables.js`: 479

Kept on purpose (alias text, old-form hints, recorded evidence):

- `packages/rcf-lite/src/build/backstop.js`: 11, 21, 170
- `packages/rcf-lite/src/cli/build.js`: 847, 851, 889

Owner decision (data paths, MCP names, guidance topics, gate ids, module paths):

- `packages/rcf-lite/scripts/blueprint-r11-sweep.mjs`: 7, 30
- `packages/rcf-lite/src/cli/build.js`: 56, 60
- `packages/rcf-lite/src/cli/freeze.js`: 9, 18-19, 36-37, 39, 288
- `packages/rcf-lite/src/cli/ledger.js`: 27, 228, 278, 540, 600
- `packages/rcf-lite/src/cli/questions.js`: 24-25
- `packages/rcf-lite/src/cli/readiness.js`: 27-28, 37, 210, 396
- `packages/rcf-lite/src/cli/validate.js`: 13, 21
- `packages/rcf-lite/src/cli/view.js`: 740
- `packages/rcf-lite/src/core/errors/index.js`: 56
- `packages/rcf-lite/src/core/store/writer.js`: 81, 1384
- `packages/rcf-lite/src/define/freeze-record.js`: 3, 54, 229
- `packages/rcf-lite/src/define/ledgers.js`: 1, 10-13, 63, 66
- `packages/rcf-lite/src/define/validate-findings.js`: 44
- `packages/rcf-lite/src/discovery/record.js`: 12, 25, 455
- `packages/rcf-lite/src/query/gates.js`: 17, 48-49, 59-67, 1829
- `packages/rcf-lite/src/query/readiness.js`: 20, 183
- `packages/rcf-lite/src/query/refuse-on-admissibility.js`: 42
- `packages/rcf-lite/src/ruleset/index.js`: 5-6
- `packages/rcf-lite/src/ruleset/ruleset.json`: 2, 109, 123, 167
- `packages/rcf-lite/src/view/index.js`: 15-17
- `packages/rcf-lite/src/view/readiness.js`: 451-452
- `packages/rcf-lite/src/view/readiness/composite-id.js`: 7
- `packages/rcf-lite/src/view/readiness/tables.js`: 62
- `packages/rcf-lite/src/view/vendored/mermaid.min.js`: 1, 803, 885, 2153, 2554
- `pnpm-workspace.yaml`: 6

</details>

<details><summary><b>MCP tool names and descriptions</b>: 3 lines to change in 1 files (0 regenerated), 0 kept on purpose, 19 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `packages/rcf-lite/src/mcp/tools.js`: 82, 795, 1057

Owner decision (data paths, MCP names, guidance topics, gate ids, module paths):

- `packages/rcf-lite/src/mcp/tools.js`: 52-53, 538, 543, 762, 764, 778, 793-794, 1056, 1234, 1237, 1240, 1402, 1429, 1484, 1505, 1507, 1510

</details>

<details><summary><b>Managed block (CLAUDE.md / AGENTS.md template)</b>: 9 lines to change in 2 files (0 regenerated), 0 kept on purpose, 2 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `packages/rcf-lite/guidance/managed/README.md`: 38
- `packages/rcf-lite/guidance/managed/agent-instructions-block.md`: 124, 135, 153, 232, 321, 358, 382, 403

Owner decision (data paths, MCP names, guidance topics, gate ids, module paths):

- `packages/rcf-lite/guidance/managed/agent-instructions-block.md`: 404, 408

</details>

<details><summary><b>Docs: READMEs, guidance, playbooks, CHANGELOG instructions, CI workflow</b>: 210 lines to change in 27 files (0 regenerated), 0 kept on purpose, 48 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `.github/workflows/ci.yml`: 54, 57
- `packages/rcf-lite/CHANGELOG.md`: 178, 216, 488-489, 526, 528, 533, 535, 550, 568, 1216-1217, 1219-1220, 1242, 1295, 1647, 1683
- `packages/rcf-lite/README.md`: 21, 57, 78, 113
- `packages/rcf-lite/docs/blueprint-authoring-checklist.md`: 42-45, 116
- `packages/rcf-lite/docs/blueprint-authoring-walkthrough.md`: 77, 129, 215, 227, 234, 241, 258, 266
- `packages/rcf-lite/docs/blueprint-authoring.md`: 5, 63, 67, 158, 165, 167-168, 170, 235, 577, 608, 678, 682, 686
- `packages/rcf-lite/docs/capability-tags.md`: 49, 51
- `packages/rcf-lite/docs/code-nodes.md`: 9, 11, 37, 45, 47-49, 52, 66-69, 76, 81, 103, 127, 134
- `packages/rcf-lite/docs/getting-started.md`: 64, 74-75, 86-89, 102, 112, 143, 148-149, 157, 160-161, 175, 178, 182, 188, 196, 241-243, 405-407, 462
- `packages/rcf-lite/docs/how-it-works.md`: 103, 106, 126, 130, 150, 165, 245
- `packages/rcf-lite/docs/install.md`: 24
- `packages/rcf-lite/docs/library-authoring.md`: 93-94, 98, 105, 109-111, 118, 152
- `packages/rcf-lite/guidance/build-cycle-playbook.md`: 37, 63, 73, 76, 79, 83, 87, 97, 122-123, 133, 169, 234, 258, 373, 392, 410, 435, 510-511, 518, 528, 555
- `packages/rcf-lite/guidance/build-cycle.md`: 9, 28, 32, 36, 64
- `packages/rcf-lite/guidance/define-draft-shapes.md`: 19, 79, 92
- `packages/rcf-lite/guidance/define-intake.md`: 42, 83, 87
- `packages/rcf-lite/guidance/define-intent.md`: 13, 26, 60, 65, 70, 79
- `packages/rcf-lite/guidance/define-litmus.md`: 12, 38, 42, 52, 55, 70, 80
- `packages/rcf-lite/guidance/discovery/discovery-viewer-command-page-1-layout.html`: 181
- `packages/rcf-lite/guidance/discovery/discovery-viewer-command-page-4-tables.html`: 124, 132, 140, 169, 177, 185
- `packages/rcf-lite/guidance/discovery/discovery-viewer-command-page.md`: 5, 7, 50, 52, 71, 149, 267, 292
- `packages/rcf-lite/guidance/document-model.md`: 29
- `packages/rcf-lite/guidance/elicitation-playbook.md`: 7, 27, 64, 68, 80, 94, 176, 194, 216, 227, 229, 250, 261, 302, 306, 371, 373, 375, 382, 413
- `packages/rcf-lite/guidance/harness-template.md`: 137, 148, 166, 245, 334, 371, 395, 416
- `packages/rcf-lite/guidance/manifest.json`: 20
- `packages/rcf-lite/guidance/overview.md`: 46
- `packages/rcf-lite/releases/releases.yaml`: 100, 121, 405

Owner decision (data paths, MCP names, guidance topics, gate ids, module paths):

- `docs/2026-08-06_packaging-consolidation-proposal.md`: 9, 11, 51, 139, 163, 186, 199
- `packages/rcf-lite/CHANGELOG.md`: 180
- `packages/rcf-lite/docs/blueprint-authoring.md`: 292
- `packages/rcf-lite/docs/capability-tags.md`: 48, 50, 52
- `packages/rcf-lite/docs/ruleset.md`: 4, 6, 58, 75-76, 85
- `packages/rcf-lite/guidance/define-draft-shapes.md`: 3
- `packages/rcf-lite/guidance/define-intake.md`: 3, 43
- `packages/rcf-lite/guidance/define-intent.md`: 4-5, 14, 16, 27, 64
- `packages/rcf-lite/guidance/define-litmus.md`: 3
- `packages/rcf-lite/guidance/discovery/discovery-viewer-command-page-5-subtabs.html`: 190-192
- `packages/rcf-lite/guidance/discovery/discovery-viewer-command-page-6-one-page.html`: 183, 207-209
- `packages/rcf-lite/guidance/discovery/discovery-viewer-command-page.md`: 92, 106
- `packages/rcf-lite/guidance/elicitation-playbook.md`: 239, 334, 343
- `packages/rcf-lite/guidance/harness-template.md`: 417, 421
- `packages/rcf-lite/guidance/manifest.json`: 9-10, 16-18
- `packages/rcf-lite/releases/releases.yaml`: 91

</details>

<details><summary><b>Tests, goldens and snapshots</b>: 1629 lines to change in 113 files (935 regenerated), 212 kept on purpose, 555 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `packages/rcf-lite/test/_harness/goldens.js`: 19, 58, 100, 109, 111, 226
- `packages/rcf-lite/test/_helpers/d0.js`: 20-21
- `packages/rcf-lite/test/blueprint/application-onboarding-tour-anatomy.test.js`: 95, 110-112
- `packages/rcf-lite/test/blueprint/cli-library.test.js`: 1-2, 101, 113, 126, 139, 152, 165, 167, 184, 186, 188, 201, 203, 216, 222, 233, 240, 245, 247, 252, 254, 256, 274, 289, 305, 316, 333, 345, 414, 433, 452
- `packages/rcf-lite/test/blueprint/cli.test.js`: 49, 51, 53, 60, 67, 86, 89, 123, 125, 127, 202, 209, 217, 221, 226, 228, 257, 261, 265, 268, 281, 283, 294, 306-307, 309, 319-320, 322, 334, 338, 379, 383, 392-393, 397, 402, 409, 433, 441, 447, 453, 459, 465, 471, 475, 478, 492, 496, 499, 507, 511, 514, 527, 530, 542, 544, 552, 571, 585, 641, 652, 654, 661, 668, 675, 680, 682
- `packages/rcf-lite/test/blueprint/conflicts.test.js`: 102, 104, 185
- `packages/rcf-lite/test/blueprint/edge-cloudflare-rate-limiting-anatomy.test.js`: 113
- `packages/rcf-lite/test/blueprint/loader.test.js`: 152
- `packages/rcf-lite/test/blueprint/object-storage-s3-anatomy.test.js`: 104
- `packages/rcf-lite/test/blueprint/ownership-authoritative.test.js`: 132, 147, 153, 156, 163, 276, 278, 306, 318, 351, 354, 381, 383
- `packages/rcf-lite/test/blueprint/prefix-id-cli.test.js`: 98, 106, 114, 120, 126
- `packages/rcf-lite/test/blueprint/shelf-resolver-library.test.js`: 67
- `packages/rcf-lite/test/blueprint/shelf-resolver.test.js`: 57
- `packages/rcf-lite/test/build/fixtures/bundle-fbs-001.json`: R 288, 298
- `packages/rcf-lite/test/build/fixtures/bundle-fbs-001.md`: R 196, 202
- `packages/rcf-lite/test/build/fixtures/queue.json`: R 443, 541, 589, 601, 1019, 1187, 1211, 1223, 1247, 1271
- `packages/rcf-lite/test/build/fixtures/queue.md`: R 24, 33, 37-38, 76, 91, 93-94, 96, 98
- `packages/rcf-lite/test/build/mark.test.js`: 55, 71
- `packages/rcf-lite/test/cli/audit-separation-stage-prefix.test.js`: 265, 269
- `packages/rcf-lite/test/cli/audit-test-strength-workspace.test.js`: 353
- `packages/rcf-lite/test/cli/b5-postwrite.test.js`: 63, 68, 74, 77, 83, 89, 98
- `packages/rcf-lite/test/cli/blueprint-companions.test.js`: 51, 60, 68, 83, 97, 101, 106, 108-109, 115, 117, 124, 128, 130, 137, 144-147, 195, 197, 199, 204-206, 209, 213-216
- `packages/rcf-lite/test/cli/build-bundle-next-freeze-gate.test.js`: 94, 99
- `packages/rcf-lite/test/cli/codenode-crud.test.js`: 46, 54, 57, 65, 77, 89, 97, 106-107, 116-118, 120, 122, 133, 140-141, 148
- `packages/rcf-lite/test/cli/codenode-gate.test.js`: 111-114
- `packages/rcf-lite/test/cli/codenode.test.js`: 70, 77, 86, 102, 108, 116, 119, 189
- `packages/rcf-lite/test/cli/coverage-retired.test.js`: 118-119, 123, 131, 139, 246, 256
- `packages/rcf-lite/test/cli/create-ac-keeps-scope.test.js`: 1, 4, 42-43, 57, 61, 70, 74, 81, 86, 89-90, 93, 99, 106
- `packages/rcf-lite/test/cli/create-title-mapping.test.js`: 50, 68, 82, 100, 111, 126
- `packages/rcf-lite/test/cli/create.test.js`: 41, 50, 57, 64, 76, 84, 95, 105, 119, 124, 136, 141, 151, 160, 172, 186-187, 203, 212, 223, 238, 244, 250, 255, 264, 271, 293, 303, 326
- `packages/rcf-lite/test/cli/delete-message.test.js`: 37, 44, 54, 61, 74-76
- `packages/rcf-lite/test/cli/delete.test.js`: 39, 41, 46, 48, 57, 65-66, 74, 77, 84, 92, 103, 107, 109, 117
- `packages/rcf-lite/test/cli/doctor-agent-instructions.test.js`: 170
- `packages/rcf-lite/test/cli/doctor-identity.test.js`: 90
- `packages/rcf-lite/test/cli/end-to-end.test.js`: 49, 55, 62-63, 72, 81, 90, 95, 100, 110
- `packages/rcf-lite/test/cli/error-classification.test.js`: 55, 74-75, 87-88, 99, 106, 118
- `packages/rcf-lite/test/cli/feedback-add.test.js`: 70, 76, 89, 105, 123, 166, 179, 192, 205, 248, 291, 314, 337
- `packages/rcf-lite/test/cli/feedback-defer-discard.test.js`: 48, 160
- `packages/rcf-lite/test/cli/feedback-destinations.test.js`: 114, 124, 145, 172, 174, 201, 207, 213, 238, 252, 272, 299, 318, 339, 341
- `packages/rcf-lite/test/cli/feedback-fix-round-2.test.js`: 59, 65, 170, 191
- `packages/rcf-lite/test/cli/feedback-fix-round-3.test.js`: 65, 71, 120, 190
- `packages/rcf-lite/test/cli/feedback-fix-round-4.test.js`: 73, 79, 257, 263
- `packages/rcf-lite/test/cli/feedback-hook.test.js`: 43
- `packages/rcf-lite/test/cli/feedback-list-status.test.js`: 53
- `packages/rcf-lite/test/cli/feedback-opt-out.test.js`: 63, 183
- `packages/rcf-lite/test/cli/feedback-preview.test.js`: 69, 75, 204, 209
- `packages/rcf-lite/test/cli/feedback-submit.test.js`: 92, 98, 242, 333, 359
- `packages/rcf-lite/test/cli/finalise-referee-refusals.test.js`: 96, 114
- `packages/rcf-lite/test/cli/fixtures/bundle-next-029-golden.md`: R 67, 73
- `packages/rcf-lite/test/cli/freeze.test.js`: 1, 16, 18, 271, 463, 465
- `packages/rcf-lite/test/cli/help-parity.test.js`: 88, 93, 97
- `packages/rcf-lite/test/cli/help.test.js`: 30, 48-49, 55-56, 58, 75, 77
- `packages/rcf-lite/test/cli/ledger.test.js`: 1, 11, 378
- `packages/rcf-lite/test/cli/link.test.js`: 40, 48-49, 56-57, 65, 72, 80
- `packages/rcf-lite/test/cli/questions.test.js`: 1, 132
- `packages/rcf-lite/test/cli/rcf-verify-subcommand.test.js`: 71, 75
- `packages/rcf-lite/test/cli/read.test.js`: 40, 46, 48, 57, 66, 81, 91, 98, 104, 106, 113, 115, 140
- `packages/rcf-lite/test/cli/readiness.test.js`: 1, 48, 309, 330, 386, 421, 474
- `packages/rcf-lite/test/cli/update.test.js`: 40, 57, 67, 70, 80, 88, 96, 103, 112, 120, 128, 136
- `packages/rcf-lite/test/cli/validate-companions-pin.test.js`: 1, 44, 53
- `packages/rcf-lite/test/cli/validate-quiet-count.test.js`: 60, 79
- `packages/rcf-lite/test/cli/validate.test.js`: 40, 49, 83, 91, 102, 109, 122, 132, 140, 142, 147, 167, 186, 202, 214, 230
- `packages/rcf-lite/test/define/concern-catalogue.test.js`: 1, 15
- `packages/rcf-lite/test/define/freeze-record.test.js`: 17
- `packages/rcf-lite/test/define/ledgers.test.js`: 27
- `packages/rcf-lite/test/define/readiness-own-chain.test.js`: 33, 41, 61, 87, 94, 96-97, 107, 109, 193, 210, 236, 254, 267, 330, 349, 372, 376-377, 400, 408, 410-411, 415, 419, 421-422, 424
- `packages/rcf-lite/test/define/validate-dogfood.test.js`: 3, 17, 31
- `packages/rcf-lite/test/define/validate-findings.test.js`: 16
- `packages/rcf-lite/test/define/verification-end-state.test.js`: 9, 49, 71, 81, 399, 401, 403, 429, 463, 497, 746, 755, 771, 781, 789, 794
- `packages/rcf-lite/test/define/verification-field.test.js`: 52, 57, 59, 65-66, 69, 74, 82-83, 90, 102, 106, 114, 118, 175, 182-183, 190, 203-204, 206-207
- `packages/rcf-lite/test/discovery/discovery-gate.test.js`: 110, 341, 548, 553, 589, 592
- `packages/rcf-lite/test/discovery/journey-binding.test.js`: 202, 205-206, 580, 599, 602, 608, 611, 613-615, 626, 641, 644-645, 647
- `packages/rcf-lite/test/docs/getting-started-replay.test.js`: 53-60, 62-68, 74-76
- `packages/rcf-lite/test/docs/verbs.test.js`: 30-31, 106, 115, 117
- `packages/rcf-lite/test/feedback/destination.test.js`: 127, 244
- `packages/rcf-lite/test/feedback/fingerprint.test.js`: 65-66, 86
- `packages/rcf-lite/test/feedback/render.test.js`: 37, 186
- `packages/rcf-lite/test/finalise/administrative-finalise.test.js`: 129, 298
- `packages/rcf-lite/test/fixtures/probe-pack-application-empty-error-states/proof/README.md`: 27
- `packages/rcf-lite/test/fixtures/probe-pack-application-file-upload/proof/README.md`: 28-30
- `packages/rcf-lite/test/fixtures/probe-pack-application-forms-wizard/proof/README.md`: 29
- `packages/rcf-lite/test/guidance/build-cycle-0-37.test.js`: 76
- `packages/rcf-lite/test/guidance/inventory.test.js`: 46
- `packages/rcf-lite/test/guidance/stage-contract.test.js`: 24, 287-288
- `packages/rcf-lite/test/guidance/twelve-rules-0-41-0.test.js`: 81, 83
- `packages/rcf-lite/test/guidance/verbs.test.js`: 93
- `packages/rcf-lite/test/mcp/parity.test.js`: 74-75
- `packages/rcf-lite/test/mcp/resources.test.js`: 138-139
- `packages/rcf-lite/test/query/fixtures/coverage.json`: R 7844, 9485, 10370, 10381, 10403, 10437, 10510, 10631, 10653, 10774, 11058, 11080, 11274, 11307, 12054, 12087, 12635, 12730, 12763, 12774, 12796
- `packages/rcf-lite/test/query/fixtures/coverage.mmd`: R 2987-2988, 3600-3601, 3994-3995, 3998-3999, 4006-4007, 4020-4021, 4045-4046, 4089-4090, 4097-4098, 4141-4142, 4242-4243, 4250-4251, 4318-4319, 4330-4331, 4750-4751, 4762-4763, 4985-4986, 5018-5019, 5030-5031, 5034-5035, 5042-5043, 6712, 7015, 7200, 7202, 7206, 7213, 7226, 7248, 7252, 7274, 7324, 7328, 7362, 7368, 7578, 7584, 7696, 7713, 7719, 7721, 7725
- `packages/rcf-lite/test/query/fixtures/coverage.table.txt`: R 626, 766, 834-835, 837, 840, 846, 857, 859, 870, 895, 897, 914, 917, 975, 978, 1025, 1033, 1036-1037, 1039
- `packages/rcf-lite/test/query/fixtures/trace.json`: R 130
- `packages/rcf-lite/test/query/gates.test.js`: 2173
- `packages/rcf-lite/test/query/questions-loop-real.test.js`: 54, 90, 93-94, 96
- `packages/rcf-lite/test/query/questions.test.js`: 200, 206, 221-222
- `packages/rcf-lite/test/query/readiness.test.js`: 350, 377
- `packages/rcf-lite/test/rcf-tree.test.js`: 249, 251, 299, 313, 361, 373, 474, 496, 525, 539, 873
- `packages/rcf-lite/test/store/walker-invisible-define.test.js`: 18
- `packages/rcf-lite/test/store/walker.test.js`: 64, 158-159, 180, 588, 794
- `packages/rcf-lite/test/verify/helpers/package-world.js`: 156, 191, 194, 200, 203
- `packages/rcf-lite/test/verify/probe-assertion-0-9-0.test.js`: 174, 182-183, 186, 196, 205, 215, 241-242, 248, 252, 255-256
- `packages/rcf-lite/test/verify/probe-catalog.test.js`: 4, 195, 218, 258, 263, 268, 271, 275, 352, 358, 369, 381, 424, 433, 442, 446-447, 517, 526, 535, 543-544, 551
- `packages/rcf-lite/test/verify/suite-as-probe-pack.test.js`: 185
- `packages/rcf-lite/test/verify/suite-as-probe.test.js`: 158, 183-184
- `packages/rcf-lite/test/verify/verify-report-hand.test.js`: 252, 261
- `packages/rcf-lite/test/view/architecture-tab.test.js`: 102, 106
- `packages/rcf-lite/test/view/fixtures/phase-3-6-static.html`: R 129, 193, 236, 238-239, 241, 637, 696, 3272, 3279, 3358, 3398, 3405, 3415, 3417, 3422-3423, 3425-3426, 3428-3429, 3431-3432, 3446, 3448, 3453, 3455, 3461, 3463, 3469, 3471, 3477, 3479, 3511, 3517, 3519-3520, 3523, 3528-3529, 3531, 3534, 3538, 3544, 3555, 3564, 3570, 3572, 3581, 3594, 3596-3597, 3602, 3610, 3620, 3636, 3660, 3665-3666, 3669, 3672, 3675, 3686, 3693, 3695, 3703, 3711, 3719, 3816, 4304, 4500, 4505, 4507, 4513-4514, 4524, 4526, 4531, 4533-4534, 4671, 4687, 4697-4698, 4712, 4727, 4729, 4761, 4771-4772, 4786, 4801, 4803, 4895, 4898, 4902, 4979, 4984-4985, 4992-4993, 4995-4996, 4998, 5009-5010, 5016, 5018, 5025, 5027, 5034, 5053, 5058, 5060, 5066-5067, 5069-5070, 5072-5073, 5083, 5085, 5090, 5092, 5099, 5101, 5108, 5110, 5143-5144, 5146-5147, 5173, 5175, 5182, 5184, 5200-5201, 5205, 5474, 5477, 5481, 5484, 5489, 5493, 5511, 5517, 5554, 5557, 5745, 5775, 5847, 5871, 5969, 6003, 6201, 6233, 6402, 6409, 6514, 6623, 6625, 6627, 6657, 6662, 6667, 6943, 6975, 7123, 7161, 7289, 7324, 7544, 7583, 7682, 7721, 7881, 7913-7915, 8241-8242, 8244-8245, 8282, 8284, 8291, 8293, 8556-8557, 8559-8560, 8591, 8593, 8600, 8602, 8802-8803, 8837, 8839, 8956, 8963, 8982-8983, 8985-8986, 8988-8989, 9020, 9022, 9029, 9031, 9038, 9040, 9089, 16586-16587, 16613-16614, 17433, 17436, 17440, 17443, 17448-17449, 17457, 17459-17460, 17467, 17475, 17481, 17488, 17490, 17506, 17512, 17693, 17700, 17795, 17804, 17816, 17836, 18163, 18805, 18812, 18886, 18914, 18917, 18921, 18924, 18929, 18931, 18938, 18940, 18942, 18954, 18957, 18962, 18967, 18972, 19007, 19009, 19019, 19021, 19023, 19025, 19027, 19029, 19031, 19033-19034, 19052, 19057, 19082, 19087, 19092, 19097, 19102, 19107, 19112, 19117, 19120-19121, 19140-19141, 19540, 19586, 19649, 19653, 19698, 19708, 19848, 19851, 19855, 19858, 19863, 19866-19867, 19878, 19880, 19892-19893, 19896, 19915, 19920, 19948, 19950, 19967, 19980, 19982, 20017, 20040, 20045, 20047, 20080, 20083, 20226-20227, 20247, 20255, 20258, 20262, 20265, 20270, 20279, 20281, 20303, 20311, 20316, 20363-20364, 20411, 20416, 20437, 20444, 20518, 20521, 20525, 20537, 20559, 20600-20601, 20629, 20636, 20720, 20748, 20755, 21266, 21506, 21513, 21617, 21622, 21632, 21643, 21650, 21675, 21787, 22117, 22124, 22606, 22612, 22614, 22616, 22618, 22620, 22639, 22666, 22675, 22684, 22693, 22702, 22747, 22753, 22774, 22801, 22840, 22980, 23031, 23303, 23360, 23855, 23859, 23863, 23899, 23909, 23919, 24017, 24069, 24246, 24253, 24270, 24272, 24274, 24276, 24280, 24282, 24284, 24321, 24329, 24337, 24345, 24358, 24363, 24368, 24435, 24495, 24502, 24512, 24519, 24521, 24523, 24525, 24527, 24531, 24539, 24554, 24560, 24566, 24572, 24578, 24590, 24622, 24624, 24626, 24661, 24667, 24673, 24686, 24893, 24936, 25633, 25636, 25640, 25650, 25657, 25659, 25661, 25663, 25667, 25677, 25692, 25698, 25704, 25710, 25722, 25751, 25756, 25758, 25760, 25762, 25764, 25774, 25787, 25793, 25799, 25805, 25811, 25946, 25950, 25973, 25985, 25998, 26012, 26051, 27564, 27571, 27588, 27590, 27592, 27617, 27623, 27629, 27663, 27665, 27669, 27692, 27698, 27710, 27738, 27740, 27744, 27767, 27773, 27785, 27798, 28260, 28284, 30598, 30608-30609, 30614, 30624, 30627, 30633, 30723, 30739, 30760, 30808, 30811, 30816, 30818-30819, 30821, 30833-30834, 30841, 30849, 30865, 30876, 30881, 30914, 30974, 30980, 30983, 30988, 30991, 30996, 31005, 31019, 31082, 31088, 31091, 31096, 31101, 31113, 31129, 31137, 31147-31148, 31163, 31165, 31201, 31204, 31209, 31211, 31214, 31226-31227, 31243, 31245, 31254, 31264, 31280, 31405, 31416, 31418, 31434, 31445, 31471, 31484, 31516, 31650, 31661, 31682, 31783, 31806, 31833, 32093, 32112, 32123-32124, 32144, 32162-32163, 32167, 32262, 32267, 32496-32497, 32508, 32511, 32523, 32535, 32620-32621, 32631-32632, 32634-32635, 32642, 32645-32646, 32653, 32656, 32658, 32668, 33064, 33077, 33101, 34785, 34796, 34798-34799, 34811, 34813, 34818, 34821, 34918, 34929-34931, 34944-34946, 34969, 34982-34983, 34997, 35002, 35071, 35085, 35103, 35122, 35134, 35149, 35173, 35176, 35181, 35198, 35224, 35237, 35252, 35642, 35655-35656, 35670, 35685, 36193, 36204-36205, 36207, 36213-36214, 36223, 36492, 36503-36504, 36513-36514, 36655, 36666, 36669, 36676, 36687, 36910, 36921-36922, 36931-36932, 37380, 37387, 37411, 37428, 37435, 37468-37469, 37486, 37493, 37517, 37938, 37945, 37952, 37987, 37994, 38001, 38037, 38040, 38044, 38050-38051, 38088, 38342, 38345, 38355, 38384, 38488, 38491, 38501, 38525, 38528, 38532, 38538, 38569, 38636, 38639, 38643, 38657-38658, 39151, 39158, 39176, 39184, 39191, 39212, 39218, 39225, 39246, 39252, 39259, 39280, 39286, 39293, 39313, 39345, 39352, 39355, 39378, 39385, 39404, 39410, 39417, 39437, 39443, 39450, 39470, 39476, 39483, 39502, 39508, 39515, 39527, 39689, 39692, 39708, 39769, 39776, 39789, 39843, 40333, 40336, 40340, 40354, 40357, 40387, 40435, 40438, 40442, 40458-40459, 40486, 40489, 40493, 40511-40512, 40538, 40545, 40579, 40602, 40607, 40610, 40614, 40633-40634, 40658, 40670, 40718, 40723, 40730, 40842, 40847, 40871, 41625, 41632, 41636, 41750, 41757, 41761, 41987, 42095, 42217, 42224, 42228, 42274, 42281, 42284, 42304, 42421, 42428, 42431-42432, 42462, 42469, 42472, 42638, 42645, 42648-42649, 43053, 43060, 43064, 43069-43070, 43072, 43207, 43216, 43220-43221, 43224, 43265, 43274, 43276-43277, 43279, 43326
- `packages/rcf-lite/test/view/product-name-precedence.test.js`: 3
- `packages/rcf-lite/test/view/readiness-layout.test.js`: 503, 534
- `packages/rcf-lite/test/view/readiness-paths-resolve-307.test.js`: 6
- `packages/rcf-lite/test/view/readiness-tab.test.js`: 104, 135, 150, 321, 332, 349
- `packages/rcf-lite/test/view/readiness-tables.test.js`: 282, 292, 314, 340, 346
- `packages/rcf-lite/test/view/shell-header.test.js`: 4, 56

Kept on purpose (alias text, old-form hints, recorded evidence):

- `packages/rcf-lite/test/_harness/goldens.js`: 28, 130, 143
- `packages/rcf-lite/test/define/ledgers.test.js`: 358, 450, 457, 464-465
- `packages/rcf-lite/test/define/readiness-own-chain.test.js`: 131, 154-155, 157
- `packages/rcf-lite/test/fixtures/flag-move/criteria-before.json`: 3, 7, 11, 15, 19, 27, 39, 43, 47, 67, 103, 271, 275, 279, 283, 291, 295, 299, 303, 307, 311, 339, 347, 619, 631, 635, 639, 643, 651, 655, 663, 667, 671, 679
- `packages/rcf-lite/test/fixtures/managed-block-0-40-1/CLAUDE.md`: 195, 206, 252, 341, 380, 404, 425-426, 430
- `packages/rcf-lite/test/fixtures/own-chain/at-639f07bb.json`: 11, 13, 17, 19, 23, 25, 29, 31, 43, 49, 53, 55, 62, 71, 73-74, 77, 83, 91, 101, 103, 109, 115, 121, 380, 382-383, 422, 424, 440, 442, 491, 493, 497, 499, 503, 509, 511, 515, 517, 521, 523, 533, 535, 539, 541, 737-738, 907, 911, 913, 953, 959, 1112, 1118, 1121, 1124, 1127, 1130, 1133, 1136, 1139, 1142, 1145, 1147-1148, 1151, 1166, 1169, 1172, 1277, 1307, 1313, 1346, 1349, 1373, 1421, 1424, 1439, 1445, 1532, 1595, 1616, 1619, 1649, 1658, 1664, 1697, 1814, 1823, 1826, 1829, 1832, 1835, 1841, 1850, 1871, 1904, 1907, 1910, 1913, 1973, 2030, 2036, 2042, 2057, 2087, 2114, 2117, 2120, 2126, 2129, 2132, 2141, 2207, 2354, 2399, 2402, 2405, 2420, 2441, 2462, 2486, 2510, 2541-2543, 2654, 2656, 2660, 2662, 2744, 2746, 2750, 2752, 2780, 2782, 2816, 2818, 2822, 2824, 2828, 2830
- `packages/rcf-lite/test/guidance/fixtures/agent-instructions-block.pre-fbs-224.md`: 190, 201, 247, 336, 357, 378, 399-400, 404
- `packages/rcf-lite/test/guidance/twelve-rules-0-41-0.test.js`: 74, 363
- `packages/rcf-lite/test/query/gates.test.js`: 979
- `packages/rcf-lite/test/rcf-tree.test.js`: 113
- `packages/rcf-lite/test/store/walker.test.js`: 328

Owner decision (data paths, MCP names, guidance topics, gate ids, module paths):

- `packages/rcf-lite/test/_harness/goldens.js`: 227, 229
- `packages/rcf-lite/test/cli/build-base-suite.test.js`: 41, 355, 357, 371, 382, 384, 408-410
- `packages/rcf-lite/test/cli/build-bundle-next-freeze-gate.test.js`: 52, 58
- `packages/rcf-lite/test/cli/freeze.test.js`: 184, 203, 274, 345, 381
- `packages/rcf-lite/test/cli/ledger.test.js`: 389-392, 423
- `packages/rcf-lite/test/cli/readiness.test.js`: 167, 184, 496-497, 550
- `packages/rcf-lite/test/cli/req-baseline-opt-out-dry-run.test.js`: 82, 84, 87, 95-96
- `packages/rcf-lite/test/define/freeze-record.test.js`: 50, 56, 144
- `packages/rcf-lite/test/define/ledgers.test.js`: 38-42, 155-156, 471
- `packages/rcf-lite/test/define/readiness-own-chain.test.js`: 378, 425, 427
- `packages/rcf-lite/test/discovery/discovery-gate.test.js`: 92, 103, 119-120, 282, 293, 329, 337, 355, 368, 409, 427, 449, 458, 506, 536, 543
- `packages/rcf-lite/test/discovery/journey-record.test.js`: 757
- `packages/rcf-lite/test/guidance/inventory.test.js`: 47-49, 60-61, 64, 67, 74, 78-80, 82, 87
- `packages/rcf-lite/test/guidance/verbs.test.js`: 87
- `packages/rcf-lite/test/mcp/conformance.test.js`: 61-62, 69, 151, 153, 156, 160-163, 172-174, 176
- `packages/rcf-lite/test/mcp/define-questions.test.js`: 1, 36, 48, 55, 58, 64, 67, 74, 77, 84, 87
- `packages/rcf-lite/test/mcp/prompts.test.js`: 22-23, 25, 28
- `packages/rcf-lite/test/mcp/resources.test.js`: 140-141
- `packages/rcf-lite/test/mcp/stdio.e2e.test.js`: 129-130, 187, 189
- `packages/rcf-lite/test/mcp/tools.test.js`: 25, 466, 487, 493
- `packages/rcf-lite/test/rcf-tree.test.js`: 27-28, 31, 91, 333, 833, 839, 843, 860, 875-876, 892
- `packages/rcf-lite/test/store/walker-invisible-define.test.js`: 1, 3, 25, 27, 30, 32, 34, 36, 38, 40-42, 46, 49-50, 52, 54
- `packages/rcf-lite/test/store/walker.test.js`: 156
- `packages/rcf-lite/test/view/fixtures/phase-3-6-static.html`: 144, 235, 237, 243-245, 276, 282, 288-291, 305, 17801, 17827, 18808, 18822, 18833, 18848, 18863, 18872, 18908, 18944, 18977, 18981, 19126, 19161, 19163, 19169, 19176, 19293, 19392, 19437, 19500, 19505, 19611-19612, 19718-19719, 19804-19805, 19842, 19929, 20027, 20133, 20155, 20179, 20211-20212, 20249, 20283, 20291, 20293, 20321, 20341, 20346, 20350, 20386, 20392, 20399, 20475, 20490, 20512, 20586, 20623, 20705, 20742, 20941, 20993, 21288, 21297, 21304, 21395, 21401, 21405, 21408, 21425, 21427, 21449, 21454, 21469, 21484, 21486, 21498, 21500, 21510, 21595, 21628, 21665, 21680, 21758, 21775, 21789, 21795, 21799, 21802, 21829, 21872, 21877, 21962, 21979, 21999, 22005, 22009, 22012, 22080, 22097, 22111, 22210, 22228, 22643, 22661, 22688, 22706, 22715, 22846, 23194, 23199, 23201, 23203, 23205, 23214, 23224, 23236, 23244, 23248, 23252, 24770, 24823, 27263, 27270, 27477, 27483, 27506, 27524, 27537, 27606, 27681, 27756, 27804, 27807, 28458, 28532, 30733-30734, 30749, 30752, 30766, 30769, 30773-30774, 30776-30777, 30783, 30786, 30791-30792, 30796, 30815, 30820, 30825, 30828, 30836, 30842, 30846, 30872-30873, 30878, 30882, 30885, 30893, 30913, 30915, 30971, 30987, 30993, 30997, 31000, 31014-31015, 31024, 31079, 31095, 31098-31099, 31105, 31108, 31114, 31117, 31122, 31124, 31150, 31182, 31208, 31213, 31218, 31221, 31235, 31240, 31325, 31332-31333, 31336, 31338, 31342, 31345, 31353, 31356-31359, 31364, 31366, 31369, 31374, 31376, 31379, 31381, 31394, 31396, 31412-31413, 31422, 31425, 31435, 31450, 31455, 31460, 31478-31479, 31482, 31488, 31491, 31499, 32122, 32151, 32260, 32335-32336, 32357-32358, 32392, 32397, 32995, 32998, 33010, 33015, 33019, 33028, 33039, 33052, 35020, 35023, 35027-35028, 35032-35034, 35037, 35040, 35045, 35047-35048, 35056, 35063, 35078-35079, 35082-35083, 35088, 35091, 35097-35098, 35102, 35180, 35185, 35190, 35193, 35200, 35346, 35360, 35381, 36009, 36020, 36029, 36506, 36528, 36859, 36870, 36880, 40288, 40295, 40310, 40314, 40320, 40322, 40355, 40359-40360, 40363, 40365-40367, 40369, 40415, 40418, 40463, 40469, 40471-40472, 40475, 40516-40517, 40521, 40524-40525, 40527, 40584-40585, 40639, 40650, 40726, 40841, 40850-40855, 40865, 40872-40873, 40875-40876, 40882, 40884-40886, 40888, 40891, 40896-40897, 40900-40901, 40904, 40907, 40914, 41357, 41374, 41411, 41429, 41466, 41483, 41521, 41539, 41566, 41573, 41577, 41593, 41653, 41767, 41905, 41912, 41916, 42651, 43103, 43110, 43114, 43281
- `packages/rcf-lite/test/view/readiness-coverage-summary.test.js`: 249, 257, 326, 336, 342-343
- `packages/rcf-lite/test/view/readiness-layout.test.js`: 295-299, 307-308, 552
- `packages/rcf-lite/test/view/readiness-po-layer.test.js`: 31, 48, 69, 84, 94, 414
- `packages/rcf-lite/test/view/readiness-tab.test.js`: 36, 53, 71, 92, 112, 122, 315-316
- `packages/rcf-lite/test/view/readiness-tables.test.js`: 68, 87, 99, 125, 127-128, 132-133, 246, 268

</details>

<details><summary><b>rcf-lite's own requirements tree (rcf/, .rcf/)</b>: 594 lines to change in 219 files (0 regenerated), 392 kept on purpose, 349 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `packages/rcf-lite/rcf/adrs/adr-4109-referee-validate-adr-crosslinks.json`: 10, 12, 17, 20
- `packages/rcf-lite/rcf/adrs/adr-4112-referee-finalise-verified-invariant.json`: 10-12
- `packages/rcf-lite/rcf/adrs/adr-4120-canonical-json-hashing.json`: 12, 17
- `packages/rcf-lite/rcf/adrs/adr-4122-define-gates-blocking-and-optout.json`: 16
- `packages/rcf-lite/rcf/adrs/adr-4123-readiness-single-object.json`: 11
- `packages/rcf-lite/rcf/adrs/adr-4124-define-freeze-verb.json`: 9
- `packages/rcf-lite/rcf/adrs/adr-4126-persona-tagged-blockers-two-levels.json`: 12
- `packages/rcf-lite/rcf/adrs/adr-4135-readiness-po-register-and-adapter.json`: 12, 27
- `packages/rcf-lite/rcf/adrs/adr-4146-d0-blocking-no-ack-three-verb-door-single-reviewer.json`: 4-5, 14
- `packages/rcf-lite/rcf/adrs/adr-4152.json`: 5-6
- `packages/rcf-lite/rcf/adrs/adr-4155.json`: 5, 16
- `packages/rcf-lite/rcf/adrs/adr-4160.json`: 5-6
- `packages/rcf-lite/rcf/code-nodes/cn-019.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-020.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-021.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-022.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-061.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-066.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-069.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-075.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-076.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-084.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-086.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-089.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-090.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-723.json`: 4-5
- `packages/rcf-lite/rcf/code-nodes/cn-727.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-730.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-731.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-761.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-763.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-765.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-768.json`: 4
- `packages/rcf-lite/rcf/define/decisions-ledger.json`: 579, 594, 713, 885, 889, 893, 935, 956, 977, 1019, 1023, 1177, 1282, 1372, 1645, 1649, 1670, 1681, 1687, 1937, 2558, 2587, 2595, 2627, 2811, 3001, 3020, 3118, 3126, 3133
- `packages/rcf-lite/rcf/fbs/fbs-005.json`: 25
- `packages/rcf-lite/rcf/fbs/fbs-006.json`: 34-35
- `packages/rcf-lite/rcf/fbs/fbs-007.json`: 25
- `packages/rcf-lite/rcf/fbs/fbs-016.json`: 8
- `packages/rcf-lite/rcf/fbs/fbs-017.json`: 8
- `packages/rcf-lite/rcf/fbs/fbs-018.json`: 7-8
- `packages/rcf-lite/rcf/fbs/fbs-027.json`: 7
- `packages/rcf-lite/rcf/fbs/fbs-031.json`: 7
- `packages/rcf-lite/rcf/fbs/fbs-032.json`: 7
- `packages/rcf-lite/rcf/fbs/fbs-035.json`: 15-16
- `packages/rcf-lite/rcf/fbs/fbs-064.json`: 19
- `packages/rcf-lite/rcf/fbs/fbs-070.json`: 22
- `packages/rcf-lite/rcf/fbs/fbs-080.json`: 22
- `packages/rcf-lite/rcf/fbs/fbs-090.json`: 22
- `packages/rcf-lite/rcf/fbs/fbs-100.json`: 21
- `packages/rcf-lite/rcf/fbs/fbs-110.json`: 4
- `packages/rcf-lite/rcf/fbs/fbs-120.json`: 20
- `packages/rcf-lite/rcf/fbs/fbs-130.json`: 21
- `packages/rcf-lite/rcf/fbs/fbs-140.json`: 21
- `packages/rcf-lite/rcf/fbs/fbs-150.json`: 20
- `packages/rcf-lite/rcf/fbs/fbs-160.json`: 13
- `packages/rcf-lite/rcf/fbs/fbs-180.json`: 42
- `packages/rcf-lite/rcf/fbs/fbs-186.json`: 13
- `packages/rcf-lite/rcf/fbs/fbs-189.json`: 14
- `packages/rcf-lite/rcf/fbs/fbs-195.json`: 15, 18
- `packages/rcf-lite/rcf/fbs/fbs-197.json`: 17-18
- `packages/rcf-lite/rcf/fbs/fbs-198.json`: 19-20
- `packages/rcf-lite/rcf/fbs/fbs-199.json`: 35, 58
- `packages/rcf-lite/rcf/fbs/fbs-200.json`: 20-21, 45
- `packages/rcf-lite/rcf/fbs/fbs-201.json`: 49
- `packages/rcf-lite/rcf/fbs/fbs-202.json`: 113, 118, 142
- `packages/rcf-lite/rcf/fbs/fbs-215.json`: 5
- `packages/rcf-lite/rcf/fbs/fbs-218.json`: 5
- `packages/rcf-lite/rcf/fbs/fbs-225.json`: 28
- `packages/rcf-lite/rcf/fbs/fbs-227.json`: 4, 24
- `packages/rcf-lite/rcf/fbs/fbs-230.json`: 31
- `packages/rcf-lite/rcf/fbs/fbs-231.json`: 4-5
- `packages/rcf-lite/rcf/fbs/fbs-232.json`: 4
- `packages/rcf-lite/rcf/fbs/fbs-235.json`: 4-5
- `packages/rcf-lite/rcf/fbs/fbs-240.json`: 5, 10-11, 13
- `packages/rcf-lite/rcf/manifest.json`: 32, 86, 95
- `packages/rcf-lite/rcf/requirements/req-009.json`: 9
- `packages/rcf-lite/rcf/requirements/req-010.json`: 4
- `packages/rcf-lite/rcf/requirements/req-014.json`: 4-5, 9
- `packages/rcf-lite/rcf/requirements/req-016.json`: 4, 7
- `packages/rcf-lite/rcf/requirements/req-022.json`: 7
- `packages/rcf-lite/rcf/requirements/req-043.json`: 7
- `packages/rcf-lite/rcf/requirements/req-163.json`: 4, 10
- `packages/rcf-lite/rcf/requirements/req-165.json`: 4
- `packages/rcf-lite/rcf/requirements/req-172.json`: 7
- `packages/rcf-lite/rcf/requirements/req-173.json`: 6-7
- `packages/rcf-lite/rcf/requirements/req-175.json`: 6-7, 27
- `packages/rcf-lite/rcf/requirements/req-176.json`: 6-7
- `packages/rcf-lite/rcf/requirements/req-178.json`: 6-7
- `packages/rcf-lite/rcf/requirements/req-179.json`: 7
- `packages/rcf-lite/rcf/requirements/req-180.json`: 7
- `packages/rcf-lite/rcf/requirements/req-186.json`: 21
- `packages/rcf-lite/rcf/requirements/req-189.json`: 4
- `packages/rcf-lite/rcf/requirements/req-194.json`: 4
- `packages/rcf-lite/rcf/requirements/req-195.json`: 4
- `packages/rcf-lite/rcf/requirements/req-198.json`: 4, 18, 57
- `packages/rcf-lite/rcf/requirements/req-203.json`: 4
- `packages/rcf-lite/rcf/tacs/tac-4109-referee-validate-adr-crosslinks.json`: 10, 13, 19
- `packages/rcf-lite/rcf/tacs/tac-4112-referee-finalise-verified-invariant.json`: 21
- `packages/rcf-lite/rcf/tacs/tac-4121-define-ledgers.json`: 9-10, 17, 25
- `packages/rcf-lite/rcf/tacs/tac-4122-define-gates.json`: 33, 93
- `packages/rcf-lite/rcf/tacs/tac-4123-define-readiness.json`: 9, 23, 86
- `packages/rcf-lite/rcf/tacs/tac-4124-define-freeze.json`: 9, 25
- `packages/rcf-lite/rcf/tacs/tac-4125-build-bundle-refuse-override-skip.json`: 10, 12
- `packages/rcf-lite/rcf/tacs/tac-4126-define-validate-findings.json`: 9-10, 26, 28
- `packages/rcf-lite/rcf/tacs/tac-4127-readiness-view.json`: 10
- `packages/rcf-lite/rcf/tacs/tac-4129-define-questions.json`: 13, 24
- `packages/rcf-lite/rcf/tacs/tac-4130-define-intake-brief.json`: 29
- `packages/rcf-lite/rcf/tacs/tac-4133-readiness-po-layer.json`: 16
- `packages/rcf-lite/rcf/tacs/tac-4135-readiness-command-page.json`: 10
- `packages/rcf-lite/rcf/tacs/tac-4142-discovery-journey-gate.json`: 15-16, 20, 115, 120
- `packages/rcf-lite/rcf/tacs/tac-4150-ac-probe-catalog.json`: 9, 21
- `packages/rcf-lite/rcf/tacs/tac-4151.json`: 13
- `packages/rcf-lite/rcf/tacs/tac-4152.json`: 4, 7-8, 15, 18, 20, 30
- `packages/rcf-lite/rcf/tacs/tac-4159.json`: 21
- `packages/rcf-lite/rcf/test-suites/PENDING.md`: 19
- `packages/rcf-lite/rcf/test-suites/ts-006.json`: 18, 25, 32
- `packages/rcf-lite/rcf/test-suites/ts-008.json`: 19, 33
- `packages/rcf-lite/rcf/test-suites/ts-009.json`: 20, 34
- `packages/rcf-lite/rcf/test-suites/ts-025.json`: 51, 53
- `packages/rcf-lite/rcf/test-suites/ts-026.json`: 5
- `packages/rcf-lite/rcf/test-suites/ts-027.json`: 58, 65-66, 73, 80, 87, 108
- `packages/rcf-lite/rcf/test-suites/ts-028.json`: 5
- `packages/rcf-lite/rcf/test-suites/ts-037.json`: 4, 46-47
- `packages/rcf-lite/rcf/test-suites/ts-038.json`: 24
- `packages/rcf-lite/rcf/test-suites/ts-039.json`: 24
- `packages/rcf-lite/rcf/test-suites/ts-041.json`: 4, 16, 24, 32, 40
- `packages/rcf-lite/rcf/test-suites/ts-042.json`: 4, 16-17, 24-25, 32, 40, 48
- `packages/rcf-lite/rcf/test-suites/ts-043.json`: 24, 32-33, 40
- `packages/rcf-lite/rcf/test-suites/ts-073.json`: 32
- `packages/rcf-lite/rcf/test-suites/ts-190.json`: 4, 24
- `packages/rcf-lite/rcf/test-suites/ts-200.json`: 4, 24
- `packages/rcf-lite/rcf/test-suites/ts-203.json`: 20, 27
- `packages/rcf-lite/rcf/test-suites/ts-215.json`: 4, 39, 44, 51, 58, 65, 72, 240, 247, 254, 261, 268
- `packages/rcf-lite/rcf/test-suites/ts-217.json`: 4, 16, 42
- `packages/rcf-lite/rcf/test-suites/ts-218.json`: 4, 18, 23, 30
- `packages/rcf-lite/rcf/test-suites/ts-222.json`: 19
- `packages/rcf-lite/rcf/test-suites/ts-226.json`: 82, 117
- `packages/rcf-lite/rcf/test-suites/ts-230.json`: 52, 59
- `packages/rcf-lite/rcf/test-suites/ts-231.json`: 64, 71, 99
- `packages/rcf-lite/rcf/test-suites/ts-232.json`: 96
- `packages/rcf-lite/rcf/test-suites/ts-233.json`: 20, 22
- `packages/rcf-lite/rcf/test-suites/ts-234.json`: 14, 19, 26, 40
- `packages/rcf-lite/rcf/test-suites/ts-235.json`: 40
- `packages/rcf-lite/rcf/test-suites/ts-247.json`: 24, 45, 52, 59, 66, 73, 75
- `packages/rcf-lite/rcf/test-suites/ts-248.json`: 21, 42
- `packages/rcf-lite/rcf/test-suites/ts-251.json`: 4, 44, 46, 58, 60, 79, 81, 93, 95, 100, 102, 114, 116, 121, 123
- `packages/rcf-lite/rcf/test-suites/ts-252.json`: 4, 49, 51
- `packages/rcf-lite/rcf/test-suites/ts-258.json`: 52, 54
- `packages/rcf-lite/rcf/test-suites/ts-260.json`: 4, 33, 35, 40, 42, 47, 49, 54, 56, 68, 70, 75, 77, 82, 84
- `packages/rcf-lite/rcf/test-suites/ts-265.json`: 4, 11, 16, 18, 23, 25, 32
- `packages/rcf-lite/rcf/test-suites/ts-266.json`: 19, 21, 26, 28, 40, 42
- `packages/rcf-lite/rcf/test-suites/ts-267.json`: 25, 27, 32, 34, 39, 41
- `packages/rcf-lite/rcf/test-suites/ts-268.json`: 34, 36, 41, 43, 48, 50
- `packages/rcf-lite/rcf/test-suites/ts-270.json`: 41, 43
- `packages/rcf-lite/rcf/test-suites/ts-276.json`: 20, 22, 27, 29
- `packages/rcf-lite/rcf/test-suites/ts-278.json`: 20, 22, 34, 36, 41, 43
- `packages/rcf-lite/rcf/test-suites/ts-281.json`: 18, 20, 25, 27
- `packages/rcf-lite/rcf/test-suites/ts-294.json`: 19, 21, 26, 28, 33, 35
- `packages/rcf-lite/rcf/test-suites/ts-295.json`: 19, 21, 40, 42
- `packages/rcf-lite/rcf/test-suites/ts-296.json`: 18, 20, 25, 27
- `packages/rcf-lite/rcf/test-suites/ts-299.json`: 16, 18
- `packages/rcf-lite/rcf/test-suites/ts-300.json`: 41, 43
- `packages/rcf-lite/rcf/test-suites/ts-303.json`: 50, 52
- `packages/rcf-lite/rcf/user-stories/us-1001.json`: 8, 10, 15, 17, 23, 25, 31, 33, 39, 41
- `packages/rcf-lite/rcf/user-stories/us-1002.json`: 8, 17, 23, 25, 34, 47, 49-50, 55, 63, 73, 89
- `packages/rcf-lite/rcf/user-stories/us-1003.json`: 8, 15, 17, 25, 33, 41
- `packages/rcf-lite/rcf/user-stories/us-1204.json`: 7, 9, 14, 16-17
- `packages/rcf-lite/rcf/user-stories/us-1301.json`: 8, 23, 25
- `packages/rcf-lite/rcf/user-stories/us-1302.json`: 8, 23, 25
- `packages/rcf-lite/rcf/user-stories/us-1402.json`: 7-8, 14, 16, 23, 25, 32
- `packages/rcf-lite/rcf/user-stories/us-1403.json`: 7, 9, 14, 16, 23, 25, 32, 34
- `packages/rcf-lite/rcf/user-stories/us-1404.json`: 23, 25, 32, 34
- `packages/rcf-lite/rcf/user-stories/us-15802.json`: 23-24
- `packages/rcf-lite/rcf/user-stories/us-1601.json`: 4, 10
- `packages/rcf-lite/rcf/user-stories/us-16301.json`: 4, 12, 18, 25, 27
- `packages/rcf-lite/rcf/user-stories/us-16502.json`: 5, 25
- `packages/rcf-lite/rcf/user-stories/us-17301.json`: 7, 10, 15, 20, 25
- `packages/rcf-lite/rcf/user-stories/us-17302.json`: 15, 20, 45, 50, 55, 60, 65, 70, 75, 80, 83-84
- `packages/rcf-lite/rcf/user-stories/us-17404.json`: 35
- `packages/rcf-lite/rcf/user-stories/us-17405.json`: 40, 50
- `packages/rcf-lite/rcf/user-stories/us-17501.json`: 7-8, 11, 30, 35
- `packages/rcf-lite/rcf/user-stories/us-17502.json`: 8, 10, 45
- `packages/rcf-lite/rcf/user-stories/us-17503.json`: 7, 10
- `packages/rcf-lite/rcf/user-stories/us-17601.json`: 7, 15, 20
- `packages/rcf-lite/rcf/user-stories/us-17702.json`: 8, 15
- `packages/rcf-lite/rcf/user-stories/us-17802.json`: 8
- `packages/rcf-lite/rcf/user-stories/us-1801.json`: 21
- `packages/rcf-lite/rcf/user-stories/us-18602.json`: 8, 15, 40
- `packages/rcf-lite/rcf/user-stories/us-18905.json`: 14, 41, 50, 59, 68, 77
- `packages/rcf-lite/rcf/user-stories/us-18906.json`: 14, 41
- `packages/rcf-lite/rcf/user-stories/us-19001.json`: 44
- `packages/rcf-lite/rcf/user-stories/us-1901.json`: 15
- `packages/rcf-lite/rcf/user-stories/us-19201.json`: 33, 43, 53
- `packages/rcf-lite/rcf/user-stories/us-19301.json`: 41
- `packages/rcf-lite/rcf/user-stories/us-19401.json`: 14, 22, 30, 38, 51, 56, 61
- `packages/rcf-lite/rcf/user-stories/us-19501.json`: 5, 20, 26, 32, 38, 44, 56
- `packages/rcf-lite/rcf/user-stories/us-19502.json`: 32, 38, 44
- `packages/rcf-lite/rcf/user-stories/us-19602.json`: 38
- `packages/rcf-lite/rcf/user-stories/us-19801.json`: 5, 20, 26, 32, 38, 50
- `packages/rcf-lite/rcf/user-stories/us-19802.json`: 7, 20, 26, 32, 38, 44
- `packages/rcf-lite/rcf/user-stories/us-19804.json`: 20, 32
- `packages/rcf-lite/rcf/user-stories/us-2001.json`: 21
- `packages/rcf-lite/rcf/user-stories/us-202.json`: 55
- `packages/rcf-lite/rcf/user-stories/us-20301.json`: 20, 26, 32
- `packages/rcf-lite/rcf/user-stories/us-20302.json`: 20, 26, 38
- `packages/rcf-lite/rcf/user-stories/us-20303.json`: 20, 26, 38
- `packages/rcf-lite/rcf/user-stories/us-20503.json`: 17
- `packages/rcf-lite/rcf/user-stories/us-2101.json`: 21
- `packages/rcf-lite/rcf/user-stories/us-2301.json`: 21, 26, 31
- `packages/rcf-lite/rcf/user-stories/us-2401.json`: 19
- `packages/rcf-lite/rcf/user-stories/us-2501.json`: 25
- `packages/rcf-lite/rcf/user-stories/us-2601.json`: 22
- `packages/rcf-lite/rcf/user-stories/us-2701.json`: 26
- `packages/rcf-lite/rcf/user-stories/us-2801.json`: 26
- `packages/rcf-lite/rcf/user-stories/us-2901.json`: 29-31
- `packages/rcf-lite/rcf/user-stories/us-4001.json`: 25, 27, 34, 36
- `packages/rcf-lite/rcf/user-stories/us-4101.json`: 19, 21, 28, 30
- `packages/rcf-lite/rcf/user-stories/us-4201.json`: 19, 21
- `packages/rcf-lite/rcf/user-stories/us-4301.json`: 19, 21, 28, 30, 37, 39

Kept on purpose (alias text, old-form hints, recorded evidence):

- `.rcf/reports/blueprints/jobs-background/apply-time-override.json`: 7
- `.rcf/reports/blueprints/jobs-background/apply-time-refusal.json`: 7
- `packages/rcf-lite/rcf/verdicts/4a951317aaa8/test-strength.json`: 2010, 2018, 2106, 2114, 2128, 2136
- `packages/rcf-lite/rcf/verdicts/5a880f2f621e/review.json`: 45
- `packages/rcf-lite/rcf/verdicts/867586f0439a/review.json`: 49
- `packages/rcf-lite/rcf/verdicts/aab1ff072968/review.json`: 147
- `packages/rcf-lite/rcf/verdicts/dffd3be3ec40/test-strength.json`: 2010, 2018, 2106, 2114, 2128, 2136
- `packages/rcf-lite/rcf/verify-reports/FBS-218/aebff5f39e5c.json`: 226, 309, 315, 317, 321, 327, 434, 440, 446
- `packages/rcf-lite/rcf/verify-reports/FBS-219/1854b3f3e362.json`: 122
- `packages/rcf-lite/rcf/verify-reports/FBS-224/d2831515e789.json`: 76
- `packages/rcf-lite/rcf/verify-reports/FBS-227/3ca3055dcfbb.json`: 60, 77, 94, 111
- `packages/rcf-lite/rcf/verify-reports/FBS-227/3ca3055dcfbb/TS-260.tap`: 2, 9-10, 22, 27, 41, 46, 59-60, 66, 71, 78-79, 91
- `packages/rcf-lite/rcf/verify-reports/FBS-228/ad2dec6444dd.json`: 91, 108, 125
- `packages/rcf-lite/rcf/verify-reports/FBS-228/ad2dec6444dd/TS-260-2.tap`: 2, 9-10, 22, 27, 41, 46, 59-60, 66, 71, 78-79, 91
- `packages/rcf-lite/rcf/verify-reports/FBS-228/ad2dec6444dd/TS-260.tap`: 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-231/4ad896595b51.json`: 156, 162, 168
- `packages/rcf-lite/rcf/verify-reports/FBS-231/4ad896595b51/TS-265.tap`: 2-3, 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-231/78374787fcad.json`: 218, 224, 230
- `packages/rcf-lite/rcf/verify-reports/FBS-231/78374787fcad/TS-265.tap`: 2-3, 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-231/7b167d9704fa.json`: 196, 202, 208
- `packages/rcf-lite/rcf/verify-reports/FBS-231/7b167d9704fa/TS-265.tap`: 2-3, 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-231/95522fa467db.json`: 258, 264, 270
- `packages/rcf-lite/rcf/verify-reports/FBS-231/95522fa467db/TS-265.tap`: 2-3, 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-231/c9098c1f421e.json`: 444, 450, 456
- `packages/rcf-lite/rcf/verify-reports/FBS-231/c9098c1f421e/TS-265.tap`: 2-3, 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-231/d284cf9197b7.json`: 380, 386, 392
- `packages/rcf-lite/rcf/verify-reports/FBS-231/d284cf9197b7/TS-265.tap`: 2-3, 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-231/e3847af4319d.json`: 490, 496, 502
- `packages/rcf-lite/rcf/verify-reports/FBS-231/e3847af4319d/TS-265.tap`: 2-3, 8-9, 14-15, 20-21
- `packages/rcf-lite/rcf/verify-reports/FBS-232/ad2dec6444dd.json`: 34, 44, 64, 100, 103-104, 117, 120-121, 134, 151, 154-155, 168, 172, 178, 191, 208, 211-212, 225, 242, 263, 280, 297
- `packages/rcf-lite/rcf/verify-reports/FBS-232/ad2dec6444dd/TS-266.tap`: 2-3, 8-9, 20-21, 27-28, 33-34
- `packages/rcf-lite/rcf/verify-reports/FBS-232/ad2dec6444dd/TS-267-2.tap`: 2, 9-10, 22, 27, 41, 46, 59-60, 66, 71, 78-79, 91
- `packages/rcf-lite/rcf/verify-reports/FBS-232/ad2dec6444dd/TS-267.tap`: 2-3, 8-9, 20-21, 27-28, 33-34
- `packages/rcf-lite/rcf/verify-reports/FBS-232/ad2dec6444dd/TS-268-2.tap`: 2, 9-10, 22, 27, 41, 46, 59-60, 66, 71, 78-79, 91
- `packages/rcf-lite/rcf/verify-reports/FBS-232/ad2dec6444dd/TS-268.tap`: 2-3, 8-9, 20-21, 27-28, 33-34
- `packages/rcf-lite/rcf/verify-reports/FBS-233/900d6763aeb6.json`: 93, 280, 314-315, 501
- `packages/rcf-lite/rcf/verify-reports/FBS-233/900d6763aeb6/TS-269.tap`: 82-83
- `packages/rcf-lite/rcf/verify-reports/FBS-233/900d6763aeb6/TS-270.tap`: 82-83
- `packages/rcf-lite/rcf/verify-reports/FBS-233/900d6763aeb6/TS-271.tap`: 82-83
- `packages/rcf-lite/rcf/verify-reports/FBS-233/900d6763aeb6/TS-272.tap`: 82-83
- `packages/rcf-lite/rcf/verify-reports/FBS-234/900d6763aeb6.json`: 321, 355
- `packages/rcf-lite/rcf/verify-reports/FBS-235/900d6763aeb6.json`: 34, 44, 54, 64, 74, 84, 110, 114, 127, 131, 144, 161, 178, 195, 212, 229, 232-233, 246, 263, 267, 280, 283-284, 297, 314, 331, 348, 365, 382, 405, 422, 426, 439, 456, 460
- `packages/rcf-lite/rcf/verify-reports/FBS-235/900d6763aeb6/TS-276.tap`: 2-3, 8-9, 44-45, 57-58, 65-66, 122-123, 134-135
- `packages/rcf-lite/rcf/verify-reports/FBS-235/900d6763aeb6/TS-277.tap`: 2-3, 8-9, 44-45, 57-58, 65-66, 122-123, 134-135
- `packages/rcf-lite/rcf/verify-reports/FBS-235/900d6763aeb6/TS-278.tap`: 2-3, 8-9, 44-45, 57-58, 65-66, 122-123, 134-135
- `packages/rcf-lite/rcf/verify-reports/FBS-235/900d6763aeb6/TS-279.tap`: 2-3, 8-9, 44-45, 57-58, 65-66, 122-123, 134-135
- `packages/rcf-lite/rcf/verify-reports/FBS-235/900d6763aeb6/TS-280.tap`: 2-3, 8-9, 44-45, 57-58, 65-66, 122-123, 134-135
- `packages/rcf-lite/rcf/verify-reports/FBS-235/900d6763aeb6/TS-281.tap`: 2-3, 8-9, 44-45, 57-58, 65-66, 122-123, 134-135
- `packages/rcf-lite/rcf/verify-reports/releases/0.38.0.json`: 70, 134, 926, 953, 1043-1047
- `packages/rcf-lite/rcf/verify-reports/releases/0.39.0.json`: 69, 133, 902, 929, 1173-1177
- `packages/rcf-lite/rcf/verify-reports/releases/0.40.0.json`: 421-425
- `packages/rcf-lite/rcf/verify-reports/releases/0.40.1.json`: 496-500

Owner decision (data paths, MCP names, guidance topics, gate ids, module paths):

- `packages/rcf-lite/rcf/.identity/profile.md`: 7
- `packages/rcf-lite/rcf/adrs/adr-4121-define-sidecars.json`: 4, 9, 11-12, 20, 27
- `packages/rcf-lite/rcf/adrs/adr-4122-define-gates-blocking-and-optout.json`: 4, 10-11, 15
- `packages/rcf-lite/rcf/adrs/adr-4124-define-freeze-verb.json`: 4, 11
- `packages/rcf-lite/rcf/adrs/adr-4129-questions-harness-driven-loop.json`: 19
- `packages/rcf-lite/rcf/adrs/adr-4142-journey-record-rcf-lite-local.json`: 4
- `packages/rcf-lite/rcf/adrs/adr-4152.json`: 20
- `packages/rcf-lite/rcf/adrs/adr-4159.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-721.json`: 3, 5
- `packages/rcf-lite/rcf/code-nodes/cn-722.json`: 3
- `packages/rcf-lite/rcf/code-nodes/cn-724.json`: 3-5
- `packages/rcf-lite/rcf/code-nodes/cn-732.json`: 3
- `packages/rcf-lite/rcf/code-nodes/cn-754.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-756.json`: 3, 5
- `packages/rcf-lite/rcf/code-nodes/cn-757.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-761.json`: 3
- `packages/rcf-lite/rcf/code-nodes/cn-764.json`: 3-5
- `packages/rcf-lite/rcf/code-nodes/cn-766.json`: 3, 5
- `packages/rcf-lite/rcf/code-nodes/cn-767.json`: 3, 5
- `packages/rcf-lite/rcf/code-nodes/cn-780.json`: 5
- `packages/rcf-lite/rcf/code-nodes/cn-829.json`: 4
- `packages/rcf-lite/rcf/code-nodes/cn-955.json`: 3
- `packages/rcf-lite/rcf/code-nodes/cn-956.json`: 3
- `packages/rcf-lite/rcf/code-nodes/cn-957.json`: 3
- `packages/rcf-lite/rcf/code-nodes/cn-958.json`: 3
- `packages/rcf-lite/rcf/code-nodes/cn-959.json`: 3
- `packages/rcf-lite/rcf/define/decisions-ledger.json`: 365, 2995, 3047, 3066, 3072, 3091
- `packages/rcf-lite/rcf/fbs/fbs-194.json`: 16, 20, 26, 28
- `packages/rcf-lite/rcf/fbs/fbs-195.json`: 16, 20-21, 24, 26-28, 30
- `packages/rcf-lite/rcf/fbs/fbs-196.json`: 29, 32
- `packages/rcf-lite/rcf/fbs/fbs-197.json`: 22, 28, 30-31, 34
- `packages/rcf-lite/rcf/fbs/fbs-198.json`: 24-25, 29, 32-33, 35
- `packages/rcf-lite/rcf/fbs/fbs-199.json`: 40-41
- `packages/rcf-lite/rcf/fbs/fbs-200.json`: 26, 37
- `packages/rcf-lite/rcf/fbs/fbs-202.json`: 112, 121-126, 136, 143-144, 146-147, 153, 155-157, 159, 162, 167-168, 171-172, 175, 178, 185
- `packages/rcf-lite/rcf/fbs/fbs-210.json`: 18
- `packages/rcf-lite/rcf/fbs/fbs-211.json`: 19
- `packages/rcf-lite/rcf/fbs/fbs-212.json`: 18
- `packages/rcf-lite/rcf/fbs/fbs-213.json`: 19
- `packages/rcf-lite/rcf/fbs/fbs-214.json`: 5, 21
- `packages/rcf-lite/rcf/fbs/fbs-215.json`: 22
- `packages/rcf-lite/rcf/fbs/fbs-218.json`: 11
- `packages/rcf-lite/rcf/fbs/fbs-221.json`: 5
- `packages/rcf-lite/rcf/fbs/fbs-235.json`: 7
- `packages/rcf-lite/rcf/fbs/fbs-243.json`: 5
- `packages/rcf-lite/rcf/requirements/req-172.json`: 29
- `packages/rcf-lite/rcf/requirements/req-173.json`: 27, 29
- `packages/rcf-lite/rcf/requirements/req-174.json`: 7, 29
- `packages/rcf-lite/rcf/requirements/req-175.json`: 29
- `packages/rcf-lite/rcf/requirements/req-176.json`: 29
- `packages/rcf-lite/rcf/requirements/req-177.json`: 7, 29
- `packages/rcf-lite/rcf/requirements/req-178.json`: 29
- `packages/rcf-lite/rcf/requirements/req-179.json`: 29
- `packages/rcf-lite/rcf/requirements/req-180.json`: 29
- `packages/rcf-lite/rcf/requirements/req-181.json`: 29
- `packages/rcf-lite/rcf/requirements/req-182.json`: 7, 9, 21, 23
- `packages/rcf-lite/rcf/requirements/req-186.json`: 9, 23
- `packages/rcf-lite/rcf/requirements/req-187.json`: 9, 29
- `packages/rcf-lite/rcf/requirements/req-188.json`: 9, 23
- `packages/rcf-lite/rcf/requirements/req-189.json`: 10
- `packages/rcf-lite/rcf/requirements/req-202.json`: 4
- `packages/rcf-lite/rcf/requirements/req-203.json`: 10, 13
- `packages/rcf-lite/rcf/tacs/tac-4112-referee-finalise-verified-invariant.json`: 10, 13
- `packages/rcf-lite/rcf/tacs/tac-4120-define-delta-and-freeze.json`: 4, 9-10, 14
- `packages/rcf-lite/rcf/tacs/tac-4121-define-ledgers.json`: 4, 12, 18, 22
- `packages/rcf-lite/rcf/tacs/tac-4122-define-gates.json`: 4, 9, 12, 32, 34, 90
- `packages/rcf-lite/rcf/tacs/tac-4123-define-readiness.json`: 4, 18-19, 28, 83
- `packages/rcf-lite/rcf/tacs/tac-4124-define-freeze.json`: 4, 10, 13, 18, 20
- `packages/rcf-lite/rcf/tacs/tac-4125-build-bundle-refuse-override-skip.json`: 29
- `packages/rcf-lite/rcf/tacs/tac-4126-define-validate-findings.json`: 4, 18, 23
- `packages/rcf-lite/rcf/tacs/tac-4128-define-guidance.json`: 4, 12, 15-18, 23, 25, 28, 33, 35, 38, 40, 53, 55
- `packages/rcf-lite/rcf/tacs/tac-4129-define-questions.json`: 4, 14, 29, 34, 39
- `packages/rcf-lite/rcf/tacs/tac-4130-define-intake-brief.json`: 4, 12
- `packages/rcf-lite/rcf/tacs/tac-4142-discovery-journey-gate.json`: 4, 113, 118
- `packages/rcf-lite/rcf/tacs/tac-4148-test-stage-verify-finalise.json`: 26, 31
- `packages/rcf-lite/rcf/tacs/tac-4158.json`: 9, 20, 33
- `packages/rcf-lite/rcf/tad.json`: 59
- `packages/rcf-lite/rcf/test-suites/ts-214.json`: 47, 49, 56, 63, 70
- `packages/rcf-lite/rcf/test-suites/ts-215.json`: 81, 86, 88, 95, 102, 137, 144, 151, 158, 170
- `packages/rcf-lite/rcf/test-suites/ts-217.json`: 58
- `packages/rcf-lite/rcf/test-suites/ts-218.json`: 37, 67, 72
- `packages/rcf-lite/rcf/test-suites/ts-220.json`: 88
- `packages/rcf-lite/rcf/test-suites/ts-226.json`: 103, 105
- `packages/rcf-lite/rcf/test-suites/ts-228.json`: 59, 61, 66
- `packages/rcf-lite/rcf/test-suites/ts-231.json`: 4, 80, 101
- `packages/rcf-lite/rcf/test-suites/ts-232.json`: 21
- `packages/rcf-lite/rcf/test-suites/ts-234.json`: 21, 28, 35, 42, 49
- `packages/rcf-lite/rcf/test-suites/ts-235.json`: 45
- `packages/rcf-lite/rcf/test-suites/ts-237.json`: 41
- `packages/rcf-lite/rcf/test-suites/ts-254.json`: 27, 34, 36, 41
- `packages/rcf-lite/rcf/test-suites/ts-257.json`: 27
- `packages/rcf-lite/rcf/test-suites/ts-266.json`: 17, 24, 35, 38
- `packages/rcf-lite/rcf/test-suites/ts-267.json`: 20, 30
- `packages/rcf-lite/rcf/test-suites/ts-268.json`: 22, 29
- `packages/rcf-lite/rcf/test-suites/ts-269.json`: 23
- `packages/rcf-lite/rcf/test-suites/ts-270.json`: 25, 39
- `packages/rcf-lite/rcf/test-suites/ts-272.json`: 21
- `packages/rcf-lite/rcf/test-suites/ts-275.json`: 25, 39
- `packages/rcf-lite/rcf/test-suites/ts-276.json`: 36, 43, 50
- `packages/rcf-lite/rcf/test-suites/ts-277.json`: 19, 26
- `packages/rcf-lite/rcf/test-suites/ts-278.json`: 18, 29, 39, 50
- `packages/rcf-lite/rcf/test-suites/ts-279.json`: 24, 31, 38, 45, 52
- `packages/rcf-lite/rcf/test-suites/ts-280.json`: 18, 25
- `packages/rcf-lite/rcf/test-suites/ts-281.json`: 34
- `packages/rcf-lite/rcf/test-suites/ts-285.json`: 22, 43
- `packages/rcf-lite/rcf/test-suites/ts-293.json`: 17, 19, 21, 40, 42
- `packages/rcf-lite/rcf/test-suites/ts-294.json`: 42
- `packages/rcf-lite/rcf/test-suites/ts-295.json`: 17, 28, 35, 38
- `packages/rcf-lite/rcf/test-suites/ts-296.json`: 16, 30, 34
- `packages/rcf-lite/rcf/user-stories/us-16502.json`: 16
- `packages/rcf-lite/rcf/user-stories/us-17201.json`: 10, 25, 34
- `packages/rcf-lite/rcf/user-stories/us-17301.json`: 30, 34
- `packages/rcf-lite/rcf/user-stories/us-17302.json`: 89
- `packages/rcf-lite/rcf/user-stories/us-17401.json`: 75
- `packages/rcf-lite/rcf/user-stories/us-17402.json`: 55
- `packages/rcf-lite/rcf/user-stories/us-17403.json`: 60, 65
- `packages/rcf-lite/rcf/user-stories/us-17404.json`: 60-61
- `packages/rcf-lite/rcf/user-stories/us-17405.json`: 60-61
- `packages/rcf-lite/rcf/user-stories/us-17406.json`: 45-46
- `packages/rcf-lite/rcf/user-stories/us-17501.json`: 44
- `packages/rcf-lite/rcf/user-stories/us-17502.json`: 55
- `packages/rcf-lite/rcf/user-stories/us-17503.json`: 60
- `packages/rcf-lite/rcf/user-stories/us-17504.json`: 8, 40-41
- `packages/rcf-lite/rcf/user-stories/us-17601.json`: 25, 45, 50, 54
- `packages/rcf-lite/rcf/user-stories/us-17702.json`: 46
- `packages/rcf-lite/rcf/user-stories/us-17802.json`: 35
- `packages/rcf-lite/rcf/user-stories/us-17902.json`: 41
- `packages/rcf-lite/rcf/user-stories/us-18003.json`: 41
- `packages/rcf-lite/rcf/user-stories/us-18202.json`: 15, 20, 35
- `packages/rcf-lite/rcf/user-stories/us-18601.json`: 50
- `packages/rcf-lite/rcf/user-stories/us-18602.json`: 30, 45
- `packages/rcf-lite/rcf/user-stories/us-18603.json`: 40
- `packages/rcf-lite/rcf/user-stories/us-18701.json`: 40, 45
- `packages/rcf-lite/rcf/user-stories/us-18702.json`: 45
- `packages/rcf-lite/rcf/user-stories/us-18801.json`: 40
- `packages/rcf-lite/rcf/user-stories/us-18901.json`: 54, 72
- `packages/rcf-lite/rcf/user-stories/us-18905.json`: 18, 36, 63, 81, 90
- `packages/rcf-lite/rcf/user-stories/us-19003.json`: 4, 14, 26, 34, 38, 42
- `packages/rcf-lite/rcf/user-stories/us-20203.json`: 20, 38
- `packages/rcf-lite/rcf/user-stories/us-20301.json`: 9
- `packages/rcf-lite/rcf/user-stories/us-20302.json`: 9
- `packages/rcf-lite/rcf/user-stories/us-20303.json`: 9

</details>

<details><summary><b>Blueprints and probe packs</b>: 156 lines to change in 72 files (0 regenerated), 0 kept on purpose, 0 owner decisions</summary>

Change (rename, or regenerate where marked R):

- `blueprints/application-account-settings/README.md`: 8, 48, 52, 55, 72
- `blueprints/application-account-settings/contributions/user-stories/application-account-settings-us-25109.json`: 16, 23
- `blueprints/application-admin-console/README.md`: 8, 47, 51, 54, 61
- `blueprints/application-admin-console/contributions/user-stories/application-admin-console-us-21109.json`: 16, 23
- `blueprints/application-admin-console/guide/application-admin-console.md`: 43-44, 50
- `blueprints/application-api-rest/README.md`: 8, 11, 26
- `blueprints/application-api-rest/contributions/adrs/adr-304-application-api-rest-logging.json`: 10
- `blueprints/application-api-rest/guide/application-api-rest.md`: 7
- `blueprints/application-charts/README.md`: 8
- `blueprints/application-dashboard/README.md`: 8
- `blueprints/application-datatable/README.md`: 8
- `blueprints/application-empty-error-states/README.md`: 8
- `blueprints/application-error-handling/README.md`: 8
- `blueprints/application-error-handling/guide/application-error-handling.md`: 25
- `blueprints/application-file-upload/README.md`: 8
- `blueprints/application-forms-wizard/README.md`: 8
- `blueprints/application-notifications-in-app/README.md`: 8
- `blueprints/application-onboarding-tour/README.md`: 8
- `blueprints/application-onboarding-tour/guide/application-onboarding-tour.md`: 50
- `blueprints/application-spa/README.md`: 8, 11, 28
- `blueprints/application-spa/docs/topics.md`: 12
- `blueprints/application-spa/guide/application-spa.md`: 7
- `blueprints/delivery-ci-workflows/CHANGELOG.md`: 73-74
- `blueprints/delivery-ci-workflows/README.md`: 8, 11, 27
- `blueprints/delivery-ci-workflows/assets/ci-provider-examples/github-actions/pull-request-checks.yml`: 58
- `blueprints/delivery-ci-workflows/assets/report-samples/per-gate.json`: 3
- `blueprints/delivery-ci-workflows/contributions/adrs/adr-701-delivery-ci-workflows-ci-gates.json`: 9
- `blueprints/delivery-ci-workflows/contributions/requirements/delivery-ci-workflows-req-003.json`: 5, 13
- `blueprints/delivery-ci-workflows/contributions/requirements/delivery-ci-workflows-req-022.json`: 5
- `blueprints/delivery-ci-workflows/contributions/tacs/tac-701-delivery-ci-workflows-gate-runner.json`: 13, 29
- `blueprints/delivery-ci-workflows/contributions/tacs/tac-704-delivery-ci-workflows-workflow-materialiser.json`: 14
- `blueprints/delivery-ci-workflows/contributions/user-stories/delivery-ci-workflows-us-6103.json`: 9, 14, 17, 28-29
- `blueprints/delivery-ci-workflows/contributions/user-stories/delivery-ci-workflows-us-6104.json`: 14
- `blueprints/delivery-ci-workflows/contributions/user-stories/delivery-ci-workflows-us-6122.json`: 38
- `blueprints/delivery-ci-workflows/guide/delivery-ci-workflows.md`: 37, 106
- `blueprints/deploy-cloudflare-workers/README.md`: 8, 11, 27, 49, 71, 75
- `blueprints/deploy-cloudflare-workers/contributions/user-stories/deploy-cloudflare-workers-us-12114.json`: 15
- `blueprints/edge-cloudflare-access/guide/edge-cloudflare-access.md`: 154-155
- `blueprints/edge-cloudflare-rate-limiting/guide/edge-cloudflare-rate-limiting.md`: 68, 74
- `blueprints/email-smtp-resend/README.md`: 8, 11, 25, 45
- `blueprints/jobs-background/README.md`: 38, 65
- `blueprints/jobs-background/contributions/adrs/adr-3103-jobs-background-requires-applied-capabilities.json`: 9, 20
- `blueprints/jobs-background/contributions/probes/apply-time-override.mjs`: 4, 39, 80
- `blueprints/jobs-background/contributions/probes/apply-time-refusal.mjs`: 4, 92
- `blueprints/jobs-background/contributions/probes/run-apply-time-override.mjs`: 9
- `blueprints/jobs-background/contributions/probes/run-apply-time-refusal.mjs`: 10
- `blueprints/jobs-background/contributions/requirements/jobs-background-req-001.json`: 5
- `blueprints/jobs-background/contributions/user-stories/jobs-background-us-30101.json`: 14, 16
- `blueprints/jobs-background/contributions/user-stories/jobs-background-us-30107.json`: 9, 14, 16
- `blueprints/jobs-background/guide/jobs-background.md`: 24, 32, 39, 45
- `blueprints/messaging-queue-cloudflare/guide/messaging-queue-cloudflare.md`: 16
- `blueprints/object-storage-s3/contributions/requirements/object-storage-s3-req-006.json`: 5
- `blueprints/object-storage-s3/contributions/user-stories/object-storage-s3-us-28106.json`: 9, 14, 16, 28, 30
- `blueprints/object-storage-s3/guide/object-storage-s3.md`: 12, 15, 18-19, 22
- `blueprints/observability-essentials/README.md`: 12, 15, 30
- `blueprints/observability-logging/README.md`: 11, 14, 26, 36
- `blueprints/observability-logging/docs/topics.md`: 7
- `blueprints/observability-logging/guide/observability-logging.md`: 25
- `blueprints/observability-probe-endpoints/README.md`: 8, 11, 28
- `blueprints/persistence-data-d1/README.md`: 8, 11, 26, 50
- `blueprints/persistence-data-postgres/guide/persistence-data-postgres.md`: 10, 13
- `blueprints/persistence-data-sqlite/README.md`: 8, 11, 26, 50
- `blueprints/platform-cloudflare-cron-triggers/guide/platform-cloudflare-cron-triggers.md`: 36
- `blueprints/platform-cloudflare-durable-objects/guide/platform-cloudflare-durable-objects.md`: 37
- `blueprints/security-auth-clerk/README.md`: 11, 14, 33, 55
- `blueprints/security-auth-keycloak/README.md`: 11, 14, 32, 54
- `blueprints/security-auth-keycloak/docs/topics.md`: 24
- `blueprints/security-auth-magic-link/README.md`: 11, 14, 29, 49
- `blueprints/security-auth-oauth2/README.md`: 11, 14, 31, 53
- `blueprints/security-auth-oauth2/docs/topics.md`: 24
- `blueprints/security-secrets-management/README.md`: 8, 11, 26, 48
- `packages/rcf-lite/data/core-band-reservations.json`: 2

</details>


## Appendix B: method and confidence

- **Sweep.** `git grep -n -I -i -P '(?<![a-z])define(?![a-z])'` over ten pathspecs that partition the repository, run by a batch Codex sweep (read-only, one unit per pathspec), plus one unit over two consumer projects at their main heads. Each line got one class, in priority order: command, MCP name, data path, module, ambiguous, stage, history, English. Each command-like line also got an action: rename, regenerate, kept on purpose, or decide.
- **Completeness.** Every unit's raw hit count equals an independent `git grep` count over the same pathspec. The units sum to 6,795, the whole-repository count. The class counts in every unit sum to its raw hits.
- **Accuracy.** A random sample of 937 listed lines (at least 20 percent and at least 5 per unit) was checked against `git show HEAD:<file>`. Every sampled line exists at the stated line number and carries the token (937 of 937). 926 of 937 (98.8 percent) were classed correctly. The 11 misses were stage wording ("open-DEFINE", `define:` commit-prefix examples) classed as command or module, or an MCP name classed as module. A whole-set scan then found 14 `refused define:` lines (DEFINE-stage refusal) that two units had marked for rename. They are moved to owner decisions in the tables above. Expect the change counts to be about 1 percent high; no line was found missing.
- **Compatibility claims** checked by reading source at this head: init routing (`src/setup/agent-setup.js:308-319`), dispatch and old-form hints (`bin/rcf.js:156-234`), exact-name MCP lookup (`src/mcp/tools.js:1112, 1601`), and the consumer gate's exit-code and JSON-parse behaviour.

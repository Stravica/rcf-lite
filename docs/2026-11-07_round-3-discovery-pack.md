# rcf-lite round 3: DISCOVERY pack

**Date:** 2026-11-07
**Read against:** `release/0.41.0` at `d683322e` (one goldens-only commit past `65365d2a`, the head the review named; the five files that differ are test fixtures, so every finding below reads the same at either head). `main` is at `892bc858` and does not yet hold 0.41.0.
**Process:** RCF delivery 1.2.0 (round opens under 1.3.0 after the 0.41.0 publish).
**Status:** DISCOVERY only. Nothing here is a criterion until the owner rules it in (section 3 of the role file). No code, criteria or tests were changed to produce this document.

How this was read: `npm pack --dry-run --ignore-scripts --json` in `packages/rcf-lite` for the packed file list (349 entries), plus the repo-root `blueprints/*` directories that `scripts/stage-blueprint-shelf.mjs` copies in at prepack; criteria, suites and Code Nodes through `rcf define read` and `rcf audit trace`; the rest by grep over exactly that file set.

---

## 1. Candidates in one table

| # | Candidate, in plain words | Proof level | Why that level | Order |
|---|---|---|---|---|
| C1 | The shipped process text says what the role file says: rule 6 in the role file's 1.2.0 words, and test strength recorded by TEST, read by REVIEW | journey | The promise is "the text the package prints matches the process"; the proof is one cold run of `rcf guidance`, `rcf init` and `rcf build bundle` reading the printed text. There is no behaviour to mutate; a strength report on a text-match test says nothing | 1 |
| C2 | The four help-constant Code Nodes move to the function the criterion's behaviour runs through, so `rcf audit test-strength` can judge AC-20502-1/-3/-4/-5/-6 | full (unchanged) | These criteria already carry full level; the re-point is what lets the strength audit judge them. No new criterion: this is a 1.2.0 section 4.2 re-point, written by the builder | 2 |
| C3 | The privacy scan catches a cited development ruling of the shape `maintainer ruling <date>` | journey (AC-20501-3 as it stands) | A test correction, not a new criterion: AC-20501-3 already forbids "a quoted or cited development ruling"; the bound test's pattern needs `operator` or `stage-keeper` before the word and so misses `maintainer`. The pack-and-scan test is one end-to-end test over the real tarball | 3 |
| C4 | No packed file carries a developer's home directory or an internal specification path | journey | Same shape of proof as C3: the artefact is packed, unpacked and read file by file. Nothing in production code runs this; a Code Node sits on each cleaned file | 4 |
| C5 | No packed file names a consumer project, the consuming team or a developer's handle | journey | As C4. The largest clean-up (about 230 lines in about 60 files, one of them a fixture several view tests pin by name), so it goes last and may be the one the owner splits | 5 |

C3, C4 and C5 together are "the widened privacy scan". They are listed separately because the owner may rule them in at different speeds: C3 is a pattern fix on an existing promise; C4 and C5 widen the promise and need an owner ruling on meaning (rule 2, and 4.1 "a criterion's meaning is the owner's").

---

## 2. Finding 1: the privacy scan misses four classes

### 2.1 What the scan does today

AC-20501-3 (US-20501, REQ-205) is bound through TS-307 / `TC-307-no-packed-file-carries-development-chain` to `test/pkg/pack-privacy-0-41-0.test.js`. The test packs the real tarball, unpacks it, asserts the file list equals what `npm pack` listed, and reads every file line by line against seven patterns (`CHAIN`, lines 176 to 184):

| Kind | Pattern (as in the test) |
|---|---|
| a named operator, stage-keeper or reviewer | `\b(?:Dave\|Baz\|Barry\|Dex)\b` |
| a dispatch id | `\bd-\d{4}-\d{2}-\d{2}-\d{3}\b` |
| a work-item id | `\bw-\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*` |
| a lane job id | `\br-\d{8}-\d{6}-[0-9a-f]{4}\b` |
| a relay id | `\brelay\b[^\n]{0,40}\b<uuid>\b` |
| a verdict record | `"verdictVersion"\s*:\s*\d\|"scope"\s*:\s*"reviewVerdict"` |
| a quoted or cited development ruling | `\b(?:relay\|operator)\b[^\n]{0,80}\bverbatim quote\|\bruled by the operator\b\|\b(?:operator\|stage-keeper)(?:'s)? (?:rulings?\|decisions?\|constraints?),?\s+(?:of \|on \|\()?(?:\d{4}-\d{2}-\d{2}\|[A-Z]?\d+\b)` |

Nothing in the set names a home directory, a project path outside the package, a consumer, or a ruling attributed to anyone but "operator" or "stage-keeper". That is why all four classes below pass the scan.

### 2.2 The hits, located

**Class A: a cited ruling of the shape `maintainer ruling <date>`.** Eight lines, all in one blueprint. The review named the blueprint and its schema; the README, one requirement and one ADR carry it too.

| File (tarball path) | Line | Text |
|---|---|---|
| `blueprints/deploy-hetzner-server/blueprint.json` | 49 | "fsn1 (Falkenstein) is the shipped default per maintainer ruling 2026-09-07 09:50Z on the Q2 ratification." |
| `blueprints/deploy-hetzner-server/contributions/schemas/hetzner-server.schema.json` | 34 | "fsn1 is the shipped default per maintainer ruling 2026-09-07 09:50Z on the Q2 ..." |
| `blueprints/deploy-hetzner-server/contributions/requirements/deploy-hetzner-server-req-002.json` | 5 | description cites the ruling |
| `blueprints/deploy-hetzner-server/contributions/adrs/adr-3803-deploy-hetzner-server-provisioning-tool.json` | 8, 15 | context and rejectedBecause cite the ruling |
| `blueprints/deploy-hetzner-server/README.md` | 48, 88, 200 | "per maintainer ruling 2026-09-07", "(maintainer ruling 2026-09-07 09:50Z)" |

Why the scan misses it: the ruling pattern requires `operator` or `stage-keeper` immediately before `ruling`.

**Class B: internal specification paths.** Every one is under `projects/rcf-lite-wsd/`, a tree that exists only in the maintainers' estate.

| File | Line |
|---|---|
| `releases/releases.yaml` | 10 (`projects/rcf-lite-wsd/specs/update-awareness-spec-2026-08-28.md`, in the header comment) |
| `CHANGELOG.md` | 500, 587 (`.../specs/2026-10-01_define-step3-po-elicitation-spec.md`), 1183 (`.../specs/rcf-eval-node-spec-2026-09-04.md`) |
| `src/cli/doctor.js` | 274 (comment), 809 (a user-facing message: "Spec: projects/rcf-lite-wsd/specs/rcf-lite-probe-path-alignment-spec-2026-09-04.md section 9") |
| `src/cli/eval-coverage.js` | 4 |
| `src/query/eval-coverage.js` | 8 |
| `src/view/doc-renderers/architecture.js` | 34 (`projects/rcf-lite-wsd/wireframes/2026-10-02_architecture.html`) |
| `src/view/product-map.js` | 12 (`projects/rcf-lite-wsd/docs/2026-09-21_product-map-proposal.md`) |
| `blueprints/observability-essentials/docs/topics.md` | 15 |
| `blueprints/observability-essentials/README.md` | 7 |
| `blueprints/observability-probe-endpoints/guide/observability-probe-endpoints.md` | 84 |
| `blueprints/observability-probe-endpoints/docs/topics.md` | 9 |

Fourteen lines in eleven files. `src/cli/doctor.js:809` is the only one a user sees at runtime; the rest are comments, CHANGELOG prose and blueprint docs.

**Class C: a developer home path.** Exactly the two the review named.

| File | Line | Text |
|---|---|---|
| `src/core/fixtures/register-canary/canary-prompt-01.json` | 4 | `operatorPrompt` begins "...described in detail in this brief: /Users/thefoot/scratch/canary-brief.md" |
| `src/core/fixtures/register-canary/canary-prompt-03.json` | 4 | `operatorPrompt`: "...it's at /Users/thefoot/scratch/internal-search-prd.md" |

Not hits, and the widened pattern must stay clear of them: `src/feedback/redact.js:376-382` (comments using `/Users/john doe/work` as a worked example, a space in the user segment), `src/cli/version.js:236` (`~/.cache`, `~/Library/Caches`), and `blueprints/application-error-handling/.../us-16102.json:27` ("no /Users/, no /home/", no user segment). The pattern in 2.3 requires a user segment with no space followed by a further path segment, so none of these match.

**Class D: consumer project names, the consuming team and a developer handle.** Whole-word, case-sensitive counts over the pack set: `wespa` 90, `WESPA` 43, `Wespa` 5, `wsd` 51, `WSD` 29, `Backstory` 6, `backstory` 1, `thefoot` 2. About 230 lines in about 60 files. Where they sit:

| Area | Files (count of lines) | What the lines are |
|---|---|---|
| `src/view/test-host/fixture.js` | 50 | The "host fixture" that mimics a consumer's admin shell: file comment, `data-rcf-test-host="wespa"`, `<title>Wespa host fixture ...`, CSS classes `wespa-header`, `wespa-brand` and kin |
| `src/view/test-host/embed-client.js`, `lints.js` | 4, 3 | Same fixture, same names |
| `src/view/index.js`, `html-page.js`, `page-init.js`, `live-client.js`, `style.css`, `view-index.js`, `scope.js`, `doc-renderers/architecture.js`, `product-map.js` | 5, 3, 3, 2, 3, 1, 1, 1, 1 | Comments: "wespa #263", "wespa's proxy allow-list", "wespa host fixture" |
| `src/server/routes.js`, `src/server/index.js` | 6, 3 | Route comments naming the consumer's reverse proxy |
| `src/query/gates.js` | 3 | Comments: "false-positiving 345 of 532 ACs on WESPA", "the WSD AI tree" |
| `src/feedback/redact.js`, `destination.js`, `fingerprint.js`, `src/cli/feedback.js` | 4, 4, 2, 4 | Comments: "Backstory-product-brief.md ... the WSD round-trip"; `wsd` also appears as a library slug example |
| `src/blueprint/*.js`, `src/cli/blueprint*.js`, `src/cli/doctor.js`, `src/cli/eval-coverage.js`, `src/query/eval-coverage.js`, `src/query/delta.js`, `src/core/store/writer.js`, `src/verify/engine/brief.js` | 1 to 3 each | Comments; `writer.js:312` "legacy trees migrated in from WESPA v1"; `brief.js:24` "the slice-1 Backstory chains" |
| `src/core/fixtures/register-canary/canary-prompt-01.json`, `-03.json` | 1 each | The `thefoot` handle inside the class C paths |
| `guidance/discovery/discovery-viewer-command-page.md` | 23 | A discovery record written against two real trees, one of them the consumer's: "12 WESPA requirement...", "Operator inside WESPA", "a WESPA-sized tree: PRD-001 forward is 2,972 nodes" |
| `CHANGELOG.md` | 34 | Release prose: "WESPA main 34ebce...", "A consumer (WSD) reported", "WSD, wespa and other consumers run in CI", "the operator's WSD-lens dogfood", "Backstory-product-brief.md", "The WSD-handover release" |
| `releases/releases.yaml` | 7 | The same prose mirrored into the feed, lines 193, 209, 254, 284, 294, plus the class B line 10 |
| `blueprints/messaging-queue-cloudflare/*` | 6 across blueprint.json, adr-3002, topics.md, README.md | "WSD" as a decision source |
| `blueprints/observability-*`, `application-error-handling`, `application-api-rest`, `application-admin-console` | 1 to 2 each | `wsd` inside the class B spec paths or "WSD" as a source |
| `blueprints/security-auth-magic-link/assets/principal-registry-samples/allow-list-file.md` | 1 | "WESPA" in a sample allow-list |

Not in the set, and worth saying so: `WAIF`, `CodeOps`, `InfoSec`, `SPi`, `Solvians`, `Innovations Team` return nothing. `Stravica` and `stravica.ai` appear throughout as the publisher and are not consumer material.

### 2.3 The widened pattern set

Added to `CHAIN`, one entry per class, in the test's own shape (kind, regex):

```js
['a cited ruling of any named authority', /\b(?:maintainer|owner|operator|stage-keeper|reviewer)(?:'s)?\s+(?:rulings?|decisions?)\b[^\n]{0,24}?\b\d{4}-\d{2}-\d{2}\b/i],
['an internal specification or estate path',  /\bprojects\/[a-z0-9-]+\/(?:specs?|docs|wireframes|notes)\/|\bagents\/(?:dex|dave|barry)\/|\bstravica-(?:pa|library-[a-z]+)\b/],
['a developer home directory',                 /(?:^|[^A-Za-z0-9_.\/-])(?:\/Users|\/home)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]/],
['a consumer project, team or developer handle', /\b(?:WESPA|Wespa|wespa|WAIF|Waif|Backstory|backstory|CodeOps|InfoSec Recall|WSD|wsd|thefoot)\b/],
```

Notes on each: the ruling pattern keeps the existing rule that a ruling needs a date after it, so the product copy that tells an adopter to record "the operator's ruling" still does not match; the home-directory pattern needs a user segment with no space and a further segment, which clears `redact.js`'s `/Users/john doe` examples and the error-handling story's bare "no /Users/"; the consumer pattern is case-sensitive on the three spellings that occur, and `wsd` is included because the team name travels in `rcf-lite-wsd` and "WSD-lens". The first entry can replace today's third alternative of the ruling pattern rather than sit beside it.

### 2.4 Test shape

1. **One canary fixture per class**, under `test/pkg/fixtures/pack-privacy/`, each a short file holding one planted line of its class (a `maintainer ruling 2026-01-01` sentence; a `projects/rcf-lite-wsd/specs/x.md` path; `/Users/someone/scratch/brief.md`; a sentence naming a consumer). A unit-shaped test runs the `CHAIN` scan function over the four fixtures and asserts each is caught by exactly its own kind. This needs the scan loop lifted out of the test body into a function the test file exports or a `test/_harness/` helper; it stays test-side, no production path.
2. **A non-hit fixture** holding the three near-misses in 2.2 class C and the generic "operator's ruling" product copy, asserting zero hits. This is what keeps the widening from false-positiving the package's own guidance.
3. **The scan over the real pack list**, as today: pack, unpack, assert the file set equals `npm pack`'s listing, read every file. The existing assertion `hits.slice(0, 40)` is kept; the failure message already prints the per-file summary.
4. **Red proof at DEFINE:** the canary test is green on the fixtures (it tests the scan, not the package) and the real scan is red with the hit list above: at the 0.41.0 head the summary should read about 60 files. The test-author records the assertion text; the builder's job is the clean-up until the scan is green.
5. **Proof level journey**: the bound test is one end-to-end test over the real artefact. Code Nodes, as AC-20501-3 already has them (CN-1093 on `src/ruleset/ruleset.json`, CN-1096 to CN-1099 on the cleaned functions), go on each file the builder cleans; for comment-only cleans a file-level node on a source file would fail the strength audit (1.2.0 section 4.2), so the Code Node goes on the function whose comment changed, or on the fixture file for data files.

### 2.5 The clean-up, by file area (the BUILD)

| Class | Files the builder touches | Shape of the change |
|---|---|---|
| A | The five `blueprints/deploy-hetzner-server/` files above | Reword to "the shipped default; see the Q2 ratification note in the blueprint CHANGELOG" or carry the ruling in the blueprint's own CHANGELOG as a dated entry without the word "ruling" |
| B | `releases/releases.yaml:10`; `CHANGELOG.md:500, 587, 1183`; `src/cli/doctor.js:274, 809`; `src/cli/eval-coverage.js:4`; `src/query/eval-coverage.js:8`; `src/view/doc-renderers/architecture.js:34`; `src/view/product-map.js:12`; the four `blueprints/observability-*` lines | Replace the path with what the reader can reach: the release that shipped it ("the probe-path alignment of 0.14.x"), an issue number, or nothing. `doctor.js:809` is a user-facing message and should cite the blueprint's own `docs/topics.md` instead |
| C | `src/core/fixtures/register-canary/canary-prompt-01.json:4`, `-03.json:4` | Replace `/Users/thefoot/scratch/<file>` with a neutral path such as `./briefs/<file>`. Check `test/core/fixtures/register-canary.test.js`, `test/register-canary/runner.test.js` and `test/setup/playwright-checks.test.js`, which load these fixtures: none greps the path text (confirmed by grep for `thefoot`), so the change is production-side only |
| D, src comments | The `src/` files in 2.2 class D except the test-host fixture | "wespa" becomes "the consumer's admin shell" or "a consumer"; "WSD" becomes "a consumer" or "the operator's dogfood". Comment-only |
| D, test-host fixture | `src/view/test-host/fixture.js`, `embed-client.js`, `lints.js`; `src/server/routes.js` route comments | Rename the fixture's data attribute, title and CSS classes (`wespa-header` and kin) to a neutral name such as `host-shell`. Ten view tests pin the fixture by name (`test/view/shell-header.test.js`, `tabs.test.js`, `product-name-precedence.test.js`, `product-map.test.js`, `html-page.test.js`, `tree-model.test.js`, `layout-regression.test.js`, `integration.test.js`, `test/rcf-tree.test.js`, `test/cli/audit-test-strength-workspace.test.js`): the test-author rewrites those in DEFINE pass 1, because the builder may not touch a bound test |
| D, guidance | `guidance/discovery/discovery-viewer-command-page.md` (23 lines) | A dated discovery record. Reword "WESPA" to "a consumer tree of 532 criteria" and so on; the numbers stay, the name goes |
| D, history | `CHANGELOG.md` (34 lines), `releases/releases.yaml` (7 lines) | Reword in place ("a consumer", "a downstream product", "the operator's dogfood"). This is the one place the owner should rule explicitly: the CHANGELOG is a historical record and some would rather not rewrite it. If the owner keeps it as written, the scan needs an allow-list for the two files and the promise is weaker by exactly that; the pack recommends rewording, since the file ships |
| D, blueprints | `messaging-queue-cloudflare` (4 files), `security-auth-magic-link` sample, the `observability-*` and `application-*` lines | "WSD" as a decision source becomes "the maintainers"; the sample allow-list gets a fictional tenant name |

---

## 3. Finding 2: Code Nodes on help constants

Four Code Nodes point at exported string constants. `src/audit/test-strength/source.js#findDeclaration` classes a `const` initialised with a string as `other`, and `src/audit/test-strength/index.js:310-312` then reports `no mutable symbol <path>` for the node. 1.2.0 section 4.2 lets the builder move such a node, with no code change, to the function or class symbols in its own file that the criterion's behaviour runs through. Each file below declares at least one function, so none of the four is a removal.

| CN | Today | Criteria | Functions the file declares | Proposed re-point | Other nodes the criterion keeps |
|---|---|---|---|---|---|
| CN-1079 | `src/cli/finalise.js#HELP` | AC-20502-1, AC-20502-6 | `main` (line 118) | `src/cli/finalise.js#main` | AC-20502-1: CN-1074, CN-1076, CN-1077 (`src/finalise/light.js`), CN-1078 (`src/cli/finalise.js#main`). AC-20502-6: CN-1074, CN-1075 |
| CN-1081 | `src/cli/build.js#VERDICT_HELP` | AC-20502-3 | `verdictMain` (273, not exported), `main` (348), `classifyPositional`, `emitBundle`, `resolveOverrideBy`, `enforceBundleNextFreezeGate`, `emitNext`, `enforceBundleNextBackstop`, `runBackstopAdopt`, `amendScope`, `baseSuiteMain`, `emitToSink`, `runMark`, `emitClassifierSignal`, `latestBrowserVerification` | `src/cli/build.js#verdictMain` (the verdict verb's own entry; `findDeclaration` takes any top-level declaration, exported or not) | CN-1080 (`src/build/verdict.js#recordTestVerdict`) |
| CN-1083 | `src/cli/separation.js#HELP` | AC-20502-4 | `main` (144) | `src/cli/separation.js#main` | CN-1082 (`src/audit/separation.js#judgeRounds`) |
| CN-1084 | `src/cli/test-strength.js#HELP` | AC-20502-5 | `positive` (302), `main` (313) | `src/cli/test-strength.js#main` | none; this node must move, not go |

Two notes for the owner. First, CN-1079 re-pointed to `#main` sits on the same symbol as CN-1078; the alternative is to remove CN-1079 and add AC-20502-6 to CN-1078's `implementsAcIds`, which is a smaller tree but a Code Node edit with no matching code change on a node the round did not create, so 4.2 reads against it. The re-point is the safer reading. Second, the re-point is the builder's write "of a criterion the round touches": round 3 as scoped here does not otherwise touch AC-20502-1 to -6, so the owner either lists those five criteria as touched (for the re-point only; their bound tests are unchanged and already green) or rules the re-point a chain chore outside a round. The pack proposes the former, so the round's TEST strength record covers them and the result is on the record.

The failure itself was not re-run here: the clone carries no `node_modules`, and the installed 0.38.0 CLI predates the audit's 0.41.0 shape. The reading of the audit's source and the four node paths is the evidence.

---

## 4. Finding 3: rule 6 wording

**The package (six copies, identical).** `guidance/managed/agent-instructions-block.md:174-176`, `guidance/build-cycle.md:14` and `:28` (the DEFINE section's exit sentence), `guidance/build-cycle-playbook.md:29`, `guidance/harness-template.md:187-189`, and the bundle runbook's DEFINE stage at `src/build/bundle.js:287`:

> 6. **DEFINE exit.** Each new test is red at the DEFINE head with its failing assertion recorded, and the suite fails on exactly the new tests. No throwaway.

**The role file (RCF delivery 1.2.0, rule 6):**

> 6. **DEFINE exit.** From the named base-suite record, only the newly added or changed test cases fail at the DEFINE head, and each fails at its recorded assertion; an unrecorded baseline failure makes DEFINE BLOCKED. There is no throwaway implementation: the test-author proves red, and green is the builder's to prove.

The differences that matter: the role file measures "red" against the named base-suite record (the package says "exactly the new tests", which a pre-existing baseline failure would break for no reason of the round's); it covers changed tests, not only new ones; and it names the BLOCKED outcome. "No throwaway" is the same rule in both.

**Proposal:** align the package's copy to the role file's text. Only `agent-instructions-block.md` is edited by hand among the managed files; `scripts/gen-managed-artefacts.mjs` regenerates `agent-instructions-block.hash` and splices the block into `harness-template.md`. `build-cycle.md:14` and `:28`, `build-cycle-playbook.md:29` and `src/build/bundle.js:287` are separate hand edits.

**What this touches in the chain.** The package wording is pinned verbatim in three criteria: AC-20503-1 (rule 6 "verbatim" in the managed block), AC-20504-1 (the DEFINE section's exit "reads" the sentence) and AC-20504-2 (the bundle runbook gives DEFINE the rule 6 text). Their bound test `test/guidance/twelve-rules-0-41-0.test.js` holds the sentence as `RULE_6` (line 73) and `DEFINE_EXIT` (line 74). The change is therefore a DEFINE pass: the test-author amends the three criteria's quoted sentence (wording; the meaning, "the shipped text states rule 6 as the role file has it", is unchanged) and the two constants, and the test goes red until the builder changes the text in the six places. Goldens that would change: `test/build/fixtures/bundle-fbs-001.md:184`, `bundle-fbs-001.json:274`, `test/cli/fixtures/bundle-next-029-golden.md:55` (the runbook's DEFINE stage), and the viewer fixture `test/view/fixtures/phase-3-6-static.html` where the criteria render.

A managed-block change means consumers see `rcf doctor` report a stale block and the release note asks for `rcf init` again or `rcf doctor --fix`, as 0.41.0's did.

---

## 5. Finding 4: REVIEW still records strength

Under 1.1.0 the verifier records the strength report at TEST (role file 4.4 "What it runs": "Test owns test strength: it records the strength ..."), and the reviewer "runs it itself through the tool, read-only and unrecorded, on the touched criteria (the recorded copy is TEST's, 4.4)" (4.3 "What it reads"). The role file's rule 8 carries no sentence about recording. The package's text still gives the recording to REVIEW in every place it describes the stage:

| File | Line | Text today |
|---|---|---|
| `guidance/managed/agent-instructions-block.md` | 183 | rule 8: "Test strength is recorded for the reviewer's adequacy verdict." |
| `guidance/managed/agent-instructions-block.md` | 341-343 | the build loop: "REVIEW (`REVIEW:`) runs the scoped gate, `rcf audit separation` and `rcf audit test-strength --record`, and records `rcf build verdict review`." |
| `guidance/harness-template.md` | 196, 354-356 | the same two passages (spliced copy of the block) |
| `guidance/build-cycle.md` | 16 | rule 8, same sentence |
| `guidance/build-cycle.md` | 36 | REVIEW section: "`rcf audit test-strength --record` has recorded the structural and mutation report for the touched criteria ... Test strength is recorded for the reviewer's adequacy verdict: the report shows a gutted test whose mutants survive, and the reviewer judges it." |
| `guidance/build-cycle-playbook.md` | 126 | "Then `rcf audit separation --base <trunk>` ..., `rcf audit test-strength --record` records the structural and mutation report for the touched criteria (a report the reviewer reads; its result refuses nothing), and `rcf build verdict review ...`" |
| `src/build/bundle.js` (the bundle runbook, md and json) | 295 | REVIEW stage: "... and the test-strength audit, re-reads the diff ... Test strength is recorded for the reviewer's adequacy verdict; its result refuses nothing." |
| `src/build/bundle.js` | 298 | the REVIEW stage's command list carries `rcf audit test-strength --record` |
| `test/build/fixtures/bundle-fbs-001.md`, `bundle-fbs-001.json`, `test/cli/fixtures/bundle-next-029-golden.md` | 200, 296, 71 | goldens of the runbook REVIEW stage |

Nothing in these files gives TEST the record; `build-cycle.md:44` and the playbook's line 196 describe FINALISE requiring the record without saying who writes it, which is consistent with either reading.

**Proposal.** Rule 8 drops the recording sentence (as the role file's rule 8 has). The REVIEW passages say the reviewer runs `rcf audit test-strength` on the touched criteria read-only, no `--record`, and reads the report; the TEST passages gain "and `rcf audit test-strength --record` at the reviewed head, the record FINALISE requires". In `src/build/bundle.js` the `--record` command moves from the REVIEW list (line 298) to the TEST list, and the two stage descriptions change accordingly.

**What this touches in the chain.** AC-20504-2 pins "the REVIEW stage the line that test strength is recorded for the reviewer's adequacy verdict", tested at `test/guidance/twelve-rules-0-41-0.test.js:345, 391, 395` (`REVIEW_STRENGTH`). Moving the record to TEST changes what that criterion requires, not only its words, so it is the owner's: the pack reads the 1.1.0 ruling ("Test owns test strength") as already having decided it, and asks the owner to confirm that AC-20504-2's REVIEW clause is amended under that ruling rather than treated as a fresh meaning change. AC-20503-1 lists rule 8 only as "rule 8 REVIEW", so it is unaffected by dropping the sentence.

---

## 6. Order, and why

1. **C1 (findings 3 and 4 together).** One DEFINE pass, one BUILD, guidance text and `src/build/bundle.js` only, one managed-block regeneration. First because round 3's own hands read the managed block, the playbook and the runbook: a reviewer briefed from today's text will run `--record` and the verifier will not, and the round's FINALISE will then be fed a REVIEW-written record. Fixing the text before the hands that need it are dispatched is the cheapest version of this.
2. **C2 (the re-points).** Builder-only writes, no code change, five criteria listed as touched for the purpose. Second so the TEST strength record of round 3 is clean on them rather than carrying four "no mutable symbol" rows.
3. **C3 (the ruling pattern).** A pattern fix plus eight lines in one blueprint. A test correction to an existing promise, so it carries no meaning question.
4. **C4 (home paths and spec paths).** Sixteen lines in thirteen files, all mechanical; the only judgement is what to cite in place of the path.
5. **C5 (consumer names).** Last and largest: about 230 lines, a fixture rename that touches ten view tests, and the CHANGELOG question. If the round's budget looks tight at the open, this is the candidate to split: C5a src comments and the fixture rename (code and tests, one DEFINE pass), C5b guidance, CHANGELOG and releases feed (prose only, after the owner's CHANGELOG ruling).

C3, C4 and C5 share one bound test and one DEFINE pass (the widened `CHAIN`, the canaries and the non-hit fixture land together); they are separate rows so the owner can rule them in or out one at a time.

---

## 7. For the owner to rule, before the round opens

1. C4 and C5 widen AC-20501-3's meaning (or become a sibling criterion under US-20501). Which shape, and are consumer names in scope at all?
2. CHANGELOG and `releases/releases.yaml`: reword history in place, or allow-list the two files and accept the weaker promise?
3. AC-20504-2's REVIEW clause: amended under the 1.1.0 ruling, or a fresh ruling?
4. The five AC-20502 criteria listed as touched in round 3 for the Code Node re-point, or the re-point ruled a chain chore outside a round?

Everything else in this pack is a test correction or a wording change that keeps its criterion's meaning, and needs no ruling to proceed.

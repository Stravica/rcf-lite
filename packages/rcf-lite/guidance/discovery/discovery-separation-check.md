# Discovery: a mechanical separation check for build and test commits

Stage: DISCOVERY (design artefact only; no source, test or chain-document changes ride with it).

Written against `Stravica/rcf-lite` at origin/main b7f87af8 (0.34.2, 2026-10-16). Counts come from `git log` and the chain under `packages/rcf-lite/rcf/`. The process side (roles, gate template, brief templates) is a separate DISCOVERY held outside this repository.

What the reader needs first: RCF wants the hand that writes tests and acceptance criteria to differ from the hand that writes the code that makes them pass, so nobody marks their own homework. Today a person polices that by reading diffs; this record proposes a verb that does it.

Thesis: the smallest thing that holds is one deterministic verb, `rcf audit separation`, with default path classes, one commit trailer, one quotable line and exit 4, run in CI on pull requests. No git hook, no schema change, no network.

## 1. Problem

On a GBP 249 product built with rcf-lite (AI on Record), build hands repeatedly gamed their own tests: tests that read source text instead of running it, fixes special-cased to the reviewer's scenario. On 2026-10-16 delivery converged once authorship split: a spec-and-test hand wrote the failing tests and chain bindings, a different build hand changed only production code, and a judge confirmed the commit separation by reading the diffs by hand each round. Every round then merged at its first gate, in 25 to 35 minutes. The judging step is mechanical and should not need a reader.

## 2. Users and their questions

| Role | Question | Today |
|---|---|---|
| Owner | Did the builder touch the tests or criteria it is judged by? | A judge reads every diff |
| Gate reviewer | Is there a builder-edited test or criterion in this PR? | Re-derived from the diff; no line to quote |
| Build or test hand | Is anything I am pushing outside my lane? | No local check |
| Consumer operator | Can I adopt this without configuring anything? | Not applicable |

## 3. Current surface audit with counts

- PR gates, all in `.github/workflows/ci.yml`: `rcf define validate` (line 52), strict `rcf audit coverage` (54), `rcf audit eval coverage --strict` (56), register scan (62), consistency lint (74), `pnpm -r test` (79). None reads git history.
- Commit intent: none. `src/` parses no trailers or prefixes and installs no git hooks; git is called only for a remote, `user.email` and the branch (`src/cli/feedback.js:1144`, `src/cli/build.js:412`, `src/cli/finalise.js:302`). `rcf init` installs agent-harness hooks only (ADR-4108).
- Of 100 non-merge commits since 2026-10-01: 37 `feat`, 26 `fix`, 13 `test`, 12 `release`, 5 `define`; 57 touch production plus tests or criteria (classes as in 4b).
- Chain bindings: a Test Case carries `testPointer` (`file::testName`, resolved in `src/core/store/tp-resolve.js:112`); a Code Node carries `path` (`file#symbol`); chain families map to `rcf/` subdirectories (`src/core/store/ids.js:83`).
- The method: `guidance/build-cycle.md` has one pass build (stage 2, which also authors Code Nodes) and then write tests (stage 4). Since 2026-10-07 this repository's DEFINE PRs commit test declarations flagged todo and build PRs fill them (PR 342, then 343 to 348). Both conflict with strict separation.
- 24 of the last 30 merged PRs were squashed, so per-commit hands survive only on the PR branch.

## 4. Candidate capabilities ranked (design questions a to f)

**(a) How a commit declares its hand.** Options: a `Hand:` trailer (`test` covers tests and criteria, `build` covers production); a conventional prefix; one branch per hand; inference from paths. A prefix fails because `fix` serves both hands and `define` commits carry test declarations. A branch rule fails because both hands land in one PR. Pure inference cannot tell a build hand's test-only commit from a test hand's. **Recommendation:** trailer plus inference. A declared hand must agree with its paths; an undeclared commit is classified from its paths and passes when single-class; a mixed commit fails whatever it declares. `--require-hand` fails undeclared commits for repos that want it. The trailer is self-declared, so this is a tripwire for drift and honest mistakes, not proof of identity.

**(b) Path classification.** Test: `**/test/**`, `**/tests/**`, `**/__tests__/**`, `**/*.test.*`, `**/*.spec.*`. Criteria: chain documents under `rcf/`, including `rcf/define/` ledgers. Neutral: `rcf/code-nodes/`, `rcf/fbs/` and `rcf/manifest.json` (written by build-stage verbs and the view heartbeat), Markdown outside `rcf/`, the changelog, lockfiles, `.github/`. Production: everything else. Globs match at any depth, so monorepo packages work. Options: defaults only; a required per-repo config; derive from the chain. Derivation does not hold: Test Case pointers name 172 of 397 test files, Code Nodes name 109 of 278 `src/` files, and 24 Code Nodes point into `test/`. **Recommendation:** defaults needing no config, plus an optional override file under `rcf/`, which makes the override itself criteria-class so a build hand cannot reclassify its way out. The manifest belongs to rcf-schemas, so a local file follows ADR-4142; the name is settled at DEFINE.

**(c) A commit touching both classes.** Options: always fail; fail unless a recorded exception; allow named path pairs. **Recommendation:** fail, with one recorded override: `Hand: mixed` plus a non-empty `Separation-Reason:` trailer passes and is counted on the report line, the ADR-4131 posture (gates bite, the acknowledgement is recorded). It covers harness work (PR 363) and renames that cross classes.

**(d) Where it runs and what it exits with.** Options: a local verb; a pre-push hook; CI on pull requests; inside `rcf build finalise`. **Recommendation:** `rcf audit separation [--base <ref>] [--head <ref>] [--require-hand] [--json]`, renamed from the working name to fit `rcf <group> <verb>`; `audit` already holds strict coverage. The default range runs from the merge-base with `origin/main` to HEAD; merge commits are skipped. Exits 0 pass, 4 violation, 2 bad ref, 1 not a git repository, matching the CLI exit table. CI runs it on `pull_request` with `fetch-depth: 0`; never on `main` after a squash, where both hands share one commit, and not in finalise, which is post-merge. No hook in v1; the brief templates tell each hand to run the verb before pushing.

**(e) How a gate consumes it.** One line, quotable verbatim:

```
separation: FAIL 1 of 6 commits (base 1a2b3c4, head 5d6e7f8): 9f8e7d6 Hand=build touches test/x.test.js
separation: PASS 6 commits (base 1a2b3c4, head 5d6e7f8): test 3, build 2, neutral 1, undeclared 0, exceptions 0
```

**Recommendation:** the gate's "builder-edited test or criterion" blocker quotes this line from the CI log instead of re-reading diffs; `--json` carries one row per commit.

**(f) Sizing.** **Recommendation:** one module and one CLI handler; git and globs only; no LLM, network, `gh` or schema change. A GBP 249 product adds one CI line and one trailer line per brief; another layout adds one override file. Out of v1: identity binding, field-level FBS checks, chain-derived classes, hooks, post-merge audits.

## 5. Data already available vs needs computing

Available: commits, trailers and touched paths from `git log`; the exit table; the `--json` convention (`src/cli/coverage.js:188`). To compute: the range, each path's class, each commit's verdict. Nothing reads the chain.

## 6. Report shape

The line and `--json` rows in 4e; no viewer surface.

## 7. Risks

- Method conflict: on today's habits the check would fail 57 of 100 commits here. Mitigation: adoption is per repository, this repository adopts from DEFINE forward with no retroactive audit, and the build-cycle guidance change rides with the process DISCOVERY.
- A self-declared trailer can lie. Mitigation: said in the help; the gate stays the backstop.
- Squash merges and shallow clones erase or hide hands. Mitigation: pull-request runs with full history; exit 2 names a missing ref.
- The neutral class is wide: a build hand could edit an FBS `acIds`. Mitigation: a named v1 gap.

## 8. Open questions for Barry

1. Hand: trailer plus inference, mixed always failing, undeclared single-class passing (recommended); or a trailer required on every commit.
2. Mixed commits: fail with one recorded override (recommended); or fail with no override.
3. Placement: `rcf audit separation` in CI on pull requests, no hook in v1 (recommended); or a pre-push hook installed by `rcf init`.
4. Classes: defaults plus an optional override under `rcf/`, Code Nodes, FBS and manifest neutral (recommended); or a required per-repo config.
5. Posture: opt-in per repository, adopted here from DEFINE forward (recommended); or separation as the default build cycle in the same release.

## 9. Proposed DEFINE scope split into FBS-sized pieces

| FBS title | One-line goal | Order |
|---|---|---|
| `rcf audit separation` verb | Range, merge skip, default classes, trailer parse, verdicts, one line plus `--json`, exit codes | 1 |
| Override, exception and CI wiring | Override file, `Hand: mixed` with `Separation-Reason:`, `--require-hand`, a `pull_request` step in this repository's `ci.yml` | 2 |

Chain proposal: one REQ, one TAC (command and output line), ADRs for trailer plus inference, classes plus override, and pull-request-only placement. Brief statements from this record carry the source `discovery:separation-check`.

# Discovery: the viewer Readiness tab as the command page, with traceability on the page

Stage: DISCOVERY (design artefact only; no source changes ride with it).

Written against `Stravica/rcf-lite` at origin/main 138fa4a8 (0.32.3, 2026-10-07) and read against two real trees: rcf-lite's own chain (1,055 documents, unfrozen) and WESPA main 34ebceba (616 documents, unfrozen, the largest consumer) rendered through the 0.32.3 binary. Every count below comes from either `rcf define readiness --json` or the rendered Readiness panel HTML (the output of `renderModelToPage` in `src/view/index.js`, counted inside `#tab-readiness`).

What the reader needs before the RCF detail: the viewer is a read-only web page that renders a project's requirements tree. Its first tab, Readiness, answers two questions (is the requirements set ready for engineers, is the tree ready to build) by running eight checks called D1 to D8 and listing what fails. The same compute feeds the CLI verb `rcf define readiness`, so the tab and the terminal never disagree on the data; this document is about how that data is presented and what is missing around it.

Thesis: the Readiness tab already has the right numbers and the wrong shape. The two verdict cards work; everything beneath them is prose, cards or a dump.

The question cards carry no link and no write-back, and the one real table reads three of thirty-six checks. The "For engineers" row holds the whole engineer rendering, which on an unfrozen tree is dominated by a delta list that prints every document in the tree (616 rows on WESPA, 1,055 on rcf-lite's own chain) with a diff widget each. Beside it sit a Coverage block that prints blanks because it reads fields the coverage result does not carry, dead links on every composite id, and a Freeze button wired to nothing.

The command page is the same readiness object re-expressed as linked tables (questions, blocking items, thin requirements, coverage) with counts that are themselves links, plus three on-demand JSON routes that expose the pure trace, impact and coverage functions the CLI already calls, rendered as a coverage summary chart and a trace matrix for a chosen node. All of it stays server-rendered, GET-only, embed-safe and theme-tokened. The viewer is read-only: it never renders CLI commands, and it never writes. "Resolve in place" means "open the item in full context and surface what settles it in human terms", so every row carries the id, the plain-English ask or finding, where it lives on the chain, a link to the item in full context, and what a resolved state would look like.

Infographic sketches (static mocked pages, light theme, no external assets) sit beside this file:

- [1 Command page layout](./discovery-viewer-command-page-1-layout.html)
- [2 Coverage summary](./discovery-viewer-command-page-2-coverage.html)
- [3 Trace matrix for a selected node](./discovery-viewer-command-page-3-trace-matrix.html)
- [4 Questions and blocking items tables](./discovery-viewer-command-page-4-tables.html)

## 1. Problem

Barry, 2026-10-07, on the Readiness tab:

> [Readiness tab] at the moment - apart from the two key stage boxes, its scrappy/messy prose. The user has to try to translate it into the questions its supposed to be answering. E.g. "Questions for you" -> should be a list of the questions in a table perhaps, with a link to where those questions are and can be viewed in full context and/or resolved. If there are say insufficient ACs for a couple of REQs - I would expect to see these specified/listed and links to resolve/view them in place. The "For engineers" section is garbage - its like a scratchpad for the agent - its unhelpful to a human engineer. Lists, tables, counts, links - are whats needed on this whole page - it should serve as THE command page.

And on traceability:

> Part of the "sell" of RCF is its traceability. So far we barely demo/show that ability via the only exposed visible surface - the viewer. We should helpfully expose available/key query tools to the UI, as well as perhaps a full traceability scan on-demand with a nice chart and table-driven traceability/coverage report. This will help expose key parts of RCF - which helps understanding and adoption.

The command page in this project is the Readiness tab: the one screen where a product owner or an engineer sees what blocks the next step, opens each blocking item where it lives, and sees how far the chain from requirement to test actually reaches, with no agent in the loop and no terminal open.

## 2. Users and their questions

| # | Role | Question they bring | Current surface answer | The gap |
|---|---|---|---|---|
| 1 | Operator | Is my requirements set ready for engineers? | Verdict card "Ready for engineers: Yes / Not yet" with a question count (`po-layer.js` renderVerdictCards) | None on the verdict; the count is text, not a link to the list it counts |
| 2 | Operator | What do I have to answer, and where does each item live? | "Questions for you" cards: heading, ask, hint, collapsed engineer detail; grouped by source span | No link to the statement or requirement, no table, no write-back shown, no done state |
| 3 | Operator | Which requirements are thin? | "Requirements that still need work" table (REQ, what is missing, Open) fed by three checks only: `stories:reqHasUs`, `skeleton:reqIntent`, `skeleton:resolvedBy` | Stories missing criteria, criteria with no resolving test and D4 floor failures never reach it; 0 rows on both trees today |
| 4 | Operator | What happens if I answer these? | "What happens next" paragraph with two counts | Prose; the counts do not link anywhere |
| 5 | Engineer | What blocks the build, by id, and why? | Blocker cards inside the For-engineers row: stage, check, persona pill, up to 20 ids each with a "why" | Ids past 20 per card are cut (`readiness.js` renderBlockerCard slices to 20; `skeleton:reqShape` has 36 failing, `stories:usFloors` 498 on rcf-lite's chain); composite ids are dead links |
| 6 | Engineer | What is the next concrete edit? | Next-action line naming stage, check, ids and the re-check command | The command shown is the re-check, not the write-back; no copy control |
| 7 | Engineer | Which stages pass and what is each one's posture? | D1 to D8 chips with hover text; Stage guide dialog (one real table) | Good; per-stage pass/total only appears deep in the stage detail |
| 8 | Engineer | What changed since the freeze? | Delta block listing every changed, added or removed document with a hash diff widget | On an unfrozen tree the delta is the whole tree: 616 rows on WESPA, 1,055 on rcf-lite |
| 9 | Engineer | How much of the tree is covered by resolving tests? | Coverage block: tree column, delta column, re-verify and re-execute counts | Prints `pass / ` (blank) and "No per-REQ delta coverage" on every tree; the CLI line says `15/55 covered (strict)` for WESPA |
| 10 | Engineer | Which test pointers do not resolve? | Not on the tab; Product Map "Trace coverage" counts structure only | 12 WESPA requirements show Complete on the map while `rcf audit coverage` reports every chain under them unresolved (covered 15, covered-unresolved 12, uncovered 28) |
| 11 | Engineer | If REQ-001 changes, what has to be re-run or re-approved? | Nothing in the viewer; `rcf audit impact` in the CLI only (74 nodes, 138 edges for REQ-001 on WESPA) | Not exposed |
| 12 | Engineer, agent | Show me the chain from this requirement down to its tests |  (retiring) Per-requirement Mermaid slice under Requirements (REQ, US, AC, FBS); `rcf audit trace` in the CLI; the trace-matrix FBS in Section 9 retires this slice| Test suites, test cases and components are absent from the slice; no node picker; no matrix |
| 13 | Agent | What exact command answers each question? | `rcf define questions --json` carries `writeBack[].command` per question | Computed and folded onto the readiness object in `src/view/index.js`, never rendered |
| 14 | Operator inside WESPA | The same answers inside the admin SPA iframe | `?embed=1`, `?theme=`, relative asset URLs, SSE tab resync (0.32.0) all in place | Every new route must be added to the host's proxy allow-list (WESPA added `page-init.js` by hand for 0.29.0) |
| 15 | Engineer | Can I freeze now? | "Freeze now" button plus the `rcf define freeze` command text | The button has no handler anywhere in `page-init.js` and the server answers 405 to anything but GET and HEAD (`src/server/routes.js`) |

## 3. Current surface audit with counts

Method: the Readiness panel was rendered for both trees with the shipped code path and its sections counted with a script. Tree A is rcf-lite's own chain (register unstated, intent-complete no, 15 engineer checks blocking). Tree B is WESPA at 34ebceba under 0.32.3 (register engineer, intent-complete yes, ready-to-build no on D6 and D8).

### 3.1 Two verdict cards (`src/view/readiness/po-layer.js`, renderVerdictCards)

- Shape: two equal-height cards, a Yes / Not yet pill, one count line, the CLI verdict line in a code span, the chain term muted.
- Kinds of information: two verdicts, two counts, one chain term each.
- Actionable links: 0 (A and B).
- Items needing a resolve-in-context link: the two counts (they name a list the reader then has to find).
- Barry's rule: keep the cards; make each count the link into the table it counts.

### 3.2 Questions for you (renderQuestionCards, `question-adapter.js`, `phrasebook.js`)

- Shape: one card per question (Q badge, heading, ask, hint, a collapsed "Show the detail (engineer view)" line), grouped by source span, plus an optional dashed group for decisions with a default.
- Counts: A has 3 questions in 1 group (151 words, 10 paragraphs, 3 details, 0 tables, 0 links); B has 0 questions (30 words, 0 links).
- Kinds of information: question text, hint, stage and check id in the detail.
- Items needing a resolve link: all 3 on A; each already carries `writeBack[].command` in the readiness object (for example `rcf define ledger brief add --text "<text>"`) and `itemId` (profile:surface, brief-ledger), neither rendered.
- Barry's rule: this becomes a table: number, question, where it lives (link), what settles it, the ask in brief-your-agent form (id plus one-line ask, copyable), state. No CLI command rendered on the page.

### 3.3 What happens next (renderNextStep)

- Shape: one card, three short paragraphs.
- Counts: 53 words, 0 links (A and B).
- Kinds of information: the question count and the engineer item count restated.
- Items needing a link: both counts.
- Barry's rule: fold into the verdict cards as linked counts, or keep as one sentence; a paragraph that restates two numbers is not a panel.

### 3.4 Requirements that still need work (renderReqWorkTable)

- Shape: a real table (Requirement, What is missing, Open link to `#tab=requirements&entity=REQ-n`).
- Counts: 0 rows on A and 0 rows on B. Why 0: only three product-owner checks feed it, and on A the failing checks are engineer-persona (`skeleton:reqShape` 36 ids, `stories:usFloors` 498 ids) while on B nothing fails below D6.
- Kinds of information when populated: REQ id, one reason sentence, one link.
- Items needing a link: every thin requirement the other checks name.
- Barry's rule: the right shape, fed by too little. "Insufficient ACs" has no feed at all today; the nearest signals are D4 `stories:usFloors` per story, the Product Map "Missing AC scope" bucket for a story with zero criteria, and coverage `acs[].covered` for criteria with no resolving test.

### 3.5 For engineers (renderForEngineers, a collapsed DocRow carrying the full engineer body from `src/view/readiness.js`)

The row is collapsed unless the profile register is engineer; WESPA's register is engineer, so on the showhome tree it is open on first paint. Totals inside it: A 526 KB, 21,639 words, 3,172 paragraphs, 1,437 list items, 1,417 links of which 206 are dead; B 285 KB, 10,949 words, 1,855 paragraphs, 630 list items, 623 links of which 8 are dead. Dead means the href is a composite id (`#AC-060-3:userID`, `#profile:surface`, `#brief-ledger`, `#D6`, `#TAC-4122-define-gates:CHECK_PERSONA`, `#ledger:brief`) that `findByDocId` in `page-init.js` cannot find, so the router falls back to activating the Readiness tab and nothing moves. Sub-blocks:

| Block (readiness.js) | A | B | Notes |
|---|---|---|---|
| Tree line | 1 paragraph, 11 words | same | Fine |
| Verdict pills | 2 pills | same | Duplicates the cards above |
| Next action lines | 2 paragraphs, 2 live anchor links, 2 commands | 2 paragraphs, 1 link | The only working deep links on the page |
| D1 to D8 chips | 8 chips, hover text, click opens the stage guide | same | Fine; the pass/total per stage is not on the chip |
| Blockers by persona | 15 cards, 187 ids, 180 links (103 dead) | 2 cards, 3 ids, 3 links (3 dead) | Cards cap at 20 ids; on A, 16 and 478 ids are invisible on two cards |
| Delta | 1,055 rows, 8,440 diff fragments, 17,938 words, 449 KB (84 percent of the panel) | 616 rows, 4,928 fragments, 10,475 words, 259 KB | Every row reads "added, not in the frozen tree, sha256:..."; this is the scratchpad |
| Stage detail | 36 checks (21 ok, 15 fail), 187 ids | 36 checks (34 ok, 2 fail), 3 ids | Same ids as the blocker cards, listed a second time |
| Coverage | `pass / ` and "No per-REQ delta coverage." | identical | Defect: renderCoverage reads `t.pass`, `t.total`, `cv.reqId`; the coverage result carries `totals.{requirements, covered, coveredUnresolved, uncovered}` and `requirements[].id` (`src/query/coverage.js`). The object holds 119/119 on A and 15/55 on B |
| Decisions outstanding | "No open decisions." | same | Fine when empty; a list, not a table, when not |
| Freeze now | 1 disabled button, command text | same | No click handler exists; the server is GET and HEAD only |
| Freeze record | "No freeze record on disk." | same | A has no `rcf/define/` directory at all |

- Kinds of information across the row: verdicts, next actions, stage states, failing ids with reasons, delta ids with hashes, coverage counts (not shown), decisions, freeze state.
- Items needing a resolve link: every failing id (187 on A, 3 on B), every unresolved test pointer (94 on B, not shown), the two coverage counts.
- Barry's rule: nothing in this row is a table, and the delta is a 616-row list with no filter. The useful engineer content (failing ids with why, next command, coverage) is present but has to be dug out from under the delta.

### 3.6 Stage guide dialog (`stage-legend.js`)

- Shape: a dialog with one table (Stage, Name, What it checks, Posture), 8 rows, 238 words, 1 close button.
- Barry's rule: fine as is; it is the only part of the page that already matches the rule.

### 3.7 Summary across panels

| Panel | Words A / B | Tables | Links A / B (dead) | Items needing a resolve link | Verdict against "lists, tables, counts, links" |
|---|---|---|---|---|---|
| Verdict cards | 58 / 49 | 0 | 0 / 0 | 2 counts | Keep; link the counts |
| Questions for you | 151 / 30 | 0 | 0 / 0 | 3 / 0 | Rebuild as a table with write-backs |
| What happens next | 53 / 54 | 0 | 0 / 0 | 2 counts | Fold into the cards |
| Requirements that still need work | 44 / 44 | 1 (empty) | 0 / 0 | all thin REQs | Keep the shape, widen the feed |
| For engineers | 21,639 / 10,949 | 0 | 1,417 (206) / 623 (8) | 187 / 3 ids, 94 pointers, 2 counts | Retire the row; promote named tables |
| Stage guide | 238 / 238 | 1 | 0 / 0 | 0 | Keep |
| Whole panel | 22,184 / 11,365 | 1 (+1 in the dialog) | 1,417 / 623 | | |

## 4. Candidate capabilities ranked

Rank 1 is highest. Barry value is scored on reader clarity (C), operator action (A) and traceability demonstration (T), each H / M / L; cost is S (a day), M (a few days), L (a week or more, or a decision first).

| Rank | Capability | C | A | T | Cost | Evidence and notes |
|---|---|---|---|---|---|---|
| 1 | Questions for you as a sortable table: number, question, where it lives (link), what settles it, a copyable brief-your-agent handle (id plus one-line ask), state. No CLI command rendered on the page (Q1 ruling, Section 7). | H | H | L | M | `readiness.questions[]` already carries `itemId`, `context.sourceSpan`, `answerKinds`, `writeBack[].command` (`src/query/questions.js`); the brief handle is composed from `itemId` and the question ask, not from `writeBack[].command` |
| 2 | Blocking items table for engineers: one row per failing item (stage, check, id as a link, plain-English why, what resolved looks like), filterable by stage and persona, no 20-row cap. No command rendered on the page (Q1 ruling, Section 7). | H | H | M | M | `stages[].checks[].failing[]` has `{id, why}`; composite ids split on the first colon to a real document id plus a fragment |
| 3 | Coverage block fixed and promoted to a coverage summary: totals, per-requirement rows (covered / unresolved / uncovered), unresolved pointers with reason | H | M | H | S | `coverage.tree.totals`, `requirements[].coverageClass`, `unresolvedTestPointers[]` are already on the readiness object (`src/query/coverage.js`) |
| 4 | Thin requirements table widened: stories with zero criteria, criteria with no resolving test, D4 floor failures, each with a reason and an Open link | H | H | M | M | Map US ids to REQ via `reqId`; reuse `groupByTraceCoverage` buckets from `src/view/product-map.js` |
| 5 | Delta as counts with an on-demand list, never 616 rows on first paint | H | L | L | S | `delta.{changed, added, removed, briefSince, impacted, impactedFbs}` are counts already |
| 6 | Readiness verdict grid: D1 to D8 by scope (tree, delta), each cell pass/total with the failing count as a link into the blocking table | M | M | M | S | `checks[].over` is `tree` or `delta`; `pass` and `total` exist per check |
| 7 | On-demand full traceability scan: `./trace.json?id=&direction=`, `./impact.json?id=`, `./coverage.json` served from the current state, plus a report sub-view with a chart and a table | M | M | H | L | `computeTrace`, `computeImpact`, `computeCoverage` are pure and already imported by the CLI; the server has no JSON route for them yet |
| 8 | Trace matrix for a selected node (requirement to story to criterion to suite and case, with components and build specs as columns) | M | M | H | M | Needs 7; matrix chosen over sunburst (section 6.5) |
| 9 | Global "Trace" action on every id in every table (opens 8 with that pivot) | M | M | H | S | Once 7 and 8 exist, one link pattern |
| 10 | Impact view for a selected node, action label per row (re-run, re-verify, re-approve, re-execute) | L | M | H | M | `labelFor` in `src/query/impact.js`; defer to a second pass |
| 11 | Sub-tabs on Readiness: Overview, Questions, Blocking, Coverage, Trace | M | M | L | S | `SubTabStrip` component exists; the router already reads `sub=` for Build |
| 12 | Search integration: lookup modal hits on readiness rows, `#tab=readiness&sub=blocking&entity=<id>` | L | M | L | S | `./index.json` lookup (TAC-4132) and the hash router already handle `entity=` |
| 13 | Keyboard shortcuts beyond the existing Cmd or Ctrl+F lookup (row navigation, t for trace) | L | L | L | S | Defer; no evidence anyone asked |
| 14 | For engineers rewritten as named engineer items (missing coverage, failing checks by id, orphan interfaces, unresolved pointers) and the DocRow wrapper removed | H | H | M | included in 2, 3, 5, 6 | The content survives; the dump does not |
| 15 | Resolve in place as a write route (POST to a verb such as `rcf define update`) | H | H | L | L, decision first | Server is GET and HEAD only; the host's auth would gate it in WESPA; see question 1 |
| 16 | Freeze now: remove the dead button; show the state and what resolves it in human terms. No command text on the page (Q4 ruling, Section 7). | M | L | L | S | A dead control on the command page costs trust |
| 17 | Readiness state timeline (optional) | L | L | M | defer | Needs a persisted snapshot per rewalk; none exists |

## 5. Data already available vs needs computing

| Capability | Data source | Viewer compute carries it today | What to compute, and where |
|---|---|---|---|
| Questions table (1) | `src/query/questions.js` computeQuestions: `questions[].{id, stage, check, itemId, heading, ask, context.sourceSpan, answerKinds, writeBack[].command, blocks}`, `groups[]`, `optional[]` | Yes; `src/view/index.js` folds it onto `readiness.questions` | Nothing; render it. A "where it lives" link is `#tab=requirements&entity=<REQ>` for REQ items, `#tab=readiness&sub=questions&entity=<itemId>` for brief and profile items |
| Blocking items table (2) | `readiness.stages[].checks[].failing[].{id, why}`, `personas.engineer.blockers[].{stage, check, ids, failingCount, question}`, `nextAction.command` (`src/query/readiness.js`) | Yes | Nothing; drop the 20-id slice; split composite ids (`AC-060-3:userID` to `AC-060-3` plus `userID`) in a small helper under `src/view/readiness/` |
| Coverage summary (3) | `readiness.coverage.tree` (CoverageResult: `totals`, `requirements[].{id, coverageClass, acs[].{id, covered, testCases, unresolvedTestCases}}`, `unresolvedTestPointers[].{tsId, tcId, testPointer, reason}`) and `coverage.delta[]` one per requirement | Yes (686 KB of JSON on WESPA, already in memory per rewalk) | Per-family counts (requirements, stories, criteria, suites, cases) from `BuiltTreeModel` lengths; percentage covered from `totals`; a view-side fold only |
| Thin requirements (4) | D4 `stories:usFloors` failing US ids; `groupByTraceCoverage` buckets (missing stories, missing AC scope, missing component, missing tests) in `src/view/product-map.js`; coverage `acs[].covered` | Partly (checks yes, buckets computed for the Product Map on every rewalk) | Join US to REQ via `us.reqId`; one fold in a new `src/view/readiness/thin-reqs.js`; the Product Map bucket should take the resolution-gated class from coverage instead of counting structure (today 12 WESPA requirements read Complete there and unresolved in coverage) |
| Delta counts (5) | `readiness.delta` | Yes | Nothing |
| Verdict grid (6) | `stages[].checks[].{over, pass, total, ok}` | Yes | Group by stage and `over`; view-side |
| Trace walk REQ, US, AC, TS, TC, FBS (7, 8, 9) | `src/query/trace.js` computeTrace(tree, {id, direction, includeCode}) returning `nodes[].{id, kind, depth, title}` and `edges[].{from, to, kind}`; forward from an AC follows `tsByAcId`, `tcsByAcId`, `fbsByAcId`; FBS is a cross-link leaf; components are not in the walk (US `tacIds` is a view-side join via `usByTacId`) | No; the server keeps the walked tree in `state` but exposes no query route | A GET route per pivot in `src/server/routes.js` (`./trace.json?id=<id>&direction=forward|back|both`), computed from the current state and cached by `state.version`; the client renders the matrix. Full tree on WESPA: PRD-001 forward is 2,972 nodes, 6,337 edges, 1.5 MB as JSON, about half a second end to end from a cold CLI process including the tree walk, so per-pivot responses, not a whole-tree dump |
| Coverage walk, build-spec queue to criterion closure (3, 6) | D8 `freeze:acFbsOwnership` (every criterion owned by exactly one build spec), `model.fbsByAcId`, `computeQueue` in `src/build/queue.js`, `readiness.tree.{buildAt, fbsTotal}` | Partly (the check's pass/total and failing ids; the queue for the Build tab) | Per build spec: criteria owned, criteria with a resolving test, from `fbs.acIds` joined to coverage `acs[]`; view-side fold |
| Impact (10) | `src/query/impact.js` computeImpact(tree, {id}) returning `nodes[].{id, kind, role, actionNeeded}` | No | Route `./impact.json?id=<id>` alongside trace; same cache |
| Unresolved pointers (3) | `coverage.tree.unresolvedTestPointers[]` | Yes | Nothing; render with the reason text the CLI prints |
| Orphan interfaces, unsatisfiable tokens (2) | D6 failing ids of the form `TAC-x:interface` and `AC-x:token` | Yes | Composite-id split to link the owning TAC or AC |
| Acknowledged checks (grid) | `stages[].state` and `freezeRecord.gates[gate].reason` today; a sidecar if issue 303 lands | Yes for the state; reason from the freeze record | Read the reason from whichever seam lands; the grid follows `state` unchanged |

## 6. Chart and table proposals with a sketch each

Every colour below is a `--sv-*` token from `src/view/style.css`, never a raw value: `--sv-success` and `--sv-successbg` for passed or covered, `--sv-warning` and `--sv-warningbg` for acknowledged or unresolved, `--sv-danger` and `--sv-dangerbg` for failing or uncovered, `--sv-muted` for not applicable, `--sv-link` for row actions, `--sv-border`, `--sv-surface`, `--sv-raised` and `--sv-canvas` for structure. No Mermaid on the page; charts are inline SVG or CSS bars. Sketch 1 shows the whole page with the grid; sketch 4 shows both tables; sketch 2 the coverage summary; sketch 3 the matrix.

### 6.1 Readiness verdict grid (sketch 1)

What it shows: the eight stages as rows, the two scopes (tree, delta) as columns, each cell the pass/total of that stage's checks in that scope, coloured by the stage state, the failing count a link into the blocking table filtered to that stage. Data: `stages[].checks[]` grouped by `over`. Shape: a compact table above the fold, replacing the chip row and the stage detail.

```
Stage         Tree            Delta           State
D1 Brief      3/3   ok        18/18 ok        passed
D2 Skeleton   4/4   ok        127/127 ok      passed
...
D6 Consist.   1194/1194 ok    241/243  2 fail passed? no -> failing   [2 items]
D8 Freeze     6/7   1 fail    -               failing   [1 item]
```

### 6.2 Questions table (sketch 4)

What it shows: one row per question: number, the plain question, where it lives (a link to the statement, profile field or requirement), what settles it (the hint), a copyable brief-your-agent handle (id plus one-line ask, no command string), and a state column (open; answered appears after the next rewalk). Data: `readiness.questions[]` and `questionGroups[]`; the group label becomes a sortable column, not a heading. Shape: sortable by number, stage, group. Q1 ruling: no CLI command is rendered on the page.

```
#  Question                                   Where            Settles it            Brief for your agent (copy)       State
1  What is this project for?                  brief ledger     a document or text    brief-ledger: project purpose     open
2  Where will you look at what we produce?    profile:surface  pick one              profile:surface: viewing surface  open
```

### 6.3 Thin requirements table, including insufficient criteria (sketch 4)

- What it shows: one row per requirement that fails any of: no story, a story with zero criteria, a criterion with no resolving test, a story failing D4 floors, no plain description.
- Columns: requirement, stories, criteria, criteria with resolving tests, reason, Open link, Trace link.
- Data: `groupByTraceCoverage` buckets, coverage `requirements[].acs[]`, D4 and D2 failing ids.
- Shape: sortable, filterable by reason; the row count is the number the verdict card links to.

```
REQ      Stories  Criteria  Covered  Reason                                   Open   Trace
REQ-015  2        10        0        10 criteria have no resolving test       ->     ->
REQ-028  1        5         3        pointer does not resolve: file-missing   ->     ->
```

### 6.4 Coverage summary (sketch 2)

What it shows: counts per node family (requirements, stories, criteria, suites, cases, build specs) as a row of stat tiles, a stacked bar per requirement class (covered, covered-unresolved, uncovered) with the percentage covered, and a table of unresolved pointers with reason. Data: `coverage.tree.totals`, `requirements[].coverageClass`, `unresolvedTestPointers[]`, family counts from the tree model. Shape: tiles plus one horizontal stacked bar (CSS widths from the three totals) plus a table; on WESPA the bar reads 15 covered, 12 unresolved, 28 uncovered of 55.

```
[ 55 REQ ] [ 165 US ] [ 1121 AC ] [ 188 TS ] [ 1314 TC ] [ 128 FBS ]
Covered 27% |#########.......|.............| 15 covered  12 unresolved  28 uncovered
Unresolved pointers (94): TS-1003 TC-1003-ac-003-1-01  tests/rcf/api/US-003/...  test-missing
```

### 6.5 Traceability matrix for a selected node (sketch 3), chosen over a sunburst

- What it shows: for a chosen pivot (a requirement by default), rows are the stories and their criteria, columns are suites and cases, build specs and components; a cell is filled when the chain reaches it and coloured by resolution (resolving test, pointer unresolved, none).
- Node picker: reuses the lookup modal; the pivot can be any id.
- Data: `./trace.json?id=<pivot>&direction=forward` plus `usByTacId` for the component column and coverage `acs[]` for the cell colour.
- Why a matrix and not a sunburst: a sunburst of WESPA's PRD is 2,972 arcs and unreadable past a few hundred leaves, and it cannot show "reached but unresolved" without a second encoding. A matrix scales by filtering the rows and reads left to right in the same order as the chain (requirement, story, criterion, test), which is the sell. A sunburst can be offered later as a decorative overview; it is not the working view.

```
Pivot: REQ-001 Natural Language Query Processing        [Trace] [Impact] [Open]
                    TS-1001  TC-...-01  TC-...-02   FBS-012   TAC-002
US-001  AC-001-1    x        x(ok)      .           x         x
        AC-001-4    x        .          .           x         x      <- no resolving test
US-002  AC-002-1    x        x(unres)   .           x         x      <- pointer test-missing
```

### 6.6 Readiness state timeline (optional, named as such)

- What it would show: one point per rewalk (tree hash, time, intent-complete, ready-to-build, failing count per stage), so a team sees the tree move towards green over a week.
- Data: none persisted today; the server would have to append a line per rewalk under `.rcf/` (the per-clone runtime area the managed gitignore already covers, never `rcf/manifest.json`, per issue 236).
- Shape: a small line or step chart.
- Status: deferred; named here so the DEFINE scope can say no to it explicitly.

## 7. Risks

Decisions received since the brief are listed first; mitigations and open-risks follow.

### 7.1 Decisions received

- **Q1 ruled by Barry, 2026-10-07** (relay 9d3dd0a3-e7e5-4c6a-985e-c3962be38d4c, verbatim quote): "I meant provide the info they need to resolve with their agent. Keep the commands out of the view - the user isnt typing those commands - remember - the user operates their agent which uses these commands. Showing them here is little value." The viewer stays read-only, no CLI commands rendered on the page, no write route. Every row carries the item id, the plain-English ask or finding, the chain location (which REQ, US, AC, which gate), a link that opens the item in full context, and what resolved would look like. A per-row brief-your-agent handle (id plus plain-English ask, one line, copyable) is in scope as a design candidate for the wireframe at DEFINE; Barry rules on the render.
- **Q2 ruled** (delta on an unfrozen tree): counts only, on-demand expand.
- **Q3 ruled** (thin requirements table): list all three flavours (zero criteria, unresolved tests, D4 floor failures).
- **Q4 ruled** (freeze-now): no freeze button, no command text on the page; show the state and what resolves it in human terms.
- **Q5 ruled at DEFINE** (sub-tabs versus one long page): decided on the render; two HTML sketches (same data, both shapes) land in `guidance/discovery/` at DEFINE and Barry rules.
- **Admissibility note (F2)**: the proposed viewer trace, impact and coverage routes skip `runWithAdmissibilityGate` the same way `src/cli/coverage.js` and `src/cli/impact.js` do (issue 316 and 317 context), so the BUILD worker does not re-apply the gate and refuse on WESPA. The DEFINE TAC states the admissibility statement explicitly.
- **No Mermaid user-facing**: the per-requirement Mermaid trace slice (Section 2 row 12) is retired by the Trace-matrix FBS in Section 9. No new Mermaid lands on the viewer.
- **Full traceability scan (ex-Q6, F1 mitigation)**: on an unfrozen tree the scan is on-demand per pivot with the result cached client-side keyed by `state.version`; a whole-tree re-walk per rewalk would be 1.5 MB of JSON every 30 seconds on WESPA and is out of scope. Barry's framing already covers it ("full traceability scan on-demand").
- **For-engineers DocRow ruled (Dave 2026-10-07, Section 8 Q1)**: retire the wrapper. Section 3.5 described current state; the DEFINE build has no DocRow for engineers. Everything an engineer needs appears as rows in the tables (blocking check id, finding, location, link that opens the item, what resolves it). The Readiness-layout FBS in Section 9 lists `For-engineers retired` on its line already; this bullet is the ruling behind that.
- **Readiness timeline deferred (Dave 2026-10-07, Section 8 Q2)**: no snapshot log under `.rcf/` in this DEFINE cycle. Recorded as a later candidate in Section 9 (last row, `defer`); not in scope for this build. Reconsidered when the operator surface earns the persistence.

### 7.2 Open risks



- Embed-mode layout: the page cannot assume the title block, footer or theme control exist (`html[data-embed="1"]` hides them), and tables wider than the WESPA iframe will scroll the page horizontally, which the shell forbids. Mitigation: tables use the existing `.rcf-filterbar` sticky pattern, collapse to stacked rows under 720px, and the sub-tab strip stays inside the panel.
- Dark-theme contrast: `test/view/contrast-aa.test.js` enumerates every colour pair in both themes and fails the suite below 4.5:1 for text and 3:1 for boundaries, so any new chart colour that is not an existing `--sv-*` token on a known surface breaks the build. Mitigation: no new tokens in the first pass; bars and cells use `--sv-success`, `--sv-warning`, `--sv-danger` on `--sv-surface`.
- SSE resync (the issue 297 class): every `tree-update` replaces the whole of `#rcf-live-content`, so an on-demand scan rendered inside it is wiped on the next swap, which arrives about every 30 seconds while the heartbeat writes `rcf/manifest.json`. Mitigation: cache the scan result client-side keyed by `state.version` (the Product Map partial cache is the precedent), re-render after `rcfPage.init()`, and mark the result stale rather than dropping it.
- Heartbeat dirtying the tree (issue 236): any future write route would race the 30-second manifest write and would commit stale liveness fields if an agent commits meanwhile. Mitigation: no write route in the first build; if one lands, it must go through the CLI verbs and never touch the manifest.
- Full-scan performance on a WESPA-sized tree: PRD-001 forward is 2,972 nodes and 6,337 edges (1.5 MB of JSON), and `rcf define readiness --json` is 687 KB. Mitigation: per-pivot routes only, responses cached by tree version, the matrix capped at one requirement per view with a row filter, no whole-tree trace in the DOM.
- Ack verb shape (issue 303): a check parked by a future readiness-level ack must show as acknowledged with its reason, not as failing, and the grid must not hard-wire `freezeRecord.gates`. Mitigation: the grid reads `stages[].state` and asks one helper for the reason; the helper is the only place that changes when the sidecar lands.
- Backwards compatibility with the readiness compute signature: `computeReadiness(tree, {freeze, ledgers, profile, profileText, testPointers, validateErrors, resolvedPaths, probeRunner})` is shared by the CLI, freeze and the viewer, and the tab must not add arguments to it. Mitigation: every new fold lives under `src/view/readiness/` or as a new pure module in `src/query/`, and `renderModelToPage` keeps its return additive (as the issue 307 fix did).
- Freeze-record staleness after resolve-in-place: a write changes document hashes, so a frozen tree would show "changed" rows and D1 `brief:sinceFreeze` would bite on the next rewalk. Mitigation: the page re-renders on the SSE update after the write and the delta counts say so; this is correct behaviour and the design states it rather than hiding it.
- Tooling on the consumer laptop: `pnpm exec rcf` from `packages/rcf-lite/` resolves the globally installed 0.31.0 binary, not the clone, while `pnpm rcf` and `node bin/rcf.js` resolve 0.32.3. Mitigation: the hand-back names `pnpm rcf`; the pack's `pnpm exec rcf` wording wants a note.
- Where this document lives: the guidance pack ships in the npm package (`files` in `package.json` includes `guidance`) and is served to every consumer's agent over MCP and `rcf guidance`, and its tests require a manifest entry for every pack file. Mitigation: this stage adds the manifest entry so the suite stays green; the hand-back asks whether a project discovery doc belongs in the product's guidance pack or under the package docs.

## 8. Open questions for Barry

None open. Both remaining items (For-engineers DocRow; Readiness timeline) were ruled by Dave on 2026-10-07 and are recorded in Section 7.1. The deferred timeline is also captured in Section 9 as the final row.

## 9. Proposed DEFINE scope split into FBS-sized pieces

Order is the build order. Chain ids are proposals; the DEFINE stage mints them. Test estimates count new `node:test` cases.

| FBS title | One-line goal | Capabilities (section 4) | `src/view/` and `src/query/` files | Chain nodes added or edited | Est. tests | Order |
|---|---|---|---|---|---|---|
| Readiness tables: questions and blocking items | Replace the question cards and the blocker cards with two linked tables, composite ids resolved, no row cap, no CLI command rendered on the page (Q1); first-paint audience preserves the `profile.register` ordering WESPA relies on (product owner first unless the profile says engineer; folded from ex-Q10 per WESPA precedent) | 1, 2, 16 | `view/readiness.js`, `view/readiness/po-layer.js`, `view/readiness/question-adapter.js`, new `view/readiness/tables.js`, `view/style.css` | US under REQ-180 settled from the discovery draft statement, with criteria; TAC-4133 interfaces; new ADR "tables over prose, composite ids split on the first colon" | +12 in `test/view/readiness-tab.test.js` and `readiness-po-layer.test.js` | 1 |
| Coverage summary and thin requirements | Fix the blank Coverage block and promote it to the coverage summary; widen the thin requirements feed; align the Product Map trace bucket with resolution-gated coverage | 3, 4, 14 | `view/readiness.js` (renderCoverage), new `view/readiness/coverage-summary.js`, new `view/readiness/thin-reqs.js`, `view/product-map.js`, `view/style.css` | New US under REQ-180; TAC-4127 edit; new ADR "the viewer counts coverage the way the CLI does" | +10 in `test/view/readiness-tab.test.js` and `product-map.test.js` | 2 |
| Readiness layout: verdict grid, sub-tabs, delta counts, For-engineers retired | Grid above the fold, sub-tab strip with `sub=` in the hash, delta as counts, DocRow removed | 5, 6, 11, 14 | `view/readiness.js`, `view/components/sub-tab-strip.js` (use), `view/page-init.js` (readiness `sub=`), `view/style.css` | US under REQ-180; TAC-4133 edit; ADR-4127 edit (register orders, never hides) | +10 in `tabs.test.js`, `layout-regression.test.js`, `readiness-tab.test.js` | 3 |
| Query routes: trace, impact, coverage as JSON | Three GET routes computed from the current state and cached by version, relative paths, release-noted for proxy allow-lists | 7 (server half) | `src/server/routes.js`, `src/view/index.js` (state), `src/query/` unchanged | New US under REQ-002 (Visual review surface); new TAC "view query routes" or TAC-003 edit; new ADR "query routes are GET, per pivot, cached by version" | +8 in `test/view/cli.test.js` and `integration.test.js` | 4 |
| Trace matrix, trace actions, lookup integration (retires the per-requirement Mermaid slice) | Matrix sub-view for a selected node, a Trace action on every id, lookup hits land on readiness rows; the per-requirement Mermaid trace slice (Section 2 row 12) is removed in the same change | 8, 9, 12 | `view/page-init.js`, new `view/readiness/trace-matrix.js`, `view/components/entity-selector.js`, `view/style.css`, remove the per-REQ Mermaid render path in `view/requirements.js` | New US under REQ-180 or REQ-002; TAC-4132 edit; new ADR "matrix, not sunburst; no Mermaid user-facing" | +10 in `readiness-tab.test.js`, `id-lookup.test.js`, `wespa-host-fixture.test.js` | 5 |
| Impact view and keyboard shortcuts | Impact sub-view with action labels; row navigation keys | 10, 13 | `view/page-init.js`, new `view/readiness/impact-view.js` | New US; ADR as needed | +6 | defer |
| Readiness timeline | Snapshot per rewalk under `.rcf/`, small chart | 17 | `src/server/`, `view/readiness/` | New US; ADR on persistence | +6 | defer (Dave 2026-10-07, ex-Q2) |

Chain-first note for this PR: the discovery artefacts that fit the chain today are brief-ledger statements under `rcf/define/` (none exist on this tree yet; the ledger is created by the CLI on first add). A `[draft]` story was rehearsed and rejected for this PR: `rcf define create us` always writes one placeholder criterion (the schema requires at least one), and CI runs `rcf audit coverage` in strict mode, so a draft story with no resolving test turns REQ-180 uncovered and fails the build. The stories above are minted at DEFINE with their criteria and suites in the same change.

### 9.1 Query modules named in the brief but not in the DEFINE plan (F8)

- **gates**: folded. The admissibility gate stays as it is in the CLI (`src/cli/coverage.js`, `src/cli/impact.js`); the viewer routes bypass it the same way (Section 7.1 F2). No gates-specific FBS.
- **attestation**: deferred. Attestation is a separate build-cycle lane and does not touch the Readiness tab or the three viewer query routes; no FBS in this window.
- **eval-coverage**: deferred. Readiness coverage counts (Section 6.4) and the trace matrix (Section 6.5) cover the operator's and engineer's needs here; eval-coverage is a separate programme and does not land as its own FBS in this scope.
- **delta**: folded. On an unfrozen tree the delta is counts only with on-demand expand (Section 7.1 Q2), rendered as part of the Readiness layout FBS (order 3), not its own FBS.
- **questions**: folded. The computeQuestions path already exists (`src/query/questions.js`); the Readiness tables FBS (order 1) renders it as a table with the brief-your-agent handle. No new query module for questions.


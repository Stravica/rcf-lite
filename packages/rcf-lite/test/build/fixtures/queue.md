# Build queue: BS-001 - RCF Lite initial delivery

Generation strategy: dependencyFirst

| order | tier | id | title | status | state | blocked by |
|---|---|---|---|---|---|---|
| 1 | 0 | FBS-001 | Document store core | complete | complete |  |
| 2 | 1 | FBS-002 | Tree walk and validate command | complete | complete |  |
| 3 | 2 | FBS-003 | Diagram rendering | complete | complete |  |
| 4 | 2 | FBS-004 | HTML page rendering | complete | complete |  |
| 5 | 2 | FBS-005 | CLI read verbs | complete | complete |  |
| 6 | 3 | FBS-006 | CLI create and update verbs | complete | complete |  |
| 7 | 4 | FBS-007 | CLI delete with reference safety | complete | complete |  |
| 8 | 2 | FBS-008 | Coverage and trace queries | complete | complete |  |
| 9 | 3 | FBS-009 | Impact analysis | complete | complete |  |
| 10 | 3 | FBS-010 | Build adapter prompt assembly | complete | complete |  |
| 11 | 4 | FBS-011 | Mark-done on completion | complete | complete |  |
| 12 | 4 | FBS-012 | MCP server over the full surface | complete | complete |  |
| 13 | 0 | FBS-013 | Deploy-aware elicitation and hosting guidance | notStarted | actionable |  |
| 14 | 0 | FBS-014 | Local-preview default, runtime-honest verification, interim self-review | notStarted | actionable |  |
| 15 | 0 | FBS-015 | `rcf verify` group routing (0.10.0 CLI reorganisation) | complete | complete |  |
| 16 | 0 | FBS-016 | Blueprint verb family (add, list, remove, upgrade) with manifest.blueprints[] writes | notStarted | actionable |  |
| 17 | 1 | FBS-017 | Namespaced blueprint ids and scope:global ADR conflict surfacing | notStarted | blocked | FBS-016 |
| 18 | 0 | FBS-018 | Standards ingestion: rcf define standards add + reference-by-default | notStarted | actionable |  |
| 19 | 1 | FBS-019 | Selective retrieval at bundle assembly (contextRequirements.standardIds) | notStarted | blocked | FBS-018 |
| 20 | 0 | FBS-020 | Verify pins the Playwright MCP version | verified | verified |  |
| 21 | 0 | FBS-021 | Blueprints amend for e2e as a declared test level | verified | verified |  |
| 22 | 0 | FBS-022 | Doctor: playwright-present, browser-present, playwright-mcp-reachable, playwright-mcp-redundant | verified | verified |  |
| 23 | 0 | FBS-023 | Init: Playwright MCP entry only when no scope-visible entry exists | verified | verified |  |
| 24 | 0 | FBS-024 | Three-way compose test asserting no globalAdrTopic conflict on healthProbes or readinessSemantics across every ordering | verified | verified |  |
| 25 | 1 | FBS-025 | Compose test assertion 3: greppable no-literal-path invariant on the applied rcf/ tree | verified | verified |  |
| 26 | 2 | FBS-026 | Compose test assertions 4-9 covering the per-blueprint ratified alignment facts and the probe-path-owner doctor check | verified | verified |  |
| 27 | 3 | FBS-027 | `rcf define blueprint remove-resolution <adr-id>` verb (drops one manifest.resolutions[] entry; idempotent; refuses exit 2 on malformed or unknown id) | verified | verified |  |
| 28 | 4 | FBS-028 | observability-logging v1.0.0 shelf blueprint (contributions + README + guide + docs/topics.md + assets), applies clean into a fresh fixture | verified | verified |  |
| 29 | 5 | FBS-029 | application-error-handling v1.0.0 shelf blueprint (contributions + README + guide + docs/topics.md + assets); errorHandling topic distinct from errorEnvelope | verified | verified |  |
| 30 | 6 | FBS-030 | Loader accepts providesRoles[] and suggestedCompanions[] with shape validation + em-dash / emoji refusal on reason strings + paired-scope:global-ADR gate | verified | verified |  |
| 31 | 7 | FBS-031 | rcf define blueprint add prints resolved companion suggestions after apply; --companion selectors preflight-refuse non-providers; --no-companion-suggestions suppresses both phases; pins land in rcf/companions.json | verified | verified |  |
| 32 | 8 | FBS-032 | rcf define blueprint companions <slug>|set|unset sub-verbs (text output with origin annotations; --json envelope; set/unset round-trip; unset without pin refuses) | verified | verified |  |
| 33 | 9 | FBS-033 | Deterministic tier ladder resolver (applied > pinned > registered library > shelf); two-libraries-one-role refuses exit 3 with three-path resolution message on both add and companions verb; validate refuses unresolvable pin exit 3 | verified | verified |  |
| 34 | 10 | FBS-034 | Loader accepts standardsTrace[] + per-ADR recommendedDefault / elicited / standardsTraceClause; refuses missing standardsTraceClause when standardsTrace is declared; no cross-check on clause severity to kind (amendment A2) | verified | verified |  |

Totals: items 34 | notStarted 6 | inProgress 0 | complete 13 | verified 15 | actionable 4 | blocked 2

Parallel-safe tiers (items in the same tier have no dependency between them and can build in parallel):
- tier 0: FBS-001, FBS-013, FBS-014, FBS-015, FBS-016, FBS-018, FBS-020, FBS-021, FBS-022, FBS-023, FBS-024
- tier 1: FBS-002, FBS-017, FBS-019, FBS-025
- tier 2: FBS-003, FBS-004, FBS-005, FBS-008, FBS-026
- tier 3: FBS-006, FBS-009, FBS-010, FBS-027
- tier 4: FBS-007, FBS-011, FBS-012, FBS-028
- tier 5: FBS-029
- tier 6: FBS-030
- tier 7: FBS-031
- tier 8: FBS-032
- tier 9: FBS-033
- tier 10: FBS-034

Next actionable: FBS-013

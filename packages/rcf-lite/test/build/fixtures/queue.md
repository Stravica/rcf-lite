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

Totals: items 19 | notStarted 6 | inProgress 0 | complete 13 | verified 0 | actionable 4 | blocked 2

Parallel-safe tiers (items in the same tier have no dependency between them and can build in parallel):
- tier 0: FBS-001, FBS-013, FBS-014, FBS-015, FBS-016, FBS-018
- tier 1: FBS-002, FBS-017, FBS-019
- tier 2: FBS-003, FBS-004, FBS-005, FBS-008
- tier 3: FBS-006, FBS-009, FBS-010
- tier 4: FBS-007, FBS-011, FBS-012

Next actionable: FBS-013

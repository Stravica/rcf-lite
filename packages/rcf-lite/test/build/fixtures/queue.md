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
| 35 | 0 | FBS-035 | rcf-lite consumer wiring for the rcf-schemas 0.6.0 EVAL node (L1 audit / L2 verdict / L3 finalise / L4 define + judge) | notStarted | actionable |  |
| 36 | 0 | FBS-036 | Browser-verify runner extension: blueprint-shipped probe pack loader, scoping predicate, aggregate verdict and --probe-pack CLI | notStarted | actionable |  |
| 37 | 0 | FBS-037 | application-datatable v1.0.0 blueprint on the shelf: 22 contributions, Playwright probe pack with six anchored checks, sample-app fixture | notStarted | actionable |  |
| 38 | 0 | FBS-038 | application-charts v1.0.0 blueprint on the shelf: 15 contributions, Playwright probe pack with three anchored checks, sample-app fixture with negative-run switches | notStarted | actionable |  |
| 39 | 0 | FBS-039 | application-dashboard v1.0.0 blueprint on the shelf: 18 contributions, packaged design guidance, Playwright probe pack with three anchored checks, sample-app fixture with negative-run switches, pack-browser resize seam extension | notStarted | actionable |  |
| 40 | 0 | FBS-040 | application-notifications-in-app v1.0.0 blueprint on the shelf: 19 contributions, Playwright probe pack with three anchored checks, sample-app fixture with four break switches, and the family-prefix reservation across the shelf registry | notStarted | actionable |  |
| 41 | 0 | FBS-041 | Capability-declaration mechanism and four shelf auth blueprint 1.1.0/1.2.0 minor bumps | notStarted | actionable |  |
| 42 | 1 | FBS-042 | application-admin-console v1.0.0 blueprint on the shelf with capability-gated probe pack and sample-app fixture | notStarted | blocked | FBS-041 |
| 43 | 2 | FBS-043 | application-empty-error-states v1.0.0 blueprint on the shelf with the eight-state probe pack and sample-app fixture | notStarted | blocked | FBS-042 |
| 44 | 3 | FBS-060 | persistence-data-postgres v1.0.0 blueprint on the shelf with six Node-only probes against a live postgres:17-alpine container and a sample-app fixture | notStarted | blocked | FBS-043 |
| 45 | 3 | FBS-044 | application-file-upload v1.0.0 blueprint on the shelf with the four-check probe pack and sample-app fixture | notStarted | blocked | FBS-043 |
| 46 | 0 | FBS-061 | object-storage-s3 v1.0.0 blueprint on the shelf with six Node-only probes against MinIO plus one accountBound R2 smoke and a shared sample-app fixture (T-2 slice) | notStarted | actionable |  |
| 47 | 4 | FBS-045 | application-forms-wizard v1.0.0 blueprint on the shelf with the four-check probe pack and sample-app fixture | notStarted | blocked | FBS-044 |
| 48 | 5 | FBS-046 | application-account-settings v1.0.0 blueprint on the shelf with 5-check probe pack, sample-app fixture, four auth-blueprint minor bumps, observability-logging minor and mechanism minor for Q3 refusal | notStarted | blocked | FBS-045 |
| 49 | 6 | FBS-047 | application-onboarding-tour v1.0.0 blueprint on the shelf with 4-check probe pack, dependency-free sample-app fixture composing on dashboard notifications-in-app account-settings SPA and Q4 fallback (spa-local-storage) when no persistence blueprint is applied | notStarted | blocked | FBS-046 |
| 50 | 0 | FBS-062 | messaging-queue-cloudflare v1.0.0 blueprint on the shelf with six Node-only probes against wrangler dev plus one accountBound real-account concurrency smoke and a shared sample-app fixture (T-3 slice) | notStarted | actionable |  |
| 51 | 0 | FBS-063 | T-0 deploy-cloudflare-workers v1.2.0 minor bump: seven-contribution additive delta on the shipped v1.1.0 blueprint, cf-platform shared sample-app fixture, assets-manifest-scan probe module, anatomy test suite | notStarted | actionable |  |
| 52 | 1 | FBS-064 | jobs-background v1.0.0 blueprint on the shelf with five Node-only probes wired to the T-3 in-memory queue seam, a shared sample-app fixture extension carrying two toy jobs plus jobs-runtime plus scheduler, plus the CLI --allow-no-queue-yet flag and the queue-family sidecar-notes derivation on the T-5 mechanism (T-4 slice, post-#164 re-mint) | notStarted | blocked | FBS-062 |
| 53 | 0 | FBS-070 | T-1 platform-cloudflare-kv v1.0.0: 5 REQs 8 USs 3 TACs 3 ADRs, cf-platform fixture KV extension, 5 Node-only probes, anatomy test | notStarted | actionable |  |
| 54 | 0 | FBS-080 | T-2 platform-cloudflare-cron-triggers v1.0.0: 4 REQs 7 USs 10 ACs 3 TACs 3 ADRs, cf-platform fixture cron extension, 5 Node-only probes, anatomy test | notStarted | actionable |  |
| 55 | 0 | FBS-090 | T-3 platform-cloudflare-durable-objects v1.0.0: 8 REQs 10 USs 10 ACs 5 TACs 5 ADRs, cf-platform fixture DO extension, 7 Node-only probes, anatomy test | notStarted | actionable |  |
| 56 | 0 | FBS-100 | T-4 edge-cloudflare-access v1.0.0: 6 REQs 9 USs 9 ACs 4 TACs 4 ADRs, cf-edge fixture with JWT signer + JWKS, 5 Node-only probes + 1 wrangler-seam probe, anatomy test | notStarted | actionable |  |
| 57 | 0 | FBS-101 | T-4 application-admin-console v1.1.0 additive minor: consume zeroTrustGate optionally, Access-gated sign-in surface pack check AC-21815-1 on the existing application-admin-console.pack.mjs | notStarted | actionable |  |
| 58 | 0 | FBS-110 | T-5 edge-cloudflare-turnstile v1.0.0: 5 REQs 8 USs 8 ACs 3 TACs 3 ADRs, dedicated probe-pack-edge-cloudflare-turnstile fixture with pinned test sitekeys, 4 Node-only probes and 1 Playwright pack with 4 checks | notStarted | actionable |  |
| 59 | 0 | FBS-120 | T-6 edge-cloudflare-rate-limiting v1.0.0: 5 REQs, 8 USs, 8 ACs, 3 TACs, 4 ADRs, 4 Node-only probes; cf-edge fixture extended with rate-limit manifests, schema, drift-audit runner and induced-failure switches | notStarted | actionable |  |
| 60 | 0 | FBS-130 | T-1 deploy-hetzner-server v1.0.0: 6 REQs 9 USs 4 TACs 4 ADRs 6 Node-only probes; shared hetzner-throwaway-server fixture mint with provision/destroy/sweep-orphans and dry-run mock | notStarted | actionable |  |
| 61 | 0 | FBS-140 | T-2 platform-docker-compose-host v1.0.0: 6 REQs 9 USs 4 TACs 4 ADRs 5 Node-only probes; extend shared hetzner-throwaway-server fixture with compose stack, Caddyfile, secret file mount and healthchecked service | notStarted | actionable |  |
| 62 | 0 | FBS-150 | T-3 edge-cloudflare-tunnel v1.0.0: 5 REQs 8 USs 3 TACs 3 ADRs 5 Node-only probes; extend shared hetzner-throwaway-server fixture with cloudflared connector (compose-service and systemd-unit variants; access-gated and public-hostname sidecar modes) | notStarted | actionable |  |
| 63 | 0 | FBS-160 | Adapter object-storage-s3 v1.1.0 Hetzner Object Storage: minor bump adds hetznerObjectStorage provider; new hetzner-endpoint helper on the fixture side; new hetzner-object-storage-round-trip probe (accountBound gated on CI_HAS_HETZNER_OBJECT_STORAGE); MinIO round-5 T-2 probes and R2 smoke unchanged | notStarted | actionable |  |

Totals: items 63 | notStarted 35 | inProgress 0 | complete 13 | verified 15 | actionable 25 | blocked 10

Parallel-safe tiers (items in the same tier have no dependency between them and can build in parallel):
- tier 0: FBS-001, FBS-013, FBS-014, FBS-015, FBS-016, FBS-018, FBS-020, FBS-021, FBS-022, FBS-023, FBS-024, FBS-035, FBS-036, FBS-037, FBS-038, FBS-039, FBS-040, FBS-041, FBS-061, FBS-062, FBS-063, FBS-070, FBS-080, FBS-090, FBS-100, FBS-101, FBS-110, FBS-120, FBS-130, FBS-140, FBS-150, FBS-160
- tier 1: FBS-002, FBS-017, FBS-019, FBS-025, FBS-042, FBS-064
- tier 2: FBS-003, FBS-004, FBS-005, FBS-008, FBS-026, FBS-043
- tier 3: FBS-006, FBS-009, FBS-010, FBS-027, FBS-060, FBS-044
- tier 4: FBS-007, FBS-011, FBS-012, FBS-028, FBS-045
- tier 5: FBS-029, FBS-046
- tier 6: FBS-030, FBS-047
- tier 7: FBS-031
- tier 8: FBS-032
- tier 9: FBS-033
- tier 10: FBS-034

Next actionable: FBS-013

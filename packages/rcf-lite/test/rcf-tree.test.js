// Dogfood tree integrity tests. Validates every JSON file under rcf/
// THROUGH THE CORE VALIDATOR (`#core/store`) - the
// same code path `rcf validate` and the writers use - and asserts the
// referential integrity that D7 walker + D8 validator enforce
// structurally. Routing through the core validator (w-2026-07-28-005)
// means this gate carries the published @stravica-ai/rcf-schemas bundle
// PLUS the local strictness overlay (testPointer required on every Test
// Case), so the dogfood gate and the tool can never disagree: a
// pointerless TC the CLI refuses would fail here too, instead of
// sliding through a raw-schema check.
//
// Phase 3.7 shape (D1-D6, D14):
//   Every parent-child edge is encoded on the child. PRD no longer carries
//   requirementIds; each REQ carries prdId. TAD no longer carries
//   componentIds / architecturalDecisionIds; each TAC / ADR carries tadId.
//   BS no longer carries fbs[]; each FBS carries bsId + buildOrder +
//   executionStatus + dependsOnFbsIds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { knownKinds, validateDocument } from '#core/store';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const rcfRoot = resolve(repoRoot, 'rcf');

function classify(relPath) {
  if (relPath === 'manifest.json') return 'manifest';
  if (relPath === 'prd.json') return 'prd';
  if (relPath === 'tad.json') return 'tad';
  if (relPath === 'build-sequence.json') return 'buildSequence';
  if (relPath.startsWith('requirements/')) return 'req';
  if (relPath.startsWith('user-stories/')) return 'userStory';
  if (relPath.startsWith('tacs/')) return 'tac';
  if (relPath.startsWith('adrs/')) return 'adr';
  if (relPath.startsWith('fbs/')) return 'fbs';
  if (relPath.startsWith('test-suites/')) return 'testSuite';
  // Phase 10 (X2 CodeNode bridge): 11th document kind.
  if (relPath.startsWith('code-nodes/')) return 'codeNode';
  // rcf-schemas 0.6.0: EVAL doc subdir. Peer of test-suites/.
  if (relPath.startsWith('evals/')) return 'evalDoc';
  return null;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.json')) acc.push(full);
  }
  return acc;
}

function loadAll() {
  const files = walk(rcfRoot).sort();
  return files.map((full) => {
    const rel = relative(rcfRoot, full).split('\\').join('/');
    const kind = classify(rel);
    const json = JSON.parse(readFileSync(full, 'utf8'));
    return { full, rel, kind, json };
  });
}

const expectedCounts = {
  manifest: 1,
  prd: 1,
  // 0.7.1 packaging consolidation added REQ-009 (verify subcommand
  // routing) with US-901, TS-025, FBS-015 and CN-055..057.
  // Phase 1 blueprint mechanism (w-2026-08-18-016) added REQ-010 with
  // US-1001..1004, TS-026..029, FBS-016..019 and CN-058..068.
  // e2e contract (w-2026-09-03-dave-020) added REQ-011 with US-1101..1104
  // (four USs binding the four ratified commits of the e2e verification
  // contract spec). The USs deliberately ship without paired TS entries in
  // this train; the ACs are runtime-scope and covered by the shipped
  // code paths' own suites. See test/store/walker.test.js's expected-count
  // comment for the full rationale.
  // Core companions train (w-2026-09-03-dave-030) added REQ-013/014/015
  // for the two new core blueprints, companion-suggestion mechanism, and
  // standards-derived-blueprint discipline (12 -> 15).
  // rcf-eval-node train (w-2026-09-03-dave-005) added REQ-016 for the
  // rcf-lite consumer wiring around the rcf-schemas 0.6.0 EVAL node
  // (15 -> 16).
  // visual round T-0 (w-2026-09-04-dave-016) added REQ-017 for the
  // blueprint-shipped probe-pack runner extension (16 -> 17).
  // visual round T-1 (w-2026-09-04-dave-011) added REQ-018 for the
  // application-datatable v1.0.0 blueprint on the shelf (17 -> 18).
  // visual round T-2 (w-2026-09-04-dave-013) added REQ-019 for the
  // application-charts v1.0.0 blueprint on the shelf (18 -> 19).
  // visual round T-3 (w-2026-09-04-dave-012) added REQ-020 for the
  // application-dashboard v1.0.0 blueprint on the shelf (19 -> 20).
  // visual round T-4 (w-2026-09-04-dave-014) added REQ-021 for the
  // application-notifications-in-app v1.0.0 blueprint on the shelf (20 -> 21).
  // visual round T-5 (w-2026-09-04-dave-015) added REQ-022 for the
  // capability-declaration mechanism and REQ-023 for the
  // application-admin-console v1.0.0 blueprint on the shelf (21 -> 23).
  // visual round 4 T-1 (w-2026-09-06-dave-015) added REQ-024 for the
  // application-empty-error-states v1.0.0 blueprint on the shelf (23 -> 24).
  // visual round 4 T-2 (w-2026-09-06-dave-016) added REQ-025 for the
  // application-file-upload v1.0.0 blueprint on the shelf (24 -> 25).
  // Infra round 5 T-1 (w-2026-09-06-dave-020) added REQ-040 for the
  // persistence-data-postgres v1.0.0 blueprint (HQ reserved-block ruling:
  // round 5 mints from the reserved id block via --id, no next-id
  // racing with HQ's train) (25 -> 26).
  // Infra round 5 T-2 (w-2026-09-06-dave-021) added REQ-041 for the
  // object-storage-s3 v1.0.0 blueprint on the shelf with five Node-only
  // probes against a live MinIO container plus one accountBound R2
  // real-account smoke (26 -> 27).
  // visual round 4 T-3 (w-2026-09-06-dave-017) added REQ-026 for the
  // application-forms-wizard v1.0.0 blueprint on the shelf (27 -> 28).
  // visual round 4 T-4 (w-2026-09-06-dave-018) added REQ-027 (28 -> 29).
  // visual round 4 T-5 (w-2026-09-06-dave-019) added REQ-028 (29 -> 30).
  // Infra round 5 T-3 (w-2026-09-06-dave-022) added REQ-042 for the
  // messaging-queue-cloudflare v1.0.0 blueprint on the shelf with four
  // wrangler-dev-seam probes plus one accountBound real-account
  // concurrency smoke, minted with dex reserved-block chain ids
  // (30 -> 31).
  // Cloudflare round 6 T-0 (w-2026-09-06-dave-025) added REQ-029 and
  // REQ-030 for the deploy-cloudflare-workers v1.2.0 additive minor
  // bump (Workers-with-static-assets shape and SPA fallback
  // discipline) per HQ sequential chain-id block (31 -> 33).
  // Infra round 5 T-4 (w-2026-09-06-dave-023) added REQ-043 for the
  // jobs-background v1.0.0 blueprint on the shelf with five Node-only
  // probes wired to the T-3 in-memory queue seam and the CLI
  // --allow-no-queue-yet override for the T-5 mechanism (33 -> 34).
  // Cloudflare round 6 T-1 (w-2026-09-06-dave-026) added REQ-050..054
  // for the platform-cloudflare-kv v1.0.0 blueprint (reserved-block
  // per HQ ruling 2026-09-07T10:12Z: REQ-050..054 / US-5001..5401 /
  // TS-080..087 / FBS-070 / CN-230..234, all minted via --id).
  // Post-#163 merge on main: (34 -> 39).
  // Cloudflare round 6 T-2 (w-2026-09-06-dave-027) added REQ-060..063
  // for the platform-cloudflare-cron-triggers v1.0.0 blueprint
  // (reserved-block per HQ ruling 2026-09-07T12:25Z: REQ-060..063 /
  // US-6001..6302 / TS-090..096 / FBS-080 / CN-260..267, all minted
  // via --id) (39 -> 43).
  // Cloudflare round 6 T-3 added REQ-070..077 for the T-3
  // platform-cloudflare-durable-objects v1.0.0 blueprint (43 -> 51).
  // Cloudflare round 6 T-4 (w-2026-09-06-dave-029) added REQ-080..085
  // for the edge-cloudflare-access v1.0.0 blueprint plus REQ-086 for
  // the application-admin-console v1.1.0 additive minor riding the
  // same PR (round-4 T-4 capability-minor pattern), per HQ
  // reserved-block ruling 2026-09-07 (51 -> 58).
  // Cloudflare round 6 T-5 (w-2026-09-06-dave-030) added REQ-090..094
  // for the edge-cloudflare-turnstile v1.0.0 blueprint (client widget
  // mount, server-side siteverify verifier, refuse-if-token-missing
  // guard, magic-link composition hook, widget mode elicit) per HQ
  // reserved-block ruling 2026-09-07 (58 -> 63).
  req: 68,
  // w-2026-09-03-dave-021 spec amendment A2 added US-1204 (37) binding
  // the `rcf define blueprint remove-resolution` verb the spec section
  // 9 remedy names. Core companions train added US-1301/1302/1401..1404/1501
  // (37 -> 44).
  // rcf-eval-node train added US-1601 (44 -> 45).
  // visual round T-0 added US-1701 (45 -> 46).
  // visual round T-1 added US-1801 (46 -> 47).
  // visual round T-2 added US-1901 (47 -> 48).
  // visual round T-3 added US-2001 (48 -> 49).
  // visual round T-4 added US-2101 (49 -> 50).
  // visual round T-5 added US-2201 and US-2301 (50 -> 52).
  // visual round 4 T-1 added US-2401 (52 -> 53).
  // visual round 4 T-2 added US-2501 (53 -> 54).
  // Infra round 5 T-1 added US-4001 (derived from REQ-040 per HQ
  // reserved-block ruling) (54 -> 55).
  // Infra round 5 T-2 added US-4101 (derived from REQ-041 per HQ
  // reserved-block ruling) (55 -> 56).
  // visual round 4 T-3 added US-2601 paired with REQ-026 (56 -> 57).
  // visual round 4 T-4 (w-2026-09-06-dave-018) added US-2701 (57 -> 58).
  // visual round 4 T-5 (w-2026-09-06-dave-019) added US-2801 (58 -> 59).
  // Infra round 5 T-3 added US-4201 (derived from REQ-042 per dex
  // reserved-block ruling) (59 -> 60).
  // Cloudflare round 6 T-0 added US-2901 US-2902 paired with REQ-029
  // (SPA-on-Workers deploy, assets-directory elicitation) and US-3001
  // paired with REQ-030 (SPA fallback and migrate-from-Pages guidance)
  // per HQ sequential chain-id block (60 -> 63).
  // Infra round 5 T-4 added US-4301 (derived from REQ-043 per dex
  // reserved-block ruling) (63 -> 64).
  // Cloudflare round 6 T-1 added US-5001..5401 (8 USs derived from
  // REQ-050..054 per HQ reserved-block ruling) (64 -> 72).
  // Cloudflare round 6 T-2 added US-6001..6302 (7 USs derived from
  // REQ-060..063 per HQ reserved-block ruling 2026-09-07T12:25Z)
  // (72 -> 79).
  // Cloudflare round 6 T-3 added US-7001, US-7002, US-7101,
  // US-7201, US-7301, US-7401, US-7402, US-7501, US-7601 and
  // US-7701 per HQ reserved-block ruling 2026-09-07 (79 -> 89).
  // Cloudflare round 6 T-4 added US-8001..8003 (three USs on REQ-080),
  // US-8101 (REQ-081), US-8201 (REQ-082), US-8301 (REQ-083), US-8401
  // (REQ-084), US-8501..8502 (REQ-085), US-8601..8602 (REQ-086) per
  // HQ reserved-block ruling 2026-09-07 (89 -> 100).
  // Cloudflare round 6 T-5 added US-9001, US-9002, US-9101, US-9102,
  // US-9201, US-9301, US-9302, US-9401 derived from REQ-090..094 per
  // HQ reserved-block ruling 2026-09-07 (100 -> 108).
  userStory: 116,
  tad: 1,
  // Cloudflare round 6 T-4 added TAC-3501..3504 (Access JWT validator,
  // application declaration, policy shape, audit sink) plus TAC-2214
  // (admin-console v1.1.0 Access-gated sign-in surface) (8 -> 13).
  // Cloudflare round 6 T-5 added TAC-3601 (Turnstile widget mount),
  // TAC-3602 (server-side siteverify verifier + refuse-if-token-missing
  // guard) and TAC-3603 (composition hook into security-auth-magic-link
  // mint surface) per HQ reserved-block ruling 2026-09-07 (13 -> 16).
  tac: 19,
  // fbs bumps 19 -> 23 for FBS-020..023 covering the four US-1101..1104
  // AC sets. See test/store/walker.test.js's expected-count comment.
  //
  // codeNode bumps 69 -> 73 for CN-070..073 anchoring:
  //   CN-070: src/verify/engine/launcher.js#PLAYWRIGHT_MCP_VERSION
  //   CN-071: test/blueprint/apply-spa-v1-4-0-schema.test.js (test-anchor)
  //   CN-072: src/setup/playwright-checks.js#loadBrowserFacingSources
  //   CN-073: src/cli/init.js#runPlaywrightMcpPass
  // Phase 3.5 rev-3 (w-2026-08-19-008): ADR-010 records the topic-
  // as-free-label-lookup-key decision (Baz ruling, camelCase canonical
  // on shipped blueprints).
  // Cloudflare round 6 T-4 added ADR-3501..3504 (JWT gate scope global
  // on new topic edgeAuthenticationGate, identity provider elicited,
  // policy scope, audit retention delegated) plus ADR-2214 (admin-console
  // v1.1.0 reads zeroTrustGate at apply-time, scope global on new topic
  // adminConsoleSignInSurface) (10 -> 15).
  adr: 22, // Cloudflare round 6 T-5 added ADR-3601 (verifier contract, scope global on new topic humanVerificationGate), ADR-3602 (widget mode elicit enum) and ADR-3603 (refuse-if-token-missing 400 with error-code body) per HQ reserved-block ruling 2026-09-07 (15 -> 18).
  buildSequence: 1,
  // FBS-027 covers the remove-resolution verb (US-1204). Core companions
  // train added FBS-028..034 (7 FBSs, one per US on REQ-013/014/015).
  // rcf-eval-node train added FBS-035 (34 -> 35).
  // visual round T-0 added FBS-036 (35 -> 36).
  // visual round T-1 added FBS-037 (36 -> 37).
  // visual round T-2 added FBS-038 (37 -> 38).
  // visual round T-3 added FBS-039 (38 -> 39).
  // visual round T-4 added FBS-040 (39 -> 40).
  // visual round T-5 added FBS-041 covering US-2201 and FBS-042
  // covering US-2301 (40 -> 42).
  // visual round 4 T-1 added FBS-043 covering US-2401 (42 -> 43).
  // visual round 4 T-2 added FBS-044 covering US-2501 (43 -> 44).
  // Infra round 5 T-1 added FBS-060 covering US-4001 per HQ
  // reserved-block ruling (44 -> 45).
  // Infra round 5 T-2 added FBS-061 covering US-4101 per HQ
  // reserved-block ruling (45 -> 46).
  // visual round 4 T-3 added FBS-045 covering US-2601 (46 -> 47).
  // visual round 4 T-4 (w-2026-09-06-dave-018) added FBS-046 (47 -> 48).
  // visual round 4 T-5 (w-2026-09-06-dave-019) added FBS-047 buildOrder 49 (48 -> 49).
  // Infra round 5 T-3 added FBS-062 covering US-4201 per dex
  // reserved-block ruling (49 -> 50).
  // Cloudflare round 6 T-0 added FBS-063 covering the eight ACs
  // AC-2901-1..3 AC-2902-1..2 AC-3001-1..3 (50 -> 51).
  // Infra round 5 T-4 added FBS-064 covering US-4301 per dex
  // reserved-block ruling; buildOrder 52 (next-free after FBS-063 at
  // 51). Originally minted as FBS-063 pre-#164; re-minted as FBS-064
  // via `rcf define create fbs --id` after HQ round-6 T-0 consumed
  // the original id (51 -> 52).
  // Cloudflare round 6 T-1 added FBS-070 covering the 10 T-1 ACs (52 -> 53).
  // Cloudflare round 6 T-2 added FBS-080 covering the 10 T-2 ACs
  // (buildOrder 54, next-free after FBS-070 at 53) (53 -> 54).
  // Cloudflare round 6 T-3 added FBS-090 (buildOrder next-free
  // after FBS-080 at 54) (54 -> 55).
  // Cloudflare round 6 T-4 added FBS-100 (edge-cloudflare-access v1.0.0
  // buildOrder 56) and FBS-101 (application-admin-console v1.1.0
  // buildOrder 57) (55 -> 57).
  fbs: 59, // Cloudflare round 6 T-5 added FBS-110 (edge-cloudflare-turnstile v1.0.0) with buildOrder 58 per HQ reserved-block ruling 2026-09-07 (57 -> 58).
  // Phase 10 (X2 CodeNode bridge, D20): full-tree dogfood backfill.
  // REQ-008 Tier-1 hardening added 25 guidance/drift-test CNs (29 -> 54).
  // 0.7.1 packaging added 3 CNs for the verify subcommand routing.
  // Phase 1 blueprint mechanism added 11 CNs for the mechanism modules.
  // Phase 3.5 (w-2026-08-19-008) added CN-069 for supersede.js#supersedeBlueprintTopic.
  // e2e contract added CN-070..073 for the four commits' main code paths.
  // CN-076 anchors src/blueprint/remove-resolution.js#removeResolution
  // (spec A2 verb, US-1204 / FBS-027). Core companions train added
  // CN-077..097 (21 code nodes) anchoring each new AC to the shipped
  // blueprint files, loader validation entry points, companions
  // module, apply payload and CLI handler (76 -> 97).
  // rcf-eval-node train added CN-098..105 (8 code nodes) anchoring the
  // L1 audit-eval verb + compute, L2 verdict + chain evalBindingFor,
  // L3 ship-without-eval writer + ingest refusal readers, and L4
  // judge runOneCase + composeRunRecord (97 -> 105).
  // visual round T-0 added CN-106..110 (5 code nodes) anchoring the
  // probe-pack schema validator, loader (with contribution AC id
  // cross-check), pack pass runner, manifest-writer aggregate verdict
  // extension, and the CLI --probe-pack option handler (105 -> 110).
  // Visual round T-0 follow-up added CN-111..112 (2 code nodes)
  // anchoring the Playwright-MCP stdio pack-browser client
  // (pack-browser.js#createPackBrowser) and the boot fallback
  // (boot.js#bootIfNeeded) that consumes pack.boot when the runtime
  // URL is unreachable (110 -> 112).
  // Visual round T-1 (w-2026-09-04-dave-011) added CN-113..115 (3
  // code nodes) anchoring the sample-app fixture's startServer, the
  // shipped application-datatable blueprint.json, and the shipped
  // probe pack file (112 -> 115).
  // Visual round T-2 (w-2026-09-04-dave-013) added CN-116..118 (3
  // code nodes) anchoring the application-charts sample-app fixture's
  // startServer, the shipped application-charts blueprint.json, and
  // the shipped probe pack file (115 -> 118).
  // Visual round T-3 (w-2026-09-04-dave-012) added CN-119..123 (5
  // code nodes) anchoring the application-dashboard shipped probe
  // pack file, the sample-app fixture's startServer, the packaged
  // design-guidance asset, the pack-browser resize seam, and the
  // shipped blueprint.json (118 -> 123).
  // Visual round T-4 (w-2026-09-04-dave-014) added CN-124..127 (4
  // code nodes) anchoring the application-notifications-in-app
  // shipped blueprint.json, the probe pack file, the sample-app
  // fixture's startServer, and the blueprint README (123 -> 127).
  // Visual round T-5 (w-2026-09-04-dave-015) added CN-128..133 (6
  // code nodes) anchoring the capability-declaration mechanism entry
  // points (loader, apply, capabilities), the admin-console
  // blueprint.json, the probe pack, and the sample-app fixture
  // (127 -> 133).
  // Visual round 4 T-1 (w-2026-09-06-dave-015) added CN-134..140
  // (7 code nodes) anchoring the application-empty-error-states
  // shipped blueprint.json, the probe pack, the sample-app fixture's
  // server.js, and the README, guide, CHANGELOG and docs/topics.md
  // for the state-slug enumeration parity + mechanism-reach gaps
  // ACs (133 -> 140).
  // Visual round 4 T-2 (w-2026-09-06-dave-016) added CN-141..147
  // (7 code nodes) anchoring the application-file-upload shipped
  // blueprint.json, the probe pack, the sample-app fixture's
  // server.js, and the README, guide, CHANGELOG and docs/topics.md
  // for the state-and-transport enumeration parity plus mechanism-
  // reach gaps ACs (140 -> 147).
  // Infra round 5 T-1 added CN-200/201/202 (3 code nodes) anchoring
  // the persistence-data-postgres blueprint.json, the facade-round-trip
  // probe module, and the sample-app fixture facade store.mjs per HQ
  // reserved-block ruling (147 -> 150).
  // Infra round 5 T-2 added CN-203/204/205 (3 code nodes) anchoring
  // the object-storage-s3 blueprint.json, the facade-round-trip probe
  // module, and the shared sample-app fixture facade object-store.mjs
  // per HQ reserved-block ruling (150 -> 153).
  // Visual round 4 T-3 (w-2026-09-06-dave-017) added CN-148..154
  // (7 code nodes) anchoring the application-forms-wizard shipped
  // blueprint.json, the probe pack, the sample-app fixture's
  // server.js, and the README, guide, CHANGELOG and docs/topics.md
  // for the vocabulary-and-transport enumeration parity + mechanism-
  // reach gaps ACs (153 -> 160).
  // visual round 4 T-4 (w-2026-09-06-dave-018) added CN-155..174
  // (20 code nodes) anchoring the application-account-settings
  // shipped blueprint.json, probe pack, sample-app fixture files,
  // README/guide/CHANGELOG/topics.md, section 6a table extension in
  // blueprint-authoring.md, the mechanism minor in capabilities.js,
  // and the six amended blueprint.json + CHANGELOG.md pairs (four
  // auth minors + observability-logging) (160 -> 180).
  // visual round 4 T-5 (w-2026-09-06-dave-019) added CN-175..186 (12 code nodes)
  // anchoring the application-onboarding-tour shipped blueprint.json, three
  // ADR contribution files, the probe pack, README, CHANGELOG, guide, docs
  // topics.md, the sample-app fixture server.js and README, and the section 5
  // shelf id band registry extension in packages/rcf-lite/docs/blueprint-authoring.md
  // (180 -> 192).
  // Infra round 5 T-3 added CN-206/207/208 (3 code nodes) anchoring
  // the messaging-queue-cloudflare blueprint.json, the
  // producer-facade-ready probe module, and the shared sample-app
  // fixture producer.mjs per dex reserved-block ruling (192 -> 195).
  // Cloudflare round 6 T-0 added CN-209..213 (5 code nodes) anchoring
  // the shipped assets-manifest-scan.mjs probe module (CN-209), the
  // blueprint.json delta shape (CN-210), the anatomy test file
  // (CN-211), the ADR-1306 body (CN-212) and the updated guide file
  // (CN-213), one per AC on the T-0 US triple (195 -> 200).
  // Infra round 5 T-4 added CN-214/215/216/217 (4 code nodes)
  // anchoring the jobs-background blueprint.json, the
  // apply-time-refusal probe module, the shared sample-app fixture
  // jobs-runtime.mjs, and the extended blueprint/apply.js (queue
  // family sidecar-notes derivation) per dex reserved-block ruling.
  // Originally minted as CN-209..212 pre-#164; re-minted as
  // CN-214..217 via `rcf define create cn --id` after HQ round-6 T-0
  // consumed the original block (200 -> 204).
  // Cloudflare round 6 T-1 added CN-230..234 (5 code nodes) anchoring
  // the platform-cloudflare-kv blueprint.json, kv-facade.mjs,
  // cache-aside.mjs, facade-round-trip.mjs and event-secrecy.mjs per
  // HQ reserved-block ruling (204 -> 209).
  // Cloudflare round 6 T-2 added CN-260..267 (8 code nodes) anchoring
  // the platform-cloudflare-cron-triggers blueprint.json, scheduled.mjs,
  // dispatcher.mjs and the five probe modules per HQ reserved-block
  // ruling 2026-09-07T12:25Z (209 -> 217).
  // Cloudflare round 6 T-3 added CN-290..304 for the T-3
  // blueprint.json, cf-platform DO facade, single-cell, hub and
  // storage driver, seven probe modules, probe-utils and the
  // anatomy test (217 -> 232).
  // Cloudflare round 6 T-4 added CN-320 (edge-cloudflare-access
  // blueprint.json anchoring the nine edge ACs) and CN-321
  // (application-admin-console blueprint.json anchoring the three
  // v1.1.0 delta ACs) per HQ reserved-block ruling 2026-09-07
  // (232 -> 234).
  codeNode: 236, // Cloudflare round 6 T-5 added CN-350 (edge-cloudflare-turnstile blueprint.json anchoring the eight edge ACs) per HQ reserved-block ruling 2026-09-07 (234 -> 235).
  // w-2026-07-28-005 step 4: the test axis. One TS per US; every TC binds
  // an AC to a resolving testPointer. Pending ACs are registered in
  // rcf/test-suites/PENDING.md, never stubbed as TCs.
  // TS-037 pairs with US-1204 for the remove-resolution verb. Core
  // companions train added TS-038..044 paired with US-1301..1501 (37 -> 44).
  // rcf-eval-node train added TS-045 (44 -> 45).
  // visual round T-0 added TS-046 paired with US-1701 (45 -> 46).
  // visual round T-1 added TS-047 paired with US-1801 (46 -> 47).
  // visual round T-2 added TS-048 paired with US-1901 (47 -> 48).
  // visual round T-3 added TS-049 paired with US-2001 (48 -> 49).
  // visual round T-4 added TS-050 paired with US-2101 (49 -> 50).
  // visual round T-5 added TS-051 paired with US-2201 and TS-052
  // paired with US-2301 (50 -> 52).
  // visual round 4 T-1 added TS-053 paired with US-2401 (52 -> 53).
  // visual round 4 T-2 added TS-054 paired with US-2501 (53 -> 54).
  // Infra round 5 T-1 added TS-070 paired with US-4001 per HQ
  // reserved-block ruling (54 -> 55).
  // Infra round 5 T-2 added TS-071 paired with US-4101 per HQ
  // reserved-block ruling (55 -> 56).
  // visual round 4 T-3 added TS-055 paired with US-2601 (56 -> 57).
  // visual round 4 T-4 (w-2026-09-06-dave-018) added TS-056 (57 -> 58).
  // visual round 4 T-5 (w-2026-09-06-dave-019) added TS-057 (58 -> 59).
  // Infra round 5 T-3 added TS-072 paired with US-4201 per dex
  // reserved-block ruling (59 -> 60).
  // Cloudflare round 6 T-0 added TS-073 paired with US-2901, TS-074
  // paired with US-2902 and TS-075 paired with US-3001 (60 -> 63).
  // Infra round 5 T-4 added TS-076 paired with US-4301 per dex
  // reserved-block ruling. Originally minted as TS-073 pre-#164;
  // re-minted as TS-076 via `rcf define create ts --id` after HQ
  // round-6 T-0 consumed the original id (63 -> 64).
  // Cloudflare round 6 T-1 added TS-080..087 paired with US-5001..5401 (64 -> 72).
  // Cloudflare round 6 T-2 added TS-090..096 paired with US-6001..6302
  // per HQ reserved-block ruling 2026-09-07T12:25Z (72 -> 79).
  // Cloudflare round 6 T-3 added TS-100..109 paired with the ten
  // T-3 USs per HQ reserved-block ruling 2026-09-07 (79 -> 89).
  // Cloudflare round 6 T-4 added TS-110..119 paired with the ten
  // T-4 USs (US-8001..US-8602) per HQ reserved-block ruling
  // 2026-09-07 (89 -> 100).
  // Cloudflare round 6 T-5 added TS-120..127 paired with the eight
  // T-5 USs per HQ reserved-block ruling 2026-09-07 (100 -> 107).
  testSuite: 115,
  // rcf-eval-node train added EVAL-001 for the AC-1601-4 judge run path
  // (0 -> 1). Chain schema: EVAL doc kind lands with rcf-schemas 0.6.0.
  evalDoc: 1,
};

test('expected file counts by category', () => {
  const docs = loadAll();
  const counts = {};
  for (const d of docs) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  for (const [kind, expected] of Object.entries(expectedCounts)) {
    assert.equal(
      counts[kind] ?? 0,
      expected,
      `expected ${expected} ${kind} files, found ${counts[kind] ?? 0}`,
    );
  }
});

test('every document classifies to a known schema', () => {
  const kinds = new Set(knownKinds());
  const docs = loadAll();
  for (const d of docs) {
    assert.ok(d.kind !== null, `unclassified file: ${d.rel}`);
    assert.ok(kinds.has(d.kind), `core validator knows no kind: ${d.kind}`);
  }
});

test('every document validates through the core validator (published bundle + testPointer overlay)', () => {
  const docs = loadAll();
  const failures = [];
  for (const d of docs) {
    const err = validateDocument({ doc: d.json, kind: d.kind, filePath: d.rel });
    if (err) failures.push({ file: d.rel, message: err.message });
  }
  assert.equal(
    failures.length,
    0,
    `validation failures:\n${JSON.stringify(failures, null, 2)}`,
  );
});

test('file id matches filename and structural location', () => {
  const docs = loadAll();
  const idField = {
    prd: 'prdId',
    req: 'reqId',
    userStory: 'usId',
    tad: 'tadId',
    tac: 'tacId',
    adr: 'adrId',
    buildSequence: 'bsId',
    fbs: 'fbsId',
    testSuite: 'id',
    codeNode: 'cnId',
    // rcf-schemas 0.6.0: EVAL doc uses the plain `id` field (mirrors TS).
    evalDoc: 'id',
  };
  for (const d of docs) {
    if (d.kind === 'manifest') continue;
    const field = idField[d.kind];
    const id = d.json[field];
    assert.ok(id, `${d.rel} missing ${field}`);
    if (d.kind === 'prd' || d.kind === 'tad' || d.kind === 'buildSequence') continue;
    const stem = d.rel.split('/').pop().replace(/\.json$/, '');
    assert.equal(stem, id.toLowerCase(), `${d.rel} filename does not match id ${id}`);
  }
});

test('PRD no longer carries removed requirementIds field (D2)', () => {
  const docs = loadAll();
  const prd = docs.find((d) => d.kind === 'prd').json;
  assert.equal('requirementIds' in prd, false, 'PRD still carries removed requirementIds field');
});

test('TAD no longer carries removed componentIds / architecturalDecisionIds fields (D2)', () => {
  const docs = loadAll();
  const tad = docs.find((d) => d.kind === 'tad').json;
  assert.equal('componentIds' in tad, false);
  assert.equal('architecturalDecisionIds' in tad, false);
});

test('BS no longer carries removed fbs[] array (D6)', () => {
  const docs = loadAll();
  const bs = docs.find((d) => d.kind === 'buildSequence').json;
  assert.equal('fbs' in bs, false);
});

test('every REQ carries prdId matching the PRD (child-owned parent edge, D1)', () => {
  const docs = loadAll();
  const prdId = docs.find((d) => d.kind === 'prd').json.prdId;
  const reqs = docs.filter((d) => d.kind === 'req').map((d) => d.json);
  for (const r of reqs) {
    assert.equal(r.prdId, prdId, `REQ ${r.reqId} has wrong prdId`);
  }
});

test('every TAC and ADR carries tadId matching the TAD (D1)', () => {
  const docs = loadAll();
  const tadId = docs.find((d) => d.kind === 'tad').json.tadId;
  for (const t of docs.filter((d) => d.kind === 'tac')) {
    assert.equal(t.json.tadId, tadId, `TAC ${t.json.tacId} has wrong tadId`);
  }
  for (const a of docs.filter((d) => d.kind === 'adr')) {
    assert.equal(a.json.tadId, tadId, `ADR ${a.json.adrId} has wrong tadId`);
  }
});

test('every US has at least one covering REQ (US.reqId resolves)', () => {
  const docs = loadAll();
  const reqIds = new Set(docs.filter((d) => d.kind === 'req').map((d) => d.json.reqId));
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const reqToUs = {};
  for (const us of usDocs) {
    assert.ok(reqIds.has(us.reqId), `US ${us.usId} references unknown REQ ${us.reqId}`);
    (reqToUs[us.reqId] ??= []).push(us.usId);
  }
  for (const reqId of reqIds) {
    assert.ok(reqToUs[reqId]?.length, `REQ ${reqId} has no user stories`);
  }
});

test('every FBS carries bsId + buildOrder + executionStatus + dependsOnFbsIds (D6)', () => {
  const docs = loadAll();
  const bsId = docs.find((d) => d.kind === 'buildSequence').json.bsId;
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const fbsIds = new Set(fbsDocs.map((f) => f.fbsId));
  const orders = new Set();
  for (const f of fbsDocs) {
    assert.equal(f.bsId, bsId, `FBS ${f.fbsId} has wrong bsId`);
    assert.equal(typeof f.buildOrder, 'number', `FBS ${f.fbsId} missing buildOrder`);
    assert.ok(f.executionStatus, `FBS ${f.fbsId} missing executionStatus`);
    assert.ok(Array.isArray(f.dependsOnFbsIds), `FBS ${f.fbsId} missing dependsOnFbsIds`);
    for (const dep of f.dependsOnFbsIds) {
      assert.ok(fbsIds.has(dep), `FBS ${f.fbsId} depends on unknown FBS ${dep}`);
      assert.notEqual(dep, f.fbsId, `FBS ${f.fbsId} depends on itself`);
    }
    assert.equal(orders.has(f.buildOrder), false, `duplicate buildOrder ${f.buildOrder} inside ${bsId}`);
    orders.add(f.buildOrder);
  }
});

test('every FBS acId resolves to a real AC and every AC is covered by at least one FBS', () => {
  const docs = loadAll();
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const acIds = new Set();
  for (const us of usDocs) {
    for (const ac of us.acceptanceCriteria) {
      assert.ok(!acIds.has(ac.id), `duplicate AC id ${ac.id} across user stories`);
      acIds.add(ac.id);
      const m = ac.id.match(/^AC-(\d{3,})-\d+$/);
      if (m) {
        const usNum = us.usId.match(/^US-(\d{3,})$/)?.[1];
        assert.equal(m[1], usNum, `AC ${ac.id} sits under US-${usNum} but its prefix is ${m[1]}`);
      }
    }
  }
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const tacIds = new Set(docs.filter((d) => d.kind === 'tac').map((d) => d.json.tacId));
  const adrIds = new Set(docs.filter((d) => d.kind === 'adr').map((d) => d.json.adrId));
  const covered = new Set();
  for (const f of fbsDocs) {
    for (const acId of f.acIds) {
      assert.ok(acIds.has(acId), `FBS ${f.fbsId} references unknown AC ${acId}`);
      covered.add(acId);
    }
    const ctx = f.contextRequirements ?? {};
    for (const tacId of ctx.tacIds ?? []) {
      assert.ok(tacIds.has(tacId), `FBS ${f.fbsId} references unknown TAC ${tacId}`);
    }
    for (const adrId of ctx.adrIds ?? []) {
      assert.ok(adrIds.has(adrId), `FBS ${f.fbsId} references unknown ADR ${adrId}`);
    }
  }
  const orphans = [...acIds].filter((id) => !covered.has(id)).sort();
  assert.equal(orphans.length, 0, `acceptance criteria not covered by any FBS: ${orphans.join(', ')}`);
});

test('manifest roots resolve to existing files with matching ids', () => {
  const docs = loadAll();
  const manifest = docs.find((d) => d.kind === 'manifest').json;
  const prdDoc = docs.find((d) => d.kind === 'prd');
  const tadDoc = docs.find((d) => d.kind === 'tad');
  const bsDoc = docs.find((d) => d.kind === 'buildSequence');
  assert.equal(manifest.prd.id, prdDoc.json.prdId);
  assert.equal(manifest.tad.id, tadDoc.json.tadId);
  assert.equal(manifest.bs.id, bsDoc.json.bsId);
});

// ---------------------------------------------------------------------------
// Phase 10 (X2 CodeNode bridge, D20): full-tree dogfood backfill. The repo
// is its own demo - every AC carries a Code Node, `dependencies[]` edges
// resolve, and the REQ-007 validation chain is proven through the real
// verbs (13 hand-authored-then-reproduced-via-CRUD nodes, PoC-ported).
// ---------------------------------------------------------------------------

test('every CN implementsAcIds entry resolves to a real AC; every AC carries at least one CN', () => {
  const docs = loadAll();
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const acIds = new Set();
  for (const us of usDocs) {
    for (const ac of us.acceptanceCriteria) acIds.add(ac.id);
  }
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  const covered = new Set();
  for (const cn of cnDocs) {
    for (const acId of cn.implementsAcIds ?? []) {
      assert.ok(acIds.has(acId), `CN ${cn.cnId} references unknown AC ${acId}`);
      covered.add(acId);
    }
  }
  const orphans = [...acIds].filter((id) => !covered.has(id)).sort();
  assert.equal(orphans.length, 0, `acceptance criteria with no Code Node: ${orphans.join(', ')}`);
});

test('every CN dependencies entry resolves to a real, distinct CN', () => {
  const docs = loadAll();
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  const cnIds = new Set(cnDocs.map((cn) => cn.cnId));
  for (const cn of cnDocs) {
    for (const depId of cn.dependencies ?? []) {
      assert.ok(cnIds.has(depId), `CN ${cn.cnId} depends on unknown CN ${depId}`);
      assert.notEqual(depId, cn.cnId, `CN ${cn.cnId} depends on itself`);
    }
  }
});

test('every CN path resolves against the working tree (no staleCode on the dogfood tree)', () => {
  const docs = loadAll();
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  for (const cn of cnDocs) {
    const [file] = cn.path.split('#');
    const absPath = resolve(repoRoot, file);
    assert.ok(statSync(absPath, { throwIfNoEntry: false })?.isFile(), `CN ${cn.cnId} path ${file} does not resolve on disk`);
  }
});

test('the REQ-007 validation chain (13 nodes) is present with the PoC-proven implementsAcIds/dependencies shape', () => {
  const docs = loadAll();
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  const byPath = new Map(cnDocs.map((cn) => [cn.path, cn]));
  // Post 0.7.1 packaging consolidation: core src lives inline under
  // src/core/, so the Code Nodes point at src/core/... (was ../core/src/...
  // pre-consolidation). map-errors.js stays under src/mcp/.
  const expectedPaths = [
    'src/core/store/validator.js#getAjv',
    'src/core/store/walker.js#netNewErrors',
    'src/core/errors/index.js#rcfError',
    'src/core/store/walker.js', // file-level
    'src/core/store/validator.js#validateDocument',
    'src/core/errors/index.js#formatErrors',
    'src/mcp/map-errors.js#issueFromRcfError',
    'src/core/store/validator.js', // file-level
    'src/core/store/walker.js#simulateWriteErrors',
    'src/core/store/loader.js#loadDocument',
    'src/core/store/writer.js#postWriteGate',
    'src/core/store/writer.js', // file-level
    'src/core/store/writer.js#createDocument',
  ];
  for (const p of expectedPaths) {
    assert.ok(byPath.has(p), `expected REQ-007-chain Code Node over ${p} is missing`);
  }
  // AC-701-3 ("registered once at start-up") is satisfied by getAjv.
  assert.ok(byPath.get('src/core/store/validator.js#getAjv').implementsAcIds.includes('AC-701-3'));
  // createDocument depends (transitively through the chain) on rcfError.
  const createDocumentCn = byPath.get('src/core/store/writer.js#createDocument');
  const rcfErrorCn = byPath.get('src/core/errors/index.js#rcfError');
  assert.ok(createDocumentCn.dependencies.includes(rcfErrorCn.cnId));
});

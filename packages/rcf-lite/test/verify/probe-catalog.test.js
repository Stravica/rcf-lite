// FBS-218 (US-19201): per-AC probes resolve URL-verifiable criteria in deterministic verify.
//
// Declared skeletons, one per AC, bound by the US-19201 test suite. The
// FBS-218 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19201-1: rcf verify run --url <target> --fbs <fbs-id> --mode deterministic with an AC probe { path: "/health", expectStatus: 200 } served 200 exits 0; report records the AC "pass" with observed status and elapsed time and runStats.counts.verified incremented');
test.todo('AC-19201-2: rcf verify run --mode deterministic with a probe expecting 200 and body "ready" against a body without "ready" exits 4; report records the AC "fail" naming the failed expectation and observed value, runStats.counts.failed at least 1');
test.todo('AC-19201-3: rcf verify run --mode deterministic on an AC with no probe and no catalog entry exits 4 recording "critiqueOnly" counted in runStats.counts.critiqueOnly, verdict not PASS; an unreachable probe path is recorded "skipped" with the error kind, never "pass"');
test.todo('AC-19201-4: rcf verify run --mode deterministic uses the AC-level probe over rcf/verify-catalog.json with evidence source "ac", a catalog-only probe with source "catalog"; a catalog key naming no AC makes rcf define validate exit 3');
test.todo('AC-19201-5: rcf verify run --mode deterministic --parity-env staging resolves a probe with parityEnv "staging"; with --parity-env production the same probe is recorded "skipped" with reason "parityEnv mismatch"');
test.todo('AC-19201-6: rcf define update <us-id> --ac <ac-id> --probe {"path":"/","expectStatus":200} stores the probe and rcf define validate exits 0; an unknown probe key or a non-integer expectStatus is refused with exit 3 naming the key');
test.todo('AC-19201-7: rcf verify run --mode deterministic on a chain with no in-scope probe exits 4 with runStats.counts.verified 0, never records "pass" for an AC without a probe and spawns no child process');

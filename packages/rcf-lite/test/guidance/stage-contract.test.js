// FBS-224 (US-19004): guidance, the managed block and the README say the new stage contract, and audit is the fifth verb.
//
// Declared skeletons, one per AC, bound by the US-19004 test suite. The
// FBS-224 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19004-1: rcf guidance build-cycle exits 0 and its Test stage names the verifier hand, rcf verify run --fbs <fbs-id> --hand verifier and rcf/verify-reports/, its Finalise stage names rcf build finalise <fbs-id> --ci-run <ref>, with no "--url <deploy-url>" and no "post-merge verify run"');
test.todo('AC-19004-2: rcf guidance build-cycle exits 0 with the Define stage naming the test-author hand and TS/TC bindings, the Build stage naming the builder for production code, Code Nodes and code-hygiene unit tests only, and every stage naming its Hand: trailer');
test.todo('AC-19004-3: rcf build bundle --next --format md closes with a runbook listing the five stages and hands, rcf verify run --hand verifier, rcf audit separation and rcf build finalise <fbs-id> --ci-run <ref>, with no finalise --mode or --url');
test.todo('AC-19004-4: rcf guidance managed/agent-instructions-block states verified is written only by rcf build finalise from a Test-stage report, the release notes carry a non-null minAgentAction, and rcf doctor reports the old block as drifted');
test.todo('AC-19004-5: the root README and every rcf guidance topic read define, build, verify, release, audit as the stage chain and never name attest as a verb or stage, leaving AC attestation and --litmus-attested as they are');
test.todo('AC-19004-6: rcf doctor on a project whose CLAUDE.md or AGENTS.md carries the pre-change managed block reports it drifted, names rcf doctor --fix and exits non-zero');
test.todo('AC-19004-7: no rcf guidance topic and no rcf build bundle --next runbook tells a hand to run rcf build finalise with --mode or --url, or to run verification after merge');

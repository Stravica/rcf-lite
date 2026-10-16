// FBS-220 (US-19002): Finalise promotes to verified by ingesting the Test-stage report, with no agent spawn.
//
// Declared skeletons, one per AC, bound by the US-19002 test suite. The
// FBS-220 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19002-1: rcf build finalise <fbs-id> --ci-run <ref> with a valid verifier PASS report exits 0, sets executionStatus verified and prints "finalise: <fbs-id> verified from <report path> (head <sha7>, ci <ref>)", spawning nothing but git');
test.todo('AC-19002-2: rcf build finalise <fbs-id> --ci-run <ref> with no report exits 4 with "finalise refused: no Test-stage verify report for <fbs-id>; the verifier runs rcf verify run --fbs <fbs-id> --hand verifier before merge" and the FBS stays complete');
test.todo('AC-19002-3: rcf build finalise exits 4 with "finalise refused: report head <sha7> is not contained in HEAD <sha7>; re-verify the merged head", "report target <url> is loopback" or "report is <n> days old"');
test.todo('AC-19002-4: rcf build finalise on a report whose hand is not verifier or whose verifierId matches a builder Hand-Id exits 4 with "finalise refused: report hand <hand>/<id> is not separate from the builder" and the FBS is unchanged');
test.todo('AC-19002-5: rcf build finalise exits 4 "ci evidence missing: pass --ci-run <ref>", 4 not-complete, 4 off-trunk and 3 "missing Code Nodes: <ac-ids>"; a report failing VerifyReport v1 exits 3 naming the field');
test.todo('AC-19002-6: rcf build finalise on a report carrying MOCK-ONLY-DECLARED, EVAL-MISSING, EVAL-BELOW-THRESHOLD, UI-BASELINE-UNMET, BROWSER-VERIFICATION-MISSING or SCOPE-MISMATCH, or a non-PASS or non-ship verdict, exits 4 with the 0.20.0 and 0.28.0 message shapes');
test.todo('AC-19002-7: rcf build finalise <fbs-id> --mode <any> or --url <url> exits 2 with "finalise no longer runs verify; run rcf verify run --fbs <fbs-id> --hand verifier at the Test stage" and spawns nothing');
test.todo('AC-19002-8: rcf build finalise never spawns rcf verify run, the verifier package or the agent CLI, and every refusal leaves rcf/fbs/<fbs-id>.json byte-identical');

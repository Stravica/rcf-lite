// FBS-219 (US-19001): the verifier records a Test-stage verify report before merge.
//
// Declared skeletons, one per AC, bound by the US-19001 test suite. The
// FBS-219 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19001-1: rcf verify run --url <preview-url> --fbs <fbs-id> --mode deterministic --hand verifier --verifier-id <id> writes rcf/verify-reports/<fbs-id>/<head12>.json valid as VerifyReport v1 and stdout ends "verify report: <path> <verdict> <verified>/<total>"');
test.todo('AC-19001-2: rcf verify run --hand verifier --fbs <fbs-id> on a dirty working tree exits 4 with "verify report refused: working tree is dirty; the report must name a committed head" and writes no report');
test.todo('AC-19001-3: rcf verify run with --hand outside the five hands, or --hand without --fbs, exits 2 naming the flag and writes no report');
test.todo('AC-19001-4: rcf verify run --package <name@version|tarball> --fbs <fbs-id> --hand verifier writes a report with target.kind "package" and target.packageRef and no target.url');
test.todo('AC-19001-5: with a committed report under rcf/verify-reports/, rcf define validate exits 0 with no unknown-document error and rcf audit separation classifies the path as verifier evidence');
test.todo('AC-19001-6: rcf verify run --hand verifier writes only under rcf/verify-reports/<fbs-id>/; a second run for the same head exits 4 with "verify report exists for head <sha7>; pass --replace" and never overwrites');

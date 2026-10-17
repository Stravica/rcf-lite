// FBS-222 (US-19101): rcf audit separation judges each commit hand against the paths it touches.
//
// Declared skeletons, one per AC, bound by the US-19101 test suite. The
// FBS-222 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19101-1: rcf audit separation over test-author, builder and verifier commits on their own paths exits 0 and prints "separation: PASS 3 commits (base <sha7>, head <sha7>): test-author 1, builder 1, verifier 1, stage-keeper 0, neutral 0, undeclared 0, exceptions 0"');
test.todo('AC-19101-2: rcf audit separation with a Hand: builder commit touching test/x.test.js exits 4 and prints "separation: FAIL 1 of <n> commits (base <sha7>, head <sha7>): <sha7> Hand=builder touches test/x.test.js"');
test.todo('AC-19101-3: rcf audit separation passes undeclared commits touching only src/ or only test/ and counts them undeclared; an undeclared commit touching both exits 4 naming both paths');
test.todo('AC-19101-4: rcf audit separation --base <missing-ref> exits 2 with "separation: bad ref <ref>"; outside a git repository it exits 1 with "separation: not a git repository"; an unknown Hand value is a violation "unknown hand <value>"');
test.todo('AC-19101-5: rcf audit separation --json prints a JSON array of one SeparationRow { sha, subject, hand, declared, classes, verdict, reason, paths } per non-merge commit with merge commits absent');
test.todo('AC-19101-6: rcf audit separation writes no file, reads no network and no chain: two runs over the same range print byte-identical output and leave git status unchanged');
test.todo('AC-19101-7: rcf audit separation classifies a committed report under rcf/verify-reports/ as verifier evidence');

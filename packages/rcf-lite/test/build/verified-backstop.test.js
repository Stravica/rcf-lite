// FBS-221 (US-19003): bundle --next refuses while a merged spec is complete and not verified.
//
// Declared skeletons, one per AC, bound by the US-19003 test suite. The
// FBS-221 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19003-1: rcf build bundle --next with an FBS at or above backstop fromBuildOrder at complete exits 4 with "backstop: <k> merged spec(s) complete and not verified: <ids>; run rcf build finalise <id> or pass --allow-unverified" and emits no bundle');
test.todo('AC-19003-2: rcf build bundle --next --allow-unverified <reason> emits the bundle, appends { reason, by, at, unverifiedFbsIds } to backstop.overrides and prints "backstop overridden: <reason>"; an empty reason exits 2');
test.todo('AC-19003-3: rcf build bundle --next with no rcf/define/backstop.json, or only complete FBS below fromBuildOrder, does not refuse and emits the bundle as before');
test.todo('AC-19003-4: rcf build backstop adopt --from FBS-218 exits 0 writing rcf/define/backstop.json { fromBuildOrder: 218, adoptedAt, adoptedBy }; an unknown FBS id exits 3 and a missing --from exits 2');
test.todo('AC-19003-5: rcf build bundle --next never emits a bundle while the backstop refuses unless --allow-unverified carries a non-empty reason, and the override never changes any FBS executionStatus');

// FBS-223 (US-19102): the mixed escape, the class override file, --require-hand and CI on pull requests.
//
// Declared skeletons, one per AC, bound by the US-19102 test suite. The
// FBS-223 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19102-1: rcf audit separation passes a Hand: mixed commit with Separation-Reason as an exception (exceptions 1, --json verdict "exception"); Hand: mixed without a reason exits 4 with "mixed without Separation-Reason"');
test.todo('AC-19102-2: rcf audit separation with rcf/separation.json { classes: { test: ["spec/**"] } } exits 4 naming spec/a.js for a builder commit; a malformed rcf/separation.json exits 2 naming the file; a builder edit to it fails as a criteria-class touch');
test.todo('AC-19102-3: rcf audit separation --require-hand exits 4 naming the commit and the missing trailer for a commit with no Hand: trailer or a Hand: builder commit with no Hand-Id: trailer');
test.todo('AC-19102-4: on pull_request, CI runs node bin/rcf.js audit separation --base origin/${{ github.base_ref }} from packages/rcf-lite after checkout fetch-depth 0 and its exit code fails the job; the step does not run on push to main');
test.todo('AC-19102-5: an empty or whitespace Separation-Reason never turns Hand: mixed into a pass, and rcf audit separation on a shallow checkout exits 2 naming the missing base');

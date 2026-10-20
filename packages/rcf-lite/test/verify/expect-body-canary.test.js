// FBS-229 (US-19401): the expectBody.matches canary rule in deterministic verify (AC-19401-13 to -17).
//
// Declared skeletons, one per AC, bound by the US-19401 test suite. The
// FBS-229 Define fill round (test-author hand) turns each todo into a test
// that drives bin/rcf.js in the test/verify/probe-catalog.test.js world (scaffoldChain, a local target server)
// and is red for the right reason before Build starts. The supersession
// fixtures validate only once the pin reads rcf-schemas 0.9.0. These
// fixtures use initProject in-process; a body that runs rcf init or rcf
// doctor must pin claudeFreePath as test/guidance/stage-contract.test.js does.
import { test } from 'node:test';

test.todo('AC-19401-13: rcf verify run --mode deterministic with a specific expectBody.matches pattern (the three AC-19401-13 names, among them "[0-9a-f]{8}") matching the body exits 0 with AC-101-1 "pass" and runStats.counts.verified 1');
test.todo('AC-19401-14: rcf verify run --mode deterministic with expectBody.matches ".*", "^.*$", "(?:)", "x?" or "a|", each matching both canaries qzvxjk0729 and ~!@#%^&*() and the body, exits 4 with AC-101-1 "fail", failedExpectation "expectBody.matches" and expected naming the vacuous pattern and both canaries');
test.todo('AC-19401-15: rcf verify run --mode deterministic with expectBody.matches "(" or "[a-" does not crash, writes the report and exits 4 with AC-101-1 "fail", failedExpectation "expectBody.matches", expected "a pattern that compiles" and the compile error as observed');
test.todo('AC-19401-16: rcf verify run --mode deterministic with a match-anything expectBody.matches (".+", "^", "$", ".*?", "(.*)", ".{0,}", "[^]*", ".") alone or beside expectStatus 200 never records "pass", never counts it verified, verdict never PASS, exit 4');
test.todo('AC-19401-17: rcf verify run --mode deterministic with expectBody.matches matching one canary only or neither (the word-class pattern of AC-19401-17, or "Notes") and the body the body exits 0 with "pass"; expectHeader { "name": "content-type", "match": ".*" } stays a substring check and fails "expectHeader content-type", exit 4');

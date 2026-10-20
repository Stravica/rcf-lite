// FBS-227 (US-19401) part b: retired criteria (supersededBy) in rcf audit coverage and rcf audit eval coverage (AC-19401-5 to -11).
//
// Declared skeletons, one per AC, bound by the US-19401 test suite. The
// FBS-227 Define fill round (test-author hand) turns each todo into a test
// that drives bin/rcf.js in the test/cli/coverage.test.js world (initProject in-process, runBin) and test/query/eval-coverage.test.js
// and is red for the right reason before Build starts. The supersession
// fixtures validate only once the pin reads rcf-schemas 0.9.0. These
// fixtures use initProject in-process; a body that runs rcf init or rcf
// doctor must pin claudeFreePath as test/guidance/stage-contract.test.js does.
import { test } from 'node:test';

test.todo('AC-19401-5: rcf audit coverage with AC-101-1 superseded by AC-101-2 (no TC) and AC-101-2 bound to a resolving TC exits 0, the row reads "retired (AC-101-2)", json state "retired" supersededBy "AC-101-2" covered false totals.retiredAcs 1, mermaid "AC-101-1 -. supersededBy .-> AC-101-2", shallow-any exits 0');
test.todo('AC-19401-6: rcf audit coverage with AC-101-1 supersededBy AC-101-9 absent from the chain exits 4 printing "supersession: AC-101-1 supersededBy AC-101-9: successor not found in the chain"; --mode shallow-any prints it and exits 0; rcf define validate exits 0');
test.todo('AC-19401-7: rcf audit coverage with AC-101-1 supersededBy AC-101-1 exits 4 printing "supersession: AC-101-1 supersededBy AC-101-1: a criterion cannot supersede itself"; --mode shallow-any prints it and exits 0; rcf define validate exits 0');
test.todo('AC-19401-8: rcf audit coverage with AC-101-1 and AC-101-2 superseding each other exits 4 printing one line "supersession: AC-101-1 supersededBy AC-101-2: cycle AC-101-1 -> AC-101-2 -> AC-101-1"; --mode shallow-any prints it and exits 0; rcf define validate exits 0');
test.todo('AC-19401-9: rcf audit coverage with a resolving TC still bound to retired AC-101-1 and no TC on AC-101-2 exits 4 with REQ-001 uncovered; the AC-101-1 row reads "retired (AC-101-2)" and lists the TC, json keeps it in testCases, and it counts toward nothing');
test.todo('AC-19401-10: rcf audit coverage with retired AC-101-1, covered AC-101-2 and uncovered AC-101-3 exits 4 with REQ-001 uncovered and AC-101-3 "no"; AC-101-1 never reads "yes" or covered true in strict or shallow-any mode');
test.todo('AC-19401-11: rcf audit eval coverage --strict with retired nonDeterministic AC-101-1 and no EVAL exits 0 reading outcome "retired" supersededBy "AC-101-2" and missingCount 0; a live nonDeterministic AC-101-3 with no EVAL still reads "missing" and exits 4');

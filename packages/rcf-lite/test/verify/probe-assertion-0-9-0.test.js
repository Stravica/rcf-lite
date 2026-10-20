// FBS-227 and FBS-228 (US-19401): the rcf-schemas 0.9.0 pin bump with assertion-required probes (FBS-227, AC-19401-1 to -4), and deterministic verify skipping a retired criterion's probe (FBS-228, AC-19401-12).
//
// Declared skeletons, one per AC, bound by the US-19401 test suite. The
// owning spec's Define fill round (test-author hand; FBS-227 for AC-19401-1 to -4, FBS-228 for AC-19401-12) turns each todo into a test
// that drives bin/rcf.js in the test/verify/probe-catalog.test.js world (scaffoldChain, a local target server)
// and is red for the right reason before Build starts. The supersession
// fixtures validate only once the pin reads rcf-schemas 0.9.0. These
// fixtures use initProject in-process; a body that runs rcf init or rcf
// doctor must pin claudeFreePath as test/guidance/stage-contract.test.js does.
import { test } from 'node:test';

test.todo('AC-19401-1: with @stravica-ai/rcf-schemas 0.9.0 pinned and installed, node bin/rcf.js define validate over the chain of this repository exits 0 with no "[error]" line and node bin/rcf.js audit coverage --strict exits 0');
test.todo('AC-19401-2: rcf define update US-101 --ac AC-101-1 --probe {"path":"/"} at rcf-schemas 0.9.0 exits 3 with a stderr line naming AC-101-1 and "missing assertion" and the four assertion fields, and leaves rcf/user-stories/us-101.json byte-identical');
test.todo('AC-19401-3: at rcf-schemas 0.9.0 an rcf/verify-catalog.json entry { "path": "/" } resolves "fail" with failedExpectation "missing assertion" (never "expectStatus"), never "pass", counted under runStats.counts.failed, rcf verify run --mode deterministic exits 4, and rcf define validate exits 3 naming the key');
test.todo('AC-19401-4: at rcf-schemas 0.9.0 an AC-level probe { "path": "/" } already on disk fails rcf define validate with exit 3 naming AC-101-1, and rcf verify run --mode deterministic records it "fail" with failedExpectation "missing assertion", never "pass", exit 4');
test.todo('AC-19401-12: rcf verify run --mode deterministic never requests the probe path of retired AC-101-1, records it "retired" with evidence.supersededBy "AC-101-2", never "pass" or "fail", counts it under neither verified nor failed, and exits 0 when AC-101-2 passes');

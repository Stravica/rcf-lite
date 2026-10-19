// FBS-226 (US-19302): rcf verify run --package <dir> packs the artefact from HEAD and installs it under a declared store policy.
//
// Declared skeletons, one per AC, bound by the US-19302 test suite. The
// FBS-226 Define round (test-author hand) turns each todo into a test that
// drives bin/rcf.js and is red for the right reason before Build starts.
import { test } from 'node:test';

test.todo('AC-19302-1: rcf verify run --package . --fbs FBS-001 --hand verifier at clean head H packs with npm pack into the scratch directory, exits 0 and prints "verify report: rcf/verify-reports/FBS-001/<head12>.json PASS 2/2"; target sha256 equals a separate npm pack of H, servedSha H, pack { command, exitCode 0 }');
test.todo('AC-19302-2: rcf verify run --artefact fixture-cli-0.9.0.tgz --fbs FBS-001 --hand verifier at head H records target.version 0.9.0, the tarball sha256, servedSha null and no pack object, and an npm wrapper on PATH logs install and never pack');
test.todo('AC-19302-3: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier --offline with an unresolvable dependency exits 1 with stderr "verify run: install failed (npm exit <n>); log rcf/verify-reports/FBS-001/<head12>/install.log", the log exists and no report JSON is written');
test.todo('AC-19302-4: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier with --offline then without exits 0 both times; install.command carries --offline only on the first, install.registry offline then default; rcf build finalise never installs or reaches the network');
test.todo('AC-19302-5: rcf verify run --package . --fbs FBS-001 --hand verifier leaves no *.tgz, node_modules or package-lock.json change in git status, new paths only under rcf/verify-reports/FBS-001/, and a dirty tree outside rcf/verify-reports/ refuses exit 4 before packing');

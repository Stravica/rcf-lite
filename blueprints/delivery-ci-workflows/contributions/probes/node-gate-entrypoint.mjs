// Node-gate-entrypoint probe for delivery-ci-workflows v2.3.1.
// Every GitHub Actions workflow template invokes the blueprint's
// single-substrate CI contract by running a `node scripts/rcf-*.js`
// entry point (rcf-ci for check-set workflows, rcf-release for
// releases, rcf-scheduled-audit for the scheduled audit,
// rcf-ci-e2e for the e2e suite). Any template that fires a non-
// rcf substrate is a FAIL naming the offending file.
//
// Positive evidence: the exact `scripts/rcf-*.js` entry names seen
// per file are excerpted on the report.
// anchorAcId: AC-6102-1. accountBound: false.

import { loadTemplates, findNodeGateStep } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'AC-6102-1';
export const accountBound = false;

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  const perFile = templates.map((t) => { const g = findNodeGateStep(t.text); return { file: t.name, hasNodeGate: g.has, entries: g.entries }; });
  const missing = perFile.filter((f) => !f.hasNodeGate);
  results.push({
    anchorAcId: 'AC-6102-1',
    verdict: missing.length === 0 ? 'pass' : 'fail',
    detail: `${templates.length} templates scanned; every one runs a 'node scripts/rcf-*.js' entry point; missing in ${missing.length}`,
    evidence: { perFile, missing: missing.map((f) => f.file) },
  });
  const allEntries = perFile.flatMap((f) => f.entries);
  const allRcf = allEntries.every((e) => /^scripts\/rcf-[a-z0-9-]+\.js$/.test(e));
  results.push({
    anchorAcId: 'AC-6102-2',
    verdict: allRcf ? 'pass' : 'fail',
    detail: `${allEntries.length} node gate entries observed; all match rcf-*.js contract`,
    evidence: { uniqueEntries: [...new Set(allEntries)] },
  });
  return { results, extra: { envDeclared: [], templateCount: templates.length, perFile } };
}

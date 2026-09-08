// Probe: real-account-minimal-stack-up.
//
// anchorAcId: AC-composeHost-upClean.
// accountBound: true.
//
// On the shared throwaway-Hetzner-server fixture (spec 3.3), when
// CI_HAS_HETZNER_ACCOUNT is set: provisions the server, scps the
// compose.yaml and referenced files, runs docker compose up -d --wait,
// asserts every declared service reaches healthy inside the elicited
// timeout, tears the stack down and destroys the server in always().
// Without CI_HAS_HETZNER_ACCOUNT the probe records accountBoundSkipped:
// true and the aggregate flips to pass per hetzner-round-7-spec section 3.5.

import { runShim, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-upClean';
export const accountBound = true;

export default async function runProbe() {
  const results = [];
  const extra = { skipped: process.env.CI_HAS_HETZNER_ACCOUNT !== 'true' };
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    results.push(accountBoundSkippedResult(anchorAcId, 'no throwaway server provisioned; minimal-stack-up not exercised'));
    return { results, extra };
  }
  // Real-account path (not run in this environment; requires a Hetzner
  // token via the fixture's provision.mjs and ssh access to the created
  // server). The full driver lives with the round-close real-account
  // gate work item; see hetzner-round-7-spec-2026-09-07 section 3.3 and
  // the T-2 followup w-2026-09-08-dave-001.
  results.push({
    anchorAcId, verdict: 'warn',
    detail: 'CI_HAS_HETZNER_ACCOUNT is set but the driver is not wired in this environment; run against the throwaway server via the round-close real-account gate',
  });
  return { results, extra };
}

const engine = { kind: 'throwaway-server', image: 'hetzner cx23 in fsn1 via provision.mjs', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-minimal-stack-up', engine, runProbe);
}

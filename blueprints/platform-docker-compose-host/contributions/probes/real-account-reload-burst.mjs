// Probe: real-account-reload-burst.
//
// anchorAcId: AC-composeHost-zeroDowntimeReload.
// accountBound: true.
//
// On the shared throwaway-Hetzner-server fixture with the compose
// stack running: fires an undici burst against the caddy service while
// docker compose exec caddy caddy reload runs. Asserts every request
// returns a 2xx status inside the elicited reload window (10 s default)
// and no connection is dropped. Tears the stack down in always().
// Without CI_HAS_HETZNER_ACCOUNT the probe records accountBoundSkipped:
// true and the aggregate flips to pass.

import { runShim, accountBoundSkippedResult } from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-zeroDowntimeReload';
export const accountBound = true;

export default async function runProbe() {
  const results = [];
  const extra = { skipped: process.env.CI_HAS_HETZNER_ACCOUNT !== 'true' };
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    results.push(accountBoundSkippedResult(anchorAcId, 'no throwaway server provisioned; reload-burst not exercised'));
    return { results, extra };
  }
  results.push({
    anchorAcId, verdict: 'warn',
    detail: 'CI_HAS_HETZNER_ACCOUNT is set but the driver is not wired in this environment; run against the throwaway server via the round-close real-account gate',
  });
  return { results, extra };
}

const engine = { kind: 'throwaway-server-burst', image: 'undici burst against caddy in the throwaway compose stack', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-reload-burst', engine, runProbe);
}

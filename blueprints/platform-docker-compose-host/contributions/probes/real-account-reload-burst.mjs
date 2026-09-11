// Probe: real-account-reload-burst.
//
// anchorAcId: AC-composeHost-zeroDowntimeReload.
// accountBound: true.
//
// On the shared throwaway-Hetzner-server fixture with the container-host
// compose stack running: fires a small concurrent HTTP burst against
// the caddy :80 endpoint while `docker compose exec caddy caddy reload`
// runs. Asserts every request returns 2xx (default 40 requests, 8
// concurrent) inside the elicited reload window (10 s default) so the
// zero-downtime-reload contract carries positive evidence.
//
// Without CI_HAS_HETZNER_ACCOUNT the probe records
// accountBoundSkipped: true (reason names the env var) and the
// aggregate flips to pass per the real-account gate contract,
// section 3.5. The throwaway server is destroyed in always()
// regardless of verdict.

import { resolve } from 'node:path';
import { runShim, accountBoundSkippedResult, FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-zeroDowntimeReload';
export const accountBound = true;

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [accountBoundSkippedResult(anchorAcId, 'real-account reload-burst skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the caddy reload window against a throwaway cx23 stack.')],
      extra: { skipped: true, missingEnv: ['CI_HAS_HETZNER_ACCOUNT'] },
    };
  }
  const { provisionThrowawayServer } = await import(resolve(FIXTURE_DIR, 'provision.mjs'));
  const { destroyThrowawayServer } = await import(resolve(FIXTURE_DIR, 'destroy.mjs'));
  const { bringUpStack, reloadBurst, tearDownStack, httpProbe } = await import(resolve(FIXTURE_DIR, 'src/compose-stack-driver.mjs'));

  let provisioned = null;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}` });
    const brought = await bringUpStack(provisioned);
    if (!brought.ok) {
      return {
        results: [{ anchorAcId, verdict: 'fail', detail: `stack failed at phase ${brought.phase} on server ${provisioned.id}: ${JSON.stringify(brought).slice(0, 500)}` }],
        extra: { serverId: provisioned.id, brought },
      };
    }
    const url = `http://${provisioned.primaryIpv4}/`;
    // Warm-up probe: baseline the caddy answer before the burst.
    const warm = await httpProbe(url);
    if (!warm.ok || warm.statusCode !== 200) {
      return {
        results: [{ anchorAcId, verdict: 'fail', detail: `caddy did not answer 200 before the burst on ${url}: statusCode=${warm.statusCode} error=${warm.error || 'none'}` }],
        extra: { serverId: provisioned.id, warm },
      };
    }
    const burst = await reloadBurst(provisioned, url, { total: 40, concurrency: 8 });
    if (burst.reloadExit !== 0) {
      return {
        results: [{ anchorAcId, verdict: 'fail', detail: `caddy reload exited non-zero (${burst.reloadExit}): ${burst.reloadStderrExcerpt}` }],
        extra: { serverId: provisioned.id, burst, warm },
      };
    }
    if (burst.drops > 0 || burst.twoXx < burst.total) {
      return {
        results: [{ anchorAcId, verdict: 'fail', detail: `zero-downtime-reload violated on server ${provisioned.id}: ${burst.twoXx}/${burst.total} 2xx, ${burst.drops} dropped connections during a ${burst.reloadDurationMs}ms reload.` }],
        extra: { serverId: provisioned.id, burst, warm },
      };
    }
    return {
      results: [{
        anchorAcId, verdict: 'pass',
        detail: `zero-downtime-reload observed on server ${provisioned.id}: ${burst.twoXx}/${burst.total} 2xx, 0 dropped connections during a ${burst.reloadDurationMs}ms reload; warm baseline statusCode=${warm.statusCode}.`,
      }],
      extra: {
        serverId: provisioned.id,
        primaryIpv4: provisioned.primaryIpv4,
        deployedStackUrl: url,
        warm, burst,
        eventTrail: brought.events,
      },
    };
  } catch (err) {
    return {
      results: [{ anchorAcId, verdict: 'fail', detail: `reload-burst threw: ${err.message}` }],
      extra: { serverId: provisioned && provisioned.id, error: err.stack || err.message },
    };
  } finally {
    if (provisioned && provisioned.id) {
      try { await tearDownStack(provisioned); } catch (_) { /* server destroy below still fires */ }
      try { await destroyThrowawayServer(provisioned); } catch (_) { /* swept by orphan cron */ }
    }
  }
}

const engine = { kind: 'throwaway-server-burst', image: 'undici burst against caddy in the throwaway compose stack', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-reload-burst', engine, runProbe);
}

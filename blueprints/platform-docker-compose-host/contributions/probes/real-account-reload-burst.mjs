// Probe: real-account-reload-burst (v1.1.5).

// anchorAcId: AC-composeHost-zeroDowntimeReload.
// accountBound: true.

// Contract:
//   - First-tier gate CI_HAS_HETZNER_ACCOUNT must equal exactly the
//     string "true"; anything else records an honest skip row.
//   - Second-tier HCLOUD_TOKEN missing carries its own honest skip row.
//   - The pass row carries an `evidence` object with the created
//     server id, the warm baseline response, the burst counters (total,
//     2xx, drops, reload duration), the reload exit and the elicited
//     window (RELOAD_WINDOW_SECONDS, default 10s per AC).
//   - The AC requires the elicited 10-second window to bound the
//     reload duration; a reload that exceeds the window FAILS.
//   - Teardown failure FAILS the verdict (the shape rule).

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  runShim, firstTierGateSkipResult, secondTierMissingSkipResult, FIXTURE_DIR,
} from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-zeroDowntimeReload';
export const accountBound = true;

function hcloudJson(argv, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn('hcloud', argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} reject(new Error(`hcloud ${argv.join(' ')} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', (err) => { clearTimeout(timer); reject(err); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`hcloud ${argv.join(' ')} exited ${code}: ${stderr}`));
      const trimmed = stdout.trim();
      if (trimmed.length === 0) return resolvePromise([]);
      try {
        const parsed = JSON.parse(trimmed);
        resolvePromise(Array.isArray(parsed) ? parsed : (parsed.servers || []));
      } catch (err) {
        reject(new Error(`hcloud stdout not JSON: ${err.message}`));
      }
    });
  });
}

export default async function runProbe() {
  if (process.env.CI_HAS_HETZNER_ACCOUNT !== 'true') {
    return {
      results: [firstTierGateSkipResult(
        anchorAcId,
        'CI_HAS_HETZNER_ACCOUNT',
        'real-account reload-burst skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the caddy reload window against a throwaway cx23 stack.',
      )],
      extra: { skipped: true, missingEnv: ['CI_HAS_HETZNER_ACCOUNT'] },
    };
  }
  if (!process.env.HCLOUD_TOKEN) {
    return {
      results: [secondTierMissingSkipResult(
        anchorAcId,
        'HCLOUD_TOKEN',
        'the throwaway cx23 cannot be provisioned without HCLOUD_TOKEN.',
      )],
      extra: { skipped: true, missingEnv: ['HCLOUD_TOKEN'] },
    };
  }
  const reloadWindowSeconds = Number(process.env.RELOAD_WINDOW_SECONDS ?? 10);
  const reloadWindowMs = Math.round(reloadWindowSeconds * 1000);
  const { provisionThrowawayServer } = await import(resolve(FIXTURE_DIR, 'provision.mjs'));
  const { destroyThrowawayServer } = await import(resolve(FIXTURE_DIR, 'destroy.mjs'));
  const { bringUpStack, reloadBurst, tearDownStack, httpProbeOnServer } = await import(resolve(FIXTURE_DIR, 'src/compose-stack-driver.mjs'));

  const evidence = { elicitedReloadWindowSeconds: reloadWindowSeconds };
  const resultRow = { anchorAcId, verdict: 'fail', detail: '', evidence };
  let provisioned = null;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}` });
    evidence.serverId = provisioned.id;
    evidence.primaryIpv4 = provisioned.primaryIpv4;
    const brought = await bringUpStack(provisioned);
    evidence.eventTrail = brought.events;
    if (!brought.ok) {
      resultRow.verdict = 'fail';
      resultRow.detail = `stack failed at phase ${brought.phase} on server ${provisioned.id}: ${JSON.stringify(brought).slice(0, 500)}`;
      return { results: [resultRow], extra: evidence };
    }
    const warm = await httpProbeOnServer(provisioned, '/');
    evidence.warm = {
      target: warm.target, statusCode: warm.statusCode,
      bodyExcerpt: warm.bodyExcerpt, elapsedSeconds: warm.elapsedSeconds,
    };
    if (!warm.ok || warm.statusCode !== 200) {
      resultRow.verdict = 'fail';
      resultRow.detail = `caddy did not answer 200 before the burst on ${warm.target}: statusCode=${warm.statusCode} error=${warm.error || 'none'}`;
      return { results: [resultRow], extra: evidence };
    }
    // Zero-downtime reload: undici GETs on the throwaway server
    // (Node global fetch is undici) fired continuously for the
    // elicited reload-window-seconds, wrapping the caddy reload.
    // The burst-request window brackets and per-request timestamps
    // prove the overlap on a single runner clock.
    const burst = await reloadBurst(provisioned, '/', { total: 40, concurrency: 8, mode: 'undici-on-server', reloadWindowMs, burstDurationMs: reloadWindowMs });
    evidence.burst = {
      expectedTotal: burst.expectedTotal,
      total: burst.total,
      twoXx: burst.twoXx, drops: burst.drops,
      reloadDurationMs: burst.reloadDurationMs, reloadExit: burst.reloadExit,
      reloadStartedAt: burst.reloadStartedAt, reloadEndedAt: burst.reloadEndedAt,
      burstStartedAt: burst.burstStartedAt, burstEndedAt: burst.burstEndedAt,
      firstRequestStartedAt: burst.firstRequestStartedAt, lastRequestEndedAt: burst.lastRequestEndedAt,
      burstDurationMs: burst.burstDurationMs,
      burstWindowContainsReloadWindow: burst.burstWindowContainsReloadWindow,
      overlapCount: burst.overlapCount,
      firstOverlapStart: burst.firstOverlapStart, lastOverlapEnd: burst.lastOverlapEnd,
      mode: burst.mode,
      onServerNodeVersion: burst.onServerNodeVersion,
      reloadStderrExcerpt: burst.reloadStderrExcerpt,
      burstStderrExcerpt: burst.burstStderrExcerpt,
      burstParseError: burst.burstParseError,
      elicitedReloadWindowMs: reloadWindowMs,
    };
    if (burst.reloadExit !== 0) {
      resultRow.verdict = 'fail';
      resultRow.detail = `caddy reload exited non-zero (${burst.reloadExit}): ${burst.reloadStderrExcerpt}`;
      return { results: [resultRow], extra: evidence };
    }
    // The duration-based burst runs for the elicited window and
    // fires as many requests as the loopback plus concurrency allow;
    // expectedTotal is a floor (at least this many GETs must be
    // observed inside the window), never a ceiling.
    if (burst.total < burst.expectedTotal) {
      resultRow.verdict = 'fail';
      resultRow.detail = `undici burst produced ${burst.total} outcomes in the ${burst.burstDurationMs}ms burst window, below the ${burst.expectedTotal}-request floor AC-composeHost-zeroDowntimeReload requires.`;
      return { results: [resultRow], extra: evidence };
    }
    if (burst.drops > 0 || burst.twoXx < burst.total) {
      resultRow.verdict = 'fail';
      resultRow.detail = `zero-downtime-reload violated on server ${provisioned.id}: ${burst.twoXx}/${burst.total} 2xx, ${burst.drops} dropped connections during a ${burst.reloadDurationMs}ms reload.`;
      return { results: [resultRow], extra: evidence };
    }
    // Overlap proof: the burst window must contain the reload window
    // (AC-composeHost-zeroDowntimeReload requires undici requests to
    // overlap the reload; the burst being in flight for the whole
    // reload is the strictest reading), and at least one request must
    // have overlapped the reload window.
    if (!burst.burstWindowContainsReloadWindow) {
      resultRow.verdict = 'fail';
      resultRow.detail = `undici burst-request window [${burst.firstRequestStartedAt},${burst.lastRequestEndedAt}] did not contain the reload window [${burst.reloadStartedAt},${burst.reloadEndedAt}]; AC-composeHost-zeroDowntimeReload requires the burst to run WHILE the reload runs.`;
      return { results: [resultRow], extra: evidence };
    }
    if (burst.overlapCount === 0) {
      resultRow.verdict = 'fail';
      resultRow.detail = `undici burst produced ${burst.total} 2xx results but ZERO request windows [startedAt,endedAt] overlapped the reload window [${burst.reloadStartedAt},${burst.reloadEndedAt}]; AC-composeHost-zeroDowntimeReload requires the burst to run WHILE the reload runs.`;
      return { results: [resultRow], extra: evidence };
    }
    if (burst.reloadDurationMs > reloadWindowMs) {
      resultRow.verdict = 'fail';
      resultRow.detail = `caddy reload duration ${burst.reloadDurationMs}ms exceeded the elicited reload-window-seconds ${reloadWindowSeconds}s (${reloadWindowMs}ms); AC-composeHost-zeroDowntimeReload requires the reload to fit inside the elicited window.`;
      return { results: [resultRow], extra: evidence };
    }
    resultRow.verdict = 'pass';
    resultRow.detail = `zero-downtime-reload OBSERVED on server ${provisioned.id}: ${burst.twoXx}/${burst.total} on-server undici 2xx, 0 dropped connections; burst-request window [${burst.firstRequestStartedAt},${burst.lastRequestEndedAt}] contains reload window [${burst.reloadStartedAt},${burst.reloadEndedAt}]; ${burst.overlapCount}/${burst.total} request windows overlap the ${burst.reloadDurationMs}ms reload (under the elicited ${reloadWindowSeconds}s window); warm baseline statusCode=${warm.statusCode}.`;
  } catch (err) {
    resultRow.verdict = 'fail';
    resultRow.detail = `reload-burst threw: ${err.message}`;
    evidence.error = err.stack || err.message;
    return { results: [resultRow], extra: evidence };
  } finally {
    if (provisioned && provisioned.id) {
      try {
        const tearDownDown = await tearDownStack(provisioned);
        evidence.composeDown = { code: tearDownDown && tearDownDown.code, stderrExcerpt: (tearDownDown && tearDownDown.stderr || '').slice(0, 300) };
        if (tearDownDown && tearDownDown.code !== 0) {
          resultRow.verdict = 'fail';
          resultRow.detail = `${resultRow.detail} TEARDOWN docker compose down exited ${tearDownDown.code}: ${(tearDownDown.stderr || '').slice(0, 300)}`;
        }
      } catch (err) {
        resultRow.verdict = 'fail';
        resultRow.detail = `${resultRow.detail} TEARDOWN docker compose down failed: ${err.message}`;
        evidence.composeDownError = err.message;
      }
      try {
        await destroyThrowawayServer(provisioned);
        evidence.teardown = { destroyed: provisioned.id };
        try {
          const postList = await hcloudJson(['server', 'list', '--output', 'json']);
          evidence.postTeardownServerIds = postList.map((s) => s.id);
          if (postList.some((s) => s.id === provisioned.id)) {
            resultRow.verdict = 'fail';
            resultRow.detail = `${resultRow.detail} TEARDOWN INCOMPLETE: server ${provisioned.id} still present in hcloud server list.`;
          }
        } catch (err) {
          evidence.postTeardownListError = err.message;
          resultRow.verdict = 'fail';
          resultRow.detail = `${resultRow.detail} TEARDOWN CONFIRMATION FAILED: post-teardown hcloud server list threw (${err.message}); cannot confirm server ${provisioned.id} was removed.`;
        }
      } catch (err) {
        resultRow.verdict = 'fail';
        resultRow.detail = `${resultRow.detail} TEARDOWN FAILED for server ${provisioned.id}: ${err.message}.`;
        evidence.teardownError = err.message;
        evidence.orphanServerId = provisioned.id;
      }
    }
  }
  return { results: [resultRow], extra: evidence };
}

const engine = { kind: 'throwaway-server-burst', image: 'curl burst against caddy in the throwaway compose stack', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-reload-burst', engine, runProbe);
}

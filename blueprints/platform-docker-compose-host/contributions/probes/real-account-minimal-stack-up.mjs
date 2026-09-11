// Probe: real-account-minimal-stack-up (v1.1.5).

// anchorAcId: AC-composeHost-upClean.
// accountBound: true.

// Contract:
//   - First-tier gate CI_HAS_HETZNER_ACCOUNT must equal exactly the
//     string "true"; anything else records an honest skip row.
//   - Second-tier HCLOUD_TOKEN missing carries its own honest skip row.
//   - The AC-composeHost-upClean pass row carries an `evidence`
//     object with the created server id, the compose ps service
//     list, the on-server HTTP response (statusCode and body
//     excerpt) proving the deployed stack URL answers, and the
//     root-path body sample that reads the mounted secret file
//     (`tokenPresence`).
//   - After the stack is up, the probe emits one additional row per
//     mounted secret anchored to AC-composeHost-secretShape whose
//     evidence carries the in-container mode observed via
//     `docker exec <container> stat -c %a /run/secrets/<name>`; this
//     is the "mounted at mode 0o400" observation the offline scan
//     cannot make. The row FAILS if the observed mode is anything
//     other than 400.
//   - Teardown failure FAILS the verdict.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  runShim, firstTierGateSkipResult, secondTierMissingSkipResult, FIXTURE_DIR,
} from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-upClean';
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
        'real-account minimal-stack-up skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the compose stack against a throwaway cx23.',
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
  const { provisionThrowawayServer } = await import(resolve(FIXTURE_DIR, 'provision.mjs'));
  const { destroyThrowawayServer } = await import(resolve(FIXTURE_DIR, 'destroy.mjs'));
  const { bringUpStack, httpProbe, httpProbeOnServer, tearDownStack, observeSecretModes } = await import(resolve(FIXTURE_DIR, 'src/compose-stack-driver.mjs'));

  const evidence = {};
  const resultRow = { anchorAcId, verdict: 'fail', detail: '', evidence };
  const extraRows = [];
  let provisioned = null;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? `local-${Date.now()}` });
    evidence.serverId = provisioned.id;
    evidence.primaryIpv4 = provisioned.primaryIpv4;
    const brought = await bringUpStack(provisioned);
    evidence.services = brought.services;
    evidence.declaredServices = brought.declared;
    evidence.observedNames = brought.observedNames;
    evidence.eventTrail = brought.events;
    evidence.elicitedTimeoutSeconds = brought.elicitedTimeoutSeconds;
    if (!brought.ok) {
      resultRow.verdict = 'fail';
      const detailPieces = [`stack failed at phase ${brought.phase} on server ${provisioned.id} (elicited timeout ${brought.elicitedTimeoutSeconds}s)`];
      if (brought.missingServices && brought.missingServices.length > 0) {
        detailPieces.push(`missing services: ${brought.missingServices.map((m) => m.name).join(', ')}`);
        evidence.missingServices = brought.missingServices;
      }
      if (brought.unhealthy && brought.unhealthy.length > 0) {
        detailPieces.push(`unhealthy services: ${brought.unhealthy.map((u) => `${u.service}(${u.reason})`).join('; ')}`);
        evidence.unhealthyServices = brought.unhealthy;
      }
      resultRow.detail = `${detailPieces.join('; ')}. Trailer: ${JSON.stringify(brought).slice(0, 400)}`;
      return { results: [resultRow], extra: evidence };
    }
    const onServer = await httpProbeOnServer(provisioned, '/live');
    const onServerRoot = await httpProbeOnServer(provisioned, '/');
    const externalUrl = `http://${provisioned.primaryIpv4}/live`;
    const external = await httpProbe(externalUrl, { timeoutMs: 5000 });
    evidence.onServer = {
      target: onServer.target, statusCode: onServer.statusCode,
      bodyExcerpt: onServer.bodyExcerpt, elapsedSeconds: onServer.elapsedSeconds,
      requestId: onServer.requestId,
    };
    evidence.onServerRoot = {
      target: onServerRoot.target, statusCode: onServerRoot.statusCode,
      bodyExcerpt: onServerRoot.bodyExcerpt,
    };
    evidence.external = {
      url: externalUrl, statusCode: external.statusCode, error: external.error || null,
      note: 'off-host fetch expected to fail under the deploy-hetzner-server DOCKER-USER hardening',
    };
    if (!onServer.ok || onServer.statusCode !== 200) {
      resultRow.verdict = 'fail';
      resultRow.detail = `caddy /live did not return 200 on ${onServer.target}: statusCode=${onServer.statusCode} error=${onServer.error || 'none'} bodyExcerpt=${onServer.bodyExcerpt || ''}`;
      return { results: [resultRow], extra: evidence };
    }
    resultRow.verdict = 'pass';
    resultRow.detail = `stack up on server ${provisioned.id} (${provisioned.primaryIpv4}); ${brought.services.length} services declared; caddy answered ${onServer.target} with ${onServer.statusCode} body="${(onServer.bodyExcerpt || '').replace(/\n/g, ' ')}" elapsed=${onServer.elapsedSeconds}s; root ${onServerRoot.target} returned ${onServerRoot.statusCode}.`;

    // In-container secret mode observation. AC-composeHost-secretShape
    // requires the mounted secret file to land at mode 0o400 inside
    // the container; the offline scan cannot see that. Run
    // `docker exec ... stat -c %a /run/secrets/<name>` for every
    // consuming service.
    try {
      const modes = await observeSecretModes(provisioned);
      evidence.observedSecretModes = modes;
      for (const obs of modes.observations) {
        const modePass = obs.mode === '400';
        extraRows.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: modePass ? 'pass' : 'fail',
          detail: modePass
            ? `service '${obs.service}' secret '${obs.secretName}' mounted at ${obs.mountPath} with observed mode ${obs.mode} inside container ${obs.containerId} (docker exec stat -c %a)`
            : `service '${obs.service}' secret '${obs.secretName}' mounted at ${obs.mountPath} with observed mode ${obs.mode}; AC-composeHost-secretShape requires 0o400 (400)`,
          evidence: {
            service: obs.service,
            secretName: obs.secretName,
            mode: obs.mode,
            mountPath: obs.mountPath,
            containerId: obs.containerId,
            source: 'docker exec stat -c %a',
          },
        });
      }
      for (const err of modes.errors) {
        extraRows.push({
          anchorAcId: 'AC-composeHost-secretShape',
          verdict: 'fail',
          detail: `could not observe in-container mode for service '${err.service}' secret '${err.secretName}': ${err.error}`,
          evidence: {
            service: err.service,
            secretName: err.secretName,
            error: err.error,
            source: 'docker exec stat -c %a',
          },
        });
      }
      // Every top-level secret must be consumed by at least one
      // service (an orphan is a defect the offline scan also catches;
      // this real-account row confirms the same on the live compose
      // graph).
      for (const [secretName, consumers] of Object.entries(modes.consumingServicesBySecret)) {
        if (!consumers.length) {
          extraRows.push({
            anchorAcId: 'AC-composeHost-secretShape',
            verdict: 'fail',
            detail: `top-level secret '${secretName}' has no consuming service in the applied compose graph`,
            evidence: { secretName, consumingServices: [], source: 'live docker compose ps + compose.yaml services block' },
          });
        }
      }
      if (extraRows.some((r) => r.verdict === 'fail')) {
        resultRow.verdict = 'fail';
        resultRow.detail = `${resultRow.detail} SECRET MODE observation carries at least one fail row; see evidence.observedSecretModes.`;
      }
    } catch (err) {
      extraRows.push({
        anchorAcId: 'AC-composeHost-secretShape',
        verdict: 'fail',
        detail: `observeSecretModes threw: ${err.message}`,
        evidence: { error: err.message, source: 'docker exec stat -c %a' },
      });
      resultRow.verdict = 'fail';
      resultRow.detail = `${resultRow.detail} SECRET MODE observation threw: ${err.message}.`;
    }
  } catch (err) {
    resultRow.verdict = 'fail';
    resultRow.detail = `minimal-stack-up threw: ${err.message}`;
    evidence.error = err.stack || err.message;
    return { results: [resultRow], extra: evidence };
  } finally {
    if (provisioned && provisioned.id) {
      let tearDownDown = null;
      try {
        tearDownDown = await tearDownStack(provisioned);
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
  return { results: [resultRow, ...extraRows], extra: evidence };
}

const engine = { kind: 'throwaway-server', image: 'hetzner cx23 in fsn1 via provision.mjs', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('real-account-minimal-stack-up', engine, runProbe);
}

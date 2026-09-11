// Probe: real-account cloud-init hardened (v1.1.4 closure fix).
//
// anchorAcId: AC-37105-1. accountBound: true.
//
// Addendum-driven contract:
//   - First-tier gate CI_HAS_HETZNER_ACCOUNT must equal exactly the
//     string "true"; anything else records an honest skip row.
//   - Second-tier HCLOUD_TOKEN missing carries its own honest skip row.
//   - The pass row carries an `evidence` object with the created
//     server id, the ssh readiness result, the cloud-init status exit
//     code and every baseline block's stdout excerpt (bounded).
//   - A non-zero exit from `cloud-init status --wait` FAILS the
//     verdict; the six baseline checks that follow are diagnostic in
//     that case rather than the verdict.
//   - Teardown lives in a finally block and its failure FAILS the
//     verdict (Addendum rule 5).

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import {
  firstTierGateSkipResult, secondTierMissingSkipResult, FIXTURE_DIR,
} from './probe-utils.mjs';

export const anchorAcId = 'AC-37105-1';
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
        'real-account cloud-init hardened check skipped; run with CI_HAS_HETZNER_ACCOUNT=true to exercise the six ssh baseline checks against a throwaway cx23.',
      )],
      extra: { skipped: true, missingEnv: ['CI_HAS_HETZNER_ACCOUNT'] },
    };
  }
  if (!process.env.HCLOUD_TOKEN) {
    return {
      results: [secondTierMissingSkipResult(
        anchorAcId,
        'HCLOUD_TOKEN',
        'the throwaway server cannot be provisioned without HCLOUD_TOKEN.',
      )],
      extra: { skipped: true, missingEnv: ['HCLOUD_TOKEN'] },
    };
  }
  const provisionPath = resolve(FIXTURE_DIR, 'provision.mjs');
  const destroyPath = resolve(FIXTURE_DIR, 'destroy.mjs');
  const sshCheckPath = resolve(FIXTURE_DIR, 'src/ssh-baseline-check.mjs');
  const { provisionThrowawayServer } = await import(provisionPath);
  const { destroyThrowawayServer } = await import(destroyPath);
  const { runSshBaselineChecks } = await import(sshCheckPath);

  const evidence = {};
  const resultRow = { anchorAcId, verdict: 'fail', detail: '', evidence };
  let provisioned;
  try {
    provisioned = await provisionThrowawayServer({ runId: process.env.GITHUB_RUN_ID ?? 'local' });
    evidence.serverId = provisioned.id;
    evidence.serverName = provisioned.name;
    evidence.primaryIpv4 = provisioned.primaryIpv4;
    const report = await runSshBaselineChecks(provisioned);
    evidence.sshReadiness = report.readiness;
    evidence.cloudInit = report.cloudInit;
    evidence.baselineChecks = report.checks.map((c) => ({
      id: c.id,
      verdict: c.verdict,
      stdoutExcerpt: (c.detail || '').slice(0, 200),
    }));
    // Rule 6 of the fix list: cloud-init non-zero FAILS the verdict.
    if (!report.cloudInit || report.cloudInit.code !== 0) {
      resultRow.verdict = 'fail';
      resultRow.detail = `cloud-init status --wait exited ${report.cloudInit ? report.cloudInit.code : 'null'} on server ${provisioned.id}; the ssh baseline checks are diagnostic and do not carry the verdict when cloud-init did not reach a terminal success state. stderr: ${(report.cloudInit && report.cloudInit.stderr) || ''}`;
      return { results: [resultRow], extra: evidence };
    }
    const failed = report.checks.filter((c) => c.verdict === 'fail');
    if (failed.length > 0) {
      // Fail with per-block detail on the FIRST failing block so the
      // result row carries a specific failure locus; the full check
      // list is in evidence.baselineChecks.
      const first = failed[0];
      resultRow.verdict = 'fail';
      resultRow.detail = `cloud-init baseline block "${first.label}" failed on server ${provisioned.id}: ${first.detail}`;
      return { results: [resultRow], extra: evidence };
    }
    const blocks = report.checks.filter((c) => c.verdict === 'pass').map((c) => c.id);
    resultRow.verdict = 'pass';
    resultRow.detail = `cloud-init reached terminal state on server ${provisioned.id} (cloud-init status --wait exit 0); six baseline hardening blocks observed: ${blocks.join(', ')}.`;
  } catch (err) {
    resultRow.verdict = 'fail';
    resultRow.detail = `check failed: ${err.message}`;
    evidence.checkError = err.message;
    return { results: [resultRow], extra: evidence };
  } finally {
    if (provisioned && provisioned.id) {
      try {
        await destroyThrowawayServer(provisioned);
        evidence.teardown = { destroyed: provisioned.id };
        try {
          const finalList = await hcloudJson(['server', 'list', '--output', 'json']);
          evidence.postTeardownServerIds = finalList.map((s) => s.id);
          if (finalList.some((s) => s.id === provisioned.id)) {
            resultRow.verdict = 'fail';
            resultRow.detail = `${resultRow.detail} TEARDOWN INCOMPLETE: server ${provisioned.id} still present in hcloud server list.`;
          }
        } catch (err) {
          evidence.postTeardownListError = err.message;
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

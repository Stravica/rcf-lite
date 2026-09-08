// Probe: caddyfile-validate.
//
// anchorAcId: AC-composeHost-reverseProxyArtefactValid.
// accountBound: false.
//
// Runs caddy validate against the applied fixture caddy/Caddyfile. When
// a local caddy binary is not on PATH the probe uses the caddy:2
// container image via docker run --rm (pinned tag), so review machines
// without a local caddy still get a real validation. When neither is
// available the probe records skipped with a warn note.
//
// The applying project may set reverseProxy to a value other than caddy
// (traefik or none per ADR-3902); when that happens the probe returns
// skipped with note.
//
// Mutation:
// - SIMULATE_INVALID_CADDYFILE=true writes an obviously-invalid
//   directive (\"not-a-directive-at-all\") into a scratch copy of the
//   Caddyfile; the probe FAILS naming the offending line.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runShim, CADDYFILE_PATH, whichCaddy, whichDocker } from './probe-utils.mjs';

export const anchorAcId = 'AC-composeHost-reverseProxyArtefactValid';
export const accountBound = false;

function isCaddyReverseProxy() {
  // Applying project passes reverseProxy via env for the probe run; the
  // shipped default per ADR-3902 is caddy.
  const v = process.env.REVERSE_PROXY;
  if (v === undefined || v === 'caddy') return true;
  return false;
}

export default async function runProbe() {
  const results = [];
  const extra = {};
  extra.mutations = { invalidCaddyfile: process.env.SIMULATE_INVALID_CADDYFILE === 'true' };
  extra.reverseProxy = process.env.REVERSE_PROXY ?? 'caddy';
  if (!isCaddyReverseProxy()) {
    results.push({
      anchorAcId,
      verdict: 'skipped',
      detail: `reverseProxy=${extra.reverseProxy}: caddyfile-validate skipped (applies only when reverseProxy=caddy)`,
    });
    return { results, extra };
  }
  const scratchDir = join(tmpdir(), `rcf-lite-t2-caddyfile-validate-${Date.now()}`);
  await mkdir(scratchDir, { recursive: true });
  const scratchPath = join(scratchDir, 'Caddyfile');
  try {
    let text = await readFile(CADDYFILE_PATH, 'utf8');
    if (process.env.SIMULATE_INVALID_CADDYFILE === 'true') {
      text = text + "\n{ unclosed_block_that_never_ends_and_is_a_syntax_error_caddy_will_reject\n";
    }
    await writeFile(scratchPath, text, 'utf8');
    const localCaddy = whichCaddy();
    const localDocker = whichDocker();
    extra.caddyLocal = localCaddy;
    extra.dockerLocal = localDocker;
    let cmd, args, engineLabel;
    if (localCaddy !== null) {
      cmd = 'caddy';
      args = ['validate', '--config', scratchPath, '--adapter', 'caddyfile'];
      engineLabel = `local caddy ${localCaddy}`;
    } else if (localDocker !== null) {
      cmd = 'docker';
      args = ['run', '--rm', '-v', `${scratchDir}:/etc/caddy:ro`, 'caddy:2',
        'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'];
      engineLabel = 'caddy:2 container (docker run --rm)';
    } else {
      results.push({
        anchorAcId,
        verdict: 'warn',
        detail: 'neither caddy binary nor docker on PATH; caddy validate could not be exercised',
      });
      return { results, extra };
    }
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000 });
    extra.exitStatus = r.status;
    extra.engineLabel = engineLabel;
    const tail = ((r.stderr || '') + (r.stdout || '')).split('\n').slice(-10).join('\n');
    if (r.status === 0) {
      results.push({
        anchorAcId,
        verdict: 'pass',
        detail: `caddy validate exit 0 (${engineLabel}); tail: ${tail.slice(-200)}`,
      });
    } else {
      results.push({
        anchorAcId,
        verdict: 'fail',
        detail: `caddy validate exit ${r.status} (${engineLabel}); tail: ${tail.slice(-400)}`,
      });
    }
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
  return { results, extra };
}

const engine = { kind: 'caddy-validate', image: 'caddy:2 (or local caddy binary)', healthy: true };
if (import.meta.url === `file://${process.argv[1]}`) {
  await runShim('caddyfile-validate', engine, runProbe);
}

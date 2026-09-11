/**
 * Apply-time refusal probe.
 *
 * Invokes rcf define blueprint add ./blueprints/jobs-background on a
 * fresh scratch project WITH NO applied queue provider. Asserts exit 3,
 * greps stderr for [jobs-background-no-queue] tag on the first line,
 * greps stderr for the explicit provider name messaging-queue-cloudflare,
 * and greps stderr for the override flag --allow-no-queue-yet.
 *
 * Anchors AC-jobs-requiresQueue.
 *
 * Q3 default per spec section 10: asserts BOTH exit code AND stable
 * message id.
 *
 * The bare scratch project is created under a scratch tmp directory
 * (not committed). rcf-lite is invoked via its bin script.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_ROOT } from './probe-utils.mjs';

const AC_FIRST8 = 'On a fresh init scratch project with NO';

const HERE = dirname(fileURLToPath(import.meta.url));
const BLUEPRINT_DIR = resolve(HERE, '..', '..');
const RCF_BIN = resolve(PROJECT_ROOT, 'packages/rcf-lite/bin/rcf.js');

function runNode(args, opts = {}) {
  return new Promise((resolveP) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('close', (code) => resolveP({ code, stdout, stderr }));
  });
}

export default async function runProbe() {
  const scratch = await mkdtemp(join(tmpdir(), 'jobs-bg-refuse-'));
  try {
    // 1. Init a bare rcf project (no applied blueprints).
    const init = await runNode([RCF_BIN, 'init'], { cwd: scratch });
    if (init.code !== 0) {
      return [{
        anchorAcId: 'AC-jobs-requiresQueue',
        verdict: 'fail',
        detail: `${AC_FIRST8} - rcf init failed exit=${init.code} stderr=${init.stderr}`,
        evidence: { initExitCode: init.code, initStderrSample: init.stderr.slice(0, 400) },
      }];
    }
    // 2. Attempt to apply jobs-background on the bare project.
    const apply = await runNode(
      [RCF_BIN, 'define', 'blueprint', 'add', BLUEPRINT_DIR],
      { cwd: scratch },
    );
    const results = [];
    const firstLine = apply.stderr.split('\n')[0] ?? '';
    const tagMatch = firstLine.includes('[jobs-background-no-queue]');
    const providerMatch = apply.stderr.includes('messaging-queue-cloudflare');
    const overrideMatch = apply.stderr.includes('--allow-no-queue-yet');
    const codeMatch = apply.code === 3;
    const pass = codeMatch && tagMatch && providerMatch && overrideMatch;
    results.push({
      anchorAcId: 'AC-jobs-requiresQueue',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `${AC_FIRST8} - exit=${apply.code}; stderr first line carries [jobs-background-no-queue] tag; stderr names messaging-queue-cloudflare; stderr names --allow-no-queue-yet`
        : `${AC_FIRST8} - expected exit=3 AND first-line tag [jobs-background-no-queue] AND messaging-queue-cloudflare AND --allow-no-queue-yet; got exit=${apply.code}; firstLine='${firstLine}'; tagMatch=${tagMatch}; providerMatch=${providerMatch}; overrideMatch=${overrideMatch}`,
      evidence: { exitCode: apply.code, stderrFirstLine: firstLine, tagPresent: tagMatch, providerPresent: providerMatch, overrideFlagPresent: overrideMatch },
    });
    // Do NOT include the scratch dir path in the committed report; it is
    // a per-run tmp path and would leak the machine's tmp naming into the
    // gate-time evidence file.
    return { results, extra: { exitCode: apply.code, stderrFirstLine: firstLine } };
  } finally {
    // rm -rf the scratch dir (deletion discipline: literal absolute
    // scratch path created this call).
    try { await rm(scratch, { recursive: true, force: true }); } catch (err) {
      results.push({
        anchorReqId: 'jobs-background-REQ-001',
        verdict: 'fail',
        detail: 'The jobs-background blueprint composes on an applied queue - scratch dir teardown failed: ' + (err && err.message),
        evidence: { teardownStep: 'rm scratch', error: err && err.message },
      });
    }
  }
}

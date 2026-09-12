/**
 * Apply-time override probe.
 *
 * Invokes rcf define blueprint add ./blueprints/jobs-background
 * --allow-no-queue-yet on a fresh scratch project WITH NO applied queue
 * provider. Asserts exit 0, asserts rcf/blueprints/jobs-background
 * .applied.json exists with allowNoAuthYet true, appliedCapabilities [],
 * and notes containing 'no queue yet' + '--allow-no-queue-yet' + 'queue'
 * (but NOT 'no auth yet' nor 'no secrets-management yet').
 *
 * Anchors AC-jobs-overrideRecorded.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
  const scratch = await mkdtemp(join(tmpdir(), 'jobs-bg-override-'));
  try {
    const init = await runNode([RCF_BIN, 'init'], { cwd: scratch });
    if (init.code !== 0) {
      return [{
        anchorAcId: null,
        conformanceOnly: true,
        limitation: `${OVERRIDE_PRECOND_LIM}`,
        verdict: 'fail',
        detail: `conformanceOnly (${OVERRIDE_PRECOND_LIM}) - rcf init failed exit=${init.code} stderr=${init.stderr}`,
        evidence: { initExitCode: init.code, initStderrSample: init.stderr.slice(0, 400) },
      }];
    }
    const apply = await runNode(
      [RCF_BIN, 'define', 'blueprint', 'add', BLUEPRINT_DIR, '--allow-no-queue-yet'],
      { cwd: scratch },
    );
    if (apply.code !== 0) {
      return [{
        anchorAcId: null,
        conformanceOnly: true,
        limitation: `${OVERRIDE_PRECOND_LIM}`,
        verdict: 'fail',
        detail: `conformanceOnly (${OVERRIDE_PRECOND_LIM}) - apply --allow-no-queue-yet expected exit 0; got exit=${apply.code} stderr=${apply.stderr}`,
        evidence: { applyExitCode: apply.code, applyStderrSample: apply.stderr.slice(0, 400) },
      }];
    }
    // Sidecar path.
    const sidecarPath = join(scratch, 'rcf', 'blueprints', 'jobs-background.applied.json');
    try { await stat(sidecarPath); } catch {
      return [{
        anchorAcId: null,
        conformanceOnly: true,
        limitation: `${OVERRIDE_PRECOND_LIM}`,
        verdict: 'fail',
        detail: `conformanceOnly (${OVERRIDE_PRECOND_LIM}) - sidecar ${sidecarPath} missing after --allow-no-queue-yet apply`,
        evidence: { sidecarPathAbsent: true },
      }];
    }
    const doc = JSON.parse(await readFile(sidecarPath, 'utf8'));
    const results = [];
    const notes = typeof doc.notes === 'string' ? doc.notes : '';
    const checks = {
      slug: doc.slug === 'jobs-background',
      allowNoAuthYet: doc.allowNoAuthYet === true,
      appliedCapabilitiesEmpty: Array.isArray(doc.appliedCapabilities) && doc.appliedCapabilities.length === 0,
      notesQueueFamily: notes.includes('no queue yet'),
      notesOverrideFlag: notes.includes('--allow-no-queue-yet'),
      notesNamesCapability: notes.includes('queue'),
      notesNotAuthFamily: !notes.includes('no auth yet'),
      notesNotSecretsFamily: !notes.includes('no secrets-management yet'),
    };
    const pass = Object.values(checks).every(Boolean);
    // The apply-time-override property is observed by CLI exit code
    // and sidecar-notes grep; no engine-minted id is produced on this
    // row (a sidecar-notes assertion, not a runtime job/message id).
    // Row is conformanceOnly against AC-jobs-overrideRecorded with
    // the no-engine-id clause named on the limitation.
    results.push({
      anchorAcId: null,
      conformanceOnly: true,
      limitation: `AC-jobs-overrideRecorded: with the override flag the apply verb exits 0 and the sidecar carries 'no queue yet' and '--allow-no-queue-yet' on notes; observed here through CLI exit code and sidecar grep. Not observed on this row: an engine-minted id (the sidecar-notes assertion is compose-time, not runtime).`,
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `${AC_FIRST8} - exit=0; sidecar recorded slug=jobs-background allowNoAuthYet=true appliedCapabilities=[]; notes carry 'no queue yet' + '--allow-no-queue-yet' + 'queue' and none of the auth/secrets family words`
        : `${AC_FIRST8} - checks=${JSON.stringify(checks)}; notes='${notes}'`,
      evidence: { checks, sidecarDoc: doc, exitCode: apply.code },
    });
    // Do NOT include the sidecarPath (a per-run tmp path) in the report;
    // the sidecar contents (doc) is the load-bearing evidence.
    return { results, extra: { sidecar: doc } };
  } finally {
    try { await rm(scratch, { recursive: true, force: true }); } catch (err) {
      results.push({
        anchorAcId: null,
        conformanceOnly: true,
        limitation: `${TEARDOWN_PRECOND_LIM}`,
        verdict: 'fail',
        detail: 'conformanceOnly (' + TEARDOWN_PRECOND_LIM + ') - scratch dir teardown failed: ' + (err && err.message),
        evidence: { teardownStep: 'rm scratch', error: err && err.message },
      });
    }
  }
}

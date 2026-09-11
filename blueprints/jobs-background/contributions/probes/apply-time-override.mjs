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
        anchorAcId: 'AC-jobs-overrideRecorded',
        verdict: 'fail',
        detail: `rcf init failed exit=${init.code} stderr=${init.stderr}`,
      }];
    }
    const apply = await runNode(
      [RCF_BIN, 'define', 'blueprint', 'add', BLUEPRINT_DIR, '--allow-no-queue-yet'],
      { cwd: scratch },
    );
    if (apply.code !== 0) {
      return [{
        anchorAcId: 'AC-jobs-overrideRecorded',
        verdict: 'fail',
        detail: `apply --allow-no-queue-yet expected exit 0; got exit=${apply.code} stderr=${apply.stderr}`,
      }];
    }
    // Sidecar path.
    const sidecarPath = join(scratch, 'rcf', 'blueprints', 'jobs-background.applied.json');
    try { await stat(sidecarPath); } catch {
      return [{
        anchorAcId: 'AC-jobs-overrideRecorded',
        verdict: 'fail',
        detail: `sidecar ${sidecarPath} missing after --allow-no-queue-yet apply`,
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
    results.push({
      anchorAcId: 'AC-jobs-overrideRecorded',
      verdict: pass ? 'pass' : 'fail',
      detail: pass
        ? `exit=0; sidecar recorded slug=jobs-background allowNoAuthYet=true appliedCapabilities=[]; notes carry 'no queue yet' + '--allow-no-queue-yet' + 'queue' and none of the auth/secrets family words`
        : `checks=${JSON.stringify(checks)}; notes='${notes}'`,
      evidence: { checks, sidecarDoc: doc, exitCode: apply.code },
    });
    // Do NOT include the sidecarPath (a per-run tmp path) in the report;
    // the sidecar contents (doc) is the load-bearing evidence.
    return { results, extra: { sidecar: doc } };
  } finally {
    try { await rm(scratch, { recursive: true, force: true }); } catch (err) {
      results.push({
        anchorReqId: 'jobs-background-REQ-001',
        verdict: 'fail',
        detail: 'Requires an applied queue capability; refuses apply - scratch dir teardown failed: ' + (err && err.message),
        evidence: { teardownStep: 'rm scratch', error: err && err.message },
      });
    }
  }
}

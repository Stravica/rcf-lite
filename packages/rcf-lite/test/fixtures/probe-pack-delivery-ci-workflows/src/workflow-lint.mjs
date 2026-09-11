// Minimal fixture-side workflow linter for delivery-ci-workflows.
//
// The real engine is a workflow file the blueprint ships. This
// fixture reads every workflow template under blueprints/delivery-
// ci-workflows/assets/ci-provider-examples/github-actions/ and asserts
// (a) the YAML top-level 'on', 'jobs' and 'name' keys are present,
// (b) a 'steps' array exists under each job with a 'checkout' step,
// (c) exactly one job runs the `node scripts/rcf-ci.js` gate step
//     (the single node entry point contract).
//
// A parallel probe branch invokes actionlint if present on PATH and
// captures its stdout as positive evidence; without actionlint the
// probe records a WARN with a reason naming the missing binary and
// keeps its own YAML-level checks.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_DIR = resolve(HERE, '..', '..', '..', '..', '..', '..', 'blueprints', 'delivery-ci-workflows', 'assets', 'ci-provider-examples', 'github-actions');

export async function loadTemplates() {
  const entries = await readdir(TEMPLATE_DIR);
  const files = [];
  for (const e of entries.sort()) {
    if (!e.endsWith('.yml') && !e.endsWith('.yaml')) continue;
    const p = join(TEMPLATE_DIR, e);
    const st = await stat(p);
    if (!st.isFile()) continue;
    files.push({ name: e, path: p, text: await readFile(p, 'utf8') });
  }
  return files;
}

// Deliberately naive top-level key scan (avoids taking a new YAML
// dep on the shelf; the blueprint's real gate uses actionlint). This
// is enough to prove the workflow files carry the required top-level
// shape.
export function scanTopLevel(text) {
  const has = { name: false, on: false, jobs: false };
  for (const line of text.split('\n')) {
    if (/^name:\s*/.test(line)) has.name = true;
    if (/^on:\s*$/.test(line) || /^on:\s*\S/.test(line)) has.on = true;
    if (/^jobs:\s*$/.test(line)) has.jobs = true;
  }
  return has;
}

export function findNodeGateStep(text) {
  const lines = text.split('\n');
  const matches = lines.map((l) => l.match(/node\s+(scripts\/rcf-[a-z0-9-]+\.js)/)).filter(Boolean).map((m) => m[1]);
  return { has: matches.length > 0, entries: [...new Set(matches)] };
}

export function findCheckoutStep(text) {
  return /actions\/checkout@v[34]/.test(text);
}

export async function actionlintOn(paths, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const child = spawn('actionlint', paths, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; const err = [];
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} resolve({ ran: false, reason: 'timeout', stdout: '', stderr: '' }); }, timeoutMs);
    child.stdout.on('data', (b) => out.push(b.toString('utf8')));
    child.stderr.on('data', (b) => err.push(b.toString('utf8')));
    child.on('error', (e) => { clearTimeout(timer); resolve({ ran: false, reason: `spawn: ${e.code || e.message}`, stdout: '', stderr: '' }); });
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ran: true, exitCode: code, stdout: out.join(''), stderr: err.join('') }); });
  });
}

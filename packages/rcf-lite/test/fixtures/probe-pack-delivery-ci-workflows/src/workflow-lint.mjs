// Fixture-side workflow linter for delivery-ci-workflows.
//
// The real engine is the workflow file the blueprint ships. This
// fixture reads every workflow template under blueprints/delivery-
// ci-workflows/assets/ci-provider-examples/github-actions/ and provides
// a naive top-level scan, a per-job node-gate scan, and an actionlint
// invocation branch. The actionlint binary path can be overridden via
// the declared env var RCF_FIXTURE_CIW_ACTIONLINT_PATH (per the master
// brief); an absent actionlint records a skip naming that variable.

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

export function findCheckoutStep(text) {
  return /actions\/checkout@v[34]/.test(text);
}

// Split the workflow YAML into per-job sections by leading indentation.
// A job header sits at two-space indent under `jobs:` and its body
// includes every following line at greater indent, up to the next job
// header (also two-space) or the file end. Naive enough for the
// blueprint's templates but disciplined about not conflating jobs.
export function splitJobs(text) {
  const lines = text.split('\n');
  const jobs = [];
  let inJobs = false;
  let current = null;
  for (const line of lines) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    // Two-space indent + jobName:
    const jobHeader = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (jobHeader) {
      if (current) jobs.push(current);
      current = { name: jobHeader[1], lines: [] };
      continue;
    }
    // Any line at four+ spaces indent (or blank) belongs to the current job.
    if (current && (line === '' || /^\s{4,}/.test(line))) {
      current.lines.push(line);
      continue;
    }
    // Line at top-level indent under `jobs:` that is not a header
    // (unexpected) stops the current job body.
    if (current && /^\S/.test(line)) {
      jobs.push(current); current = null; inJobs = false;
    }
  }
  if (current) jobs.push(current);
  return jobs.map((j) => ({ name: j.name, text: j.lines.join('\n') }));
}

// Per-job node-gate scan: an entry point in a job is a line matching
// `node scripts/rcf-<name>.js`. Returns the entries the job runs.
export function findJobEntries(jobText) {
  const matches = jobText
    .split('\n')
    .map((l) => l.match(/node\s+(scripts\/rcf-[a-z0-9-]+\.js)/))
    .filter(Boolean)
    .map((m) => m[1]);
  return [...matches];
}

// Retained for backward compatibility with the older probe shape.
export function findNodeGateStep(text) {
  const entries = findJobEntries(text);
  return { has: entries.length > 0, entries: [...new Set(entries)] };
}

export async function actionlintOn(paths, timeoutMs = 10000) {
  const overrideRaw = process.env.RCF_FIXTURE_CIW_ACTIONLINT_PATH;
  const override = overrideRaw && overrideRaw.trim() !== '' ? overrideRaw.trim() : null;
  const bin = override || 'actionlint';
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (settled) return; settled = true; resolve(v); };
    const child = spawn(bin, paths, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; const err = [];
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} settle({ ran: false, reason: 'timeout', binaryUsed: bin, overrideProvided: Boolean(override), stdout: '', stderr: '' }); }, timeoutMs);
    child.stdout.on('data', (b) => out.push(b.toString('utf8')));
    child.stderr.on('data', (b) => err.push(b.toString('utf8')));
    child.on('error', (e) => { clearTimeout(timer); settle({ ran: false, reason: `spawn: ${e.code || e.message}`, binaryUsed: bin, overrideProvided: Boolean(override), stdout: '', stderr: '' }); });
    child.on('exit', (code) => { clearTimeout(timer); settle({ ran: true, exitCode: code, binaryUsed: bin, overrideProvided: Boolean(override), stdout: out.join(''), stderr: err.join('') }); });
  });
}

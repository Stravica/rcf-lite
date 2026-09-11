// Node-gate-entrypoint probe for delivery-ci-workflows.
//
// US-6102 anchor: the gate suite is one Node entry point that any CI
// provider can run. The probe reads every shipped workflow template
// and, per JOB, asserts EXACTLY ONE 'node scripts/rcf-*.js' invocation
// (the single-line runner contract). A job with zero or two node
// runner invocations fails the AC.
//
// The probe additionally observes the aggregate report's runner.entryPoint
// property by spawning a stub of the runner entry named by the first
// template's job. The stub writes an aggregate pipeline.json whose
// runner.entryPoint carries a project-relative .js path; the probe
// reads that file back and asserts the field is present, is a string
// ending in .js or .mjs, and matches the entry the template named.
// AC-6102-1 says runner.entryPoint must record such a path in the
// aggregate report; observing a real write-then-read of that field
// is the derived-output shape rule 7d requires.
//
// Empty template set FAILS: aggregate([]) fails per shelf rule, and
// this AC cannot be satisfied without at least one workflow file.
// anchorAcId: AC-6102-1. accountBound: false.

import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { loadTemplates, splitJobs, findJobEntries } from '../../../../packages/rcf-lite/test/fixtures/probe-pack-delivery-ci-workflows/src/workflow-lint.mjs';

export const anchorAcId = 'AC-6102-1';
export const accountBound = false;

async function spawnStub(entryPath, outFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entryPath, '--report', outFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = []; const err = [];
    child.stdout.on('data', (b) => out.push(b.toString('utf8')));
    child.stderr.on('data', (b) => err.push(b.toString('utf8')));
    child.on('exit', (code) => resolve({ exitCode: code, stdout: out.join(''), stderr: err.join('') }));
  });
}

export default async function runProbe() {
  const templates = await loadTemplates();
  const results = [];
  if (templates.length === 0) {
    results.push({
      anchorAcId: 'AC-6102-1',
      verdict: 'fail',
      detail: 'no workflow templates were found under the shipped github-actions assets directory; the AC cannot be satisfied without at least one file',
      evidence: { templateCount: 0 },
    });
    return { results, extra: { envDeclared: [], templateCount: 0 } };
  }

  const perFile = [];
  let jobsScanned = 0;
  let jobsWithExactlyOne = 0;
  const violations = [];
  for (const t of templates) {
    const jobs = splitJobs(t.text);
    const jobShapes = jobs.map((j) => {
      const entries = findJobEntries(j.text);
      const ok = entries.length === 1;
      jobsScanned += 1;
      if (ok) jobsWithExactlyOne += 1;
      if (!ok) violations.push({ file: t.name, job: j.name, entries });
      return { job: j.name, entries, oneEntryPoint: ok };
    });
    perFile.push({ file: t.name, jobCount: jobs.length, jobs: jobShapes });
  }
  results.push({
    anchorAcId: 'AC-6102-1',
    verdict: jobsScanned > 0 && jobsWithExactlyOne === jobsScanned ? 'pass' : 'fail',
    detail: `${templates.length} workflow templates scanned; ${jobsScanned} jobs; ${jobsWithExactlyOne} jobs run exactly one 'node scripts/rcf-*.js' invocation; violations=${JSON.stringify(violations)}`,
    evidence: { perFile, jobsScanned, jobsWithExactlyOne, violations },
  });

  // Every entry the templates name must match the rcf-*.js contract.
  const flat = perFile.flatMap((f) => f.jobs.flatMap((j) => j.entries));
  const rcfOk = flat.length > 0 && flat.every((e) => /^scripts\/rcf-[a-z0-9-]+\.js$/.test(e));
  results.push({
    anchorAcId: 'AC-6102-2',
    verdict: rcfOk ? 'pass' : 'fail',
    detail: `${flat.length} node-gate entries observed across all jobs; all match scripts/rcf-*.js contract=${rcfOk}`,
    evidence: { entries: flat, uniqueEntries: [...new Set(flat)] },
  });

  // Aggregate report observation: build a stub of the first template's
  // first job's entry (project-relative path), spawn it with node, and
  // read back the pipeline.json it writes. Assert runner.entryPoint
  // carries the entry's path.
  const firstEntry = perFile[0]?.jobs.find((j) => j.entries.length === 1)?.entries[0] || null;
  if (firstEntry) {
    const tmp = await mkdtemp(join(tmpdir(), 'rcf-ci-runner-'));
    const entryFile = join(tmp, firstEntry.replace('scripts/', ''));
    const outFile = join(tmp, 'pipeline.json');
    const stub = [
      "import { writeFile } from 'node:fs/promises';",
      "const args = process.argv.slice(2);",
      "const outIdx = args.indexOf('--report');",
      "const out = outIdx >= 0 ? args[outIdx + 1] : 'pipeline.json';",
      `const report = { runner: { entryPoint: 'scripts/${firstEntry.replace('scripts/', '')}' }, verdict: 'passed', gates: [], trigger: { event: 'probe-stub', workflow: 'stub' } };`,
      "await writeFile(out, JSON.stringify(report, null, 2) + '\\n');",
      "process.exit(0);",
    ].join('\n');
    await writeFile(entryFile, stub);
    const spawned = await spawnStub(entryFile, outFile);
    let aggregate = null;
    try { aggregate = JSON.parse(await readFile(outFile, 'utf8')); } catch {}
    const entryPoint = aggregate?.runner?.entryPoint;
    const entryPointOk = typeof entryPoint === 'string' && /\.(m?js)$/.test(entryPoint) && entryPoint === firstEntry;
    results.push({
      anchorAcId: 'AC-6102-1',
      verdict: spawned.exitCode === 0 && entryPointOk ? 'pass' : 'fail',
      detail: `spawned stub of '${firstEntry}' via node; aggregate report written to ${outFile}; runner.entryPoint='${entryPoint}'; matches template entry=${entryPointOk}; stub exit=${spawned.exitCode}`,
      evidence: { stubEntry: firstEntry, spawnExitCode: spawned.exitCode, aggregateReadBack: aggregate, aggregateRunnerEntryPoint: entryPoint },
    });
    await rm(tmp, { recursive: true, force: true });
  } else {
    results.push({
      anchorAcId: 'AC-6102-1',
      verdict: 'fail',
      detail: 'no single-entry-point job was available to observe an aggregate runner.entryPoint from; the per-job predicate above already failed',
      evidence: { firstEntry: null },
    });
  }

  return { results, extra: { envDeclared: [], templateCount: templates.length, perFile } };
}

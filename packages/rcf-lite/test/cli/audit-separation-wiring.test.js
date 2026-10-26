// FBS-223 (US-19102): the mixed escape, the class override file, --require-hand and CI on pull requests.
//
// The test of AC-19102-4, bound by TS-256, reads this repository's own
// .github/workflows/ci.yml (located by findRepoRoot below). The tests of
// AC-19102-1, AC-19102-2, AC-19102-3 and AC-19102-5 (retired, with
// successors in FBS-233, whose BUILD makes their assertions false) were
// deleted in round B's DEFINE, their test cases re-pointed at the
// successors' tests (stage-keeper ruling 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// The repository root holding this package: walk up from this file (the
// clone) and from the shell's working directory the run inherited (PWD,
// or INIT_CWD under a package manager: inside `rcf verify run --artefact`
// this file runs from a scratch copy, and the verifier's shell sits in the
// clone). The root is the first directory holding both
// .github/workflows/ci.yml and packages/rcf-lite/package.json.
function findRepoRoot() {
  const starts = [HERE, process.env.PWD, process.env.INIT_CWD].filter(Boolean);
  for (const start of starts) {
    let dir = resolve(start);
    for (;;) {
      if (existsSync(join(dir, '.github', 'workflows', 'ci.yml')) && existsSync(join(dir, 'packages', 'rcf-lite', 'package.json'))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  assert.fail(`no repository root with .github/workflows/ci.yml above ${starts.join(', ')}`);
}

// ci.yml parsed with the repository's own js-yaml (a devDependency of
// packages/rcf-lite, resolved from the root found above, so it loads in
// the clone and beside the installed artefact alike).
function loadWorkflow() {
  const root = findRepoRoot();
  const yaml = createRequire(join(root, 'packages', 'rcf-lite', 'package.json'))('js-yaml');
  return yaml.load(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8'));
}

const SEPARATION_RUN = 'node bin/rcf.js audit separation --base origin/${{ github.base_ref }}';
const PR_ONLY = /^(\$\{\{\s*)?github\.event_name\s*==\s*['"]pull_request['"](\s*\}\})?$/;

// The job whose step runs the separation command, and that step.
function separationJob(wf) {
  for (const [id, job] of Object.entries(wf.jobs ?? {})) {
    const steps = job.steps ?? [];
    const at = steps.findIndex((s) => typeof s.run === 'string' && s.run.trim() === SEPARATION_RUN);
    if (at !== -1) return { id, job, steps, at, step: steps[at] };
  }
  return assert.fail(`no job in ci.yml has a step whose run is exactly "${SEPARATION_RUN}"`);
}

function separationCheckout({ steps, at }) {
  const checkout = steps.slice(0, at).filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
  assert.equal(checkout.length, 1, 'one actions/checkout step before the separation step in its job');
  return checkout[0];
}

test('AC-19102-4: on pull_request, CI runs node bin/rcf.js audit separation --base origin/${{ github.base_ref }} from packages/rcf-lite after checkout fetch-depth 0 and its exit code fails the job; the step does not run on push to main', () => {
  const wf = loadWorkflow();
  const on = wf.on ?? wf[true];
  assert.ok(on && typeof on === 'object' && 'pull_request' in on, 'ci.yml triggers on pull_request');

  const found = separationJob(wf);
  assert.equal(found.step['working-directory'], 'packages/rcf-lite');
  assert.ok(!/\|\|/.test(found.step.run), 'nothing swallows the exit code');
  assert.notEqual(found.job['continue-on-error'], true, 'the job does not continue on error');
  assert.notEqual(found.step['continue-on-error'], true, 'the step does not continue on error');

  const checkout = separationCheckout(found);
  assert.equal(Number(checkout.with?.['fetch-depth']), 0, 'checkout fetch-depth 0');
  assert.notEqual(checkout.with?.['fetch-depth'], undefined, 'fetch-depth is set');

  // Not on push to main: either the workflow has no push trigger, or the
  // job or the step is gated to the pull_request event.
  const gated = [found.job.if, found.step.if].some((cond) => typeof cond === 'string' && PR_ONLY.test(cond.trim()));
  assert.ok(!('push' in on) || gated, 'the separation step is gated to pull_request (job or step if: github.event_name == \'pull_request\')');
});

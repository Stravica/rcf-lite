// Contract-shape guards for the e2e-contract blueprint additions
// (spec 2026-09-03).
//
// AC-1102-2: application-spa v1.4.0 contributes US-1134 and US-1135, whose
// ACs are scope: deployed and describe an observable rendered browser
// surface. A paste-in assets/tc-templates/e2e.md test-case template ships
// and names the browser-verify TAC driver seam.
//
// AC-1102-3: delivery-ci-workflows v2.2.0 contributes US-6124 whose AC
// binds the four points spec 2.3 names (distinct e2e CI job, testLevel:e2e
// runner, browser-artefact upload, distinct row in the aggregate report).
//
// AC-1102-4: the illustrative GHA pull-request-checks.yml carries a
// documented e2e job block and notes.md carries one line per alternate
// provider translating the same four points.
//
// This is a library-scope contract test: it reads the shipped blueprint
// files at repo root and asserts the shape the spec commits to. If a later
// edit drops one of these facts, the suite trips before we ship.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = pathResolve(here, '..', '..', '..', '..');
const spaSource = join(repoRoot, 'blueprints', 'application-spa');
const ciSource = join(repoRoot, 'blueprints', 'delivery-ci-workflows');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('AC-1102-2: application-spa ships US-1134 and US-1135 as browser-facing (scope: deployed) e2e stories, plus the e2e.md template', async () => {
  const us1134 = await readJson(
    join(spaSource, 'contributions', 'user-stories', 'application-spa-us-1134.json'),
  );
  const us1135 = await readJson(
    join(spaSource, 'contributions', 'user-stories', 'application-spa-us-1135.json'),
  );

  assert.equal(us1134.usId, 'application-spa-US-1134');
  assert.equal(us1134.reqId, 'application-spa-REQ-011');
  assert.equal(us1134.acceptanceCriteria.length >= 1, true);
  assert.equal(us1134.acceptanceCriteria[0].scope, 'deployed');
  assert.match(
    us1134.acceptanceCriteria[0].description,
    /browser/i,
    'AC-1134-1 must name a browser surface',
  );

  assert.equal(us1135.usId, 'application-spa-US-1135');
  assert.equal(us1135.reqId, 'application-spa-REQ-009');
  assert.equal(us1135.acceptanceCriteria.length >= 1, true);
  assert.equal(us1135.acceptanceCriteria[0].scope, 'deployed');
  assert.match(
    us1135.acceptanceCriteria[0].description,
    /sign-in|browser/i,
    'AC-1135-1 must name an auth-surface browser observation',
  );

  const template = await readFile(
    join(spaSource, 'assets', 'tc-templates', 'e2e.md'),
    'utf8',
  );
  assert.match(
    template,
    /testLevel:\s*e2e/,
    'e2e template must show a testLevel: e2e shape',
  );
  assert.match(
    template,
    /rcf verify browser/,
    'e2e template must name the rcf verify browser driver seam',
  );
});

test('AC-1102-3: delivery-ci-workflows v2.2.0 US-6124 binds an AC naming the four e2e-job points', async () => {
  const meta = await readJson(join(ciSource, 'blueprint.json'));
  assert.equal(meta.version, '2.2.0');
  const us6124Ref = meta.contributions.find(
    (c) => c.id === 'delivery-ci-workflows-US-6124',
  );
  assert.ok(
    us6124Ref,
    'blueprint.json contributions must reference delivery-ci-workflows-US-6124',
  );

  const us6124 = await readJson(
    join(ciSource, 'contributions', 'user-stories', 'delivery-ci-workflows-us-6124.json'),
  );
  assert.equal(us6124.usId, 'delivery-ci-workflows-US-6124');
  const ac = us6124.acceptanceCriteria.find((c) => c.id === 'AC-6124-1');
  assert.ok(ac, 'AC-6124-1 must exist on US-6124');
  const desc = ac.description;
  assert.match(desc, /distinct e2e job/i, 'names a distinct e2e CI job');
  assert.match(desc, /testLevel:\s*e2e/i, 'names testLevel: e2e cases');
  assert.match(desc, /artefacts?/i, 'names artefact upload');
  assert.match(desc, /pipeline\.json|aggregate/i, 'names the aggregate report row');
});

test('AC-1102-4: illustrative GHA pull-request-checks.yml carries the e2e job and notes.md translates the four points per provider', async () => {
  const workflow = await readFile(
    join(
      ciSource,
      'assets',
      'ci-provider-examples',
      'github-actions',
      'pull-request-checks.yml',
    ),
    'utf8',
  );
  assert.match(
    workflow,
    /\n\s{2}e2e:\s*\n/,
    'pull-request-checks.yml must declare an e2e job at two-space indentation',
  );
  assert.match(workflow, /playwright/i, 'e2e job section must mention Playwright');

  const notes = await readFile(
    join(ciSource, 'assets', 'ci-provider-examples', 'notes.md'),
    'utf8',
  );
  for (const provider of ['GitLab CI', 'CircleCI', 'Buildkite', 'Jenkins']) {
    assert.ok(
      notes.includes(provider),
      `notes.md must carry an e2e-job translation line for ${provider}`,
    );
  }
  assert.match(notes, /e2e job/i, 'notes.md must reference the e2e job explicitly');
});

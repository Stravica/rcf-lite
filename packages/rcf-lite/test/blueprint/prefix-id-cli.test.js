// CLI-level regression for w-2026-08-19-003: on a fresh scaffold, apply
// a blueprint carrying BOTH a prefix-family contribution (spa-REQ-001)
// and a suffix-family contribution (ADR-005-spa), then drive the real
// bin end-to-end (add / validate / re-add / remove / validate). Every
// step must exit clean.
//
// The defect this pins: walker.idFromFilenameStem upper-cased only the
// first dash segment (`spa-req-001` -> `SPA-req-001` instead of
// `spa-REQ-001`), and loader.pathForId's `startsWith('REQ-')` checks
// refused the prefix-namespaced id. Apply succeeded (it never re-walked)
// but every subsequent verb bricked. This test exercises the whole loop
// on the real CLI, so a future core-store change can't silently reopen
// the family-blindness.
//
// The pre-existing blueprint/apply.test.js hits applyBlueprint directly
// on a walked tree and never re-walks with error assertions, which is
// why the defect slipped through Phase 1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-prefix-id-cli-'));
  const init = await initProject({ projectRoot: root, projectName: 'PrefixIdCli' });
  assert.equal(init.kind, undefined, `initProject failed: ${JSON.stringify(init)}`);
  return root;
}

async function writeMixedBlueprint(root) {
  const dir = join(root, 'blueprint-spa');
  await mkdir(join(dir, 'contributions'), { recursive: true });
  // Prefix-family contribution: spa-REQ-001. This is the one that broke
  // pre-fix. The scaffolded PRD-001 is its parent (no changes needed to
  // the tree beyond what init writes).
  const req = {
    reqId: 'spa-REQ-001', prdId: 'PRD-001',
    title: 'SPA router requirement',
    description: 'Blueprint-owned requirement to prove prefix-family ids round-trip.',
    category: 'functional', priority: 'must', domain: 'ui',
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  // Suffix-family contribution: ADR-005-spa. Included so this test is a
  // regression guard for BOTH families, not just the one that regressed.
  const adr = {
    adrId: 'ADR-005-spa', prdId: 'PRD-001', tadId: 'TAD-001',
    version: '0.1.0', status: 'proposed',
    title: 'SPA routing framework',
    context: 'Blueprint-owned ADR to exercise suffix-family namespacing.',
    decision: 'Adopt file-based routing.',
    consequences: 'Simpler mental model, at the cost of dynamic route flexibility.',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  const meta = {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json' },
      { kind: 'adr', id: 'ADR-005-spa', path: 'adr-005-spa.json' },
    ],
  };
  await writeFile(join(dir, 'blueprint.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  await writeFile(join(dir, 'contributions', 'spa-req-001.json'), JSON.stringify(req, null, 2), 'utf8');
  await writeFile(join(dir, 'contributions', 'adr-005-spa.json'), JSON.stringify(adr, null, 2), 'utf8');
  return dir;
}

test('rcf blueprint add + validate + re-add + remove all exit 0 for prefix- and suffix-family contributions (w-2026-08-19-003)', async () => {
  const root = await scaffold();
  const source = await writeMixedBlueprint(root);

  // 1. add -> exit 0, one applied line.
  const add = await runBin(root, ['blueprint', 'add', source]);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}\nstdout: ${add.stdout}`);
  assert.match(add.stdout, /applied 'spa' at 1\.0\.0/);

  // 2. validate -> exit 0 (tree walk resolves both prefix- and suffix-
  //    namespaced ids and reports "tree is clean" on stdout). This is
  //    the exact call that returned exit 3 with
  //    "Unrecognised document id: SPA-req-001" pre-fix.
  const validate = await runBin(root, ['validate']);
  assert.equal(validate.code, 0, `validate stderr: ${validate.stderr}\nstdout: ${validate.stdout}`);
  assert.match(validate.stdout, /tree is clean/);
  assert.doesNotMatch(validate.stderr, /Unrecognised document id/);

  // 3. re-add -> exit 0 with alreadyApplied notice. Pre-fix this exited
  //    2 because the tree walk raised a usage error on the prefix-
  //    namespaced doc before applyBlueprint even ran.
  const reAdd = await runBin(root, ['blueprint', 'add', source]);
  assert.equal(reAdd.code, 0, `re-add stderr: ${reAdd.stderr}\nstdout: ${reAdd.stdout}`);
  assert.match(reAdd.stdout, /'spa' already applied at 1\.0\.0/);

  // 4. remove -> exit 0 (again, pre-fix this was blocked by the same
  //    tree-walk usage error).
  const remove = await runBin(root, ['blueprint', 'remove', 'spa']);
  assert.equal(remove.code, 0, `remove stderr: ${remove.stderr}\nstdout: ${remove.stdout}`);
  assert.match(remove.stdout, /removed 'spa' \(2 file\(s\) deleted\)/);

  // 5. validate after remove -> exit 0 (the tree is back to scaffold
  //    state; the prefix-namespaced doc is gone).
  const validateAfter = await runBin(root, ['validate']);
  assert.equal(validateAfter.code, 0, `validate-after stderr: ${validateAfter.stderr}\nstdout: ${validateAfter.stdout}`);
  assert.match(validateAfter.stdout, /tree is clean/);
});

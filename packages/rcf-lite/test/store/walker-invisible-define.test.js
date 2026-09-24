// Invariant: the walker never reads under rcf/define/ (proposal
// §2.1 v3, "the loader reads only its named collection directories,
// so rcf/define/ is invisible to the walker"). The freeze record and
// the four ledgers are owned by rcf-lite outside the shared schema;
// no walker consumer should be able to accidentally load them as a
// standalone RCF document.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';
import { walkTree } from '#core/store/walker.js';

async function scratchProject(prefix = 'define-invisible-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const result = await initProject({ projectRoot: root });
  assert.ok(result && Array.isArray(result.created), `initProject failed: ${JSON.stringify(result)}`);
  return root;
}

test('walkTree never surfaces rcf/define/ files as documents in byId', async () => {
  const root = await scratchProject();
  await mkdir(join(root, 'rcf', 'define'), { recursive: true });
  // Freeze record + the four ledgers, plus some garbage that a
  // walkTree bug would happily try to schema-validate as a document.
  await writeFile(join(root, 'rcf', 'define', 'freeze.json'),
    JSON.stringify({ frozenAt: '2026-09-24T10:00:00Z', treeHash: 'sha256:x', docHashes: {}, briefStatements: 0 }, null, 2), 'utf8');
  await writeFile(join(root, 'rcf', 'define', 'brief-ledger.json'),
    JSON.stringify({ statements: [] }, null, 2), 'utf8');
  await writeFile(join(root, 'rcf', 'define', 'decisions-ledger.json'),
    JSON.stringify({ decisions: [] }, null, 2), 'utf8');
  await writeFile(join(root, 'rcf', 'define', 'concern-ledger.json'),
    JSON.stringify({ concerns: [] }, null, 2), 'utf8');
  await writeFile(join(root, 'rcf', 'define', 'probe-ledger.json'),
    JSON.stringify({ probes: [] }, null, 2), 'utf8');
  // A REQ-shaped filename inside rcf/define/ (bug-bait): a walker
  // that enumerated rcf/define/ would try to schema-validate this.
  await writeFile(join(root, 'rcf', 'define', 'req-999.json'),
    JSON.stringify({ reqId: 'REQ-999', prdId: 'PRD-001', title: '' }), 'utf8');

  const { tree, errors } = await walkTree({ projectRoot: root });
  // No error about any rcf/define/ path.
  for (const err of errors) {
    const path = err.filePath ?? '';
    assert.equal(path.startsWith('rcf/define/'), false,
      `walker surfaced a rcf/define/ file: ${path}`);
  }
  // No id whose backing file lives under rcf/define/.
  assert.equal(tree.byId.has('REQ-999'), false,
    'walker loaded rcf/define/req-999.json as a REQ');
});

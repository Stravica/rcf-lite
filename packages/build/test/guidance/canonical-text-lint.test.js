// AC-1.11 (as extended by finding J): every canonical asset ships free
// of em-dashes and of the small denylist of American-English forms. The
// same greps fire against:
//   - guidance/managed/agent-instructions-block.md
//   - guidance/managed/README.md
//   - seed constants: KNOWLEDGE_README, KNOWLEDGE_INDEX, IDENTITY_TEMPLATE
//   - composed managed .gitignore block
//
// D-10 makes this a belt-and-braces gate: it runs at test time (fails
// CI) AND at package build time via scripts/gen-managed-artefacts.mjs
// invariants; here we cover the test-time half.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KNOWLEDGE_README, KNOWLEDGE_INDEX } from '../../src/setup/knowledge-seed.js';
import { IDENTITY_TEMPLATE } from '../../src/setup/identity-seed.js';
import { composeGitignoreBlock } from '../../src/setup/managed-gitignore.js';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');

const AMERICAN_ENGLISH_DENYLIST = /\b(behavior|behaviors|behavioral|organization|organizations|organize|organized|realize|realized|analyze|analyzed|customize|customizing|color|colors|favor|favors|centered|labeled|traveled|catalog|dialog)\b/i;

/** @typedef {{ name: string, text: string | Promise<string> }} Fixture */

async function assetTexts() {
  const [block, managedReadme] = await Promise.all([
    readFile(resolve(PACKAGE_ROOT, 'guidance', 'managed', 'agent-instructions-block.md'), 'utf8'),
    readFile(resolve(PACKAGE_ROOT, 'guidance', 'managed', 'README.md'), 'utf8'),
  ]);
  return [
    { name: 'agent-instructions-block.md', text: block },
    { name: 'managed/README.md', text: managedReadme },
    { name: 'KNOWLEDGE_README', text: KNOWLEDGE_README },
    { name: 'KNOWLEDGE_INDEX', text: KNOWLEDGE_INDEX },
    { name: 'IDENTITY_TEMPLATE', text: IDENTITY_TEMPLATE },
    { name: 'composed .gitignore block', text: composeGitignoreBlock() },
  ];
}

test('AC-1.11: no em-dash in any canonical asset', async () => {
  const fixtures = await assetTexts();
  const offenders = [];
  for (const { name, text } of fixtures) {
    if (/—/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `em-dash found in: ${offenders.join(', ')}`);
});

test('AC-1.11: no denylisted American-English forms in any canonical asset', async () => {
  const fixtures = await assetTexts();
  const offenders = [];
  for (const { name, text } of fixtures) {
    const m = AMERICAN_ENGLISH_DENYLIST.exec(text);
    if (m) offenders.push(`${name} (matched '${m[0]}')`);
  }
  assert.deepEqual(offenders, [], `American-English form found in: ${offenders.join(', ')}`);
});

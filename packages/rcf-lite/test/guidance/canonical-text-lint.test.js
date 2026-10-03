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

// REQ-182 (US-18202), AC-18202-3: the register scan rejects an em-dash
// in a new guidance file. The scan is the one above, generalised over
// every guidance/*.md: if a new file carries an em-dash, the scan
// fails. We assert the posture two ways: (1) no em-dash in any
// guidance/*.md on disk right now; (2) a synthetic file with an
// em-dash fails the exact same regex the asset scan uses, so a reader
// can see the scan is the regression gate the AC names.
test('guidance (REQ-182, AC-18202-3): em-dash in a new guidance file fails the register scan', async () => {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const guidanceDir = resolve(PACKAGE_ROOT, 'guidance');
  const names = (await readdir(guidanceDir)).filter((n) => n.endsWith('.md'));
  const offenders = [];
  for (const name of names) {
    const text = await readFile(join(guidanceDir, name), 'utf8');
    if (/—/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `em-dash found in guidance file: ${offenders.join(', ')}`);
  // A synthetic file with an em-dash must trip the same regex.
  const synthetic = 'A dash — right here breaks the register.';
  assert.equal(/—/.test(synthetic), true, 'the register-scan regex must fail a file containing an em-dash');
});

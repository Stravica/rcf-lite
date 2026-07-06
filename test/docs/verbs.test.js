// Docs verb lint (Phase 8 §6.2). Every `rcf <token>` shown in
// README.md + docs/*.md - inline code spans and fenced-block
// invocation lines - must name a real subcommand, checked against
// HELP_MAP from src/cli/help.js, so a verb rename or removal fails CI
// until the docs move in the same PR (§D9 mechanical layer). Node 24
// built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HELP_MAP } from '../../src/cli/help.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const docsDir = join(repoRoot, 'docs');

// `help` is a real subcommand (the dispatcher's own topic printer) but
// has no HELP_MAP entry of its own; allow it explicitly.
const KNOWN_VERBS = new Set([...Object.keys(HELP_MAP), 'help']);

async function docFiles() {
  const files = [{ name: 'README.md', text: await readFile(join(repoRoot, 'README.md'), 'utf8') }];
  for (const name of (await readdir(docsDir)).filter((n) => n.endsWith('.md'))) {
    files.push({ name: `docs/${name}`, text: await readFile(join(docsDir, name), 'utf8') });
  }
  return files;
}

test('the docs show rcf commands (extraction is not silently broken)', async () => {
  let count = 0;
  for (const { text } of await docFiles()) {
    count += [...text.matchAll(/`rcf\s+([a-z][a-z-]*)[^`]*`/g)].length;
    count += [...text.matchAll(/^\s*\$?\s*rcf\s+([a-z][a-z-]*)/gm)].length;
  }
  assert.equal(count >= 40, true, `expected at least 40 rcf commands across the docs, found ${count}`);
});

test('every inline rcf command in the docs names a real subcommand', async () => {
  for (const { name, text } of await docFiles()) {
    for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)[^`]*`/g)) {
      assert.equal(KNOWN_VERBS.has(m[1]), true, `${name}: inline \`rcf ${m[1]}\` is not a known subcommand`);
    }
  }
});

test('every fenced-block rcf invocation in the docs names a real subcommand', async () => {
  for (const { name, text } of await docFiles()) {
    for (const m of text.matchAll(/^\s*\$?\s*rcf\s+([a-z][a-z-]*)/gm)) {
      assert.equal(KNOWN_VERBS.has(m[1]), true, `${name}: fenced 'rcf ${m[1]}' is not a known subcommand`);
    }
  }
});

test('every --mark value shown in the docs is a valid lifecycle status', async () => {
  const { LIFECYCLE } = await import('../../src/build/queue.js');
  for (const { name, text } of await docFiles()) {
    for (const m of text.matchAll(/--mark\s+([A-Za-z]+)/g)) {
      assert.equal(LIFECYCLE.includes(m[1]), true, `${name}: --mark ${m[1]} is not a lifecycle status`);
    }
  }
});

test('the how-it-works verb map names every shipped subcommand', async () => {
  const text = await readFile(join(docsDir, 'how-it-works.md'), 'utf8');
  for (const verb of KNOWN_VERBS) {
    assert.equal(text.includes(`\`${verb}\``), true, `how-it-works.md verb map is missing \`${verb}\``);
  }
});

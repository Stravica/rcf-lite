// Guidance-pack verb lint (Phase 7.5 §D11.1). Every `rcf <token>`
// shown in guidance/*.md - inline code spans and fenced-block
// invocations - must name a real subcommand, checked against HELP_MAP
// so a future verb rename fails CI until the pack moves in the same PR.
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HELP_MAP } from '../../src/cli/help.js';

const guidanceDir = fileURLToPath(new URL('../../guidance', import.meta.url));

// `help` is a real subcommand (the dispatcher's own topic printer) but
// has no HELP_MAP entry of its own; allow it explicitly.
const KNOWN_VERBS = new Set([...Object.keys(HELP_MAP), 'help']);

async function packFiles() {
  const names = (await readdir(guidanceDir)).filter((n) => n.endsWith('.md'));
  const files = [];
  for (const name of names) {
    files.push({ name, text: await readFile(join(guidanceDir, name), 'utf8') });
  }
  return files;
}

/**
 * Extract `rcf <verb>` tokens. A verb token starts with a letter, so
 * `rcf --version`, `rcf/` paths and `rcf <placeholder>` forms are
 * ignored by construction.
 */
function extractVerbs(text) {
  const found = [];
  // Inline code spans: `rcf validate`, `rcf build --next`, ...
  for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)[^`]*`/g)) {
    found.push(m[1]);
  }
  // Fenced-block invocation lines: "$ rcf build FBS-001", "    rcf validate".
  for (const m of text.matchAll(/^\s*\$?\s*rcf\s+([a-z][a-z-]*)/gm)) {
    found.push(m[1]);
  }
  return found;
}

test('the pack shows rcf commands (extraction is not silently broken)', async () => {
  const files = await packFiles();
  const all = files.flatMap(({ text }) => extractVerbs(text));
  assert.equal(all.length >= 20, true, `expected at least 20 rcf commands across the pack, found ${all.length}`);
});

test('every inline rcf command in guidance/*.md names a real subcommand', async () => {
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)[^`]*`/g)) {
      assert.equal(KNOWN_VERBS.has(m[1]), true, `${name}: inline \`rcf ${m[1]}\` is not a known subcommand`);
    }
  }
});

test('every fenced-block rcf invocation in guidance/*.md names a real subcommand', async () => {
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/^\s*\$?\s*rcf\s+([a-z][a-z-]*)/gm)) {
      assert.equal(KNOWN_VERBS.has(m[1]), true, `${name}: fenced 'rcf ${m[1]}' is not a known subcommand`);
    }
  }
});

test('every --mark value shown in the pack is a valid lifecycle status', async () => {
  const { LIFECYCLE } = await import('../../src/build/queue.js');
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/--mark\s+([A-Za-z]+)/g)) {
      assert.equal(LIFECYCLE.includes(m[1]), true, `${name}: --mark ${m[1]} is not a lifecycle status`);
    }
  }
});

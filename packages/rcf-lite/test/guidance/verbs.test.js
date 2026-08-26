// Guidance-pack verb lint (0.10.0 grouped CLI). Every `rcf <token>`
// shown in guidance/*.md - inline code spans and fenced-block
// invocations - must name a real top-level dispatch token, checked
// against CORE_HELP / GROUP_HELP so a future verb rename fails CI until
// the pack moves in the same PR. Grouped `rcf <group> <verb>` forms
// are validated with a second-token check.
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HELP_MAP, CORE_HELP, GROUP_HELP } from '../../src/cli/help.js';

const guidanceDir = fileURLToPath(new URL('../../guidance', import.meta.url));

const TOP_LEVEL_TOKENS = new Set([
  ...Object.keys(CORE_HELP), ...Object.keys(GROUP_HELP), 'help',
]);

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
  for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)[^`]*`/g)) found.push(m[1]);
  for (const m of text.matchAll(/^\s*\$?\s*rcf\s+([a-z][a-z-]*)/gm)) found.push(m[1]);
  return found;
}

test('the pack shows rcf commands (extraction is not silently broken)', async () => {
  const files = await packFiles();
  const all = files.flatMap(({ text }) => extractVerbs(text));
  assert.equal(all.length >= 20, true, `expected at least 20 rcf commands across the pack, found ${all.length}`);
});

test('every inline rcf command in guidance/*.md names a real top-level token', async () => {
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)[^`]*`/g)) {
      assert.equal(TOP_LEVEL_TOKENS.has(m[1]), true, `${name}: inline \`rcf ${m[1]}\` is not a known top-level token`);
    }
  }
});

test('every fenced-block rcf invocation in guidance/*.md names a real top-level token', async () => {
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/^\s*\$?\s*rcf\s+([a-z][a-z-]*)/gm)) {
      assert.equal(TOP_LEVEL_TOKENS.has(m[1]), true, `${name}: fenced 'rcf ${m[1]}' is not a known top-level token`);
    }
  }
});

test('grouped invocations `rcf <group> <verb>` name a real verb in that group', async () => {
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)\s+([a-z][a-z-]*)/g)) {
      const [, group, verb] = m;
      if (!(group in HELP_MAP)) continue;
      assert.equal(HELP_MAP[group][verb] !== undefined, true, `${name}: \`rcf ${group} ${verb}\` names a group but the verb is not registered under it`);
    }
  }
});

test('every mark value shown in the pack is a valid lifecycle status', async () => {
  const { LIFECYCLE } = await import('../../src/build/queue.js');
  for (const { name, text } of await packFiles()) {
    for (const m of text.matchAll(/rcf\s+build\s+mark\s+\S+\s+([A-Za-z]+)/g)) {
      assert.equal(LIFECYCLE.includes(m[1]), true, `${name}: mark ${m[1]} is not a lifecycle status`);
    }
  }
});

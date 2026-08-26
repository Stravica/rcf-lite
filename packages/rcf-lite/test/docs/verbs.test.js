// Docs verb lint (0.10.0 grouped CLI). Every `rcf <token>` shown in
// README.md + docs/*.md - inline code spans and fenced-block invocation
// lines - must name a real command, checked against the CORE / GROUP
// tokens from src/cli/help.js, so a verb rename or removal fails CI
// until the docs move in the same PR (§D9 mechanical layer). Node 24
// built-ins only.
//
// A token counts as "known" if it is a top-level dispatchable name:
// one of core verbs, one of the five group names, or `help`. Grouped
// invocations of the form `rcf <group> <verb>` are validated via the
// second token check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HELP_MAP, CORE_HELP, GROUP_HELP } from '../../src/cli/help.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const docsDir = join(repoRoot, 'docs');

// Top-level tokens the dispatcher recognises: core verbs, group names,
// and `help` (which the dispatcher handles inline).
const TOP_LEVEL_TOKENS = new Set([
  ...Object.keys(CORE_HELP), ...Object.keys(GROUP_HELP), 'help',
]);

// Every grouped verb, for the second-token check.
const GROUPED_VERBS = new Set();
for (const verbs of Object.values(HELP_MAP)) for (const v of Object.keys(verbs)) GROUPED_VERBS.add(v);

async function docFiles() {
  const files = [{ name: 'README.md', text: await readFile(join(repoRoot, 'README.md'), 'utf8') }];
  for (const name of (await readdir(docsDir)).filter((n) => n.endsWith('.md'))) {
    if (name === 'legacy-changelogs' || (await readdir(join(docsDir, name)).catch(() => null))) continue;
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

test('every inline rcf command in the docs names a real top-level token', async () => {
  for (const { name, text } of await docFiles()) {
    for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)[^`]*`/g)) {
      assert.equal(TOP_LEVEL_TOKENS.has(m[1]), true, `${name}: inline \`rcf ${m[1]}\` is not a known top-level token (expected core verb or group name)`);
    }
  }
});

test('every fenced-block rcf invocation in the docs names a real top-level token', async () => {
  for (const { name, text } of await docFiles()) {
    for (const m of text.matchAll(/^\s*\$?\s*rcf\s+([a-z][a-z-]*)/gm)) {
      assert.equal(TOP_LEVEL_TOKENS.has(m[1]), true, `${name}: fenced 'rcf ${m[1]}' is not a known top-level token`);
    }
  }
});

test('grouped invocations `rcf <group> <verb>` name a real verb in that group', async () => {
  for (const { name, text } of await docFiles()) {
    for (const m of text.matchAll(/`rcf\s+([a-z][a-z-]*)\s+([a-z][a-z-]*)/g)) {
      const [, group, verb] = m;
      if (!(group in HELP_MAP)) continue; // core verb or help; skip
      assert.equal(HELP_MAP[group][verb] !== undefined, true, `${name}: \`rcf ${group} ${verb}\` names a group but the verb is not registered under it`);
    }
  }
});

test('every mark value shown in the docs is a valid lifecycle status', async () => {
  const { LIFECYCLE } = await import('../../src/build/queue.js');
  for (const { name, text } of await docFiles()) {
    // `rcf build mark <fbs-id> <status>` form.
    for (const m of text.matchAll(/rcf\s+build\s+mark\s+\S+\s+([A-Za-z]+)/g)) {
      assert.equal(LIFECYCLE.includes(m[1]), true, `${name}: mark ${m[1]} is not a lifecycle status`);
    }
  }
});

test('the how-it-works verb map names every shipped grouped verb', async () => {
  const text = await readFile(join(docsDir, 'how-it-works.md'), 'utf8');
  for (const verb of GROUPED_VERBS) {
    assert.equal(text.includes(`\`${verb}\``), true, `how-it-works.md verb map is missing \`${verb}\``);
  }
});

test('the how-it-works machine-output claims match each verb\'s real flag surface', () => {
  // 0.10.0 grouped-CLI: audit query verbs + build queue/bundle take
  // `--format json`, define validate takes `--json`, the write verbs
  // take `--dry-run`. Assert against HELP_MAP so a flag rename fails CI
  // until the sentence moves in the same PR.
  for (const verb of ['coverage', 'trace', 'impact']) {
    assert.match(HELP_MAP.audit[verb], /--format/, `audit ${verb} help lost --format; update how-it-works.md §6`);
  }
  for (const verb of ['queue', 'bundle']) {
    assert.match(HELP_MAP.build[verb], /--format/, `build ${verb} help lost --format; update how-it-works.md §6`);
  }
  assert.match(HELP_MAP.define.validate, /--json/, 'define validate help lost --json; update how-it-works.md §6');
  for (const verb of ['create', 'update', 'delete']) {
    assert.match(HELP_MAP.define[verb], /--dry-run/, `define ${verb} help lost --dry-run; update how-it-works.md §6`);
  }
});

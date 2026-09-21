// Capability tag convention tests. Enforces the rcf-lite dogfood chain
// carries at least one capability:<slug> tag per REQ, that every slug
// is documented in packages/rcf-lite/docs/capability-tags.md, and that
// the doc is linked from docs/README.md.
//
// Chain: REQ-171 (capability tag convention on requirements),
//        US-17101 (dogfood REQs carry capability tags),
//        US-17102 (docs carry the taxonomy).
// Test suite: TS-209, TS-210 (test pointers resolve here).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const reqDir = join(repoRoot, 'rcf', 'requirements');
const docsDir = join(repoRoot, 'docs');

const CAPABILITY_TAG_RE = /^capability:[a-z0-9]+(-[a-z0-9]+)*$/;

async function readSlugsFromDoc() {
  const md = await readFile(join(docsDir, 'capability-tags.md'), 'utf8');
  // Table rows in the taxonomy section look like `| \`slug\` | meaning |`.
  const rows = [...md.matchAll(/^\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|/gm)].map((m) => m[1]);
  return new Set(rows);
}

test('every dogfood REQ carries at least one capability tag mapped to a documented slug', async () => {
  const documentedSlugs = await readSlugsFromDoc();
  assert.ok(documentedSlugs.size >= 8 && documentedSlugs.size <= 20,
    `taxonomy size should be 8-20 (informational); saw ${documentedSlugs.size}`);
  const files = (await readdir(reqDir)).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length > 0, 'no requirement files found');
  const errors = [];
  const usedSlugs = new Set();
  for (const f of files) {
    const req = JSON.parse(await readFile(join(reqDir, f), 'utf8'));
    const tags = Array.isArray(req.tags) ? req.tags : [];
    const capTags = tags.filter((t) => typeof t === 'string' && t.startsWith('capability:'));
    if (capTags.length === 0) {
      errors.push(`${req.reqId} (${f}): no capability:<slug> tag on tags[]`);
      continue;
    }
    for (const t of capTags) {
      if (!CAPABILITY_TAG_RE.test(t)) {
        errors.push(`${req.reqId}: tag "${t}" does not match capability:<kebab-slug>`);
        continue;
      }
      const slug = t.slice('capability:'.length);
      usedSlugs.add(slug);
      if (!documentedSlugs.has(slug)) {
        errors.push(`${req.reqId}: capability slug "${slug}" is not listed in docs/capability-tags.md`);
      }
    }
  }
  assert.deepEqual(errors, [], errors.join('\n'));
  // The dogfood chain must actually exercise the documented taxonomy;
  // an unused slug is either dead or the chain has not caught up.
  for (const slug of documentedSlugs) {
    assert.ok(usedSlugs.has(slug),
      `taxonomy slug "${slug}" is documented but no REQ carries it`);
  }
});

test('docs carry the capability taxonomy and link to it from the docs README', async () => {
  // 1. capability-tags.md exists.
  const doc = await readFile(join(docsDir, 'capability-tags.md'), 'utf8');
  assert.match(doc, /^# Capability tags/m, 'capability-tags.md missing top-level heading');
  // 2. The convention line names the exact form.
  assert.match(doc, /capability:<kebab-slug>/, 'convention form not spelled out in the doc');
  // 3. The rule for adding a new capability is stated.
  assert.match(doc, /Adding a new capability/i, 'no "Adding a new capability" section');
  // 4. The taxonomy is a table with at least eight rows.
  const rows = [...doc.matchAll(/^\|\s*`[a-z0-9][a-z0-9-]*`\s*\|.+\|$/gm)];
  assert.ok(rows.length >= 8, `expected at least 8 taxonomy rows, saw ${rows.length}`);
  // 5. README.md links to capability-tags.md.
  const readme = await readFile(join(docsDir, 'README.md'), 'utf8');
  assert.match(readme, /\[capability-tags\.md\]\(capability-tags\.md\)/,
    'docs/README.md does not link to capability-tags.md');
});

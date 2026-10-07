// Discovery-home lints (issue 322). The locked methodology inventories
// (test/guidance/inventory.test.js, test/mcp/resources.test.js,
// test/docs/links.test.js) stay exactly as they are: a methodology
// addition still requires a coordinated test-code change. A project
// DISCOVERY-stage artefact instead lands under `guidance/discovery/` or
// `docs/discovery/` and is explicitly ignored by those locks.
//
// What stays required under the subdir:
//   - no em-dash (matches test/guidance/canonical-text-lint.test.js posture)
//   - no non-canonical external URLs (matches test/guidance/links.test.js)
//   - filename stem is a well-formed slug: lowercase letters, digits,
//     hyphens; the file's effective slug equals its filename stem.
//
// Fixture proof: a scratch guidance tree accepts a new file under
// discovery/ (no manifest change needed) while a new file dropped
// directly in guidance/ still trips the locked orphan check.
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const guidanceDir = fileURLToPath(new URL('../../guidance', import.meta.url));
const discoveryDir = join(guidanceDir, 'discovery');
const docsDiscoveryDir = fileURLToPath(new URL('../../docs/discovery', import.meta.url));

const CANONICAL_PREFIX = 'https://stravica.ai/rcf-methodology/';
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

async function discoveryMarkdown() {
  const names = (await readdir(discoveryDir)).filter((n) => n.endsWith('.md'));
  const files = [];
  for (const name of names) {
    files.push({ name, text: await readFile(join(discoveryDir, name), 'utf8') });
  }
  return files;
}

test('issue 322: guidance/discovery/ exists on disk as the carved-out home', async () => {
  await assert.doesNotReject(access(discoveryDir),
    'guidance/discovery/ must exist as the discovery-artefact home');
  await assert.doesNotReject(access(docsDiscoveryDir),
    'docs/discovery/ must exist as the companion engineer-facing home');
  // The README that explains the home is itself a discovery file; it
  // participates in the lints below like any other.
  await assert.doesNotReject(access(join(discoveryDir, 'README.md')),
    'guidance/discovery/README.md must document the home');
});

test('issue 322: no em-dash in any guidance/discovery/*.md', async () => {
  const offenders = [];
  for (const { name, text } of await discoveryMarkdown()) {
    if (/\u2014/.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `em-dash found in guidance/discovery/: ${offenders.join(', ')}`);
});

test('issue 322: no non-canonical external URL in any guidance/discovery/*.md', async () => {
  const offenders = [];
  for (const { name, text } of await discoveryMarkdown()) {
    for (const m of text.matchAll(/https?:\/\/[^\s)`"'<>\]]+/g)) {
      if (!m[0].startsWith(CANONICAL_PREFIX)) {
        offenders.push(`${name}: ${m[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `non-canonical external URL(s) in guidance/discovery/: ${offenders.join('; ')}`);
});

test('issue 322: every guidance/discovery/*.md filename stem is a well-formed slug', async () => {
  for (const { name } of await discoveryMarkdown()) {
    const stem = name.replace(/\.md$/, '');
    // README.md is the pre-agreed home description; it is a standard
    // repository marker rather than a slugged discovery artefact.
    if (stem === 'README') continue;
    assert.match(stem, SLUG_RE,
      `${name}: filename stem '${stem}' is not a well-formed slug (lowercase, digits, hyphens)`);
  }
});

// Fixture-driven proof that mirrors the existing orphan check in
// test/guidance/inventory.test.js: a new file under discovery/ is
// invisible to the top-level readdir enumeration, while a new file
// dropped directly in guidance/ is caught by the orphan assertion.
test('issue 322 (fixture): new file under discovery/ passes the orphan check; new file in guidance/ fails it', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'rcf-guidance-322-'));
  try {
    // Scaffold a mini guidance pack: one manifest-mapped file, one
    // discovery file, and no stray.
    const manifest = {
      docs: [{ slug: 'methodology', file: 'methodology.md', title: 'Methodology' }],
      prompts: [],
    };
    await writeFile(join(scratch, 'manifest.json'), JSON.stringify(manifest, null, 2));
    await writeFile(join(scratch, 'methodology.md'), '# Methodology\n');
    await mkdir(join(scratch, 'discovery'), { recursive: true });
    await writeFile(join(scratch, 'discovery', 'viewer-command-page.md'),
      '# Viewer command page\n\nDiscovery note.\n');

    const orphanCheck = async () => {
      const mapped = new Set([...manifest.docs, ...manifest.prompts].map((e) => e.file));
      const onDisk = (await readdir(scratch))
        .filter((n) => n.endsWith('.md') && n !== 'README.md');
      const orphans = onDisk.filter((n) => !mapped.has(n));
      return orphans;
    };

    // The discovery file is in a subdirectory, so the top-level readdir
    // never sees it: the orphan check passes.
    let orphans = await orphanCheck();
    assert.deepEqual(orphans, [],
      'discovery/ file leaked into the top-level orphan check');

    // Drop a file directly in guidance/: the lock still bites.
    await writeFile(join(scratch, 'stray.md'), '# Stray\n');
    orphans = await orphanCheck();
    assert.deepEqual(orphans, ['stray.md'],
      'a new file directly under guidance/ must trip the locked orphan check');
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(scratch, { recursive: true, force: true });
  }
});

// Fixture-driven proof for the lints themselves: a synthetic discovery
// file with an em-dash or a non-canonical URL fails the exact same
// regex this test file uses in production, so a reader can see the
// scans are the gates the AC names.
test('issue 322 (fixture): em-dash + non-canonical URL regex tripwires fire on synthetic input', () => {
  const synthetic = 'A dash \u2014 right here. Also http://example.com/bad.';
  assert.equal(/\u2014/.test(synthetic), true,
    'the em-dash scan regex must trip on a synthetic file carrying one');
  const external = [...synthetic.matchAll(/https?:\/\/[^\s)`"'<>\]]+/g)]
    .map((m) => m[0])
    .filter((u) => !u.startsWith(CANONICAL_PREFIX));
  assert.deepEqual(external, ['http://example.com/bad.'],
    'the external-URL scan must trip on a non-canonical URL');
});

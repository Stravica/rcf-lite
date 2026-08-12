// Source-comment marker scanner tests (NV-BL-ADM-04).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanFilesForMarkers, scanSourceStringForMarkers } from '#admissibility';
import { getRuleset } from '#ruleset';

test('scanSourceStringForMarkers surfaces every ratified marker case-insensitively', async () => {
  // Every marker from the ratified vocabulary appears verbatim in one
  // synthetic source string; the scan must produce one finding per
  // marker occurrence. Uses the ruleset directly rather than hard-coding
  // the vocabulary so a future ruleset revision that adds a marker
  // still exercises this test.
  const ruleset = await getRuleset();
  const parts = ruleset.sourceCommentMarkers.map((m) => `// ${m.marker.toUpperCase()} note`);
  const source = parts.join('\n');
  const findings = await scanSourceStringForMarkers(source, { filePath: '/tmp/x.js' });
  // At least one finding per marker (the same marker may appear more
  // than once for some markers -- e.g. "PLACEHOLDER" and "placeholder"
  // both live in the vocab; matching is case-insensitive so both hit).
  const uniqueMarkersHit = new Set(findings.map((f) => f.message.toLowerCase().match(/marker "([^"]+)"/i)?.[1]).filter(Boolean));
  for (const m of ruleset.sourceCommentMarkers) {
    assert.ok(uniqueMarkersHit.has(m.marker.toLowerCase()), `marker ${m.marker} was not surfaced`);
  }
  for (const f of findings) {
    assert.equal(f.rule, 'NV-BL-ADM-04');
    assert.equal(f.filePath, '/tmp/x.js');
  }
});

test('scanSourceStringForMarkers reports line + column offsets', async () => {
  const source = 'const a = 1;\n// TODO: fix this\nconst b = 2;\n';
  const findings = await scanSourceStringForMarkers(source, { filePath: '/tmp/y.js' });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /:2:/);
});

test('scanSourceStringForMarkers on empty/whitespace input returns no findings', async () => {
  assert.deepEqual(await scanSourceStringForMarkers(''), []);
  assert.deepEqual(await scanSourceStringForMarkers('   \n\n  '), []);
});

test('scanFilesForMarkers scans multiple files and surfaces IO failures as ioFailure findings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-markers-'));
  const clean = join(dir, 'clean.js');
  const dirty = join(dir, 'dirty.js');
  const missing = join(dir, 'does-not-exist.js');
  await writeFile(clean, 'const a = 1;\n', 'utf8');
  await writeFile(dirty, '// FIXME: land the fix\n', 'utf8');
  const findings = await scanFilesForMarkers([clean, dirty, missing]);
  // clean produces nothing; dirty produces one FIXME; missing produces
  // an ioFailure.
  const forDirty = findings.filter((f) => f.filePath === dirty);
  assert.equal(forDirty.length, 1);
  assert.equal(forDirty[0].rule, 'NV-BL-ADM-04');
  const forMissing = findings.filter((f) => f.filePath === missing);
  assert.equal(forMissing.length, 1);
  assert.equal(forMissing[0].kind, 'ioFailure');
});

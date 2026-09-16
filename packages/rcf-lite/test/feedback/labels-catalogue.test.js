// FBS-183 slice 4 unit tests for the label catalogue module.
//
// Binds AC-15902-4: the six-label catalogue is exported from one
// place (src/feedback/labels.js). A grep-style scan across src/,
// scripts/ and bin/ refuses any bare literal for these names
// outside the catalogue module, its tests and the bootstrap script
// that imports it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FEEDBACK_LABELS,
  FEEDBACK_LABEL_DEFINITIONS,
  labelsForEntry,
  severityLabel,
  areaLabelForKind,
} from '../../src/feedback/labels.js';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');

test('FEEDBACK_LABELS is the six-label catalogue and is frozen', () => {
  assert.deepEqual([...FEEDBACK_LABELS], [
    'rcf-feedback',
    'severity:blocker',
    'severity:major',
    'severity:minor',
    'area:blueprint',
    'area:core',
  ]);
  assert.ok(Object.isFrozen(FEEDBACK_LABELS));
  // Every catalogue name has a definition (bootstrap script consumes both).
  assert.equal(FEEDBACK_LABEL_DEFINITIONS.length, FEEDBACK_LABELS.length);
  for (const [i, d] of FEEDBACK_LABEL_DEFINITIONS.entries()) {
    assert.equal(d.name, FEEDBACK_LABELS[i]);
    assert.ok(typeof d.description === 'string' && d.description.length > 0);
    assert.ok(typeof d.color === 'string' && /^[0-9A-Fa-f]{6}$/.test(d.color));
  }
});

test('labelsForEntry returns the three labels for a well-formed entry', () => {
  assert.deepEqual(labelsForEntry('major', 'blueprint'), ['rcf-feedback', 'severity:major', 'area:blueprint']);
  assert.deepEqual(labelsForEntry('blocker', 'core'), ['rcf-feedback', 'severity:blocker', 'area:core']);
});

test('labelsForEntry drops the severity when unknown but keeps area', () => {
  assert.deepEqual(labelsForEntry('unknown', 'core'), ['rcf-feedback', 'area:core']);
});

test('severityLabel and areaLabelForKind return the expected strings', () => {
  assert.equal(severityLabel('minor'), 'severity:minor');
  assert.equal(severityLabel('nope'), null);
  assert.equal(areaLabelForKind('blueprint'), 'area:blueprint');
  assert.equal(areaLabelForKind('other'), null);
});

// -- AC-15902-4 grep test -------------------------------------------------

const CATALOGUE_STRINGS = [
  'rcf-feedback',
  'severity:blocker',
  'severity:major',
  'severity:minor',
  'area:blueprint',
  'area:core',
];

const SCAN_ROOTS = ['src', 'scripts', 'bin'];

const ALLOWED_FILES = new Set([
  // The catalogue itself, its tests, and the bootstrap script are
  // the only places allowed to name these strings literally.
  'src/feedback/labels.js',
  'src/feedback/render.js',              // re-export shim for LABEL_CATALOGUE consumers; imports from labels.js
  'scripts/bootstrap-feedback-labels.mjs',
  'test/feedback/labels-catalogue.test.js',
  'test/feedback/render.test.js',        // asserts the catalogue shape too
  'test/feedback/bootstrap-labels.test.js',
  'test/cli/feedback-submit.test.js',    // routes labels through the fake
]);

async function walk(dir, out) {
  const rows = await readdir(dir, { withFileTypes: true });
  for (const row of rows) {
    if (row.name.startsWith('.')) continue;
    const full = join(dir, row.name);
    if (row.isDirectory()) await walk(full, out);
    else if (/\.(js|mjs|cjs)$/.test(row.name)) out.push(full);
  }
}

test('AC-15902-4: no bare literal for any catalogue label appears outside labels.js and its allowed consumers', async () => {
  const files = [];
  for (const rel of SCAN_ROOTS) {
    const full = join(PACKAGE_ROOT, rel);
    try { await stat(full); } catch { continue; }
    await walk(full, files);
  }
  const hits = [];
  for (const abs of files) {
    const relToRoot = relative(PACKAGE_ROOT, abs);
    if (ALLOWED_FILES.has(relToRoot)) continue;
    const text = await readFile(abs, 'utf8');
    for (const label of CATALOGUE_STRINGS) {
      // Match a quoted literal for the exact label; anywhere in the
      // file. A substring like `severity:blocker` inside a URL or a
      // documentation string is caught too, which is the point: the
      // catalogue must never leak.
      const re = new RegExp(`(['"\`])${label}\\1`);
      if (re.test(text)) hits.push({ file: relToRoot, label });
    }
  }
  assert.deepEqual(hits, [], `catalogue label literals found outside labels.js: ${JSON.stringify(hits, null, 2)}`);
});

// pack-schema tests (visual round T-0, US-1701 AC-1701-1 / 2).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validatePackModule } from '../../src/browser-verify/pack-schema.js';

function goodPack(overrides = {}) {
  return {
    default: {
      packName: 'application-datatable-grid-shell',
      version: '1.0.0',
      blueprintSlug: 'application-datatable',
      appliesTo: ({ fbs }) => Array.isArray(fbs?.designStage?.navModel?.routes) && fbs.designStage.navModel.routes.some((r) => r.path === '/dt'),
      checks: [
        { id: 'AC-17101-1', severity: 'block', description: 'Sort click reorders rows', run: async () => ({ verdict: 'pass' }) },
      ],
      ...overrides,
    },
  };
}

test('validatePackModule accepts a valid pack whose appliesTo references route', () => {
  const result = validatePackModule({ mod: goodPack(), blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, true);
  assert.equal(result.pack.packName, 'application-datatable-grid-shell');
});

test('validatePackModule refuses missing default export', () => {
  const result = validatePackModule({ mod: {}, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /missing default export/);
});

test('validatePackModule refuses packName that does not start with the blueprint slug', () => {
  const mod = goodPack({ packName: 'grid-shell' });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'packName' && /start with 'application-datatable-'/.test(e.message)));
});

test('validatePackModule refuses non-semver version', () => {
  const mod = goodPack({ version: 'one' });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'version'));
});

test('validatePackModule refuses blueprintSlug that disagrees with the enclosing directory', () => {
  const mod = goodPack({ blueprintSlug: 'application-charts' });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'blueprintSlug'));
});

test('validatePackModule refuses the unqualified appliesTo predicate () => true', () => {
  const mod = goodPack({ appliesTo: () => true });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  const err = result.errors.find((e) => e.field === 'appliesTo');
  assert.ok(err, 'expected an appliesTo error');
  assert.match(err.message, /must reference one of/);
});

test('validatePackModule accepts an appliesTo that references tacIds', () => {
  const mod = goodPack({ appliesTo: ({ fbs }) => Array.isArray(fbs?.designStage?.tacIds) && fbs.designStage.tacIds.includes('TAC-1801-application-datatable-grid') });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, true);
});

test('validatePackModule accepts an appliesTo that references a blueprint:<slug> US tag', () => {
  const mod = goodPack({ appliesTo: ({ fbs }) => Array.isArray(fbs?.usTags) && fbs.usTags.some((t) => t === 'blueprint:application-datatable') });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, true);
});

test('validatePackModule refuses non-array checks[]', () => {
  const mod = goodPack({ checks: null });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'checks'));
});

test('validatePackModule refuses empty checks[]', () => {
  const mod = goodPack({ checks: [] });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
});

test('validatePackModule refuses a check with an id that does not match AC-<us>-<n>', () => {
  const mod = goodPack({ checks: [{ id: 'foo', severity: 'block', description: 'x', run: async () => ({}) }] });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'checks[0].id'));
});

test('validatePackModule refuses a check with unknown severity', () => {
  const mod = goodPack({ checks: [{ id: 'AC-17101-1', severity: 'critical', description: 'x', run: async () => ({}) }] });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'checks[0].severity'));
});

test('validatePackModule refuses a check whose run is not a function', () => {
  const mod = goodPack({ checks: [{ id: 'AC-17101-1', severity: 'block', description: 'x', run: 'not-a-function' }] });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'checks[0].run'));
});

test('validatePackModule refuses duplicate check ids on one pack', () => {
  const mod = goodPack({
    checks: [
      { id: 'AC-17101-1', severity: 'block', description: 'a', run: async () => ({ verdict: 'pass' }) },
      { id: 'AC-17101-1', severity: 'warn', description: 'b', run: async () => ({ verdict: 'pass' }) },
    ],
  });
  const result = validatePackModule({ mod, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.field === 'checks[1].id' && /duplicate/i.test(e.message)));
});

test('validatePackModule accepts optional preChecks[] and refuses malformed entries', () => {
  const preOk = goodPack({
    preChecks: [{ id: 'no-inline-style', severity: 'block', description: 'x', run: async () => ({ verdict: 'pass' }) }],
  });
  assert.equal(validatePackModule({ mod: preOk, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' }).ok, true);

  const preBad = goodPack({
    preChecks: [{ id: '', severity: 'block', description: '', run: null }],
  });
  const result = validatePackModule({ mod: preBad, blueprintSlug: 'application-datatable', packAbsPath: '/probe.pack.js' });
  assert.equal(result.ok, false);
  const fields = result.errors.map((e) => e.field).sort();
  assert.ok(fields.some((f) => f === 'preChecks[0].id'));
  assert.ok(fields.some((f) => f === 'preChecks[0].description'));
  assert.ok(fields.some((f) => f === 'preChecks[0].run'));
});

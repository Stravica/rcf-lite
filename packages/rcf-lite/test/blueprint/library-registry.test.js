// External-library registry tests (Phase 2b, spec §4, §5.1, §8.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectBandOverlap,
  detectContributionsOutOfBand,
  detectPrefixCollision,
  findLibrary,
  loadCoreBandReservations,
  readLibraryRegistry,
  REGISTRY_PATH,
  REGISTRY_VERSION,
  writeLibraryRegistry,
} from '../../src/blueprint/library-registry.js';
import { isRcfError } from '../../src/core/errors/index.js';

function makeEntry(overrides = {}) {
  return {
    libraryPrefix: 'wsd',
    sourceKind: 'local',
    sourceRef: '/tmp/wsd-lib',
    displayName: 'WSD library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.0.0',
    bands: { ac: { start: 50000, end: 59999 }, suffixBlocks: [{ kind: 'adr', start: 5000, end: 5099 }] },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
    addedAt: '2026-09-01T00:00:00Z',
    reviewedBy: 'operator',
    provenance: { tier: 'local' },
    cachePath: '/tmp/wsd-lib',
    ...overrides,
  };
}

test('readLibraryRegistry returns an empty registry when file is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-reg-'));
  const reg = await readLibraryRegistry(root);
  assert.equal(isRcfError(reg), false);
  assert.equal(reg.registryVersion, REGISTRY_VERSION);
  assert.deepEqual(reg.libraries, []);
});

test('writeLibraryRegistry persists a valid registry file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-reg-'));
  await mkdir(join(root, 'rcf'), { recursive: true });
  const written = await writeLibraryRegistry(root, {
    registryVersion: REGISTRY_VERSION,
    libraries: [makeEntry()],
  });
  assert.equal(isRcfError(written), false);
  assert.equal(written.written, true);
  const raw = await readFile(join(root, REGISTRY_PATH), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.libraries[0].libraryPrefix, 'wsd');
});

test('writeLibraryRegistry with dryRun does not touch disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-reg-'));
  const res = await writeLibraryRegistry(root, {
    registryVersion: REGISTRY_VERSION,
    libraries: [makeEntry()],
  }, { dryRun: true });
  assert.equal(res.written, false);
});

test('findLibrary locates by prefix', () => {
  const reg = { registryVersion: 1, libraries: [makeEntry({ libraryPrefix: 'wsd' }), makeEntry({ libraryPrefix: 'ax' })] };
  assert.equal(findLibrary(reg, 'wsd').libraryPrefix, 'wsd');
  assert.equal(findLibrary(reg, 'nope'), undefined);
});

test('detectPrefixCollision refuses a prefix that is a core-slug substring boundary swallower', () => {
  const err = detectPrefixCollision({
    libraryPrefix: 'security-auth',
    registry: { registryVersion: 1, libraries: [] },
    coreSlugs: ['security-auth-magic-link'],
  });
  assert.notEqual(err, null);
  assert.match(err.message, /boundary-swallowing/);
});

test('detectPrefixCollision refuses a prefix that exactly matches a core slug', () => {
  const err = detectPrefixCollision({
    libraryPrefix: 'application-spa',
    registry: { registryVersion: 1, libraries: [] },
    coreSlugs: ['application-spa'],
  });
  assert.notEqual(err, null);
  assert.match(err.message, /collides with core-shelf blueprint slug/);
});

test('detectPrefixCollision refuses a prefix that is already registered', () => {
  const err = detectPrefixCollision({
    libraryPrefix: 'wsd',
    registry: { registryVersion: 1, libraries: [makeEntry()] },
    coreSlugs: [],
  });
  assert.notEqual(err, null);
  assert.match(err.message, /already registered/);
});

test('detectBandOverlap refuses AC band overlap with a registered library', () => {
  const registered = makeEntry({ libraryPrefix: 'ax', bands: { ac: { start: 50500, end: 55000 } } });
  const err = detectBandOverlap({
    candidate: { libraryPrefix: 'wsd', bands: { ac: { start: 55000, end: 60000 } } },
    registry: { registryVersion: 1, libraries: [registered] },
    coreReservations: { ac: [], suffixBlocks: [] },
  });
  assert.notEqual(err, null);
  assert.match(err.message, /overlaps registered library 'ax'/);
});

test('detectBandOverlap refuses AC band overlap with core', () => {
  const err = detectBandOverlap({
    candidate: { libraryPrefix: 'wsd', bands: { ac: { start: 1500, end: 2000 } } },
    registry: { registryVersion: 1, libraries: [] },
    coreReservations: { ac: [{ blueprint: 'application-spa', start: 1101, end: 1899 }], suffixBlocks: [] },
  });
  assert.notEqual(err, null);
  assert.match(err.message, /overlaps core-shelf blueprint 'application-spa'/);
});

test('detectBandOverlap refuses per-kind suffix-block overlap', () => {
  const err = detectBandOverlap({
    candidate: { libraryPrefix: 'wsd', bands: { ac: { start: 90000, end: 90999 }, suffixBlocks: [{ kind: 'adr', start: 500, end: 550 }] } },
    registry: { registryVersion: 1, libraries: [] },
    coreReservations: { ac: [], suffixBlocks: [{ blueprint: 'security-auth-magic-link', kind: 'adr', start: 500, end: 599 }] },
  });
  assert.notEqual(err, null);
  assert.match(err.message, /suffix block adr/);
});

test('detectBandOverlap tolerates non-overlapping bands', () => {
  const err = detectBandOverlap({
    candidate: { libraryPrefix: 'wsd', bands: { ac: { start: 50000, end: 59999 } } },
    registry: { registryVersion: 1, libraries: [] },
    coreReservations: { ac: [{ blueprint: 'core', start: 1101, end: 1899 }], suffixBlocks: [] },
  });
  assert.equal(err, null);
});

test('detectContributionsOutOfBand refuses a US contribution outside the AC band', () => {
  const err = detectContributionsOutOfBand(
    [{ id: 'wsd-auth-oauth2-US-9999', kind: 'us' }],
    { ac: { start: 50000, end: 59999 } },
  );
  assert.notEqual(err, null);
  assert.match(err.message, /outside library AC band 50000-59999/);
});

test('detectContributionsOutOfBand refuses an ADR contribution outside a declared suffix block', () => {
  const err = detectContributionsOutOfBand(
    [{ id: 'ADR-100-wsd-auth-oauth2', kind: 'adr' }],
    { ac: { start: 50000, end: 59999 }, suffixBlocks: [{ kind: 'adr', start: 5000, end: 5099 }] },
  );
  assert.notEqual(err, null);
  assert.match(err.message, /outside library adr suffix block/);
});

test('detectContributionsOutOfBand passes ADR when no suffix block is declared (guidance-only)', () => {
  const err = detectContributionsOutOfBand(
    [{ id: 'ADR-100-wsd-auth-oauth2', kind: 'adr' }],
    { ac: { start: 50000, end: 59999 } },
  );
  assert.equal(err, null);
});

test('detectContributionsOutOfBand passes an in-band US contribution', () => {
  const err = detectContributionsOutOfBand(
    [{ id: 'wsd-auth-oauth2-US-50101', kind: 'us' }, { id: 'ADR-5001-wsd-auth-oauth2', kind: 'adr' }],
    { ac: { start: 50000, end: 59999 }, suffixBlocks: [{ kind: 'adr', start: 5000, end: 5099 }] },
  );
  assert.equal(err, null);
});

test('loadCoreBandReservations reads the shipped data file', async () => {
  const reservations = await loadCoreBandReservations();
  assert.equal(Array.isArray(reservations.ac), true);
  assert.equal(reservations.ac.length > 0, true, 'core reservations should list at least one shipped blueprint');
  const spa = reservations.ac.find((r) => r.blueprint === 'application-spa');
  assert.ok(spa, 'application-spa row is present');
  assert.equal(spa.start, 1101);
  assert.equal(spa.end, 1899);
});

test('readLibraryRegistry refuses a malformed registry file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-reg-'));
  await mkdir(join(root, 'rcf'), { recursive: true });
  await writeFile(join(root, REGISTRY_PATH), '{ this is not JSON }', 'utf8');
  const reg = await readLibraryRegistry(root);
  assert.equal(isRcfError(reg), true);
  assert.match(reg.message, /JSON parse failed/);
});

test('readLibraryRegistry refuses a registry with a newer version than known', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-reg-'));
  await mkdir(join(root, 'rcf'), { recursive: true });
  await writeFile(join(root, REGISTRY_PATH), JSON.stringify({ registryVersion: 99, libraries: [] }), 'utf8');
  const reg = await readLibraryRegistry(root);
  assert.equal(isRcfError(reg), true);
  assert.match(reg.message, /newer than this CLI understands/);
});

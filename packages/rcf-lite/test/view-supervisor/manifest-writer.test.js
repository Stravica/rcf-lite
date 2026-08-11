// Track C+D §9.3 supervisor manifest-writer unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readViewServerRecord,
  writeViewServerRecord,
  clearViewServerRecord,
  writePidFile,
  readPidFile,
  removePidFile,
  isPidAlive,
} from '../../src/view-supervisor/manifest-writer.js';

async function scaffoldManifest(dir) {
  await mkdir(join(dir, 'rcf'), { recursive: true });
  const seed = {
    version: '2.0.0',
    projectName: 'view-supervisor-test',
    prd: { id: 'PRD-001', path: 'rcf/prd.json' },
    tad: { id: 'TAD-001', path: 'rcf/tad.json' },
    bs: { id: 'BS-001', path: 'rcf/build-sequence.json' },
  };
  await writeFile(join(dir, 'rcf', 'manifest.json'), JSON.stringify(seed, null, 2));
}

test('writeViewServerRecord + readViewServerRecord roundtrips a valid record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-view-super-'));
  await scaffoldManifest(dir);
  const record = {
    mode: 'detached',
    startedAt: '2026-07-31T10:00:00.000Z',
    socketPath: '.rcf/view-supervisor.42137.sock',
    pid: 42137,
    healthCheckPath: 'http://127.0.0.1:4373/healthz',
    lastHeartbeatAt: '2026-07-31T10:00:05.000Z',
  };
  const write = await writeViewServerRecord({ projectRoot: dir, record });
  assert.ok(!write.kind, `unexpected error: ${JSON.stringify(write)}`);
  const read = await readViewServerRecord(dir);
  assert.deepEqual(read, record);
  await rm(dir, { recursive: true });
});

test('clearViewServerRecord removes the viewServer field and drops reviewSurface if empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-view-super-'));
  await scaffoldManifest(dir);
  const record = {
    mode: 'detached', startedAt: '2026-07-31T10:00:00.000Z',
    socketPath: '.rcf/view-supervisor.99.sock', pid: 99,
    healthCheckPath: 'http://127.0.0.1:4373/healthz',
    lastHeartbeatAt: '2026-07-31T10:00:05.000Z',
  };
  await writeViewServerRecord({ projectRoot: dir, record });
  await clearViewServerRecord(dir);
  const manifest = JSON.parse(await readFile(join(dir, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.reviewSurface, undefined);
  await rm(dir, { recursive: true });
});

test('writePidFile + readPidFile + removePidFile lifecycle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-view-super-'));
  await writePidFile(dir, 12345);
  const read = await readPidFile(dir);
  assert.equal(read, 12345);
  await removePidFile(dir);
  const readAgain = await readPidFile(dir);
  assert.equal(readAgain, null);
  await rm(dir, { recursive: true });
});

test('isPidAlive is true for the current process', () => {
  assert.equal(isPidAlive(process.pid), true);
});

test('isPidAlive is false for a certainly-dead pid', () => {
  // pid 1_000_000+ is virtually never a live process on a normal host;
  // if this ever flakes, raise the boundary.
  assert.equal(isPidAlive(9_999_999), false);
});

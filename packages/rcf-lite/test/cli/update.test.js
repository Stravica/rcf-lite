// `rcf update <id>` subcommand tests. Covers --set, --from-file, --json,
// inline AC/TC id resolution, root-singleton updates, and immutable field
// refusals.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-update-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'UpdateTest' });
  return tmp;
}

test('rcf update REQ-999 returns a structured not-found error and writes nothing (AC-303-3)', async () => {
  const tmp = await scaffold();
  // Snapshot every document byte before the attempt.
  const { readdir } = await import('node:fs/promises');
  const snapshot = async () => {
    const out = new Map();
    const walk = async (dir) => {
      for (const entry of await readdir(join(tmp, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) await walk(rel);
        else out.set(rel, await readFile(join(tmp, rel), 'utf8'));
      }
    };
    await walk('rcf');
    return out;
  };
  const before = await snapshot();
  const { code, stderr } = await runBin(tmp, ['define', 'update', 'REQ-999', '--set', 'title=Nope']);
  // Structured not-found error naming the id, usage exit code...
  assert.equal(code, 2);
  assert.match(stderr, /update: id REQ-999 not found/);
  // ...and nothing was written anywhere in the tree.
  const after = await snapshot();
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [rel, body] of before) assert.equal(after.get(rel), body, `unexpected write to ${rel}`);
});

test('rcf update REQ-001 --set title=X changes the title and bumps updatedAt', async () => {
  const tmp = await scaffold();
  const before = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-001.json'), 'utf8'));
  const { code, stdout } = await runBin(tmp, ['define', 'update', 'REQ-001', '--set', 'title=Renamed']);
  assert.equal(code, 0);
  assert.match(stdout, /REQ-001 updated/);
  const after = JSON.parse(await readFile(join(tmp, 'rcf/requirements/req-001.json'), 'utf8'));
  assert.equal(after.title, 'Renamed');
  assert.notEqual(after.updatedAt, before.updatedAt);
});

test('rcf update PRD-001 --set problemStatement=... targets the root singleton (§D8)', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['define', 'update', 'PRD-001', '--set', 'problemStatement=Sharper wedge.']);
  assert.equal(code, 0);
  const prd = JSON.parse(await readFile(join(tmp, 'rcf/prd.json'), 'utf8'));
  assert.equal(prd.problemStatement, 'Sharper wedge.');
});

test('rcf update AC-101-1 --set description=... updates the inline AC entry', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['define', 'update', 'AC-101-1', '--set', 'description=New criterion']);
  assert.equal(code, 0);
  const us = JSON.parse(await readFile(join(tmp, 'rcf/user-stories/us-101.json'), 'utf8'));
  assert.equal(us.acceptanceCriteria[0].description, 'New criterion');
});

test('rcf update REQ-001 --set createdAt=... refuses (immutable, exit 2)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['define', 'update', 'REQ-001', '--set', 'createdAt=2000-01-01T00:00:00Z']);
  assert.equal(code, 2);
  assert.match(stderr, /immutable/);
});

test('rcf update REQ-001 with schema-invalid value exits 3', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['define', 'update', 'REQ-001', '--set', 'priority=irresistible']);
  assert.equal(code, 3);
  assert.match(stderr, /validation/);
});

test('rcf update --from-file merges body fields (deep merge; arrays replace)', async () => {
  const tmp = await scaffold();
  const patch = join(tmp, 'patch.json');
  await writeFile(patch, JSON.stringify({ objectives: ['a', 'b', 'c'] }), 'utf8');
  const { code } = await runBin(tmp, ['define', 'update', 'PRD-001', '--from-file', patch]);
  assert.equal(code, 0);
  const prd = JSON.parse(await readFile(join(tmp, 'rcf/prd.json'), 'utf8'));
  assert.deepEqual(prd.objectives, ['a', 'b', 'c']);
});

test('rcf update --json parses --set values as JSON', async () => {
  const tmp = await scaffold();
  const { code } = await runBin(tmp, ['define', 'update', 'PRD-001', '--json', '--set', 'objectives=["x","y"]']);
  assert.equal(code, 0);
  const prd = JSON.parse(await readFile(join(tmp, 'rcf/prd.json'), 'utf8'));
  assert.deepEqual(prd.objectives, ['x', 'y']);
});

test('rcf update with no --set and no --from-file exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['define', 'update', 'REQ-001']);
  assert.equal(code, 2);
  assert.match(stderr, /at least one --set or --from-file/);
});

test('rcf update --dry-run does not write', async () => {
  const tmp = await scaffold();
  const before = await readFile(join(tmp, 'rcf/requirements/req-001.json'), 'utf8');
  const { code } = await runBin(tmp, ['define', 'update', 'REQ-001', '--set', 'title=Nope', '--dry-run']);
  assert.equal(code, 0);
  const after = await readFile(join(tmp, 'rcf/requirements/req-001.json'), 'utf8');
  assert.equal(after, before);
});

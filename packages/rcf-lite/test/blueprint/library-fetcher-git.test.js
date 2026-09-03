// Git fetcher tests (Phase 2c, spec §6.2). Every test operates against
// a local bare repository created in a temp dir; no network is used.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  fetchGitLibrary,
  isFullSha,
  parseGitRef,
  refusedRefs,
  resolveRemoteSha,
} from '../../src/blueprint/library-fetcher-git.js';
import { ensureEmptyCache } from '../../src/blueprint/library-cache.js';
import { isRcfError } from '../../src/core/errors/index.js';

const exec = promisify(execFile);

/**
 * Build a bare git repo containing a single library commit with a
 * library.json + a blueprints/auth-oauth2/ tree. Returns { bareUrl,
 * tagName, tagSha, lightweightTagName, headSha } so tests can pin to
 * either shape.
 */
async function scaffoldBareRepo({ tag = 'v1.0.0', lightweightTag = 'v-loose' } = {}) {
  const workRoot = await mkdtemp(join(tmpdir(), 'rcf-git-work-'));
  const bareRoot = await mkdtemp(join(tmpdir(), 'rcf-git-bare-'));

  const gitEnv = {
    ...process.env,
    GIT_COMMITTER_NAME: 'rcf-test',
    GIT_COMMITTER_EMAIL: 'rcf-test@example.invalid',
    GIT_AUTHOR_NAME: 'rcf-test',
    GIT_AUTHOR_EMAIL: 'rcf-test@example.invalid',
  };

  // Create a real working tree with a library payload.
  const bpDir = join(workRoot, 'blueprints', 'auth-oauth2');
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(join(bpDir, 'blueprint.json'), JSON.stringify({
    slug: 'auth-oauth2', version: '1.0.0', contributions: [],
  }, null, 2), 'utf8');
  await writeFile(join(workRoot, 'library.json'), JSON.stringify({
    libraryVersion: 1,
    libraryPrefix: 'wsd',
    displayName: 'WSD library',
    publisher: { id: 'wsd', displayName: 'West Somerset Data' },
    libraryRef: '1.0.0',
    bands: { ac: { start: 50000, end: 59999 } },
    blueprints: [{ slug: 'auth-oauth2', path: 'blueprints/auth-oauth2' }],
  }, null, 2), 'utf8');

  await exec('git', ['init', '-b', 'main', workRoot], { env: gitEnv });
  await exec('git', ['-C', workRoot, 'add', '-A'], { env: gitEnv });
  await exec('git', ['-C', workRoot, 'commit', '-m', 'library v1.0.0'], { env: gitEnv });
  // Annotated tag.
  await exec('git', ['-C', workRoot, 'tag', '-a', tag, '-m', `release ${tag}`], { env: gitEnv });
  // Lightweight tag (no -a / no -m).
  await exec('git', ['-C', workRoot, 'tag', lightweightTag], { env: gitEnv });
  // Push into a bare repo the fetcher can clone from.
  await exec('git', ['init', '--bare', bareRoot], { env: gitEnv });
  await exec('git', ['-C', workRoot, 'push', bareRoot, 'main', `refs/tags/${tag}`, `refs/tags/${lightweightTag}`], { env: gitEnv });

  const { stdout: sha } = await exec('git', ['-C', workRoot, 'rev-parse', 'HEAD'], { env: gitEnv });
  return {
    bareUrl: bareRoot,
    tagName: tag,
    lightweightTagName: lightweightTag,
    headSha: sha.trim(),
  };
}

test('parseGitRef: git+<url>#<tag> yields url, ref, refKind=tag', () => {
  const p = parseGitRef('git+https://example.invalid/x.git#v1.2.0');
  assert.equal(isRcfError(p), false);
  assert.equal(p.url, 'https://example.invalid/x.git');
  assert.equal(p.ref, 'v1.2.0');
  assert.equal(p.refKind, 'tag');
});

test('parseGitRef: sha ref classifies as refKind=sha', () => {
  const p = parseGitRef('git+file:///tmp/foo.git#3a1c9e7b2f4d6a0e5c8b1d3f9a2e7c4b6d0f8a1c');
  assert.equal(isRcfError(p), false);
  assert.equal(p.refKind, 'sha');
});

test('parseGitRef: missing "#<ref>" pin is refused', () => {
  const p = parseGitRef('git+https://example.invalid/x.git');
  assert.equal(isRcfError(p), true);
  assert.match(p.message, /missing '#<ref>'/);
});

test('parseGitRef: floating branch names are refused up front', () => {
  for (const ref of refusedRefs()) {
    const p = parseGitRef(`git+https://example.invalid/x.git#${ref}`);
    assert.equal(isRcfError(p), true, `expected refusal for ref='${ref}'`);
    assert.match(p.message, /floating branch|alias/);
  }
});

test('fetchGitLibrary: annotated tag lands the tree and records the commit sha', async () => {
  const scratch = await scaffoldBareRepo();
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-git-target-'));
  // Clean the mkdtemp-created directory so ensureEmptyCache accepts it.
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchGitLibrary({
    url: scratch.bareUrl,
    ref: scratch.tagName,
    refKind: 'tag',
    targetDir,
  });
  assert.equal(isRcfError(res), false, JSON.stringify(res));
  assert.equal(res.root, targetDir);
  assert.equal(isFullSha(res.resolvedSha), true);
  assert.equal(res.resolvedSha, scratch.headSha);
  assert.equal(existsSync(join(targetDir, 'library.json')), true);
  assert.equal(existsSync(join(targetDir, 'blueprints', 'auth-oauth2', 'blueprint.json')), true);
});

test('fetchGitLibrary: lightweight tag refuses with the annotation diagnostic', async () => {
  const scratch = await scaffoldBareRepo();
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-git-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchGitLibrary({
    url: scratch.bareUrl,
    ref: scratch.lightweightTagName,
    refKind: 'tag',
    targetDir,
  });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /lightweight tag/);
});

test('fetchGitLibrary: commit sha ref lands the tree and records the sha verbatim', async () => {
  const scratch = await scaffoldBareRepo();
  const targetDir = await mkdtemp(join(tmpdir(), 'rcf-git-target-'));
  await ensureEmptyCache(targetDir, { replace: true });
  const res = await fetchGitLibrary({
    url: scratch.bareUrl,
    ref: scratch.headSha,
    refKind: 'sha',
    targetDir,
  });
  assert.equal(isRcfError(res), false, JSON.stringify(res));
  assert.equal(res.resolvedSha, scratch.headSha);
  assert.equal(existsSync(join(targetDir, 'library.json')), true);
});

test('resolveRemoteSha: annotated tag returns the peeled commit sha (drift detection primitive)', async () => {
  const scratch = await scaffoldBareRepo();
  const res = await resolveRemoteSha({ url: scratch.bareUrl, ref: scratch.tagName, refKind: 'tag' });
  assert.equal(isRcfError(res), false);
  assert.equal(res.resolvedSha, scratch.headSha);
});

test('resolveRemoteSha: sha ref is a pass-through (its own identity)', async () => {
  const res = await resolveRemoteSha({
    url: 'unused', ref: '3a1c9e7b2f4d6a0e5c8b1d3f9a2e7c4b6d0f8a1c', refKind: 'sha',
  });
  assert.equal(res.resolvedSha, '3a1c9e7b2f4d6a0e5c8b1d3f9a2e7c4b6d0f8a1c');
});

test('resolveRemoteSha: lightweight tag refuses (pin discipline)', async () => {
  const scratch = await scaffoldBareRepo();
  const res = await resolveRemoteSha({
    url: scratch.bareUrl, ref: scratch.lightweightTagName, refKind: 'tag',
  });
  assert.equal(isRcfError(res), true);
  assert.match(res.message, /lightweight/);
});

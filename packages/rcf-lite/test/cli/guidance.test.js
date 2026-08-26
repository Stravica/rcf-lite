// `rcf guidance [topic]` CLI tests. The verb exists so a CLI-only agent
// can reach the method pack that ships inside the installed package and
// is never scaffolded into a consumer project. Run against the real bin
// from a directory with no rcf/ tree, because the verb must not require
// a project root.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { CORE_HELP } from '../../src/cli/help.js';
import { listTopics } from '../../src/cli/guidance.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');
const bin = join(packageRoot, 'bin', 'rcf.js');
const guidanceDir = join(packageRoot, 'guidance');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** A directory with no rcf/ tree anywhere above it that we control. */
async function treelessDir() {
  return await mkdtemp(join(tmpdir(), 'rcf-guidance-'));
}

test('the topic list covers every manifest doc and prompt', async () => {
  const manifest = JSON.parse(await readFile(join(guidanceDir, 'manifest.json'), 'utf8'));
  const topics = await listTopics(guidanceDir);
  assert.equal(topics.length, manifest.docs.length + manifest.prompts.length);
  for (const d of manifest.docs) {
    assert.equal(topics.some((t) => t.slug === d.slug && t.file === d.file), true, `${d.slug} missing`);
  }
  // The two playbooks are prompt-only in the manifest (no rcf://docs
  // resource), which is exactly why the CLI route has to reach them.
  for (const p of manifest.prompts) {
    const slug = p.file.replace(/\.md$/, '');
    assert.equal(topics.some((t) => t.slug === slug && t.file === p.file), true, `${slug} missing`);
  }
});

test('rcf guidance with no topic lists the topics and exits 0', async () => {
  const { code, stdout } = await runBin(await treelessDir(), ['guidance']);
  assert.equal(code, 0);
  for (const { slug } of await listTopics(guidanceDir)) {
    assert.match(stdout, new RegExp(slug.replace(/-/g, '\\-')));
  }
});

test('rcf guidance --list emits bare slugs, one per line', async () => {
  const { code, stdout } = await runBin(await treelessDir(), ['guidance', '--list']);
  assert.equal(code, 0);
  const slugs = (await listTopics(guidanceDir)).map((t) => t.slug);
  assert.deepEqual(stdout.trim().split('\n'), slugs);
});

test('each topic prints its pack file verbatim, with no project root present', async () => {
  const cwd = await treelessDir();
  for (const topic of await listTopics(guidanceDir)) {
    const { code, stdout } = await runBin(cwd, ['guidance', topic.slug]);
    assert.equal(code, 0, `rcf guidance ${topic.slug} exited ${code}`);
    const onDisk = await readFile(join(guidanceDir, topic.file), 'utf8');
    assert.equal(stdout, onDisk, `rcf guidance ${topic.slug} did not print ${topic.file} verbatim`);
  }
});

test('the two playbooks reach real content, not a stub', async () => {
  const cwd = await treelessDir();
  const build = await runBin(cwd, ['guidance', 'build-cycle-playbook']);
  assert.match(build.stdout, /# Build-cycle playbook/);
  const elicit = await runBin(cwd, ['guidance', 'elicitation-playbook']);
  assert.match(elicit.stdout, /# Elicitation playbook/);
});

test('rcf guidance harness-template carries the fragment fence init writes', async () => {
  const { stdout } = await runBin(await treelessDir(), ['guidance', 'harness-template']);
  assert.match(stdout, /```markdown\n[\s\S]*RULE 1: Elicit first/);
});

test('--path prints the resolved file path inside the installed package', async () => {
  const { code, stdout } = await runBin(await treelessDir(), ['guidance', 'overview', '--path']);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), join(guidanceDir, 'overview.md'));
});

test('an unknown topic is a usage error (exit 2) that lists the real topics', async () => {
  const { code, stderr } = await runBin(await treelessDir(), ['guidance', 'not-a-topic']);
  assert.equal(code, 2);
  assert.match(stderr, /no topic named 'not-a-topic'/);
  assert.match(stderr, /build-cycle-playbook/);
});

test('more than one topic is a usage error (exit 2)', async () => {
  const { code, stderr } = await runBin(await treelessDir(), ['guidance', 'overview', 'build-cycle']);
  assert.equal(code, 2);
  assert.match(stderr, /at most one <topic>/);
});

test('an unknown flag is a usage error (exit 2)', async () => {
  const { code } = await runBin(await treelessDir(), ['guidance', '--nope']);
  assert.equal(code, 2);
});

test('the verb is wired into help: top-level listing and `rcf help guidance`', async () => {
  const cwd = await treelessDir();
  const top = await runBin(cwd, ['--help']);
  assert.match(top.stdout, /^\s+guidance \[topic\]/m);
  const topic = await runBin(cwd, ['help', 'guidance']);
  assert.equal(topic.code, 0);
  assert.equal(topic.stdout, CORE_HELP.guidance);
  const flag = await runBin(cwd, ['guidance', '--help']);
  assert.equal(flag.stdout, CORE_HELP.guidance);
});

test('every topic named in the help block is a real topic', async () => {
  const slugs = new Set((await listTopics(guidanceDir)).map((t) => t.slug));
  const body = CORE_HELP.guidance.split('Options:')[0];
  for (const m of body.matchAll(/^ {2}([a-z][a-z-]+) {2,}/gm)) {
    assert.equal(slugs.has(m[1]), true, `help block names '${m[1]}', which is not a topic`);
  }
});

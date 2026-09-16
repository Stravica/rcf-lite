// FBS-183 slice 4 unit tests for scripts/bootstrap-feedback-labels.mjs.
//
// Binds AC-15902-2: idempotent creation of the six labels on a
// destination repo. First run creates every missing label; second
// run creates nothing. The script uses the same gh module seam as
// the tool, so a test fake replaces gh entirely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = resolve(here, 'gh-fakes', 'gh-fake-configurable.mjs');

async function setup(scenario) {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-bootstrap-labels-'));
  const configPath = join(tmp, 'config.json');
  const logPath = join(tmp, 'log.jsonl');
  await writeFile(configPath, JSON.stringify(scenario), 'utf8');
  await writeFile(logPath, '', 'utf8');
  const prev = {
    module: process.env.RCF_FEEDBACK_GH_MODULE,
    config: process.env.RCF_FEEDBACK_GH_FAKE_CONFIG,
    log: process.env.RCF_FEEDBACK_GH_FAKE_LOG,
  };
  process.env.RCF_FEEDBACK_GH_MODULE = FAKE;
  process.env.RCF_FEEDBACK_GH_FAKE_CONFIG = configPath;
  process.env.RCF_FEEDBACK_GH_FAKE_LOG = logPath;
  return {
    tmp,
    async readLog() {
      const text = await readFile(logPath, 'utf8');
      return text.split('\n').filter((l) => l).map((l) => JSON.parse(l));
    },
    restore() {
      // Restore prior env so parallel tests see a clean state.
      if (prev.module === undefined) delete process.env.RCF_FEEDBACK_GH_MODULE;
      else process.env.RCF_FEEDBACK_GH_MODULE = prev.module;
      if (prev.config === undefined) delete process.env.RCF_FEEDBACK_GH_FAKE_CONFIG;
      else process.env.RCF_FEEDBACK_GH_FAKE_CONFIG = prev.config;
      if (prev.log === undefined) delete process.env.RCF_FEEDBACK_GH_FAKE_LOG;
      else process.env.RCF_FEEDBACK_GH_FAKE_LOG = prev.log;
    },
  };
}

// The script uses process.env for the fake config; importing the
// module resets the module-level CONFIG snapshot on each fresh
// import. `?run=<n>` cache-busts so a second run reads the updated
// scenario file.

async function runBootstrap(argv, runId) {
  const url = `${new URL('../../scripts/bootstrap-feedback-labels.mjs', import.meta.url)}?run=${runId}`;
  const mod = await import(url);
  return mod.main(argv);
}

test('AC-15902-2: bootstrap creates every missing label on the first run', async () => {
  const s = await setup({ labelList: { names: [] } });
  try {
    const code = await runBootstrap(['--repo', 'Stravica/rcf-lite'], 'first-empty');
    assert.equal(code, 0);
    const log = await s.readLog();
    const created = log.filter((l) => l.name === 'ghLabelCreate');
    assert.equal(created.length, 6, 'six creates on an empty repo');
    assert.deepEqual(created.map((l) => l.args.name).sort(), [
      'area:blueprint', 'area:core', 'rcf-feedback',
      'severity:blocker', 'severity:major', 'severity:minor',
    ]);
    // Each create carries a description and a colour.
    for (const c of created) {
      assert.ok(typeof c.args.description === 'string' && c.args.description.length > 0);
      assert.ok(/^[0-9A-Fa-f]{6}$/.test(c.args.color));
    }
  } finally { s.restore(); }
});

test('AC-15902-2: bootstrap makes zero create calls when every label is already present', async () => {
  const s = await setup({
    labelList: {
      names: [
        'rcf-feedback', 'severity:blocker', 'severity:major',
        'severity:minor', 'area:blueprint', 'area:core',
      ],
    },
  });
  try {
    const code = await runBootstrap(['--repo', 'Stravica/rcf-lite'], 'second-full');
    assert.equal(code, 0);
    const log = await s.readLog();
    const created = log.filter((l) => l.name === 'ghLabelCreate');
    assert.equal(created.length, 0, 'no creates when every label already exists');
  } finally { s.restore(); }
});

test('AC-15902-2: bootstrap creates only the missing subset (partial second run)', async () => {
  const s = await setup({
    labelList: { names: ['rcf-feedback', 'severity:blocker'] }, // 2 of 6 present
  });
  try {
    const code = await runBootstrap(['--repo', 'Stravica/rcf-lite'], 'partial');
    assert.equal(code, 0);
    const log = await s.readLog();
    const created = log.filter((l) => l.name === 'ghLabelCreate');
    assert.deepEqual(created.map((l) => l.args.name).sort(), [
      'area:blueprint', 'area:core',
      'severity:major', 'severity:minor',
    ]);
  } finally { s.restore(); }
});

test('bootstrap --dry-run reports the plan and makes no create call', async () => {
  const s = await setup({ labelList: { names: [] } });
  try {
    const code = await runBootstrap(['--repo', 'Stravica/rcf-lite', '--dry-run'], 'dryrun');
    assert.equal(code, 0);
    const log = await s.readLog();
    assert.equal(log.filter((l) => l.name === 'ghLabelCreate').length, 0);
  } finally { s.restore(); }
});

test('bootstrap refuses without --repo (exit 2)', async () => {
  const s = await setup({});
  try {
    const code = await runBootstrap([], 'no-repo');
    assert.equal(code, 2);
  } finally { s.restore(); }
});

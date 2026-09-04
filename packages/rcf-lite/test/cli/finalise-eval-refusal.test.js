// `rcf finalise` EVAL-MISSING gate integration tests
// (rcf-eval-node spec section 5.2). Mirrors the --ship-without-verified
// precedent at test/cli/finalise-mock-only.test.js: on a verify PASS
// whose report carries at least one per-AC EVAL-MISSING /
// EVAL-BELOW-THRESHOLD verdict, finalise refuses to promote 'complete'
// -> 'verified' unless the operator passes --ship-without-eval "<reason>".
// The ack lands on rcf/manifest.json under shipWithoutEval[] with a
// monotonic 'swe-<fbsId>-<n>' id (durable + greppable).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject } from '#core/store/init.js';

import { main as finalise } from '../../src/cli/finalise.js';

function sink() {
  return { data: '', write(s) { this.data += s; } };
}

async function scaffoldComplete() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-fin-eval-'));
  await initProject({ projectRoot: tmp, projectName: 'FinEvalTest' });
  const fbsPath = join(tmp, 'rcf/fbs/fbs-001.json');
  const fbs = JSON.parse(await readFile(fbsPath, 'utf8'));
  fbs.executionStatus = 'complete';
  await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  return { tmp };
}

function stubDeps({ tmp, perAc }) {
  return {
    stdout: sink(),
    stderr: sink(),
    cwd: tmp,
    detectVerify: async () => ({
      installed: true,
      invocation: { command: 'node', prefixArgs: [], source: 'package' },
    }),
    spawnVerify: async () => ({ code: 0 }),
    loadReport: async () => ({
      ok: true,
      report: {
        schemaVersion: '1',
        verdict: 'PASS',
        verdictAuthority: 'ship',
        run: { profile: 'deployed', url: 'https://app.example.com', parityEnv: false },
        findings: [],
        perAcVerdicts: perAc,
      },
    }),
  };
}

test('finalise refuses to promote on a passing verify report that carries an EVAL-MISSING verdict (exit 4, exact stderr line)', async () => {
  const { tmp } = await scaffoldComplete();
  const deps = stubDeps({
    tmp,
    perAc: [{ acId: 'AC-1601-4', verdict: 'EVAL-MISSING', reason: 'no bound EVAL' }],
  });
  const code = await finalise(['FBS-001', '--url', 'https://app.example.com'], deps);
  assert.equal(code, 4, `stderr=${deps.stderr.data}`);
  // The exact refusal line the code emits at src/cli/finalise.js:403.
  assert.match(
    deps.stderr.data,
    /finalise refused: EVAL missing on AC\(s\) AC-1601-4; author an EVAL or --ship-without-eval "reason"/,
  );
  const fbs = JSON.parse(await readFile(join(tmp, 'rcf/fbs/fbs-001.json'), 'utf8'));
  assert.equal(fbs.executionStatus, 'complete', 'FBS left at complete on refusal');
});

test('finalise --ship-without-eval "harness offline" exits 0 and appends a monotonic swe-* record on manifest.shipWithoutEval[]', async () => {
  const { tmp } = await scaffoldComplete();
  const deps = stubDeps({
    tmp,
    perAc: [{ acId: 'AC-1601-4', verdict: 'EVAL-MISSING', reason: 'no bound EVAL' }],
  });
  const code = await finalise(
    ['FBS-001', '--url', 'https://app.example.com', '--ship-without-eval', 'harness offline'],
    deps,
  );
  assert.equal(code, 0, `stderr=${deps.stderr.data}`);

  const manifest = JSON.parse(await readFile(join(tmp, 'rcf/manifest.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.shipWithoutEval), 'shipWithoutEval[] on manifest');
  assert.equal(manifest.shipWithoutEval.length, 1, 'one ack record after one --ship-without-eval run');
  const ack = manifest.shipWithoutEval[0];
  assert.equal(ack.id, 'swe-FBS-001-1', 'monotonic id (n=1) per FBS');
  assert.equal(ack.fbsId, 'FBS-001');
  assert.equal(ack.reason, 'harness offline');
  assert.match(ack.ackedAt, /^\d{4}-\d{2}-\d{2}T/, 'ISO timestamp on ackedAt');
  assert.equal(ack.declaredAcs.length, 1);
  assert.deepEqual(ack.declaredAcs[0], {
    acId: 'AC-1601-4', verdict: 'EVAL-MISSING', reason: 'no bound EVAL',
  });
  // The confirmation line names the record id and reason so the operator can grep it.
  assert.match(deps.stdout.data, /swe-FBS-001-1/);
  assert.match(deps.stdout.data, /reason: harness offline/);
});

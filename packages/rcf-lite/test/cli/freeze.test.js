// CLI tests for `rcf define freeze` (REQ-176; proposal 2026-09-22
// §2.1, §2.5 v3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir, mkdtemp, readFile, stat, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';

import { main } from '../../src/cli/freeze.js';
import { loadFreezeRecord } from '../../src/define/freeze-record.js';
import { computeDelta } from '../../src/query/delta.js';
import { loadAllLedgers } from '../../src/define/ledgers.js';
import { walkTree } from '#core/store';

function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'freeze-cli-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const result = await initProject({ projectRoot: root });
  assert.ok(result && Array.isArray(result.created), `initProject failed: ${JSON.stringify(result)}`);
  return root;
}

async function run(argv, cwd, deps = {}) {
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await main(argv, { stdout, stderr, cwd, ...deps });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

async function writeJson(path, body) {
  await mkdir(join(path, '..'), { recursive: true }).catch(() => {});
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
}

/**
 * Overwrite the initProject scratch tree with a chain that satisfies
 * every D1..D8 gate. Modelled on test/query/readiness.test.js's
 * "well-formed tree" fixture, adapted to disk shape: one REQ, one US
 * with three ACs (happy / failure / must-not), one TAC with an
 * httpRoute interface, one deploy ADR, one FBS at the queue head, a
 * TAD with security and operational fields, plus a brief statement
 * and profile markers.
 */
async function seedFreezeableTree(root) {
  await mkdir(join(root, 'rcf', '.identity'), { recursive: true });
  await writeFile(
    join(root, 'rcf', '.identity', 'profile.md'),
    '## Register\nproductOwner\n\n## Surface\nviewer\n',
    'utf8',
  );

  await writeJson(join(root, 'rcf', 'requirements', 'req-001.json'), {
    reqId: 'REQ-001',
    prdId: 'PRD-001',
    title: 'ship the widget',
    description: 'One real requirement to ship the widget end-to-end.',
    category: 'functional',
    domain: 'ops',
    priority: 'must',
    version: '0.1.0',
    status: 'draft',
    shapeClassification: {
      shapes: ['httpApi'],
      reason: 'keyword-scan',
      classifiedAt: '2026-09-24T16:00:00Z',
    },
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  await writeJson(join(root, 'rcf', 'user-stories', 'us-101.json'), {
    usId: 'US-101',
    prdId: 'PRD-001',
    reqId: 'REQ-001',
    version: '0.1.0',
    status: 'draft',
    title: 'operator ships widget',
    asA: 'operator',
    iWant: 'to ship the widget',
    soThat: 'downstream teams can use it',
    tacIds: ['TAC-001'],
    acceptanceCriteria: [
      { id: 'AC-101-1', testable: true, description: '[happy] operator ships widget' },
      { id: 'AC-101-2', testable: true, description: '[failure] server returns 500' },
      { id: 'AC-101-3', testable: true, description: '[must-not] endpoint accepts unauth' },
    ],
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  await writeJson(join(root, 'rcf', 'tacs', 'tac-001.json'), {
    tacId: 'TAC-001',
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '0.1.0',
    status: 'draft',
    name: 'widget shipper',
    purpose: 'Ships the widget over http.',
    responsibilities: ['Accept a POST', 'Return 201 with the widget id'],
    interfaces: [
      { name: 'ship', kind: 'httpRoute', description: 'POST /widgets' },
    ],
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  await writeJson(join(root, 'rcf', 'adrs', 'adr-001.json'), {
    adrId: 'ADR-001',
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '0.1.0',
    status: 'accepted',
    title: 'Deploy target: Hetzner',
    context: 'Deployment target chosen.',
    decision: 'Use Hetzner.',
    consequences: 'Ownership stays with the ops team.',
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  await writeJson(join(root, 'rcf', 'tad.json'), {
    tadId: 'TAD-001',
    prdId: 'PRD-001',
    version: '0.1.0',
    status: 'draft',
    systemOverview: {
      executiveSummary: 'Widget system.',
      systemPurpose: 'Ship widgets.',
      architecturalApproach: 'One http service, one datastore.',
      keyCapabilities: ['ship widgets'],
    },
    securityArchitecture: {
      authenticationPattern: 'jwt bearer with rotating refresh tokens',
      authorizationModel: 'per-user scopes',
    },
    operationalConcerns: {
      healthChecks: 'GET /healthz returns 200 with build info',
      logging: 'structured JSON to stdout',
    },
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  await writeJson(join(root, 'rcf', 'fbs', 'fbs-001.json'), {
    fbsId: 'FBS-001',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 1,
    executionStatus: 'notStarted',
    title: 'ship the widget',
    summary: 'Implement the http route and its three ACs.',
    acIds: ['AC-101-1', 'AC-101-2', 'AC-101-3'],
    dependsOnFbsIds: [],
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  // Brief statement satisfies D1 sinceFreeze + D2's resolvedBy pointer.
  await writeJson(join(root, 'rcf', 'define', 'brief-ledger.json'), {
    ledger: 'brief',
    statements: [
      {
        id: 1,
        kind: 'capability',
        text: 'ship the widget',
        resolvedBy: 'REQ-001',
        status: 'open',
        addedAt: '2026-09-24T16:00:00Z',
      },
    ],
  });
}

// AC-17601-1
test('freeze cli: happy path writes freeze.json and produces an empty delta', async () => {
  const cwd = await scratchProject();
  await seedFreezeableTree(cwd);

  const r = await run([], cwd);
  assert.equal(r.code, 0, `freeze exit ${r.code}; stderr:\n${r.stderr}`);
  assert.match(r.stdout, /^first freeze at [0-9a-f]{8}: /);
  assert.match(r.stdout, /1 REQ, 1 stories, 3 criteria, 1 interfaces, 1 TAC, 1 ADR, 1 FBS\./);

  // Freeze record written with the required shape.
  const record = await loadFreezeRecord({ projectRoot: cwd });
  assert.ok(record, 'freeze record was not written');
  assert.match(record.frozenAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(record.treeHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.briefStatements, 1);
  assert.equal(record.override, null);
  assert.equal(record.note, null);
  assert.ok(record.gates && record.gates['define.brief'], 'gates.define.brief missing');
  assert.ok(record.counts && record.counts.req === 1 && record.counts.us === 1 && record.counts.ac === 3);
  assert.equal(record.counts.acByClass.happy, 1);
  assert.equal(record.counts.acByClass.failure, 1);
  assert.equal(record.counts.acByClass.mustNot, 1);
  assert.equal(record.counts.interfaces.httpRoute, 1);
  assert.ok(record.litmus && Array.isArray(record.litmus.attestedAt));
  assert.equal(record.litmus.readers, 0);
  assert.ok(record.versions && typeof record.versions.rcfLite === 'string');

  // After the write, computeDelta over the live tree + new record reports empty lists.
  const { tree } = await walkTree({ projectRoot: cwd });
  const ledgers = await loadAllLedgers({ projectRoot: cwd });
  const delta = computeDelta(tree, record, ledgers);
  assert.equal(delta.changed.length, 0);
  assert.equal(delta.added.length, 0);
  assert.equal(delta.removed.length, 0);
});

// AC-17601-1 (--json envelope on happy path)
test('freeze cli: --json emits { record, summary, delta } on success', async () => {
  const cwd = await scratchProject();
  await seedFreezeableTree(cwd);
  const r = await run(['--json'], cwd);
  assert.equal(r.code, 0, `stderr: ${r.stderr}`);
  const envelope = JSON.parse(r.stdout);
  assert.ok(envelope.record && envelope.record.treeHash);
  assert.match(envelope.summary, /^first freeze at /);
  assert.ok(envelope.delta && Array.isArray(envelope.delta.added));
});

// AC-17601-2
test('freeze cli: refuses with exit 4 on any failing stage and writes nothing', async () => {
  const cwd = await scratchProject(); // fresh init; no brief statement.
  const r = await run([], cwd);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /refused/);
  assert.match(r.stderr, /D1 \(define\.brief\): failing/);
  assert.match(r.stderr, /Run `rcf define readiness --check brief`/);
  // No freeze.json written.
  await assert.rejects(
    () => stat(join(cwd, 'rcf', 'define', 'freeze.json')),
    (err) => err.code === 'ENOENT',
  );
});

// AC-17601-3
test('freeze cli: --ack only accepts D3/D5/D6 and persists as acknowledged at hash', async () => {
  const cwd = await scratchProject();
  await seedFreezeableTree(cwd);

  // Break D3 by removing the interface kind entirely (empty interfaces list).
  await writeJson(join(cwd, 'rcf', 'tacs', 'tac-001.json'), {
    tacId: 'TAC-001',
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '0.1.0',
    status: 'draft',
    name: 'widget shipper',
    purpose: 'Ships the widget over http.',
    responsibilities: ['Accept a POST', 'Return 201 with the widget id'],
    interfaces: [],
    createdAt: '2026-09-24T16:00:00Z',
    updatedAt: '2026-09-24T16:00:00Z',
  });

  // Ack on a blocking gate: usage refusal.
  const rBlocking = await run(['--ack', 'define.brief', '--reason', 'no'], cwd);
  assert.equal(rBlocking.code, 2);
  assert.match(rBlocking.stderr, /not an ackable gate/);

  // Ack without --reason: usage refusal.
  const rNoReason = await run(['--ack', 'shapes'], cwd);
  assert.equal(rNoReason.code, 2);
  assert.match(rNoReason.stderr, /requires a matching --reason/);

  // Valid --ack on D3 short name.
  const rAcked = await run(['--ack', 'shapes', '--reason', 'templates deferred'], cwd);
  assert.equal(rAcked.code, 0, `stderr: ${rAcked.stderr}`);

  const record = await loadFreezeRecord({ projectRoot: cwd });
  assert.equal(record.gates['define.shapes'].state, 'acknowledged');
  assert.equal(record.gates['define.shapes'].at.hash, record.treeHash);
  assert.equal(record.gates['define.shapes'].at.reason, 'templates deferred');
});

// AC-17601-4 (incremental summary)
test('freeze cli: summary line follows section 2.5 for first and incremental freezes', async () => {
  const cwd = await scratchProject();
  await seedFreezeableTree(cwd);

  const rFirst = await run([], cwd);
  assert.equal(rFirst.code, 0);
  assert.match(rFirst.stdout, /^first freeze at [0-9a-f]{8}: 1 REQ, 1 stories, 3 criteria/);

  // Amend the US title; second freeze should report US-101 as amended.
  const usPath = join(cwd, 'rcf', 'user-stories', 'us-101.json');
  const us = JSON.parse(await readFile(usPath, 'utf8'));
  us.title = 'operator ships widget (v2)';
  us.updatedAt = '2026-09-24T17:00:00Z';
  await writeFile(usPath, `${JSON.stringify(us, null, 2)}\n`, 'utf8');

  // Add a second brief statement so D1 sinceFreeze passes.
  const briefPath = join(cwd, 'rcf', 'define', 'brief-ledger.json');
  const brief = JSON.parse(await readFile(briefPath, 'utf8'));
  brief.statements.push({
    id: 2,
    kind: 'amendment',
    text: 'clarify the widget title',
    resolvedBy: 'US-101',
    status: 'open',
    addedAt: '2026-09-24T17:00:00Z',
  });
  await writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');

  const rSecond = await run([], cwd);
  assert.equal(rSecond.code, 0, `stderr: ${rSecond.stderr}`);
  assert.match(rSecond.stdout, /^frozen at [0-9a-f]{8}: 0 REQ, 0 stories, 0 criteria, 0 interfaces added; US-101 amended;/);
});

// AC-17601-5
test('freeze cli: --status is read-only and reports the record + live delta', async () => {
  const cwd = await scratchProject();
  // never frozen path.
  const rNever = await run(['--status'], cwd);
  assert.equal(rNever.code, 0);
  assert.match(rNever.stdout, /^never frozen/);

  // never frozen --json.
  const rNeverJson = await run(['--status', '--json'], cwd);
  assert.equal(rNeverJson.code, 0);
  const bodyNever = JSON.parse(rNeverJson.stdout);
  assert.equal(bodyNever.record, null);
  assert.ok(bodyNever.delta && Array.isArray(bodyNever.delta.added));

  // seed and freeze, then --status should print counts.
  await seedFreezeableTree(cwd);
  const rFreeze = await run([], cwd);
  assert.equal(rFreeze.code, 0, `stderr: ${rFreeze.stderr}`);
  const freezePath = join(cwd, 'rcf', 'define', 'freeze.json');
  const mtimeBefore = (await stat(freezePath)).mtimeMs;
  // Sleep briefly so a spurious rewrite would show a different mtime.
  await new Promise((res) => setTimeout(res, 20));
  const rStatus = await run(['--status'], cwd);
  assert.equal(rStatus.code, 0);
  assert.match(rStatus.stdout, /^Frozen at [0-9a-f]{8} on /);
  assert.match(rStatus.stdout, /Counts: 1 REQ \/ 1 US \/ 3 AC \/ 1 TAC \/ 1 ADR \/ 1 FBS\./);
  const mtimeAfter = (await stat(freezePath)).mtimeMs;
  assert.equal(mtimeAfter, mtimeBefore, '--status must never rewrite the record');
});

// AC-17601-6
test('freeze cli: admissibility refusal is informational, never a freeze refusal', async () => {
  // A fresh init tree has NV-BL-ADM violations (init templates carry
  // TODO placeholders that the admissibility rules refuse). The fresh
  // init is NOT freezeable for its own gate reasons (D1..D8 fail); we
  // seed the freezeable tree AND leave the manifest's rulesetVersion
  // as whatever init writes so the wrap can still run and its outcome
  // does not decide the exit code.
  const cwd = await scratchProject();
  await seedFreezeableTree(cwd);
  const r = await run([], cwd);
  // Either the wrap passes (freezeable tree) or refuses with the
  // informational warn line; in both cases the freeze compute writes
  // the record and exits 0.
  assert.equal(r.code, 0, `stderr:\n${r.stderr}`);
  const record = await loadFreezeRecord({ projectRoot: cwd });
  assert.ok(record, 'record was not written under a wrapped call');
  // When the wrap refused, the CLI prints a [warn] and continues.
  if (r.stderr.includes('[warn]')) {
    assert.match(r.stderr, /chain admissibility refused/);
  }
});

// AC-17601-8 (hygiene: readiness header + CHANGELOG use ': ')
test("freeze cli: readiness stage header and CHANGELOG no longer use ' -- '", async () => {
  // 1. Readiness CLI stage header line.
  const readinessCli = await readFile(
    join(new URL('..', import.meta.url).pathname, '..', 'src', 'cli', 'readiness.js'),
    'utf8',
  );
  // The old header pattern was `${stage.stage} (${stage.gate}) -- ${...}`.
  // The current source must use `: ` between the closing paren and the state label.
  assert.match(readinessCli, /\$\{stage\.stage\} \(\$\{stage\.gate\}\): \$/);
  assert.doesNotMatch(readinessCli, /\$\{stage\.stage\} \(\$\{stage\.gate\}\) -- /);

  // 2. CHANGELOG.md TODO regex line.
  const changelog = await readFile(
    join(new URL('..', import.meta.url).pathname, '..', 'CHANGELOG.md'),
    'utf8',
  );
  assert.match(changelog, /The regex is now `\/\\bTODO:\/`: case-sensitive/);
  assert.doesNotMatch(changelog, /The regex is now `\/\\bTODO:\/` -- /);
});

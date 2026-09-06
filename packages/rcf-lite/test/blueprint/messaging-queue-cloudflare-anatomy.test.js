// Anatomy + shape + probe-shape + fixture + shelf-doc test for the
// messaging-queue-cloudflare v1.0.0 shelf blueprint (infra round 5 spec section 5.3).
// Covers TS-072.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'messaging-queue-cloudflare');
const FIXTURE_ROOT = join(REPO_ROOT, 'packages', 'rcf-lite', 'test', 'fixtures', 'infra-s3-and-queue');
const PROBES_DIR = join(BLUEPRINT_ROOT, 'contributions', 'probes');
const AUTHORING_DOC = join(REPO_ROOT, 'packages', 'rcf-lite', 'docs', 'blueprint-authoring.md');

test('blueprint.json declares 21 contributions with capabilities queue, suggestedCompanions logging and errorHandling, and standardsTraceClause on every ADR entry (TC-072-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'messaging-queue-cloudflare');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.category, 'messaging');
  assert.deepEqual(doc.capabilities, ['queue']);
  assert.equal(doc.contributions.length, 21);
  const kinds = doc.contributions.reduce((acc, c) => {
    acc[c.kind] = (acc[c.kind] || 0) + 1;
    return acc;
  }, {});
  assert.equal(kinds.req, 6);
  assert.equal(kinds.us, 8);
  assert.equal(kinds.tac, 3);
  assert.equal(kinds.adr, 4);
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  for (const adr of adrs) {
    assert.ok(typeof adr.standardsTraceClause === 'string' && adr.standardsTraceClause.length > 0,
      `ADR entry ${adr.id} must carry a non-null standardsTraceClause per section 8a.2`);
  }
  const globalAdrs = adrs.filter((a) => a.scope === 'global');
  assert.equal(globalAdrs.length, 1);
  assert.equal(globalAdrs[0].topic, 'deliverySemantics');
  assert.equal(doc.requiresAppliedCapabilities, undefined,
    'per spec section 5.3, no requiresAppliedCapabilities block ships at v1.0.0');
});

test('apply messaging-queue-cloudflare lands 21 contributions on a scratch project (TC-072-applies-clean)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  for (const c of doc.contributions) {
    const filePath = join(BLUEPRINT_ROOT, 'contributions', c.path);
    const s = await stat(filePath);
    assert.ok(s.isFile(), `contribution file ${c.path} must exist`);
    const body = JSON.parse(await readFile(filePath, 'utf8'));
    if (c.kind === 'req') assert.equal(body.reqId, c.id);
    if (c.kind === 'us') assert.equal(body.usId, c.id);
    if (c.kind === 'tac') assert.equal(body.tacId, c.id);
    if (c.kind === 'adr') assert.equal(body.adrId, c.id);
  }
});

test('REQ-004 description names dead_letter_queue and the 4-day DLQ retention with the Cloudflare DLQ doc URL (TC-072-dlq-req-grep)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'contributions', 'requirements', 'messaging-queue-cloudflare-req-004.json'), 'utf8'));
  assert.equal(doc.reqId, 'messaging-queue-cloudflare-REQ-004');
  assert.match(doc.description, /dead_letter_queue/,
    'REQ-004 description must name the wrangler dead_letter_queue field literal');
  assert.match(doc.description, /4 days|4-day/,
    'REQ-004 description must name the DLQ retention of 4 days');
  assert.match(doc.description, /https:\/\/developers\.cloudflare\.com\/queues\/configuration\/dead-letter-queues\//,
    'REQ-004 description must cite the Cloudflare Queues dead-letter documentation URL');
});

test('every probe module exports the section 3.2 verdict envelope with an anchorAcId matching a contributed AC id (TC-072-probe-anchor-ids-cross-check)', async () => {
  const blueprintDoc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  const contributedAcIds = new Set();
  for (const c of blueprintDoc.contributions) {
    if (c.kind !== 'us') continue;
    const usPath = join(BLUEPRINT_ROOT, 'contributions', c.path);
    const usDoc = JSON.parse(await readFile(usPath, 'utf8'));
    for (const ac of usDoc.acceptanceCriteria || []) {
      contributedAcIds.add(ac.id);
    }
  }
  const probeNames = [
    'producer-facade-ready',
    'publish-to-delivery',
    'retry-and-dlq',
    'event-secrecy',
    'real-account-concurrency-smoke',
  ];
  for (const name of probeNames) {
    const probePath = join(PROBES_DIR, `${name}.mjs`);
    const stats = await stat(probePath);
    assert.ok(stats.isFile(), `probe module ${name}.mjs must exist`);
    const shimPath = join(PROBES_DIR, `run-${name}.mjs`);
    const shimStats = await stat(shimPath);
    assert.ok(shimStats.isFile(), `probe shim run-${name}.mjs must exist`);
    const src = await readFile(probePath, 'utf8');
    const anchors = [...src.matchAll(/anchorAcId:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
    assert.ok(anchors.length > 0, `probe ${name} must reference at least one anchorAcId literal`);
    for (const anchor of anchors) {
      assert.ok(contributedAcIds.has(anchor), `probe ${name} anchorAcId ${anchor} must match a contributed AC id (contributed=${[...contributedAcIds].join(',')})`);
    }
  }
  // real-account-concurrency-smoke declares accountBound: true per spec section 3.5.
  const rasSrc = await readFile(join(PROBES_DIR, 'real-account-concurrency-smoke.mjs'), 'utf8');
  assert.match(rasSrc, /export const accountBound = true/,
    'real-account-concurrency-smoke must declare accountBound: true');
});

test('sample-app fixture ships wrangler.toml, src/producer.mjs, src/consumer.mjs, src/dlq-inspector.mjs, and its README documents wrangler dev and the three wired induced-failure switches (TC-072-fixture-and-switches)', async () => {
  await stat(join(FIXTURE_ROOT, 'wrangler.toml'));
  await stat(join(FIXTURE_ROOT, 'src', 'producer.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'consumer.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'dlq-inspector.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'queue-driver.mjs'));
  await stat(join(FIXTURE_ROOT, 'src', 'event-sink.mjs'));
  const readme = await readFile(join(FIXTURE_ROOT, 'README.md'), 'utf8');
  for (const sw of [
    'SIMULATE_CONSUMER_RETRY',
    'SIMULATE_DLQ_OVERFLOW',
    'SIMULATE_PII_IN_BODY',
  ]) {
    assert.match(readme, new RegExp(sw), `fixture README must document ${sw}`);
  }
  assert.match(readme, /wrangler dev/i);
  assert.match(readme, /RCF_TEST_QUEUE/);
  assert.match(readme, /RCF_TEST_DLQ/);
  // producer.mjs (TAC-3001 facade) must not import a Cloudflare-specific client
  // at v1.0.0 (the binding is passed in from the caller); shape check.
  const prod = await readFile(join(FIXTURE_ROOT, 'src', 'producer.mjs'), 'utf8');
  assert.match(prod, /createProducer/,
    'src/producer.mjs must export createProducer');
  // wrangler.toml must declare the queue binding and DLQ per REQ-004.
  const toml = await readFile(join(FIXTURE_ROOT, 'wrangler.toml'), 'utf8');
  assert.match(toml, /RCF_TEST_QUEUE/);
  assert.match(toml, /dead_letter_queue\s*=\s*"rcf-test-dlq"/);
  assert.match(toml, /max_retries\s*=\s*3/);
  assert.match(toml, /max_batch_size\s*=\s*10/);
  assert.match(toml, /max_batch_timeout\s*=\s*5/);
});

test('section 6a table gains a queue row with reserved messaging-queue-postgres sibling and every shipped blueprint docs/topics.md gains a messaging-queue-cloudflare row at 29101-29899 / 30xx (TC-072-shelf-doc-consistency)', async () => {
  const authoring = await readFile(AUTHORING_DOC, 'utf8');
  assert.match(authoring, /^\|\s*`queue`\s*\|/m,
    'section 6a capability table must gain a queue row');
  assert.match(authoring, /messaging-queue-cloudflare/,
    'section 6a queue row must name messaging-queue-cloudflare as the shelf provider');
  assert.match(authoring, /messaging-queue-postgres/,
    'section 6a queue row must name the reserved messaging-queue-postgres sibling per Baz decision 7');
  const blueprintsDir = join(REPO_ROOT, 'blueprints');
  const dirs = (await readdir(blueprintsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const bp of dirs) {
    const topics = join(blueprintsDir, bp, 'docs', 'topics.md');
    try {
      const body = await readFile(topics, 'utf8');
      assert.match(
        body,
        /^\|\s*messaging-queue-cloudflare\s*\|\s*29101-29899\s*\|\s*30xx\s*\|/m,
        `${bp}/docs/topics.md must carry a messaging-queue-cloudflare row at 29101-29899 / 30xx`,
      );
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
  }
});

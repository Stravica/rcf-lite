// Anatomy + apply + probe-pack test for the application-notifications-in-app
// v1.0.0 shelf blueprint (visual round T-4, spec section 5.4).
//
// Covers TS-050.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyBlueprint } from '../../src/blueprint/apply.js';
import { initProject } from '../../src/core/store/init.js';
import { walkTree } from '../../src/core/store/walker.js';
import { loadBlueprint } from '../../src/blueprint/loader.js';
import { loadProbePacks, readContributedAcIds } from '../../src/browser-verify/pack-loader.js';
import { validatePackModule } from '../../src/browser-verify/pack-schema.js';

import { startServer } from '../fixtures/probe-pack-application-notifications-in-app/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..', '..', '..');
const BLUEPRINT_ROOT = join(REPO_ROOT, 'blueprints', 'application-notifications-in-app');
const PACK_ABS = join(BLUEPRINT_ROOT, 'probe-packs', 'application-notifications-in-app.pack.mjs');
const README_ABS = join(BLUEPRINT_ROOT, 'README.md');

test('application-notifications-in-app: blueprint.json declares the ratified shape (TC-050-blueprint-json-shape)', async () => {
  const doc = JSON.parse(await readFile(join(BLUEPRINT_ROOT, 'blueprint.json'), 'utf8'));
  assert.equal(doc.slug, 'application-notifications-in-app');
  assert.equal(doc.version, '1.0.0');
  assert.equal(doc.category, 'application');
  assert.equal(doc.providesRoles, undefined, 'providesRoles absent (leaf blueprint per spec; loader refuses empty array when set)');
  assert.equal(doc.suggestedCompanions.length, 2);
  const roles = doc.suggestedCompanions.map((c) => c.role).sort();
  assert.deepEqual(roles, ['errorHandling', 'logging']);
  const reqs = doc.contributions.filter((c) => c.kind === 'req');
  const uss = doc.contributions.filter((c) => c.kind === 'us');
  const tacs = doc.contributions.filter((c) => c.kind === 'tac');
  const adrs = doc.contributions.filter((c) => c.kind === 'adr');
  assert.equal(reqs.length, 5, 'five REQs');
  assert.equal(uss.length, 8, 'eight USs');
  assert.equal(tacs.length, 3, 'three TACs');
  assert.equal(adrs.length, 3, 'three ADRs');
  assert.equal(doc.contributions.length, 19, '19 contributions total');
});

test('application-notifications-in-app: applies cleanly on a fresh init project and adds 19 documents to the tree (TC-050-applies-clean)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'notifications-scratch-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const bp = await loadBlueprint(BLUEPRINT_ROOT);
  assert.equal(bp.slug, 'application-notifications-in-app');
  const { tree } = await walkTree({ projectRoot: scratch });
  const result = await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.equal(result.slug, 'application-notifications-in-app');
  const walked = await walkTree({ projectRoot: scratch });
  assert.deepEqual(walked.errors, []);
  const added = walked.tree.requirements.filter((r) => r.reqId.startsWith('application-notifications-in-app-'));
  assert.equal(added.length, 5);
  const uss = walked.tree.userStories.filter((u) => u.usId.startsWith('application-notifications-in-app-'));
  assert.equal(uss.length, 8);
});

test('application-notifications-in-app: every pack check id matches a contributed AC id, description discipline holds, appliesTo binds tacIds AND route (TC-050-pack-checks-cross-check)', async () => {
  const acIds = await readContributedAcIds({ blueprintAbsPath: BLUEPRINT_ROOT });
  const packMod = await import(pathToFileURL(PACK_ABS).href);
  const validation = validatePackModule({ mod: packMod, blueprintSlug: 'application-notifications-in-app', packAbsPath: PACK_ABS });
  assert.ok(validation.ok, JSON.stringify(validation.errors ?? []));
  const missing = validation.pack.checks.map((c) => c.id).filter((id) => !acIds.has(id));
  assert.deepEqual(missing, []);
  const expectedCheckIds = ['AC-20101-1', 'AC-20102-1', 'AC-20103-1'];
  const actual = validation.pack.checks.map((c) => c.id);
  assert.deepEqual(actual, expectedCheckIds);
  const missingDescription = validation.pack.checks.filter((c) => typeof c.description !== 'string' || c.description.length === 0);
  assert.deepEqual(missingDescription, [], 'every pack check must carry a non-empty description per spec section 9');
  // Spec section 9 T-4 row: the AC-20101-1 description contains "preseeded".
  const preseedCheck = validation.pack.checks.find((c) => c.id === 'AC-20101-1');
  assert.ok(preseedCheck.description.includes('preseeded'), 'AC-20101-1 description must contain "preseeded" per spec section 9');
  // appliesTo references BOTH tacIds AND route (the two legal source-scan seams).
  const src = validation.pack.appliesTo.toString();
  assert.ok(/tacIds/.test(src), 'appliesTo references tacIds');
  assert.ok(/route/.test(src) || /navModel/.test(src) || /path/.test(src), 'appliesTo references route/navModel/path');
});

test('application-notifications-in-app: pack loader discovers the shipped pack against an applied scratch project (TC-050-pack-loader-discovers)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'notifications-loader-'));
  await initProject({ projectRoot: scratch, projectName: 'scratch' });
  const { tree } = await walkTree({ projectRoot: scratch });
  await applyBlueprint({ projectRoot: scratch, tree, source: BLUEPRINT_ROOT });
  const { packs, errors, warnings } = await loadProbePacks({
    appliedBlueprints: [{ slug: 'application-notifications-in-app', absPath: BLUEPRINT_ROOT }],
    projectRoot: scratch,
  });
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(warnings, []);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].packName, 'application-notifications-in-app');
  assert.equal(packs[0].checks.length, 3);
});

test('application-notifications-in-app sample-app fixture: preseeds live regions on every route (TC-050-fixture-preseeding)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    for (const path of ['/', '/notifications-centre', '/notifications-preferences']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      // Both wrappers present and empty (no child element markers between the opening and closing tag).
      assert.ok(/<div class="notificationsLiveRegionPolite" aria-live="polite" data-live-region="polite" role="status"><\/div>/.test(html), `polite wrapper preseeded and empty on ${path}`);
      assert.ok(/<div class="notificationsLiveRegionAssertive" role="alert" data-live-region="assertive"><\/div>/.test(html), `assertive wrapper preseeded and empty on ${path}`);
      assert.ok(html.includes('data-region="shell-root"'), 'shell root marker present');
      assert.ok(html.includes('data-toast-timeout-floor-seconds="6"'), 'toast timeout floor advertised on shell root');
    }
    const centreHtml = await (await fetch(`http://127.0.0.1:${port}/notifications-centre`)).text();
    // Backlog enumeration by data-notification-id (per-element attribute) + acknowledge and mark-read controls per item + mark-all-read control on the surface.
    const items = centreHtml.match(/data-notification-id="([^"]+)"/g) || [];
    // Each notification appears twice in the HTML (once on the article wrapper, once on each of the acknowledge and mark-read button controls).
    // So for three backlog notifications we expect 9 data-notification-id occurrences.
    assert.ok(items.length >= 3, `centre inbox has notifications: found ${items.length} data-notification-id markers`);
    assert.ok(centreHtml.includes('data-action="acknowledge"'), 'acknowledge control present');
    assert.ok(centreHtml.includes('data-action="mark-read"'), 'mark-read control present');
    assert.ok(centreHtml.includes('data-action="mark-all-read"'), 'mark-all-read control present');
    assert.ok(centreHtml.includes('data-region="notifications-centre"'), 'centre region marker present');
    const prefsHtml = await (await fetch(`http://127.0.0.1:${port}/notifications-preferences`)).text();
    assert.ok(prefsHtml.includes('data-preference-category="security"'), 'category silence toggle for security present');
    assert.ok(prefsHtml.includes('data-preference-section="email"'), 'sibling channel section for email present');
    assert.ok(prefsHtml.includes('data-preference-status="sibling not applied"'), 'sibling not applied labelling present');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application-notifications-in-app sample-app fixture: acknowledge round-trips through /api/notifications/acknowledge and delivery-log endpoint returns the seeded rows (TC-050-fixture-acknowledge)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    const before = await (await fetch(`http://127.0.0.1:${port}/api/delivery-log`)).json();
    assert.ok(Array.isArray(before.rows), 'delivery-log returns { rows: [...] }');
    assert.ok(before.rows.length >= 3, 'seeded backlog contains at least three rows');
    const targetId = before.rows[0].notificationId;
    assert.equal(before.rows[0].acknowledgedAt, null, 'first row is unacknowledged before the request');
    const ackRes = await fetch(`http://127.0.0.1:${port}/api/notifications/acknowledge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notificationId: targetId }),
    });
    assert.equal(ackRes.status, 200);
    const ackBody = await ackRes.json();
    assert.equal(ackBody.ok, true);
    assert.equal(ackBody.notificationId, targetId);
    const after = await (await fetch(`http://127.0.0.1:${port}/api/delivery-log`)).json();
    const row = after.rows.find((r) => r.notificationId === targetId);
    assert.ok(row.acknowledgedAt, 'acknowledgedAt is now set on the row');
    const requestsRes = await (await fetch(`http://127.0.0.1:${port}/__requests`)).json();
    assert.ok(Array.isArray(requestsRes), '/__requests returns an array');
    const serverAcks = requestsRes.filter((r) => r.kind === 'acknowledge-server' && r.notificationId === targetId);
    assert.equal(serverAcks.length, 1, 'exactly one server-side acknowledge record for the target notification');
    const healthz = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(healthz.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application-notifications-in-app sample-app fixture: break switches surface the four defects on the DOM (TC-050-negative-runs)', async () => {
  const { server, port } = await startServer({ port: 0 });
  try {
    // ?break=preseed: wrappers dropped from the initial DOM. The client script contains attribute-selector string literals that mention data-live-region; we assert on the wrapper element markup itself, not on the selector strings.
    const preseedHtml = await (await fetch(`http://127.0.0.1:${port}/?break=preseed`)).text();
    assert.ok(!/<div class="notificationsLiveRegionPolite"/.test(preseedHtml), '?break=preseed drops polite wrapper element from initial DOM');
    assert.ok(!/<div class="notificationsLiveRegionAssertive"/.test(preseedHtml), '?break=preseed drops assertive wrapper element from initial DOM');
    assert.ok(/data-break="preseed"/.test(preseedHtml), 'shell root marker records the break');

    // ?break=role: the client script's role handling is inverted; the HTML embeds brk as JSON.
    const brkRoleHtml = await (await fetch(`http://127.0.0.1:${port}/?break=role`)).text();
    assert.ok(brkRoleHtml.includes('"role"'), '?break=role embedded in client script');
    assert.ok(/data-break="role"/.test(brkRoleHtml), 'shell root marker records the break');

    // ?break=timeout: shell root advertises a two-second floor.
    const brkTimeoutHtml = await (await fetch(`http://127.0.0.1:${port}/?break=timeout`)).text();
    assert.ok(brkTimeoutHtml.includes('data-toast-timeout-floor-seconds="2"'), '?break=timeout advertises two-second floor');
    assert.ok(brkTimeoutHtml.includes('"timeout"'), '?break=timeout embedded in client script');

    // ?break=ack: the acknowledge click handler is a no-op; the HTML embeds brk as JSON.
    const brkAckHtml = await (await fetch(`http://127.0.0.1:${port}/notifications-centre?break=ack`)).text();
    assert.ok(brkAckHtml.includes('"ack"'), '?break=ack embedded in client script');
    assert.ok(/data-break="ack"/.test(brkAckHtml), 'shell root marker records the break');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application-notifications-in-app: family-prefix reservation documented in blueprint README and own topics.md (TC-050-family-prefix-reservation)', async () => {
  const readme = await readFile(README_ABS, 'utf8');
  // Blueprint README carries the family-prefix reservation paragraph and names every sibling channel.
  assert.ok(readme.includes('Family-prefix reservation'), 'family-prefix section in blueprint README');
  assert.ok(readme.includes('application-notifications-email'), 'sibling -email named in blueprint README');
  assert.ok(readme.includes('application-notifications-push'), 'sibling -push named in blueprint README');
  assert.ok(readme.includes('application-notifications-webhook'), 'sibling -webhook named in blueprint README');
  // The blueprint's own docs/topics.md carries the T-4 shelf registry row and the reserved-sibling rows.
  const ownTopics = await readFile(join(BLUEPRINT_ROOT, 'docs', 'topics.md'), 'utf8');
  assert.match(ownTopics, /\| application-notifications-in-app \| 20101-20899 \| 21xx \| shipped v1\.0\.0 \| none \|/, 'T-4 shelf registry row present in blueprint docs/topics.md');
  assert.match(ownTopics, /application-notifications-email \(reserved\)/, 'reserved -email row present');
  assert.match(ownTopics, /application-notifications-push \(reserved\)/, 'reserved -push row present');
  assert.match(ownTopics, /application-notifications-webhook \(reserved\)/, 'reserved -webhook row present');
});

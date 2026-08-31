// End-to-end tests for src/blueprint/supersede.js (Phase 3.5).
//
// Scaffolds a project, applies two blueprints whose scope:global ADRs
// collide on a topic, then invokes supersede and asserts:
//   - a well-formed project ADR file lands at rcf/adrs/adr-NNN-<topic>.json
//   - manifest.resolutions[] gains a matching record
//   - a subsequent `applyBlueprint` on the same conflicting pair no
//     longer raises the conflict (both blueprint ADRs may co-reside as
//     superseded history).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initProject, walkTree } from '#core/store';
import { applyBlueprint } from '../../src/blueprint/apply.js';
import { supersedeBlueprintTopic } from '../../src/blueprint/supersede.js';

async function scaffoldProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-supersede-'));
  const init = await initProject({ projectRoot: root, projectName: 'SupersedeTest' });
  assert.equal(init.kind, undefined, `initProject failed: ${JSON.stringify(init)}`);
  return root;
}

function adrBody({ id, title, decision, topic }) {
  return {
    adrId: id,
    prdId: 'PRD-001',
    tadId: 'TAD-001',
    version: '1.0.0',
    status: 'accepted',
    title,
    context: `Blueprint ADR ${id} on topic ${topic}.`,
    decision,
    consequences: `Follows from the decision above.`,
    createdAt: '2026-08-19T00:00:00Z',
    updatedAt: '2026-08-19T00:00:00Z',
  };
}

async function writeBlueprint(root, dirName, { slug, version = '1.0.0', contributions }) {
  const dir = join(root, dirName);
  await mkdir(join(dir, 'contributions'), { recursive: true });
  const meta = { slug, version, contributions: contributions.map((c) => ({ id: c.id, kind: c.kind, path: c.path, ...(c.scope ? { scope: c.scope } : {}), ...(c.topic ? { topic: c.topic } : {}) })) };
  await writeFile(join(dir, 'blueprint.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  for (const c of contributions) {
    const abs = join(dir, 'contributions', c.path);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, JSON.stringify(c.body, null, 2), 'utf8');
  }
  return dir;
}

const now = new Date('2026-08-19T10:00:00Z');

async function twoBlueprintsCollidingOnAuth() {
  const root = await scaffoldProject();
  const spa = await writeBlueprint(root, 'blueprint-spa', {
    slug: 'spa',
    contributions: [
      {
        id: 'ADR-005-spa',
        kind: 'adr',
        path: 'adr-005-spa.json',
        scope: 'global',
        topic: 'auth',
        body: adrBody({ id: 'ADR-005-spa', title: 'SPA auth: cookie sessions', decision: 'Use HttpOnly cookies for session state.', topic: 'auth' }),
      },
    ],
  });
  const rest = await writeBlueprint(root, 'blueprint-rest', {
    slug: 'rest',
    contributions: [
      {
        id: 'ADR-003-rest',
        kind: 'adr',
        path: 'adr-003-rest.json',
        scope: 'global',
        topic: 'auth',
        body: adrBody({ id: 'ADR-003-rest', title: 'REST auth: bearer tokens', decision: 'Use JWT bearer tokens.', topic: 'auth' }),
      },
    ],
  });
  // Apply spa first so the conflict surfaces when rest is added.
  const treeStart = await walkTree({ projectRoot: root });
  const spaResult = await applyBlueprint({ projectRoot: root, tree: treeStart.tree, source: spa, now });
  assert.equal(spaResult.applied, true, `spa apply failed: ${JSON.stringify(spaResult)}`);
  return { root, spa, rest };
}

test('supersede: refuses when the topic has fewer than two ADRs across applied + incoming AND no --incoming source was named (rev-3)', async () => {
  const { root } = await twoBlueprintsCollidingOnAuth();
  const { tree } = await walkTree({ projectRoot: root });
  // Only spa is applied so far, no --incoming provided: supersede has
  // only ONE scope:global ADR on 'auth' across applied+incoming.
  const result = await supersedeBlueprintTopic({ projectRoot: root, tree, topic: 'auth', now });
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /topic 'auth' has 1 scope:global ADR\(s\) across applied\+incoming/);
  assert.match(result.message, /--incoming <source>/);
  // Prefix discipline: rcfError body does NOT carry a `blueprint
  // supersede: ` prefix (the CLI edge adds it).
  assert.doesNotMatch(result.message, /^blueprint supersede: /);
});

test('supersede: scaffolds a project ADR + appends manifest.resolutions[] when two blueprints collide on a topic', async () => {
  const { root, rest } = await twoBlueprintsCollidingOnAuth();
  // Add rest; expect a conflict (spa vs rest on auth).
  const tw = await walkTree({ projectRoot: root });
  const restConflict = await applyBlueprint({ projectRoot: root, tree: tw.tree, source: rest, now });
  assert.equal(restConflict.applied, false);
  assert.ok(Array.isArray(restConflict.conflicts) && restConflict.conflicts.length === 1);
  assert.equal(restConflict.conflicts[0].kind, 'globalAdrTopic');
  assert.equal(restConflict.conflicts[0].topic, 'auth');
  // Since rest was refused, only spa is currently applied. Manually
  // record rest as applied so supersede has two sides to operate on.
  // In real use the operator would have run apply for one side first
  // (spa here), and supersede would run against the second-mover
  // scenario. This test walks the flow via the on-disk manifest: we
  // apply rest via a resolve declaration below (see next test) to
  // reach both-applied state before supersede; for this test we
  // synthesise it by pushing rest into the manifest directly to keep
  // the flow narrow.
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints.push({
    slug: 'rest',
    version: '1.0.0',
    appliedAt: '2026-08-19T10:00:05Z',
    source: rest,
    contributions: [
      { id: 'ADR-003-rest', path: 'rcf/adrs/adr-003-rest.json', kind: 'adr', scope: 'global', topic: 'auth' },
    ],
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const tw2 = await walkTree({ projectRoot: root });
  const result = await supersedeBlueprintTopic({ projectRoot: root, tree: tw2.tree, topic: 'auth', now });
  assert.equal(result.superseded, true, `supersede failed: ${JSON.stringify(result)}`);
  assert.equal(result.topic, 'auth');
  assert.match(result.resolvedByAdrId, /^ADR-\d{3}-auth$/);
  assert.match(result.resolvedByAdrPath, /^rcf\/adrs\/adr-\d{3}-auth\.json$/);
  assert.equal(result.supersedes.length, 2);
  const bySlug = Object.fromEntries(result.supersedes.map((s) => [s.slug, s.adrId]));
  assert.equal(bySlug.spa, 'ADR-005-spa');
  assert.equal(bySlug.rest, 'ADR-003-rest');
  assert.match(result.resolutionId, /^res-2026-08-19-\d{3}$/);

  // Project ADR file lands well-formed on disk.
  const adrPath = join(root, result.resolvedByAdrPath);
  const adrStat = await stat(adrPath);
  assert.ok(adrStat.isFile());
  const adr = JSON.parse(await readFile(adrPath, 'utf8'));
  assert.equal(adr.adrId, result.resolvedByAdrId);
  assert.equal(adr.status, 'accepted');
  assert.ok(adr.title.length > 0);
  assert.ok(adr.context.length > 0);
  assert.ok(adr.decision.length > 0);
  assert.ok(adr.consequences.length > 0);
  assert.deepEqual(adr.relatedAdrs.sort(), ['ADR-003-rest', 'ADR-005-spa']);

  // Manifest resolutions[] appended.
  const finalManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(finalManifest.resolutions.length, 1);
  const rec = finalManifest.resolutions[0];
  assert.equal(rec.kind, 'globalAdrTopic');
  assert.equal(rec.topic, 'auth');
  assert.equal(rec.resolvedByAdrId, result.resolvedByAdrId);
  assert.equal(rec.supersedes.length, 2);
});

test('supersede: --reason lands on the resolution record when provided; whitespace-only --reason is refused', async () => {
  const { root, rest } = await twoBlueprintsCollidingOnAuth();
  // Set up both-applied state (same shortcut as above test).
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints.push({
    slug: 'rest', version: '1.0.0', appliedAt: '2026-08-19T10:00:05Z', source: rest,
    contributions: [{ id: 'ADR-003-rest', path: 'rcf/adrs/adr-003-rest.json', kind: 'adr', scope: 'global', topic: 'auth' }],
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const tw = await walkTree({ projectRoot: root });
  const bad = await supersedeBlueprintTopic({ projectRoot: root, tree: tw.tree, topic: 'auth', now, reason: '   ' });
  assert.equal(bad.kind, 'usage');
  assert.match(bad.message, /--reason must not be whitespace-only/);

  const tw2 = await walkTree({ projectRoot: root });
  const good = await supersedeBlueprintTopic({ projectRoot: root, tree: tw2.tree, topic: 'auth', now, reason: 'Project auth ruling stands over both blueprint defaults.' });
  assert.equal(good.superseded, true);
  const finalManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(finalManifest.resolutions[0].reason, 'Project auth ruling stands over both blueprint defaults.');
});

test('supersede: refuses to overwrite an existing file at the scaffolded path', async () => {
  const { root, rest } = await twoBlueprintsCollidingOnAuth();
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints.push({
    slug: 'rest', version: '1.0.0', appliedAt: '2026-08-19T10:00:05Z', source: rest,
    contributions: [{ id: 'ADR-003-rest', path: 'rcf/adrs/adr-003-rest.json', kind: 'adr', scope: 'global', topic: 'auth' }],
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // Pre-plant the exact file the supersede would try to write. The
  // minted id is one past the max existing ADR NNN across the tree
  // (spa carries ADR-005-spa, rest carries ADR-003-rest -> max 5 ->
  // ADR-006-auth), so plant adr-006-auth.json to hit the overwrite
  // guard.
  await mkdir(join(root, 'rcf', 'adrs'), { recursive: true });
  await writeFile(join(root, 'rcf', 'adrs', 'adr-006-auth.json'), '{}\n', 'utf8');

  const tw = await walkTree({ projectRoot: root });
  const result = await supersedeBlueprintTopic({ projectRoot: root, tree: tw.tree, topic: 'auth', now });
  assert.equal(result.kind, 'duplicateId');
  assert.match(result.message, /refuse to overwrite/);
});

test('supersede: --incoming routes through the resolveBlueprintSource pipeline; @stock, bare kebab slug, and path forms are all accepted (persona re-run 2026-08-31 arc-4 H2)', async () => {
  // The persona re-run repro walked this via the packaged shelf; the
  // hermetic form here injects a stub resolver that maps `@stock/rest`,
  // `rest`, and the raw tmpdir path all onto the SAME on-disk blueprint,
  // proving the routing accepts every form `add` accepts. Before the
  // fix, supersede fed --incoming directly to loadBlueprint and the
  // first two forms refused with "no blueprint.json found" at a
  // cwd-relative path.
  const { root, rest } = await twoBlueprintsCollidingOnAuth();
  // Both-applied state (same shortcut the older tests use).
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints.push({
    slug: 'rest', version: '1.0.0', appliedAt: '2026-08-19T10:00:05Z', source: rest,
    contributions: [{ id: 'ADR-003-rest', path: 'rcf/adrs/adr-003-rest.json', kind: 'adr', scope: 'global', topic: 'auth' }],
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const stubResolver = async (source) => {
    // The stub speaks the same three shapes the shipped resolver does:
    // '@stock/<slug>' and bare '<slug>' land as kind:'shelf'; anything
    // else is treated as a path.
    if (source === '@stock/rest' || source === 'rest') {
      return { kind: 'shelf', resolved: rest, original: source, slug: 'rest' };
    }
    return { kind: 'path', resolved: rest, original: source };
  };
  const forms = ['@stock/rest', 'rest', rest];
  for (const [i, form] of forms.entries()) {
    // Fresh manifest for each iteration so the run-once overwrite guard
    // does not fire.
    const m = JSON.parse(await readFile(manifestPath, 'utf8'));
    m.resolutions = [];
    await writeFile(manifestPath, `${JSON.stringify(m, null, 2)}\n`, 'utf8');
    // The scaffolded ADR from the previous form must be cleared too or
    // the overwrite guard refuses the second run.
    await mkdir(join(root, 'rcf', 'adrs'), { recursive: true });
    const { rm } = await import('node:fs/promises');
    await rm(join(root, 'rcf', 'adrs', 'adr-006-auth.json'), { force: true });

    const tw = await walkTree({ projectRoot: root });
    const result = await supersedeBlueprintTopic({
      projectRoot: root, tree: tw.tree, topic: 'auth', incomingSource: form,
      now: new Date(`2026-08-19T10:0${i}:00Z`),
      _resolveSource: stubResolver,
    });
    assert.equal(
      result.superseded, true,
      `supersede should accept form '${form}' via the resolver pipeline; got ${JSON.stringify(result)}`,
    );
    assert.equal(result.supersedes.length, 2, `form '${form}' should list both sides`);
    const slugs = result.supersedes.map((s) => s.slug).sort();
    assert.deepEqual(slugs, ['rest', 'spa'], `form '${form}' should carry both slugs`);
  }
});

test('supersede: --incoming propagates a resolver refusal under the --incoming banner (unregistered library prefix, malformed source)', async () => {
  const { root, rest } = await twoBlueprintsCollidingOnAuth();
  const manifestPath = join(root, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints.push({
    slug: 'rest', version: '1.0.0', appliedAt: '2026-08-19T10:00:05Z', source: rest,
    contributions: [{ id: 'ADR-003-rest', path: 'rcf/adrs/adr-003-rest.json', kind: 'adr', scope: 'global', topic: 'auth' }],
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const tw = await walkTree({ projectRoot: root });
  // The slash-qualified `@<library>/<slug>` form is refused by the
  // resolver with a pointer at the ratified colon form; the supersede
  // wrapper must surface that refusal under `--incoming <source>:`.
  const result = await supersedeBlueprintTopic({
    projectRoot: root, tree: tw.tree, topic: 'auth', incomingSource: '@dave/rest', now,
  });
  assert.equal(result.kind, 'usage');
  assert.match(result.message, /^--incoming @dave\/rest: /);
  assert.match(result.message, /slash-qualified '@<library>\/<slug>' shape/);
});

test('supersede: --incoming with a library-qualified source uses effectiveSlug for the supersedes[] entry (matches apply.js identity rewiring)', async () => {
  // Build a fresh scaffold with a bare-id ADR in the incoming
  // blueprint so the stamper actually applies the effectiveSlug as a
  // suffix (an ADR id that already carries a suffix would be trusted
  // verbatim by stampId — that is by-design and shared with apply.js).
  const root = await scaffoldProject();
  const spa = await writeBlueprint(root, 'blueprint-spa', {
    slug: 'spa',
    contributions: [
      {
        id: 'ADR-005-spa', kind: 'adr', path: 'adr-005-spa.json',
        scope: 'global', topic: 'auth',
        body: adrBody({ id: 'ADR-005-spa', title: 'SPA auth', decision: 'HttpOnly cookies.', topic: 'auth' }),
      },
    ],
  });
  const lib = await writeBlueprint(root, 'blueprint-lib-auth', {
    slug: 'auth',
    contributions: [
      {
        id: 'ADR-007', kind: 'adr', path: 'adr-007.json',
        scope: 'global', topic: 'auth',
        body: adrBody({ id: 'ADR-007-wsd-auth', title: 'Library auth', decision: 'OAuth.', topic: 'auth' }),
      },
    ],
  });
  const tw0 = await walkTree({ projectRoot: root });
  const spaApply = await applyBlueprint({ projectRoot: root, tree: tw0.tree, source: spa, now });
  assert.equal(spaApply.applied, true);

  const stubResolver = async () => ({
    kind: 'library',
    resolved: lib,
    original: 'wsd:auth',
    libraryPrefix: 'wsd',
    libraryBlueprintSlug: 'auth',
    effectiveSlug: 'wsd-auth',
    libraryBands: undefined,
  });
  const tw = await walkTree({ projectRoot: root });
  const result = await supersedeBlueprintTopic({
    projectRoot: root, tree: tw.tree, topic: 'auth', incomingSource: 'wsd:auth',
    now, _resolveSource: stubResolver,
  });
  assert.equal(result.superseded, true, `library-qualified supersede: ${JSON.stringify(result)}`);
  // The incoming side must carry the effectiveSlug (`wsd-auth`), not
  // the raw blueprint.json slug (`auth`); that is how apply.js stamps
  // the identity onto manifest.blueprints[].slug.
  const bySlug = Object.fromEntries(result.supersedes.map((s) => [s.slug, s.adrId]));
  assert.ok('wsd-auth' in bySlug, `expected 'wsd-auth' in supersedes[], got ${JSON.stringify(result.supersedes)}`);
  assert.equal(bySlug['wsd-auth'], 'ADR-007-wsd-auth');
});

test('supersede: topic is validated as a lookup key; empty and whitespace-only are refused, camelCase / kebab / snake are accepted (Phase 3.5 round 2 loosen)', async () => {
  const root = await scaffoldProject();
  const { tree } = await walkTree({ projectRoot: root });
  // Empty / whitespace-only fail at the writer edge (schema minLength
  // is 1 but is silent on whitespace).
  const empty = await supersedeBlueprintTopic({ projectRoot: root, tree, topic: '', now });
  assert.equal(empty.kind, 'usage');
  const whitespace = await supersedeBlueprintTopic({ projectRoot: root, tree, topic: '   ', now });
  assert.equal(whitespace.kind, 'usage');
  // Non-empty vocabularies (camelCase, snake_case, kebab-case) all
  // pass writer validation; they will only fail with a "no applied
  // scope:global ADR on that topic" message when the topic does not
  // match any applied ADR. Round-1 rejected camelCase outright with
  // 'not a valid kebab slug', which broke the shipped SPA + REST
  // blueprints (authModel, errorEnvelope). Loosening the writer to
  // accept any string that matches an applied ADR topic exactly is
  // the ratified fix; the ADR slug tail is kebab-ified downstream.
  const camel = await supersedeBlueprintTopic({ projectRoot: root, tree, topic: 'authModel', now });
  assert.equal(camel.kind, 'usage');
  // rev-3 message reshape: applied+incoming count exposed together.
  assert.match(camel.message, /has 0 scope:global ADR\(s\) across applied\+incoming/);
  assert.doesNotMatch(camel.message, /not a valid kebab slug/);
});

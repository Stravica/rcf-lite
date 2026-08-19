// CLI-level regression matrix for w-2026-08-19-005: ownership checks
// consult the AUTHORITATIVE record (manifest
// appliedBlueprintRecord.contributions[] id list) for anything already
// applied. String grammar is only used at first-apply stamping, and
// there the blueprint's own declared contribution ids ARE the truth --
// slug+tail ids like `ADR-201-spa-theme` MUST apply cleanly under the
// blueprint that declares them, and cross-blueprint claims (spa vs
// spa-theme) MUST be caught by the manifest record, not by string
// parsing.
//
// This file drives the real bin end-to-end (`add` → `validate` →
// re-add idempotent → `remove` → `validate`) across the whole id
// grammar surface, so a future regression in either the grammar (as
// happened when exact-slug string matching landed and refused the
// slug+tail case) or the manifest-record check cannot ship green.
//
// Fixture matrix (one test each unless noted):
//   1. bare-ids: `REQ-001` + `ADR-005` stamp into `spa-REQ-001` +
//      `ADR-005-spa` and round-trip.
//   2. prefix-family: pre-stamped `spa-REQ-001` round-trips.
//   3. suffix-slug-only: pre-stamped `ADR-005-spa` round-trips.
//   4. suffix-slug+tail: `ADR-201-spa-routing` + `TAC-201-spa-app-shell`
//      round-trip (RED-ON-MAIN — this is the regression the fix
//      addresses).
//   5. ambiguous-pair-together: `spa` and `spa-theme` blueprints apply
//      side-by-side without either claiming the other's ids; each
//      removes cleanly leaving the other intact.
//   6. cross-claim-impossibility (two sub-cases): once `spa` is
//      applied with `ADR-201-spa-routing`, a hypothetical `spa-theme`
//      blueprint that declares the SAME id `ADR-201-spa-routing`
//      cannot claim it (cross-blueprint ownership conflict); and vice
//      versa when `spa-theme` is the incumbent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args) {
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
  const root = await mkdtemp(join(tmpdir(), 'rcf-bp-ownership-'));
  const init = await initProject({ projectRoot: root, projectName: 'BpOwnership' });
  assert.equal(init.kind, undefined, `initProject failed: ${JSON.stringify(init)}`);
  return root;
}

// Blueprint author helper. `contributions` carries { kind, id, path,
// body?, scope?, topic? }. The path is the RELATIVE path inside the
// blueprint's `contributions/` directory; the on-disk destination
// is derived by the CLI from kind + id.
async function writeBlueprint(root, name, spec) {
  const dir = join(root, `blueprint-${name}`);
  await mkdir(join(dir, 'contributions'), { recursive: true });
  const meta = {
    slug: spec.slug,
    version: spec.version,
    contributions: spec.contributions.map((c) => {
      const rec = { kind: c.kind, id: c.id, path: c.path };
      if (c.scope) rec.scope = c.scope;
      if (c.topic) rec.topic = c.topic;
      return rec;
    }),
  };
  await writeFile(join(dir, 'blueprint.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  for (const c of spec.contributions) {
    const abs = join(dir, 'contributions', c.path);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, JSON.stringify(c.body ?? {}, null, 2), 'utf8');
  }
  return dir;
}

function reqBody(reqId) {
  return {
    reqId, prdId: 'PRD-001',
    title: 'A requirement', description: 'A description', category: 'functional',
    priority: 'must', domain: 'ui', version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
}

function adrBody(adrId, { scope, topic } = {}) {
  const base = {
    adrId, prdId: 'PRD-001', tadId: 'TAD-001', title: 'An ADR',
    context: 'x', decision: 'y', consequences: 'z',
    version: '0.1.0', status: 'accepted',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  if (scope) base.scope = scope;
  if (topic) base.topic = topic;
  return base;
}

function tacBody(tacId) {
  return {
    tacId, prdId: 'PRD-001', tadId: 'TAD-001', name: 'A TAC', purpose: 'x',
    responsibilities: ['r1'],
    version: '0.1.0', status: 'draft',
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
}

// Verb loop: add → validate → re-add idempotent → remove → validate.
// Ownership assertions come off the manifest (authoritative record),
// not from parsing ids: for every contribution declared in the source,
// its id appears verbatim on the manifest entry after apply, and every
// destination file is gone after remove.
async function verbLoopClean(root, source, slug, expectedIds, expectedPaths) {
  const first = await runBin(root, ['blueprint', 'add', source]);
  assert.equal(first.code, 0, `first add stderr: ${first.stderr}\nstdout: ${first.stdout}`);
  assert.match(first.stdout, new RegExp(`applied '${slug}'`));

  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const entry = manifest.blueprints.find((b) => b.slug === slug);
  assert.ok(entry, `manifest missing blueprint entry for '${slug}'`);
  const recordedIds = (entry.contributions ?? []).map((c) => c.id).sort();
  assert.deepEqual(recordedIds, [...expectedIds].sort(),
    `manifest.blueprints[${slug}].contributions[].id mismatch`);

  for (const relPath of expectedPaths) {
    await stat(join(root, relPath));
  }

  const validateAfterAdd = await runBin(root, ['validate']);
  assert.equal(validateAfterAdd.code, 0,
    `validate after add exited ${validateAfterAdd.code}.\nstderr: ${validateAfterAdd.stderr}`);
  assert.doesNotMatch(validateAfterAdd.stderr, /Unrecognised document id/,
    `validate leaked an Unrecognised-id error: ${validateAfterAdd.stderr}`);

  const second = await runBin(root, ['blueprint', 'add', source]);
  assert.equal(second.code, 0, `re-add stderr: ${second.stderr}\nstdout: ${second.stdout}`);

  const remove = await runBin(root, ['blueprint', 'remove', slug]);
  assert.equal(remove.code, 0, `remove stderr: ${remove.stderr}\nstdout: ${remove.stdout}`);
  for (const relPath of expectedPaths) {
    await assert.rejects(stat(join(root, relPath)),
      `remove left ${relPath} in the tree`);
  }

  const validateAfterRemove = await runBin(root, ['validate']);
  assert.equal(validateAfterRemove.code, 0,
    `validate after remove exited ${validateAfterRemove.code}.\nstderr: ${validateAfterRemove.stderr}`);
}

// ---------------------------------------------------------------------------
// Fixture 1: bare-ids stamped by the blueprint mechanism.
// ---------------------------------------------------------------------------
test('ownership: bare `REQ-001` + `ADR-005` stamp into namespaced ids and round-trip', async () => {
  const root = await scaffold();
  const src = await writeBlueprint(root, 'bare', {
    slug: 'bare', version: '1.0.0',
    contributions: [
      { kind: 'req', id: 'REQ-001', path: 'req-001.json', body: reqBody('bare-REQ-001') },
      { kind: 'adr', id: 'ADR-005', path: 'adr-005.json', body: adrBody('ADR-005-bare') },
    ],
  });
  await verbLoopClean(root, src, 'bare',
    ['bare-REQ-001', 'ADR-005-bare'],
    ['rcf/requirements/bare-req-001.json', 'rcf/adrs/adr-005-bare.json']);
});

// ---------------------------------------------------------------------------
// Fixture 2: prefix-family ids pre-stamped by the blueprint author.
// ---------------------------------------------------------------------------
test('ownership: prefix-family pre-stamped `spa-REQ-001` + `spa-US-101` round-trip', async () => {
  const root = await scaffold();
  const usBody = {
    usId: 'spa-US-101', prdId: 'PRD-001', reqId: 'spa-REQ-001',
    version: '0.1.0', status: 'draft',
    title: 'US', asA: 'a', iWant: 'b', soThat: 'c',
    acceptanceCriteria: [{ id: 'AC-999-1', description: 'x', testable: true }],
    tacIds: [],
    createdAt: '2026-08-19T00:00:00Z', updatedAt: '2026-08-19T00:00:00Z',
  };
  const src = await writeBlueprint(root, 'spa-prefix', {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'req', id: 'spa-REQ-001', path: 'spa-req-001.json', body: reqBody('spa-REQ-001') },
      { kind: 'us',  id: 'spa-US-101', path: 'spa-us-101.json', body: usBody },
    ],
  });
  await verbLoopClean(root, src, 'spa',
    ['spa-REQ-001', 'spa-US-101'],
    ['rcf/requirements/spa-req-001.json', 'rcf/user-stories/spa-us-101.json']);
});

// ---------------------------------------------------------------------------
// Fixture 3: suffix-family ids pre-stamped with the slug ONLY (no tail).
// ---------------------------------------------------------------------------
test('ownership: suffix-family pre-stamped `ADR-005-spa` + `TAC-014-spa` round-trip', async () => {
  const root = await scaffold();
  const src = await writeBlueprint(root, 'spa-suffix', {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-005-spa', path: 'adr-005-spa.json', body: adrBody('ADR-005-spa') },
      { kind: 'tac', id: 'TAC-014-spa', path: 'tac-014-spa.json', body: tacBody('TAC-014-spa') },
    ],
  });
  await verbLoopClean(root, src, 'spa',
    ['ADR-005-spa', 'TAC-014-spa'],
    ['rcf/adrs/adr-005-spa.json', 'rcf/tacs/tac-014-spa.json']);
});

// ---------------------------------------------------------------------------
// Fixture 4: suffix-family ids with a semantic TAIL after the slug.
// This is the RED-ON-MAIN case: pre-fix, apply refused these with
//   stampId: id 'TAC-201-spa-app-shell' already carries suffix
//   namespace 'spa-app-shell'; cannot re-stamp as 'spa'
// because the string grammar treated the whole `spa-app-shell` tail
// as another blueprint's slug.
// ---------------------------------------------------------------------------
test('ownership: suffix-family slug+tail `ADR-201-spa-routing` + `TAC-201-spa-app-shell` round-trip (w-2026-08-19-005 RED-ON-MAIN)', async () => {
  const root = await scaffold();
  const src = await writeBlueprint(root, 'spa-with-tails', {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing',    path: 'adr-201-spa-routing.json',    body: adrBody('ADR-201-spa-routing') },
      { kind: 'tac', id: 'TAC-201-spa-app-shell',  path: 'tac-201-spa-app-shell.json',  body: tacBody('TAC-201-spa-app-shell') },
    ],
  });
  await verbLoopClean(root, src, 'spa',
    ['ADR-201-spa-routing', 'TAC-201-spa-app-shell'],
    ['rcf/adrs/adr-201-spa-routing.json', 'rcf/tacs/tac-201-spa-app-shell.json']);
});

// ---------------------------------------------------------------------------
// Fixture 5: TWO blueprints applied together with an AMBIGUOUS PAIR.
// Blueprint `spa` owns `ADR-201-spa-routing`; blueprint `spa-theme`
// owns `ADR-202-spa-theme`. String parsing sees `spa-theme` as the
// suffix of both (routing tail vs theme tail), which is exactly the
// class the fix retires -- ownership is asserted by manifest record,
// not by the parse.
// ---------------------------------------------------------------------------
test('ownership: `spa` and `spa-theme` apply side-by-side without cross-claim; each removes cleanly leaving the other intact', async () => {
  const root = await scaffold();
  const spaSrc = await writeBlueprint(root, 'spa', {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing',   path: 'adr-201-spa-routing.json',   body: adrBody('ADR-201-spa-routing') },
      { kind: 'tac', id: 'TAC-201-spa-app-shell', path: 'tac-201-spa-app-shell.json', body: tacBody('TAC-201-spa-app-shell') },
    ],
  });
  const themeSrc = await writeBlueprint(root, 'spa-theme', {
    slug: 'spa-theme', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-202-spa-theme',        path: 'adr-202-spa-theme.json',       body: adrBody('ADR-202-spa-theme') },
      { kind: 'tac', id: 'TAC-202-spa-theme-tokens', path: 'tac-202-spa-theme-tokens.json', body: tacBody('TAC-202-spa-theme-tokens') },
    ],
  });

  // Apply spa first, then spa-theme. The spa-theme apply MUST NOT be
  // seen as re-stamping any of spa's contributions, and vice versa.
  const applySpa = await runBin(root, ['blueprint', 'add', spaSrc]);
  assert.equal(applySpa.code, 0, `apply spa: ${applySpa.stderr}\n${applySpa.stdout}`);
  const applyTheme = await runBin(root, ['blueprint', 'add', themeSrc]);
  assert.equal(applyTheme.code, 0, `apply spa-theme: ${applyTheme.stderr}\n${applyTheme.stdout}`);

  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  const spaEntry = manifest.blueprints.find((b) => b.slug === 'spa');
  const themeEntry = manifest.blueprints.find((b) => b.slug === 'spa-theme');
  assert.ok(spaEntry && themeEntry, 'both blueprint entries must be recorded');

  const spaIds = new Set(spaEntry.contributions.map((c) => c.id));
  const themeIds = new Set(themeEntry.contributions.map((c) => c.id));
  // Ownership disjoint: no id appears in both manifest records.
  const overlap = [...spaIds].filter((id) => themeIds.has(id));
  assert.deepEqual(overlap, [], `spa vs spa-theme ownership must be disjoint: ${overlap.join(', ')}`);
  // Each set contains its own contributions, verbatim.
  assert.ok(spaIds.has('ADR-201-spa-routing') && spaIds.has('TAC-201-spa-app-shell'));
  assert.ok(themeIds.has('ADR-202-spa-theme') && themeIds.has('TAC-202-spa-theme-tokens'));

  // Files land where the manifest says they do.
  for (const relPath of [
    'rcf/adrs/adr-201-spa-routing.json',
    'rcf/tacs/tac-201-spa-app-shell.json',
    'rcf/adrs/adr-202-spa-theme.json',
    'rcf/tacs/tac-202-spa-theme-tokens.json',
  ]) {
    await stat(join(root, relPath));
  }

  // Remove `spa` -- ONLY spa's files disappear; spa-theme stays intact.
  const removeSpa = await runBin(root, ['blueprint', 'remove', 'spa']);
  assert.equal(removeSpa.code, 0, `remove spa: ${removeSpa.stderr}\n${removeSpa.stdout}`);
  await assert.rejects(stat(join(root, 'rcf/adrs/adr-201-spa-routing.json')));
  await assert.rejects(stat(join(root, 'rcf/tacs/tac-201-spa-app-shell.json')));
  await stat(join(root, 'rcf/adrs/adr-202-spa-theme.json'));       // spa-theme untouched
  await stat(join(root, 'rcf/tacs/tac-202-spa-theme-tokens.json'));

  const manifestAfter = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifestAfter.blueprints.length, 1);
  assert.equal(manifestAfter.blueprints[0].slug, 'spa-theme');

  // Remove `spa-theme` -- its files disappear, manifest is clean.
  const removeTheme = await runBin(root, ['blueprint', 'remove', 'spa-theme']);
  assert.equal(removeTheme.code, 0, `remove spa-theme: ${removeTheme.stderr}\n${removeTheme.stdout}`);
  await assert.rejects(stat(join(root, 'rcf/adrs/adr-202-spa-theme.json')));
  await assert.rejects(stat(join(root, 'rcf/tacs/tac-202-spa-theme-tokens.json')));
  const manifestFinal = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifestFinal.blueprints, undefined, 'manifest.blueprints should be gone once empty');
});

// ---------------------------------------------------------------------------
// Fixture 6: cross-claim impossibility. Two blueprints attempting to
// declare the SAME id are refused at conflict-detection time --
// enforced by the manifest record, not by string parsing.
// ---------------------------------------------------------------------------
test('ownership: cross-claim of `ADR-201-spa-routing` — a hypothetical `spa-theme` cannot re-declare an id `spa` already owns', async () => {
  const root = await scaffold();
  const spaSrc = await writeBlueprint(root, 'spa', {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing', path: 'adr-201-spa-routing.json', body: adrBody('ADR-201-spa-routing') },
    ],
  });
  const claimantSrc = await writeBlueprint(root, 'spa-theme-claimant', {
    // A misauthored spa-theme that declares an id already stamped
    // for spa. The manifest record for spa says spa owns
    // ADR-201-spa-routing; the incoming spa-theme's claim MUST be
    // refused via the crossBlueprintOwnership conflict, regardless
    // of how the string parses.
    slug: 'spa-theme', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-201-spa-routing', path: 'adr-201-spa-routing.json', body: adrBody('ADR-201-spa-routing') },
    ],
  });

  const applySpa = await runBin(root, ['blueprint', 'add', spaSrc]);
  assert.equal(applySpa.code, 0, `apply spa: ${applySpa.stderr}\n${applySpa.stdout}`);

  const applyClaimant = await runBin(root, ['blueprint', 'add', claimantSrc]);
  assert.notEqual(applyClaimant.code, 0, 'cross-claim MUST NOT be allowed to apply');
  const combined = `${applyClaimant.stderr}\n${applyClaimant.stdout}`;
  assert.match(combined, /ADR-201-spa-routing/, `error output should name the conflicting id.\n${combined}`);
  assert.match(combined, /blueprint spa/, `error output should name the owning blueprint.\n${combined}`);

  // Manifest is unchanged: only spa remains.
  const manifest = JSON.parse(await readFile(join(root, 'rcf', 'manifest.json'), 'utf8'));
  assert.equal(manifest.blueprints.length, 1);
  assert.equal(manifest.blueprints[0].slug, 'spa');
});

test('ownership: cross-claim symmetric case — `spa` cannot re-declare an id `spa-theme` already owns', async () => {
  const root = await scaffold();
  const themeSrc = await writeBlueprint(root, 'spa-theme', {
    slug: 'spa-theme', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-202-spa-theme', path: 'adr-202-spa-theme.json', body: adrBody('ADR-202-spa-theme') },
    ],
  });
  const spaSrc = await writeBlueprint(root, 'spa-claimant', {
    slug: 'spa', version: '1.0.0',
    contributions: [
      { kind: 'adr', id: 'ADR-202-spa-theme', path: 'adr-202-spa-theme.json', body: adrBody('ADR-202-spa-theme') },
    ],
  });

  const applyTheme = await runBin(root, ['blueprint', 'add', themeSrc]);
  assert.equal(applyTheme.code, 0);
  const applySpa = await runBin(root, ['blueprint', 'add', spaSrc]);
  assert.notEqual(applySpa.code, 0, 'symmetric cross-claim MUST NOT be allowed');
  const combined = `${applySpa.stderr}\n${applySpa.stdout}`;
  assert.match(combined, /ADR-202-spa-theme/);
  assert.match(combined, /blueprint spa-theme/);
});

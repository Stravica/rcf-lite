// FBS-182 slice 3 CLI tests for the destination surface end-to-end.
//
// Binds AC-15801-1 (library.json:issues snapshotted onto the registry
// entry as issuesRepo/issuesVisibility; review-on-add prints
// "Feedback destination: OWNER/REPO (public|private)"), AC-15801-3
// (rcf doctor --check feedback-destinations warns on a library with
// no resolvable destination and exit stays 0), and part of AC-15802-1
// (rcf feedback preview on a shelf blueprint entry prints
// "Stravica/rcf-lite (public)" as the destination line).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolvePath(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args, extraEnv = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: 'test-session', ...extraEnv },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

// Interactive variant: pipes `input` to the child's stdin so the
// review-on-add prompt can be answered. Mirrors the helper in
// test/blueprint/cli-library.test.js.
function runBinInteractive(cwd, args, input, extraEnv = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd, env: { ...process.env, CI: '1', RCF_FEEDBACK_SESSION_ID: 'test-session', ...extraEnv },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolvePromise({ code: code ?? 0, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

const reqBody = (id) => ({
  reqId: id, prdId: 'PRD-001', title: 'x', description: 'y',
  category: 'functional', priority: 'must', domain: 'ui',
  version: '0.1.0', status: 'draft',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
});

async function scaffoldFeedbackProject(name) {
  const root = await mkdtemp(join(tmpdir(), `rcf-fb-dest-${name}-`));
  await initProject({ projectRoot: root, projectName: name });
  await writeFile(join(root, '.gitignore'), '.rcf/feedback/\n', 'utf8');
  return root;
}

async function scaffoldLibrary({ prefix, blueprintSlug, bands, contributions, issues, publisher }) {
  const root = await mkdtemp(join(tmpdir(), `rcf-lib-${prefix}-`));
  const bpDir = join(root, 'blueprints', blueprintSlug);
  await mkdir(join(bpDir, 'contributions'), { recursive: true });
  await writeFile(
    join(bpDir, 'blueprint.json'),
    JSON.stringify({ slug: blueprintSlug, version: '1.0.0', contributions }, null, 2),
    'utf8',
  );
  for (const c of contributions) {
    await writeFile(join(bpDir, 'contributions', c.path), JSON.stringify(reqBody(c.id), null, 2), 'utf8');
  }
  const manifest = {
    libraryVersion: 1,
    libraryPrefix: prefix,
    displayName: `${prefix.toUpperCase()} library`,
    publisher: publisher ?? { id: prefix, displayName: `${prefix} publisher` },
    libraryRef: '1.0.0',
    bands,
    blueprints: [{ slug: blueprintSlug, path: `blueprints/${blueprintSlug}` }],
    ...(issues ? { issues } : {}),
  };
  await writeFile(join(root, 'library.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return root;
}

test('AC-15801-1: library.json issues is snapshotted onto the registry entry and the review card prints the Feedback destination line', async () => {
  const project = await scaffoldFeedbackProject('S3Snap');
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'std-error-envelope',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    issues: { repo: 'wsd-team-dev/rcf-lite-blueprints', visibility: 'private' },
    publisher: { id: 'wsd', displayName: 'WSD', contact: 'engineering@wsd.example' },
  });
  // The review-on-add card must render even in the two-flag scripted
  // path so we assert on stdout regardless of interactive prompting.
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  // The scripted path skips the review card entirely (spec §9.7). We
  // therefore drive a second add in review mode against a scratch
  // project so the "Proceed with add?" prompt renders; answering 'n'
  // aborts cleanly with exit 0 and leaves the printed review card on
  // stdout for the assertion.
  const project2 = await scaffoldFeedbackProject('S3SnapReview');
  const reviewRun = await runBinInteractive(
    project2,
    ['define', 'blueprint', 'library', 'add', lib],
    'n\n',
  );
  assert.match(reviewRun.stdout, /Feedback destination: wsd-team-dev\/rcf-lite-blueprints \(private\)/);

  const registryRaw = await readFile(join(project, 'rcf', 'blueprint-libraries.json'), 'utf8');
  const registry = JSON.parse(registryRaw);
  const entry = registry.libraries.find((l) => l.libraryPrefix === 'wsd');
  assert.ok(entry, 'wsd entry present');
  assert.equal(entry.issuesRepo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(entry.issuesVisibility, 'private');
});

test('AC-15801-1: a library without an issues field does not print the Feedback destination line and the registry entry omits the fields', async () => {
  const project = await scaffoldFeedbackProject('S3NoIssues');
  const lib = await scaffoldLibrary({
    prefix: 'acme',
    blueprintSlug: 'foo',
    bands: { ac: { start: 60000, end: 60999 } },
    contributions: [{ kind: 'req', id: 'REQ-60001', path: 'req.json' }],
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  assert.doesNotMatch(add.stdout, /Feedback destination:/);

  const registry = JSON.parse(await readFile(join(project, 'rcf', 'blueprint-libraries.json'), 'utf8'));
  const entry = registry.libraries.find((l) => l.libraryPrefix === 'acme');
  assert.equal(entry.issuesRepo, undefined);
  assert.equal(entry.issuesVisibility, undefined);
});

test('AC-15801-3: rcf doctor --check feedback-destinations warns on a library without a resolvable destination and exits 0', async () => {
  const project = await scaffoldFeedbackProject('S3Doctor');
  const withIssues = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'std-error-envelope',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    issues: { repo: 'wsd-team-dev/rcf-lite-blueprints', visibility: 'private' },
    publisher: { id: 'wsd', displayName: 'WSD', contact: 'engineering@wsd.example' },
  });
  const noIssues = await scaffoldLibrary({
    prefix: 'acme',
    blueprintSlug: 'foo',
    bands: { ac: { start: 60000, end: 60999 } },
    contributions: [{ kind: 'req', id: 'REQ-60001', path: 'req.json' }],
    publisher: { id: 'acme', displayName: 'ACME', contact: 'ops@acme.example' },
  });
  const add1 = await runBin(project, ['define', 'blueprint', 'library', 'add', withIssues, '--no-review', '--i-have-reviewed']);
  assert.equal(add1.code, 0, `add1 stderr: ${add1.stderr}`);
  const add2 = await runBin(project, ['define', 'blueprint', 'library', 'add', noIssues, '--no-review', '--i-have-reviewed']);
  assert.equal(add2.code, 0, `add2 stderr: ${add2.stderr}`);

  const doctor = await runBin(project, ['doctor', '--check', 'feedback-destinations', '--json']);
  assert.equal(doctor.code, 0, `doctor stderr: ${doctor.stderr}`);
  const payload = JSON.parse(doctor.stdout);
  const rows = payload.drift.filter((d) => d.check === 'feedback-destinations');
  assert.equal(rows.length, 1, 'exactly one warn row (the acme library)');
  const acme = rows[0];
  assert.equal(acme.item, 'unresolved-library');
  assert.match(acme.message, /library 'acme' has no resolvable feedback destination/);
  assert.match(acme.message, /ops@acme\.example/, 'publisher contact carried into the message');
  assert.equal(acme.refusedByFix, true, 'warn-only: --fix cannot repair');
});

test("AC-15802-1: rcf feedback preview prints Stravica/rcf-lite (public) as the destination for a --kind core entry, and no library manifest content overrides it", async () => {
  const project = await scaffoldFeedbackProject('S3Preview');
  // Register a library that (perversely) has a good issuesRepo. It
  // must NOT be picked up for --kind core.
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'std-error-envelope',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    issues: { repo: 'wsd-team-dev/rcf-lite-blueprints', visibility: 'private' },
    publisher: { id: 'wsd', displayName: 'WSD' },
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);

  const addFb = await runBin(project, [
    'feedback', 'add',
    '--kind', 'core',
    '--target', 'define validate',
    '--anchor', 'AC-1-1',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', 'A finding',
    '--body', 'The body.',
    '--evidence', 'rcf define validate',
  ]);
  assert.equal(addFb.code, 0, `add feedback stderr: ${addFb.stderr}`);

  const preview = await runBin(project, ['feedback', 'preview', '--json']);
  assert.equal(preview.code, 0, `preview stderr: ${preview.stderr}`);
  const previews = JSON.parse(preview.stdout);
  assert.equal(previews.length, 1);
  assert.equal(previews[0].destination.repo, 'Stravica/rcf-lite');
  assert.equal(previews[0].destination.visibility, 'public');
  assert.equal(previews[0].destination.kind, 'core');
});

test('F-slice-3-02: library refresh re-snapshots issuesRepo and issuesVisibility on the registry entry', async () => {
  const project = await scaffoldFeedbackProject('S3RefreshIssues');
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'std-error-envelope',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    // Add without an issues field so the registered entry starts
    // without issuesRepo/issuesVisibility - the pre-feature shape
    // consumers who registered before 0.28.0 would carry.
    publisher: { id: 'wsd', displayName: 'WSD', contact: 'engineering@wsd.example' },
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  const preRegistry = JSON.parse(await readFile(join(project, 'rcf', 'blueprint-libraries.json'), 'utf8'));
  const preEntry = preRegistry.libraries.find((l) => l.libraryPrefix === 'wsd');
  assert.equal(preEntry.issuesRepo, undefined, 'pre-refresh entry lacks issuesRepo');
  assert.equal(preEntry.issuesVisibility, undefined, 'pre-refresh entry lacks issuesVisibility');

  // Library owner later adds an issues field to library.json - the
  // exact scenario design 3.3 L161 names for `library refresh` to
  // pick up.
  const libraryManifest = JSON.parse(await readFile(join(lib, 'library.json'), 'utf8'));
  libraryManifest.issues = { repo: 'wsd-team-dev/rcf-lite-blueprints', visibility: 'private' };
  await writeFile(join(lib, 'library.json'), JSON.stringify(libraryManifest, null, 2), 'utf8');

  const refresh = await runBin(project, ['define', 'blueprint', 'library', 'refresh', 'wsd']);
  assert.equal(refresh.code, 0, `refresh stderr: ${refresh.stderr}`);
  assert.match(refresh.stdout, /feedback destination re-snapshotted/);

  const postRegistry = JSON.parse(await readFile(join(project, 'rcf', 'blueprint-libraries.json'), 'utf8'));
  const postEntry = postRegistry.libraries.find((l) => l.libraryPrefix === 'wsd');
  assert.equal(postEntry.issuesRepo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(postEntry.issuesVisibility, 'private');
});

test('F-slice-3-03: preview text output shows derived-source disclosure and the unresolved-library bundle message', async () => {
  const project = await scaffoldFeedbackProject('S3PrevDerived');
  const lib = await scaffoldLibrary({
    prefix: 'derived',
    blueprintSlug: 'std-thing',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    // No issues field; sourceRef derived from a github URL below.
    publisher: { id: 'derived', displayName: 'Derived' },
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);
  // Rewrite the registry entry's sourceRef in place to a github URL
  // so destination.resolve derives the repo.
  const regPath = join(project, 'rcf', 'blueprint-libraries.json');
  const reg = JSON.parse(await readFile(regPath, 'utf8'));
  const entry = reg.libraries.find((l) => l.libraryPrefix === 'derived');
  entry.sourceRef = 'git+https://github.com/derived-team/derived-repo.git#v1';
  await writeFile(regPath, JSON.stringify(reg, null, 2), 'utf8');

  // Apply the derived blueprint onto the manifest so preview finds
  // a matching manifest record.
  const manifestPath = join(project, 'rcf', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.blueprints = manifest.blueprints ?? [];
  manifest.blueprints.push({ slug: 'derived-std-thing', libraryPrefix: 'derived' });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const addFb = await runBin(project, [
    'feedback', 'add',
    '--kind', 'blueprint',
    '--target', 'derived:std-thing',
    '--anchor', 'AC-1-1',
    '--class', 'docs-mismatch',
    '--severity', 'minor',
    '--title', 'A finding',
    '--body', 'The body.',
    '--evidence', 'rcf define validate',
  ]);
  assert.equal(addFb.code, 0, `add feedback stderr: ${addFb.stderr}`);

  const preview = await runBin(project, ['feedback', 'preview']);
  assert.equal(preview.code, 0, `preview stderr: ${preview.stderr}`);
  assert.match(preview.stdout, /derived-team\/derived-repo/);
  assert.match(preview.stdout, /derived from the library's git source/);
});

test('F-slice-3-04: status text lists every unresolved library, not only the count (design 3.3 L163)', async () => {
  const project = await scaffoldFeedbackProject('S3StatusList');
  const noIssues = await scaffoldLibrary({
    prefix: 'acme',
    blueprintSlug: 'foo',
    bands: { ac: { start: 60000, end: 60999 } },
    contributions: [{ kind: 'req', id: 'REQ-60001', path: 'req.json' }],
    publisher: { id: 'acme', displayName: 'ACME', contact: 'ops@acme.example' },
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', noIssues, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, `add stderr: ${add.stderr}`);

  const status = await runBin(project, ['feedback', 'status']);
  assert.equal(status.code, 0, `status stderr: ${status.stderr}`);
  assert.match(status.stdout, /- acme:/, 'names the unresolved library, not just a count');
  assert.match(status.stdout, /ops@acme\.example/, 'shows the publisher contact');
});

// -- Issue #244 (0.28.3): status --json / text parity for destination `source` field ---

test('Issue #244: rcf feedback status --json exposes destinations.table[].source (parity with the preview surface)', async () => {
  const project = await scaffoldFeedbackProject('Issue244Status');
  const lib = await scaffoldLibrary({
    prefix: 'wsd',
    blueprintSlug: 'std-error-envelope',
    bands: { ac: { start: 50000, end: 59999 } },
    contributions: [{ kind: 'req', id: 'REQ-50101', path: 'req.json' }],
    issues: { repo: 'wsd-team-dev/rcf-lite-blueprints', visibility: 'private' },
    publisher: { id: 'wsd', displayName: 'WSD', contact: 'engineering@wsd.example' },
  });
  const add = await runBin(project, ['define', 'blueprint', 'library', 'add', lib, '--no-review', '--i-have-reviewed']);
  assert.equal(add.code, 0, add.stderr);
  const bp = await runBin(project, ['define', 'blueprint', 'add', 'wsd:std-error-envelope']);
  assert.equal(bp.code, 0, bp.stderr);

  const statusJson = await runBin(project, ['feedback', 'status', '--json']);
  assert.equal(statusJson.code, 0, statusJson.stderr);
  const obj = JSON.parse(statusJson.stdout);
  const rows = obj?.destinations?.table ?? [];
  const row = rows.find((r) => r.ref === 'wsd:std-error-envelope' || r.ref === 'wsd:wsd-std-error-envelope');
  assert.ok(row, `destination row for applied blueprint present; rows=${JSON.stringify(rows)}`);
  assert.equal(row.source, 'library-manifest', 'source field is present and names the resolver path');
  assert.equal(row.repo, 'wsd-team-dev/rcf-lite-blueprints');
  assert.equal(row.visibility, 'private');

  // Text surface should now print the source line too (parity per AC-15502-2).
  const statusText = await runBin(project, ['feedback', 'status']);
  assert.equal(statusText.code, 0, statusText.stderr);
  assert.match(statusText.stdout, /source: library-manifest/);
});

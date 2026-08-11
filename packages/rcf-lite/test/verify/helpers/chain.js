// Test helper: scaffold a small, schema-valid RCF chain fixture in a tmp dir
// and populate US-101 with acceptance criteria that exercise verify's readers
// and the provisioning route derivation (an auth journey + a payment journey +
// a plain journey). Uses core's write path — legitimate in TESTS; verify's own
// src never imports the write path (§7.2 boundary).

import { initProject } from '#core/store';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @param {object} [opts]
 * @param {object[]} [opts.acceptanceCriteria] - override the default ACs
 * @param {object[]} [opts.fbsItems] - optional FBS docs to seed the chain; each is written verbatim under `rcf/fbs/`
 * @param {object} [opts.manifestPatch] - shallow-merged into the initialised manifest (for `uiBaseline`, `browserVerification[]`, etc.)
 * @returns {Promise<{ root: string }>}
 */
export async function scaffoldChain(opts = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rcf-verify-chain-'));
  await initProject({ projectRoot: root, projectName: 'VerifyFixture' });

  const acceptanceCriteria = opts.acceptanceCriteria ?? [
    {
      id: 'AC-101-1',
      description: 'A user can sign in with valid credentials',
      given: 'a registered account exists',
      when: 'the user submits the sign-in form with valid credentials',
      then: 'the user reaches their authenticated dashboard',
      testable: true,
    },
    {
      id: 'AC-101-2',
      description: 'Checkout with a valid payment card succeeds',
      given: 'a signed-in user with items in the cart',
      when: 'the user completes checkout using the payment sandbox',
      then: 'the order is confirmed and a receipt is shown',
      testable: true,
    },
    {
      id: 'AC-101-3',
      description: 'The landing page renders a headline',
      given: 'the app is reachable',
      when: 'a visitor loads the landing page',
      then: 'a headline is visible above the fold',
      testable: true,
    },
  ];

  const usPath = join(root, 'rcf', 'user-stories', 'us-101.json');
  const us = JSON.parse(await readFile(usPath, 'utf8'));
  us.acceptanceCriteria = acceptanceCriteria;
  us.title = 'Core purchase journey';
  await writeFile(usPath, `${JSON.stringify(us, null, 2)}\n`, 'utf8');

  // Optional 0.7.0 additions: FBS docs (Track A `dependsOnServices[]`,
  // Track B `uiBearing`) and manifest patches (`uiBaseline`,
  // `browserVerification[]`). Written verbatim; scaffolders own the shape.
  const fbsItems = Array.isArray(opts.fbsItems) ? opts.fbsItems : [];
  for (const fbs of fbsItems) {
    const fbsPath = join(root, 'rcf', 'fbs', `${(fbs.fbsId ?? 'FBS-000').toLowerCase()}.json`);
    await writeFile(fbsPath, `${JSON.stringify(fbs, null, 2)}\n`, 'utf8');
  }

  if (opts.manifestPatch && typeof opts.manifestPatch === 'object') {
    const manifestPath = join(root, 'rcf', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const merged = { ...manifest, ...opts.manifestPatch };
    await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  }

  return { root };
}

/** A findings-returning stub launcher for engine tests (no real agent). */
export function stubLauncher(findings = []) {
  return async () => ({ findings });
}

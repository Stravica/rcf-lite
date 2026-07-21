// Test helper: scaffold a small, schema-valid RCF chain fixture in a tmp dir
// and populate US-101 with acceptance criteria that exercise verify's readers
// and the provisioning route derivation (an auth journey + a payment journey +
// a plain journey). Uses core's write path — legitimate in TESTS; verify's own
// src never imports the write path (§7.2 boundary).

import { initProject } from '@stravica-ai/rcf-lite-core/store';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @param {object} [opts]
 * @param {object[]} [opts.acceptanceCriteria] - override the default ACs
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

  return { root };
}

/** A findings-returning stub launcher for engine tests (no real agent). */
export function stubLauncher(findings = []) {
  return async () => ({ findings });
}

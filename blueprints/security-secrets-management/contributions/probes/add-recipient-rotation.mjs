// Add-recipient rotation probe. Encrypts a scratch scope with age
// recipient A; adds age recipient B via sops --rotate --add-age;
// asserts the ciphertext's sops.age[] list now includes both
// recipients; asserts recipient B can decrypt the file with only
// its own age key. Proves the shipped rotation verb both extends
// the recipient list and re-wraps the data key against the new
// recipient.
//
// capability: secretsProvider.
// anchorAcId: security-secrets-management-AC-8102-1.
// accountBound: false.

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createScratchAgeScope, DECLARED_ENV } from './probe-utils.mjs';
import { runSops, readSopsMetadata } from '../../../../packages/rcf-lite/test/fixtures/security-secrets-management/src/sops-cli.mjs';

export const anchorAcId = 'security-secrets-management-AC-8102-1';
export const capability = 'secretsProvider';
export const accountBound = false;

export default async function runProbe() {
  const scopeA = await createScratchAgeScope({ prefix: 'qa-e-secrets-a-' });
  const scopeB = await createScratchAgeScope({ prefix: 'qa-e-secrets-b-' });
  const evidence = { envDeclared: [...DECLARED_ENV], recipientA: scopeA.recipient, recipientB: scopeB.recipient };
  const results = [];
  try {
    const cipherPath = join(scopeA.dir, 'scope.enc.json');
    const plaintext = JSON.stringify({ v: 'rotation-probe' }, null, 2) + '\n';
    await writeFile(join(scopeA.dir, 'scope.json'), plaintext, 'utf8');

    // Encrypt against recipient A.
    const enc = runSops(
      ['--age', scopeA.recipient, '--encrypt', '--output', cipherPath, join(scopeA.dir, 'scope.json')],
      { env: { ...process.env, SOPS_AGE_KEY_FILE: scopeA.keyPath } },
    );
    if (enc.status !== 0) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `initial encrypt failed status=${enc.status} stderr=${enc.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const before = readSopsMetadata(await readFile(cipherPath, 'utf8'));
    evidence.metaBefore = before;

    // Rotate: add recipient B in-place. sops --rotate --in-place --add-age <B>
    const rot = runSops(
      ['--rotate', '--in-place', '--add-age', scopeB.recipient, cipherPath],
      { env: { ...process.env, SOPS_AGE_KEY_FILE: scopeA.keyPath } },
    );
    if (rot.status !== 0) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `sops rotate failed status=${rot.status} stderr=${rot.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const after = readSopsMetadata(await readFile(cipherPath, 'utf8'));
    evidence.metaAfter = after;

    // Assertion 1: recipient list grew and now contains B.
    const bothRecipients = after.recipients.includes(scopeA.recipient) && after.recipients.includes(scopeB.recipient);
    results.push({
      anchorAcId,
      capability,
      verdict: bothRecipients ? 'pass' : 'fail',
      detail: `recipients after rotation: ${JSON.stringify(after.recipients)}; bothPresent=${bothRecipients}`,
      evidence: { before: before.recipients, after: after.recipients },
    });

    // Assertion 2: mac changed (data key re-wrapped => the payload's MAC is regenerated).
    results.push({
      anchorAcId: 'security-secrets-management-AC-8102-2',
      capability,
      verdict: after.mac !== before.mac ? 'pass' : 'fail',
      detail: `mac before=${before.mac && before.mac.slice(0, 16)}... after=${after.mac && after.mac.slice(0, 16)}... diverged=${after.mac !== before.mac}`,
      evidence: { macDiverged: after.mac !== before.mac },
    });

    // Assertion 3: recipient B can decrypt with only its key.
    const decB = runSops(['--decrypt', cipherPath], { env: { ...process.env, SOPS_AGE_KEY_FILE: scopeB.keyPath } });
    results.push({
      anchorAcId: 'security-secrets-management-AC-8102-3',
      capability,
      verdict: decB.status === 0 && JSON.stringify(JSON.parse(decB.stdout)) === JSON.stringify(JSON.parse(plaintext)) ? 'pass' : 'fail',
      detail: `recipient B decrypt status=${decB.status} matchesPlaintext=${JSON.stringify(JSON.parse(decB.stdout)) === JSON.stringify(JSON.parse(plaintext))}`,
      evidence: { statusB: decB.status, stdoutLen: decB.stdout.length },
    });
  } finally {
    await scopeA.cleanup();
    await scopeB.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}

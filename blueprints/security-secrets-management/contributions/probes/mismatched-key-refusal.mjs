// Mismatched-key refusal probe. Encrypts a scratch scope with age
// recipient A; attempts to decrypt with age recipient B's key
// only; asserts sops refuses (non-zero exit, no plaintext on
// stdout). Proves the shipped adapter fails closed on a wrong
// key rather than degrading to unencrypted.
//
// capability: secretsProvider.
// anchorAcId: security-secrets-management-AC-8104-1.
// accountBound: false.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratchAgeScope, DECLARED_ENV } from './probe-utils.mjs';
import { runSops } from '../../../../packages/rcf-lite/test/fixtures/security-secrets-management/src/sops-cli.mjs';

export const anchorAcId = 'security-secrets-management-AC-8104-1';
export const capability = 'secretsProvider';
export const accountBound = false;

export default async function runProbe() {
  const scopeA = await createScratchAgeScope({ prefix: 'qa-e-secrets-mm-a-' });
  const scopeB = await createScratchAgeScope({ prefix: 'qa-e-secrets-mm-b-' });
  const evidence = { envDeclared: [...DECLARED_ENV], recipientA: scopeA.recipient, recipientB: scopeB.recipient };
  const results = [];
  try {
    const cipherPath = join(scopeA.dir, 'scope.enc.json');
    const plaintext = JSON.stringify({ v: 'mismatch-probe' }, null, 2) + '\n';
    await writeFile(join(scopeA.dir, 'scope.json'), plaintext, 'utf8');
    runSops(['--age', scopeA.recipient, '--encrypt', '--output', cipherPath, join(scopeA.dir, 'scope.json')],
      { env: { ...process.env, SOPS_AGE_KEY_FILE: scopeA.keyPath } });
    // Attempt decrypt with B only.
    const badDec = runSops(['--decrypt', cipherPath], { env: { ...process.env, SOPS_AGE_KEY_FILE: scopeB.keyPath } });
    evidence.badStatus = badDec.status;
    evidence.badStderrExcerpt = (badDec.stderr || '').slice(0, 200);
    const refused = badDec.status !== 0 && !badDec.stdout.includes('mismatch-probe');
    results.push({
      anchorAcId,
      capability,
      verdict: refused ? 'pass' : 'fail',
      detail: `mismatched-key decrypt refused: exitStatus=${badDec.status} stdoutContainsPlain=${badDec.stdout.includes('mismatch-probe')} stderrExcerpt=${(badDec.stderr || '').slice(0, 200)}`,
      evidence: { exitStatus: badDec.status, refused },
    });
    // Sanity: A can still decrypt.
    const goodDec = runSops(['--decrypt', cipherPath], { env: { ...process.env, SOPS_AGE_KEY_FILE: scopeA.keyPath } });
    results.push({
      anchorAcId: 'security-secrets-management-AC-8104-2',
      capability,
      verdict: goodDec.status === 0 && JSON.stringify(JSON.parse(goodDec.stdout)) === JSON.stringify(JSON.parse(plaintext)) ? 'pass' : 'fail',
      detail: `correct-key decrypt sanity: status=${goodDec.status} matched=${JSON.stringify(JSON.parse(goodDec.stdout)) === JSON.stringify(JSON.parse(plaintext))}`,
      evidence: { status: goodDec.status },
    });
  } finally {
    await scopeA.cleanup();
    await scopeB.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}

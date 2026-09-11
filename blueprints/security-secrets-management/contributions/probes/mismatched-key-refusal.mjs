// Mismatched-key refusal probe. Encrypts a scratch scope with age
// recipient A; attempts to decrypt with age recipient B's key
// only; asserts sops refuses (non-zero exit, no plaintext on
// stdout). Proves the shipped adapter fails closed on a wrong
// key rather than degrading to unencrypted.
//
// capability: secretsProvider.
// Anchor honesty. No AC or REQ observes the SOPS-native
// mismatched-key refusal property. Row reads AMBER on criterion e
// (unanchored vendor-conformance evidence for ADR-902's default
// vendor sops+age).
// accountBound: false.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratchAgeScope, DECLARED_ENV } from './probe-utils.mjs';
import { runSops } from '../../../../packages/rcf-lite/test/fixtures/security-secrets-management/src/sops-cli.mjs';


// Rule (closure section 1 / addendum rule 10): probes pass an
// explicit minimal env to sops children, never a spread of the
// entire ambient process.env. Only SOPS_AGE_KEY_FILE, PATH and
// HOME are forwarded; the fixture README's env-var table is the
// declared surface.
function sopsEnv(keyPath) {
  return {
    SOPS_AGE_KEY_FILE: keyPath,
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
  };
}
const CONFORMANCE_LIM = "security-secrets-management-REQ-002: SOPS-native encrypt/decrypt/rotation/mismatched-key operations do not observe the vendor-agnostic manager-client boundary REQ-002 states; the manager-client probe is the follow-up that would anchor REQ-002 (auth integration harness follow-up).";
export const anchorAcId = null; // No AC/REQ observes SOPS-native mismatched-key refusal.
export const capability = 'secretsProvider';
export const accountBound = false;

export default async function runProbe() {
  const scopeA = await createScratchAgeScope({ prefix: 'pxe-secrets-mm-a-' });
  const scopeB = await createScratchAgeScope({ prefix: 'pxe-secrets-mm-b-' });
  const evidence = { envDeclared: [...DECLARED_ENV], recipientA: scopeA.recipient, recipientB: scopeB.recipient };
  const results = [];
  try {
    const cipherPath = join(scopeA.dir, 'scope.enc.json');
    const plaintext = JSON.stringify({ v: 'mismatch-probe' }, null, 2) + '\n';
    await writeFile(join(scopeA.dir, 'scope.json'), plaintext, 'utf8');
    runSops(['--age', scopeA.recipient, '--encrypt', '--output', cipherPath, join(scopeA.dir, 'scope.json')],
      { env: sopsEnv(scopeA.keyPath) });
    // Attempt decrypt with B only.
    const badDec = runSops(['--decrypt', cipherPath], { env: sopsEnv(scopeB.keyPath) });
    evidence.badStatus = badDec.status;
    evidence.badStderrExcerpt = (badDec.stderr || '').slice(0, 200);
    const refused = badDec.status !== 0 && !badDec.stdout.includes('mismatch-probe');
    results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
      anchorAcId,
      capability,
      verdict: refused ? 'pass' : 'fail',
      detail: `SOPS-native mismatched-key refusal observation (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). mismatched-key decrypt refused: exitStatus=${badDec.status} stdoutContainsPlain=${badDec.stdout.includes('mismatch-probe')} stderrExcerpt=${(badDec.stderr || '').slice(0, 200)}`,
      evidence: { exitStatus: badDec.status, refused },
    });
    // Sanity: A can still decrypt.
    const goodDec = runSops(['--decrypt', cipherPath], { env: sopsEnv(scopeA.keyPath) });
    results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
      anchorAcId: null,
      capability,
      verdict: goodDec.status === 0 && JSON.stringify(JSON.parse(goodDec.stdout)) === JSON.stringify(JSON.parse(plaintext)) ? 'pass' : 'fail',
      detail: `SOPS-native correct-key sanity (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). correct-key decrypt sanity: status=${goodDec.status} matched=${JSON.stringify(JSON.parse(goodDec.stdout)) === JSON.stringify(JSON.parse(plaintext))}`,
      evidence: { status: goodDec.status },
    });
  } finally {
    await scopeA.cleanup();
    await scopeB.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}

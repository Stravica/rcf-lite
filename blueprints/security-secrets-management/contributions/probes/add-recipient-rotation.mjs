// Add-recipient rotation probe. Encrypts a scratch scope with age
// recipient A; adds age recipient B via sops --rotate --add-age;
// asserts the ciphertext's sops.age[] list now includes both
// recipients; asserts recipient B can decrypt the file with only
// its own age key. Proves the shipped rotation verb both extends
// the recipient list and re-wraps the data key against the new
// recipient.
//
// capability: secretsProvider.
// Anchor honesty. No AC or REQ observes the SOPS-native
// --rotate --add-age property. Row reads AMBER on criterion e
// (unanchored vendor-conformance evidence for ADR-902's default
// vendor sops+age).
// accountBound: false.

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createScratchAgeScope, DECLARED_ENV } from './probe-utils.mjs';
import { runSops, readSopsMetadata } from '../../../../packages/rcf-lite/test/fixtures/security-secrets-management/src/sops-cli.mjs';


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
export const anchorAcId = null; // No AC/REQ observes SOPS-native rotation.
export const capability = 'secretsProvider';
export const accountBound = false;

export default async function runProbe() {
  const scopeA = await createScratchAgeScope({ prefix: 'pxe-secrets-a-' });
  const scopeB = await createScratchAgeScope({ prefix: 'pxe-secrets-b-' });
  const evidence = { envDeclared: [...DECLARED_ENV], recipientA: scopeA.recipient, recipientB: scopeB.recipient };
  const results = [];
  try {
    const cipherPath = join(scopeA.dir, 'scope.enc.json');
    const plaintext = JSON.stringify({ v: 'rotation-probe' }, null, 2) + '\n';
    await writeFile(join(scopeA.dir, 'scope.json'), plaintext, 'utf8');

    // Encrypt against recipient A.
    const enc = runSops(
      ['--age', scopeA.recipient, '--encrypt', '--output', cipherPath, join(scopeA.dir, 'scope.json')],
      { env: sopsEnv(scopeA.keyPath) },
    );
    if (enc.status !== 0) {
      results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM, anchorAcId, capability, verdict: 'fail', detail: `SOPS-native initial encrypt failed (no AC/REQ anchor) status=${enc.status} stderr=${enc.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const before = readSopsMetadata(await readFile(cipherPath, 'utf8'));
    evidence.metaBefore = before;

    // Rotate: add recipient B in-place. sops --rotate --in-place --add-age <B>
    const rot = runSops(
      ['--rotate', '--in-place', '--add-age', scopeB.recipient, cipherPath],
      { env: sopsEnv(scopeA.keyPath) },
    );
    if (rot.status !== 0) {
      results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM, anchorAcId, capability, verdict: 'fail', detail: `SOPS-native --rotate failed (no AC/REQ anchor) status=${rot.status} stderr=${rot.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const after = readSopsMetadata(await readFile(cipherPath, 'utf8'));
    evidence.metaAfter = after;

    // Assertion 1: recipient list grew and now contains B.
    const bothRecipients = after.recipients.includes(scopeA.recipient) && after.recipients.includes(scopeB.recipient);
    results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
      anchorAcId,
      capability,
      verdict: bothRecipients ? 'pass' : 'fail',
      detail: `SOPS-native --rotate --add-age observation (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). recipients after rotation: ${JSON.stringify(after.recipients)}; bothPresent=${bothRecipients}`,
      evidence: { before: before.recipients, after: after.recipients },
    });

    // Assertion 2: mac changed (data key re-wrapped => the payload's MAC is regenerated).
    results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
      anchorAcId: null,
      capability,
      verdict: after.mac !== before.mac ? 'pass' : 'fail',
      detail: `SOPS-native MAC divergence observation (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). mac before=${before.mac && before.mac.slice(0, 16)}... after=${after.mac && after.mac.slice(0, 16)}... diverged=${after.mac !== before.mac}`,
      evidence: { macDiverged: after.mac !== before.mac },
    });

    // Assertion 3: recipient B can decrypt with only its key.
    const decB = runSops(['--decrypt', cipherPath], { env: sopsEnv(scopeB.keyPath) });
    results.push({ conformanceOnly: true, limitation: CONFORMANCE_LIM,
      anchorAcId: null,
      capability,
      verdict: decB.status === 0 && JSON.stringify(JSON.parse(decB.stdout)) === JSON.stringify(JSON.parse(plaintext)) ? 'pass' : 'fail',
      detail: `SOPS-native new-recipient decrypt observation (vendor-conformance for ADR-902 sops+age; no AC/REQ anchor; row AMBER). recipient B decrypt status=${decB.status} matchesPlaintext=${JSON.stringify(JSON.parse(decB.stdout)) === JSON.stringify(JSON.parse(plaintext))}`,
      evidence: { statusB: decB.status, stdoutLen: decB.stdout.length },
    });
  } finally {
    await scopeA.cleanup();
    await scopeB.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}

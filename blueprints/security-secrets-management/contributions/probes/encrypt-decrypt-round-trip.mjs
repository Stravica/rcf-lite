// Encrypt / decrypt round-trip probe for security-secrets-management.
// Generates a throwaway age keypair in the operator's scratchpad,
// encrypts a scratch scope file with sops, records the sops.mac +
// sops.lastmodified metadata, decrypts it back to the original
// bytes, and asserts the decrypted content matches. Positive
// evidence per rule 7d shape 2: the sops metadata excerpt (mac,
// lastmodified, recipient list) captured from the ciphertext.
//
// capability: secretsProvider.
// anchorAcId: security-secrets-management-AC-8101-1.
// accountBound: false (real sops+age engine on this machine).

import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createScratchAgeScope, DECLARED_ENV } from './probe-utils.mjs';
import { runSops, readSopsMetadata } from '../../../../packages/rcf-lite/test/fixtures/security-secrets-management/src/sops-cli.mjs';

export const anchorAcId = 'security-secrets-management-AC-8101-1';
export const capability = 'secretsProvider';
export const accountBound = false;

export default async function runProbe() {
  const scope = await createScratchAgeScope();
  const evidence = { envDeclared: [...DECLARED_ENV], scopeDir: scope.dir, recipient: scope.recipient };
  const results = [];
  try {
    const plainPath = join(scope.dir, 'scope.json');
    const cipherPath = join(scope.dir, 'scope.enc.json');
    const plaintext = JSON.stringify({ helloKey: 'hello world - qa-e-secrets probe', count: 42 }, null, 2) + '\n';
    await writeFile(plainPath, plaintext, 'utf8');

    // Encrypt with sops using the throwaway age recipient.
    const encRes = runSops(
      ['--age', scope.recipient, '--encrypt', '--output', cipherPath, plainPath],
      { env: { ...process.env, SOPS_AGE_KEY_FILE: scope.keyPath } },
    );
    if (encRes.status !== 0) {
      results.push({ anchorAcId, capability, verdict: 'fail', detail: `sops encrypt failed status=${encRes.status} stderr=${encRes.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const cipherText = await readFile(cipherPath, 'utf8');
    const cipherMeta = readSopsMetadata(cipherText);
    evidence.cipherMeta = cipherMeta;
    // Positive evidence: sops.mac is a distinctive engine-produced
    // string (rule 7d shape 2 response-body excerpt).
    results.push({
      anchorAcId,
      capability,
      verdict: cipherMeta.mac && cipherMeta.lastmodified && cipherMeta.recipients.includes(scope.recipient) ? 'pass' : 'fail',
      detail: `sops encrypt produced ciphertext; mac=${cipherMeta.mac && cipherMeta.mac.slice(0, 24)}... lastmodified=${cipherMeta.lastmodified} recipients=${JSON.stringify(cipherMeta.recipients)}`,
      evidence: { sopsMetadata: cipherMeta },
    });

    // Decrypt.
    const decRes = runSops(['--decrypt', cipherPath], { env: { ...process.env, SOPS_AGE_KEY_FILE: scope.keyPath } });
    if (decRes.status !== 0) {
      results.push({ anchorAcId: 'security-secrets-management-AC-8101-2', capability, verdict: 'fail', detail: `sops decrypt failed status=${decRes.status} stderr=${decRes.stderr.slice(0, 200)}` });
      return { results, extra: evidence };
    }
    const decrypted = decRes.stdout;
    results.push({
      anchorAcId: 'security-secrets-management-AC-8101-2',
      capability,
      verdict: JSON.stringify(JSON.parse(decrypted)) === JSON.stringify(JSON.parse(plaintext)) ? 'pass' : 'fail',
      detail: `sops decrypt round-trip: decryptedLength=${decrypted.length} matchesOriginal=${JSON.stringify(JSON.parse(decrypted)) === JSON.stringify(JSON.parse(plaintext))}`,
      evidence: { decryptedLength: decrypted.length, plaintextLength: plaintext.length, roundTripMatched: JSON.stringify(JSON.parse(decrypted)) === JSON.stringify(JSON.parse(plaintext)) },
    });
  } finally {
    await scope.cleanup();
    evidence.cleanedUp = true;
  }
  return { results, extra: evidence };
}

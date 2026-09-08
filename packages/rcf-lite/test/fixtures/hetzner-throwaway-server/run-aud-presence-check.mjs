// Fixture-side delegate for the edge-cloudflare-tunnel aud-presence-check probe (round-7 T-3).
//
// Mutation switches (fixture-side ONLY):
// - SIMULATE_AUD_DROP: rewrite the compose-service/access-gated manifest
//   ingress to remove the originRequest.access block. The probe reads
//   the mutated manifest and refuses with a defensive-against-silent-
//   degradation finding.

import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANONICAL = resolve(HERE, 'cloudflared');
const BLUEPRINT_SHIM = resolve(HERE, '..', '..', '..', '..', '..', 'blueprints/edge-cloudflare-tunnel/contributions/probes/run-aud-presence-check.mjs');

const mutations = {
  audDrop: process.env.SIMULATE_AUD_DROP === 'true',
};
const anyMutation = Object.values(mutations).some(Boolean);

async function applyMutations(scratch) {
  if (mutations.audDrop) {
    const target = resolve(scratch, 'compose-service/cloudflare/tunnels/access-gated.yaml');
    let text = await readFile(target, 'utf8');
    // Remove the four originRequest / access / aud / teamName / required lines
    // beneath the first non-catchall ingress entry. The block sits under
    // the compose-service access-gated manifest as:
    //     originRequest:
    //       access:
    //         aud: AUD-fixture-rcf-lite-ci-throwaway
    //         teamName: rcf-lite-ci
    //         required: true
    text = text.replace(/\n    originRequest:\n      access:\n        aud: [^\n]+\n        teamName: [^\n]+\n        required: [^\n]+/, '');
    await writeFile(target, text, 'utf8');
  }
}

async function main() {
  if (anyMutation) {
    const scratch = await mkdtemp(resolve(tmpdir(), 'rcf-lite-t3-apc-'));
    await cp(CANONICAL, scratch, { recursive: true });
    await applyMutations(scratch);
    process.env.RCF_LITE_T3_FIXTURE_ROOT = scratch;
    process.stderr.write(`[fixture] mutations active: ${Object.entries(mutations).filter(([, v]) => v).map(([k]) => k).join(', ')}\n`);
    process.stderr.write(`[fixture] scratch RCF_LITE_T3_FIXTURE_ROOT=${scratch}\n`);
  }
  await import(pathToFileURL(BLUEPRINT_SHIM).href);
}
await main();

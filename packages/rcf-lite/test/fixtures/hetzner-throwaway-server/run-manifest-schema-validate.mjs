// Fixture-side reviewer boot for the manifest-schema-validate probe
// (v1.0.1 mutation-purified per H-1). Runs from the fixture directory:
//   cd packages/rcf-lite/test/fixtures/hetzner-throwaway-server && \
//     node ./run-manifest-schema-validate.mjs
//
// Mutation switches (fixture-side ONLY; the probe module never reads
// SIMULATE_ env vars per the H-1 mutation-purity gate row):
// - SIMULATE_MANIFEST_INVALID=true: copy every hetzner/servers/*.json
//   file into a scratch dir, rewrite each manifest's location field to
//   a non-enum token (mars1), point RCF_FIXTURE_MANIFEST_DIR at the
//   scratch dir. The probe then reads its manifests from that dir and
//   FAILS naming the offending field per
//   hetzner-round-7-spec-2026-09-07.md section 3.4 lesson 4.
//
// When no switch is set the shim simply delegates to the blueprint's
// runner unchanged.

import { cp, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANONICAL = resolve(HERE, 'hetzner/servers');
const BLUEPRINT_SHIM = resolve(
  HERE, '..', '..', '..', '..', '..',
  'blueprints/deploy-hetzner-server/contributions/probes/run-manifest-schema-validate.mjs',
);

const mutations = {
  manifestInvalid: process.env.SIMULATE_MANIFEST_INVALID === 'true',
};
const anyMutation = Object.values(mutations).some(Boolean);

async function applyMutations(scratch) {
  const entries = (await readdir(scratch)).filter((f) => f.endsWith('.json'));
  for (const name of entries) {
    const p = join(scratch, name);
    const doc = JSON.parse(await readFile(p, 'utf8'));
    if (mutations.manifestInvalid) doc.location = 'mars1';
    await writeFile(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }
}

async function main() {
  if (anyMutation) {
    const scratch = await mkdtemp(resolve(tmpdir(), 'rcf-lite-t1-msv-'));
    await cp(CANONICAL, scratch, { recursive: true });
    await applyMutations(scratch);
    process.env.RCF_FIXTURE_MANIFEST_DIR = scratch;
    process.stderr.write(`[fixture] mutations active: ${Object.entries(mutations).filter(([, v]) => v).map(([k]) => k).join(', ')}\n`);
    process.stderr.write(`[fixture] scratch RCF_FIXTURE_MANIFEST_DIR=${scratch}\n`);
  }
  await import(pathToFileURL(BLUEPRINT_SHIM).href);
}
await main();

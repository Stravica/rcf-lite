// Probe: cloud-init render lint.
//
// anchorAcId: AC-37104-1. accountBound: false.
//
// Renders the shipped cloud-init template against the fixture manifest at
// packages/rcf-lite/test/fixtures/hetzner-throwaway-server/hetzner/servers/ci-throwaway.json
// via the fixture's src/cloud-init-renderer.mjs. Asserts the six hardening
// baseline blocks appear in the rendered YAML.
//
// Purity: the probe reads only the shipped template and the fixture
// manifest; no process.env.SIMULATE_ switch is read here. The
// fixture-side renderer at src/cloud-init-renderer.mjs is the sole
// reader of SIMULATE_HARDENING_DRIFT and it mutates INPUT (the
// rendered YAML) only; the probe then FAILS naming the missing
// baseline block per hetzner-round-7-spec-2026-09-07.md section 3.4
// lesson 4. H-1 (2026-09-08).

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FIXTURE_DIR } from './probe-utils.mjs';

export const anchorAcId = 'AC-37104-1';
export const accountBound = false;

export default async function runProbe() {
  const rendererPath = resolve(FIXTURE_DIR, 'src/cloud-init-renderer.mjs');
  const manifestPath = resolve(FIXTURE_DIR, 'hetzner/servers/ci-throwaway.json');
  const { renderCloudInit, BASELINE_BLOCKS } = await import(rendererPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  // In-process render only; pass explicit stub public-key material so
  // the renderer never shells to hcloud (mock path stays hermetic).
  const rendered = await renderCloudInit(manifest, {
    publicKeys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePubKeyForRenderLintHardeningH1 rcf-lite-ci-mock'],
  });
  const missing = [];
  const present = [];
  for (const block of BASELINE_BLOCKS) {
    const ok = block.markers.every((m) => rendered.includes(m));
    if (ok) {
      present.push(block.id);
    } else {
      const missingMarkers = block.markers.filter((m) => !rendered.includes(m));
      missing.push({ id: block.id, label: block.label, missingMarkers });
    }
  }
  const results = [];
  if (missing.length > 0) {
    for (const m of missing) {
      results.push({
        anchorAcId,
        verdict: 'fail',
        detail: `cloud-init hardening baseline block "${m.label}" is missing from the rendered YAML (missing markers: ${m.missingMarkers.join(', ')}).`,
      });
    }
  } else {
    results.push({
      anchorAcId,
      verdict: 'pass',
      detail: `all ${BASELINE_BLOCKS.length} baseline blocks present in the rendered YAML: ${present.join(', ')}.`,
    });
  }
  return {
    results,
    extra: {
      manifestName: manifest.name,
      renderedByteLength: rendered.length,
      presentBlocks: present,
      missingBlocks: missing.map((m) => m.id),
    },
  };
}

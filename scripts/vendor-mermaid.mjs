#!/usr/bin/env node
// Vendor mermaid.min.js into src/view/vendored/.
//
// PINNED VERSION: 11.6.0 (matches the mermaid devDependency in package.json).
// Bumping mermaid is a deliberate, two-step change:
//   1) bump the devDependency in package.json
//   2) re-run this script (pnpm run vendor) and commit the new mermaid.min.js
// The committed bundle and the devDependency MUST agree on version; CI
// enforces this by re-running vendor and asserting no diff.

import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const source = resolve(repoRoot, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const destDir = resolve(repoRoot, 'src', 'view', 'vendored');
const dest = resolve(destDir, 'mermaid.min.js');

async function readMermaidVersion() {
  const pkgPath = resolve(repoRoot, 'node_modules', 'mermaid', 'package.json');
  try {
    const raw = await readFile(pkgPath, 'utf8');
    return JSON.parse(raw).version;
  } catch {
    return 'unknown';
  }
}

async function main() {
  try {
    await stat(source);
  } catch {
    console.error(`[vendor-mermaid] source not found: ${source}`);
    console.error('[vendor-mermaid] run `pnpm install` first.');
    process.exit(2);
  }
  await mkdir(destDir, { recursive: true });
  await copyFile(source, dest);
  const version = await readMermaidVersion();
  console.log(`[vendor-mermaid] copied mermaid@${version} -> ${dest}`);
}

main().catch((err) => {
  console.error(`[vendor-mermaid] failed: ${err.message}`);
  process.exit(1);
});

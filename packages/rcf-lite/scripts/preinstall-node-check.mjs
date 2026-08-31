#!/usr/bin/env node
// Preinstall hard-fail on Node < 24.
//
// The `engines` block in package.json only asks npm to complain; recent
// npm defaults print a warning and install anyway, so a session on
// Node 22 has historically resolved the last publish that ADVERTISED
// support for it (`rcf-lite@0.0.1`, a placeholder stub) without ever
// touching the current release train. That silent downgrade is the
// worst-possible first touch for a new operator, so we fail loudly
// here BEFORE any files land on disk.
//
// Bypass for maintainers who genuinely need to override: set
// `RCF_LITE_SKIP_NODE_CHECK=1`. Do not set it in ordinary use.
//
// Source-monorepo exemption: the same script also runs when someone
// installs this repo itself as a pnpm workspace (workspace members get
// their preinstall invoked on `pnpm install`). Blocking the source dev
// flow is not the point of this gate; the point is to stop
// `npm install rcf-lite` on the wrong Node from silently landing a
// broken tree. If we can detect we're being run from the pnpm workspace
// root (an ancestor `pnpm-workspace.yaml` exists), we skip - the
// engines WARN still fires, so contributors are not unaware.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_MAJOR = 24;

if (process.env.RCF_LITE_SKIP_NODE_CHECK === '1') {
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
// packages/rcf-lite/scripts -> packages/rcf-lite -> packages -> repo-root
const candidateRepoRoot = resolve(here, '..', '..', '..');
if (existsSync(resolve(candidateRepoRoot, 'pnpm-workspace.yaml'))) {
  // Running inside the source monorepo. The engines pin still complains,
  // but we do not want to break `pnpm install` for a dev on the wrong
  // Node while they are trying to bump their own environment. The gate
  // is aimed at consumers of the published tarball, not at us.
  process.exit(0);
}

const raw = process.versions.node;
const match = /^(\d+)\./.exec(raw ?? '');
const major = match ? Number(match[1]) : Number.NaN;

if (!Number.isFinite(major) || major < REQUIRED_MAJOR) {
  const lines = [
    '',
    '  rcf-lite requires Node.js >= 24.',
    `  Detected Node.js ${raw}.`,
    '',
    '  Install a supported Node (see https://nodejs.org) and re-run.',
    '  Bypass (not recommended): RCF_LITE_SKIP_NODE_CHECK=1 npm install rcf-lite',
    '',
  ];
  process.stderr.write(lines.join('\n'));
  process.exit(1);
}

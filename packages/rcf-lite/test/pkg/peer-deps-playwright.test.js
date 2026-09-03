// AC-1103-1 (spec 2026-09-03): @playwright/mcp and playwright are declared
// as optional peer dependencies of rcf-lite. npm and pnpm do not fail install
// when the peers are absent; browser-facing doctor checks are what surface
// the absence to the operator.
//
// Guards package.json so a later edit that drops one of the peers, or flips
// the optional bit, trips the suite before we ship.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('AC-1103-1: @playwright/mcp and playwright are declared as optional peer dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  const peers = pkg.peerDependencies ?? {};
  const meta = pkg.peerDependenciesMeta ?? {};

  assert.ok(
    typeof peers['@playwright/mcp'] === 'string' && peers['@playwright/mcp'].length > 0,
    'peerDependencies["@playwright/mcp"] must be declared with a range',
  );
  assert.ok(
    typeof peers.playwright === 'string' && peers.playwright.length > 0,
    'peerDependencies.playwright must be declared with a range',
  );
  assert.equal(
    meta['@playwright/mcp']?.optional,
    true,
    'peerDependenciesMeta["@playwright/mcp"].optional must be true so npm/pnpm do not fail install when absent',
  );
  assert.equal(
    meta.playwright?.optional,
    true,
    'peerDependenciesMeta.playwright.optional must be true so npm/pnpm do not fail install when absent',
  );
});

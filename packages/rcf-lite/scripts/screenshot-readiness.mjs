#!/usr/bin/env node
// One-shot screenshot of the Readiness tab for PR C
// (w-2026-10-01-dave-003). Launches the viewer server on a free port,
// waits for the tab, snaps a full-page PNG and stops the server.
// Uses playwright-core resolved via an absolute path when it is not a
// local devDependency.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');

const PORT = Number.parseInt(process.env.PORT ?? '4411', 10);
const OUT = process.env.SCREENSHOT_OUT
  ?? '/private/tmp/claude-501/-Users-thefoot-stravica-pa-agents-dave/4b958c5c-82d8-4e1f-b95f-e29bb7792a5f/scratchpad/s2c-readiness-tab.png';

async function loadChromium() {
  const req = createRequire(import.meta.url);
  const candidates = [
    'playwright',
    'playwright-core',
    '/Users/thefoot/WebstormProjects/Stravica/stravica.ai/node_modules/playwright-core',
  ];
  for (const name of candidates) {
    try {
      const mod = req(name);
      if (mod?.chromium) return mod.chromium;
    } catch (_) { /* keep trying */ }
  }
  throw new Error('could not resolve a Playwright chromium runtime');
}

async function main() {
  const binPath = resolve(projectRoot, 'bin/rcf.js');
  const server = spawn('node', [binPath, 'audit', 'view', '--port', String(PORT), '--no-open'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env },
  });

  let listeningUrl = null;
  const ready = new Promise((resolveReady, rejectReady) => {
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      const m = chunk.match(/listening at (\S+)/);
      if (m) {
        listeningUrl = m[1];
        resolveReady();
      }
    });
    server.on('exit', (code) => rejectReady(new Error(`server exited early with ${code}`)));
    setTimeout(() => rejectReady(new Error('server never printed listening line')), 30000);
  });

  await ready;
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 2000 } });
    const page = await context.newPage();
    await page.goto(listeningUrl, { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('button[role="tab"][data-tab="readiness"][aria-selected="true"]', { timeout: 10000 });
    await page.waitForSelector('#tab-readiness:not([hidden])', { timeout: 10000 });
    await sleep(500);
    await page.screenshot({ path: OUT, fullPage: true });
    console.log(`screenshot written to ${OUT}`);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    await sleep(500);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

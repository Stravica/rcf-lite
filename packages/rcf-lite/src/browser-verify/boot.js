// Boot fallback for probe packs (visual-round-spec-2026-09-04 §3.5).
//
// The normal path is a dev server already running at `runtimeUrl`. When
// a pack declares `boot: { bootCommand, waitForUrl, waitForSelector }`
// AND the runtime is not answering, this module spawns `bootCommand`
// from the project root, waits (bounded) for `waitForUrl` then
// `waitForSelector`, hands the running server off to the pack pass,
// and stops the process it started when the pass completes.
//
// Never used as a per-blueprint harness: this only fires when the URL
// is genuinely unreachable, per Baz's ruling that the running dev
// server is the normal case (2026-09-04).

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export const DEFAULT_URL_TIMEOUT_MS = 60000;
export const DEFAULT_SELECTOR_TIMEOUT_MS = 10000;
export const DEFAULT_REACHABLE_PROBE_TIMEOUT_MS = 3000;
const POLL_INTERVAL_MS = 500;

/**
 * @param {string} url
 * @param {(url: string, init?: object) => Promise<any>} fetchFn
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
export async function isReachable(url, fetchFn, timeoutMs = DEFAULT_REACHABLE_PROBE_TIMEOUT_MS) {
  if (typeof url !== 'string' || url.length === 0) return false;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res) return false;
    // Any HTTP response counts as "server up"; even a 404 tells us a
    // process is listening. Only a network failure means unreachable.
    return typeof res.status === 'number' && res.status > 0;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Choose the first boot config across loaded packs (any is fine; the
 * spec pins one boot per pack pass because runtimeUrl is single).
 *
 * @param {Array<import('./pack-loader.js').LoadedPack>} packs
 * @returns {object|null}
 */
export function pickBootFromPacks(packs) {
  if (!Array.isArray(packs)) return null;
  for (const pack of packs) {
    if (pack?.boot && typeof pack.boot === 'object') return pack.boot;
  }
  return null;
}

/**
 * If the runtime does not answer AND `boot` is declared, bring it up.
 *
 * @param {object} args
 * @param {object|null} args.boot
 * @param {string} args.runtimeUrl
 * @param {string} args.projectRoot
 * @param {(url: string, init?: object) => Promise<any>} args.fetch
 * @param {object|null} [args.browser]                probe-pack browser (for waitForSelector via snapshot)
 * @param {(line: string) => void} [args.logger]
 * @param {() => number} [args.now]                   injectable clock (unit tests)
 * @param {{ urlMs?: number, selectorMs?: number, reachableProbeMs?: number }} [args.timeouts]
 * @param {(command: string, opts: object) => import('node:child_process').ChildProcess} [args.spawnFn]  injectable spawner (unit tests)
 * @returns {Promise<{ started: boolean, source: 'already-up'|'no-boot'|'no-boot-command'|'boot-command'|'no-runtime-url', stop: () => Promise<void>, notes: string[] }>}
 */
export async function bootIfNeeded({
  boot,
  runtimeUrl,
  projectRoot,
  fetch: fetchFn,
  browser = null,
  logger = () => {},
  now = () => Date.now(),
  timeouts = {},
  spawnFn = spawn,
}) {
  const notes = [];
  const urlTimeout = timeouts.urlMs ?? DEFAULT_URL_TIMEOUT_MS;
  const selectorTimeout = timeouts.selectorMs ?? DEFAULT_SELECTOR_TIMEOUT_MS;
  const reachableTimeout = timeouts.reachableProbeMs ?? DEFAULT_REACHABLE_PROBE_TIMEOUT_MS;

  if (!boot || typeof boot !== 'object') {
    return { started: false, source: 'no-boot', stop: async () => {}, notes };
  }
  const probeUrl = typeof boot.waitForUrl === 'string' && boot.waitForUrl.length > 0
    ? boot.waitForUrl
    : runtimeUrl;
  if (typeof probeUrl !== 'string' || probeUrl.length === 0) {
    return { started: false, source: 'no-runtime-url', stop: async () => {}, notes };
  }

  if (await isReachable(probeUrl, fetchFn, reachableTimeout)) {
    notes.push(`runtime ${probeUrl} already reachable; boot skipped`);
    return { started: false, source: 'already-up', stop: async () => {}, notes };
  }
  if (typeof boot.bootCommand !== 'string' || boot.bootCommand.length === 0) {
    notes.push(`runtime ${probeUrl} unreachable but pack declares no bootCommand`);
    return { started: false, source: 'no-boot-command', stop: async () => {}, notes };
  }

  logger(`[boot] runtime ${probeUrl} unreachable; spawning: ${boot.bootCommand}`);
  const [cmd, ...args] = boot.bootCommand.split(/\s+/).filter(Boolean);
  const child = spawnFn(cmd, args, {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    detached: false,
  });
  child.stdout?.on('data', (b) => logger(`[boot:stdout] ${b.toString('utf8').trimEnd()}`));
  child.stderr?.on('data', (b) => logger(`[boot:stderr] ${b.toString('utf8').trimEnd()}`));

  const start = now();
  let up = false;
  while (now() - start < urlTimeout) {
    if (await isReachable(probeUrl, fetchFn, reachableTimeout)) { up = true; break; }
    await sleep(POLL_INTERVAL_MS);
  }
  if (!up) {
    await stopChild(child);
    throw new Error(`boot: waitForUrl ${probeUrl} did not respond within ${urlTimeout}ms (bootCommand: ${boot.bootCommand})`);
  }
  notes.push(`bootCommand up at ${probeUrl} after ${now() - start}ms`);

  if (typeof boot.waitForSelector === 'string' && boot.waitForSelector.length > 0 && browser) {
    try {
      await browser.goto(probeUrl);
      const s0 = now();
      let selectorSeen = false;
      while (now() - s0 < selectorTimeout) {
        const snap = await browser.snapshot();
        if (matchesSnapshot(snap, boot.waitForSelector)) { selectorSeen = true; break; }
        await sleep(POLL_INTERVAL_MS);
      }
      if (!selectorSeen) notes.push(`waitForSelector '${boot.waitForSelector}' not observed within ${selectorTimeout}ms; proceeding anyway`);
      else notes.push(`waitForSelector '${boot.waitForSelector}' observed`);
    } catch (err) {
      notes.push(`waitForSelector probe failed: ${err.message}`);
    }
  }

  return {
    started: true,
    source: 'boot-command',
    stop: async () => { await stopChild(child); },
    notes,
  };
}

async function stopChild(child) {
  try { child.kill('SIGTERM'); } catch { /* fine */ }
  await new Promise((resolve) => {
    if (typeof child.exitCode === 'number' && child.exitCode !== null) return resolve();
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* fine */ } resolve(); }, 3000);
    child.once?.('exit', () => { clearTimeout(timer); resolve(); });
  });
}

/**
 * Best-effort match of a "selector-shaped" hint against a snapshot text.
 * We accept: raw substring, an aria role hint (e.g. `role="grid"` -> "grid"),
 * or a text-content hint. Exposed for unit tests.
 */
export function matchesSnapshot(snapshot, selectorOrRef) {
  if (typeof snapshot !== 'string' || typeof selectorOrRef !== 'string') return false;
  if (snapshot.includes(selectorOrRef)) return true;
  const roleMatch = selectorOrRef.match(/\[role\s*=\s*['"]?([\w-]+)['"]?\]/);
  if (roleMatch && snapshot.includes(roleMatch[1])) return true;
  const bracketed = selectorOrRef.replace(/[[\]"'=*]/g, ' ').trim();
  if (bracketed && snapshot.includes(bracketed)) return true;
  return false;
}

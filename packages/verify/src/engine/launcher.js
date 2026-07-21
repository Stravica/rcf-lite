// Verifier-agent launcher (spec §5, §7.3, §9). Verify does NOT hand-code
// browser scripts; it launches a fresh, isolated agent (Claude Code by
// default) configured with browser tooling (Playwright) and the §7.3
// isolation env, and that agent drives the running app and returns structured
// findings. This keeps verify harness-agnostic.
//
// Shared-parent-state caution (§9): the launched agent MUST get its OWN
// isolated browser context (headless Node Playwright in its own session), not
// a shared MCP browser the parent also uses — otherwise identity/state leaks
// defeat the isolation recipe. buildLaunchConfig stamps the isolation env; the
// agent side is responsible for its own Playwright context.

import { isolationEnv, isolationProvenance } from '@stravica-ai/rcf-lite-core/isolation';

/** Env var naming a module (exporting `launchAgent`) to use instead of the default spawn launcher. The integration + manual-e2e seam. */
export const LAUNCHER_ENV = 'RCF_VERIFY_LAUNCHER';

/**
 * Build the child-process launch configuration for the verifier agent. Pure
 * and testable: asserts the §7.3 isolation env is applied and the agent is
 * pointed at the brief + live URL. The command defaults to Claude Code
 * headless; callers may override via deps for other harnesses (harness-agnostic).
 *
 * @param {object} opts
 * @param {object} opts.brief - the composed adversarial brief
 * @param {string} opts.url
 * @param {object} [deps]
 * @param {string} [deps.command] - the agent CLI (default: 'claude')
 * @param {Record<string,string|undefined>} [deps.baseEnv]
 * @returns {{ command: string, args: string[], env: Record<string,string|undefined>, isolation: {autoMemory: boolean, nonEssentialTraffic: boolean} }}
 */
export function buildLaunchConfig({ brief, url }, deps = {}) {
  const command = deps.command ?? 'claude';
  const env = isolationEnv(deps.baseEnv ?? process.env);
  // The brief is passed to the agent over argv/stdin by the concrete launcher;
  // here we only assemble the invariant config (command + isolation env).
  const args = ['--print', '--permission-mode', 'acceptEdits'];
  return { command, args, env, isolation: isolationProvenance(), briefUrl: url, brief };
}

/**
 * Resolve the launchAgent function for this run. Precedence:
 *   1. an explicitly injected `deps.launchAgent` (unit tests, in-process harness);
 *   2. a module named by RCF_VERIFY_LAUNCHER (integration + manual e2e seam);
 *   3. the default spawn launcher (live Claude Code + Playwright).
 *
 * @param {object} [deps]
 * @returns {Promise<(ctx: object) => Promise<{findings: object[]}>>}
 */
export async function resolveLauncher(deps = {}) {
  if (typeof deps.launchAgent === 'function') return deps.launchAgent;
  const envModule = process.env[LAUNCHER_ENV];
  if (envModule) {
    const mod = await import(envModule);
    const fn = mod.launchAgent ?? mod.default;
    if (typeof fn !== 'function') {
      throw new Error(`${LAUNCHER_ENV} module "${envModule}" does not export launchAgent`);
    }
    return fn;
  }
  return defaultSpawnLauncher;
}

/**
 * Default launcher: spawn the live verifier agent (Claude Code) with the
 * isolation env and let it drive the app via its own Playwright context.
 *
 * v1 honesty (§9, §11): the live-agent-drives-live-app path is NOT unit-
 * testable and is exercised only by the recorded manual e2e. When no agent
 * CLI is resolvable this throws a CLEAR error rather than fabricating a PASS —
 * a fabricated pass would be exactly the false-confidence failure the whole
 * programme exists to prevent (§9). Callers surface it as a non-zero exit.
 *
 * @param {object} ctx
 * @returns {Promise<{findings: object[]}>}
 */
export async function defaultSpawnLauncher(ctx) {
  const { spawn } = await import('node:child_process');
  const config = buildLaunchConfig(ctx, {});
  return await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.command, config.args, { env: config.env, stdio: ['pipe', 'pipe', 'inherit'] });
    } catch (err) {
      reject(new Error(`could not launch verifier agent "${config.command}": ${err.message}. `
        + `Set ${LAUNCHER_ENV} to a module exporting launchAgent, or install the agent CLI.`));
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => reject(new Error(`verifier agent failed to start: ${err.message}. Set ${LAUNCHER_ENV} to inject a launcher.`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`verifier agent exited ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(out);
        resolve({ findings: Array.isArray(parsed.findings) ? parsed.findings : [] });
      } catch (err) {
        reject(new Error(`verifier agent output was not valid findings JSON: ${err.message}`));
      }
    });
    // Hand the brief to the agent on stdin.
    child.stdin.write(JSON.stringify(config.brief));
    child.stdin.end();
  });
}

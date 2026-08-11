// Agent-driven mutation-sampling coordinator
// (verification-integrity-cluster-spec §6).
//
// This module owns the ORCHESTRATION contract, not the agent dispatch.
// The actual mutation-sampling is done by a Review-stage subagent (§6.5,
// §6.6) that runs in a worktree, applies each mutation, runs the test
// command, and records kill / survive. The subagent lives outside the
// build package (it is a Claude Code dispatch orchestrated by the
// harness, spec §6.7 note that native tool adapters are v2). Build
// provides:
//   - the CONTRACT the runner must satisfy (function shape, input, output);
//   - a DEFAULT runner that no-ops with a clear note when no wiring is
//     supplied (the record still validates against the schema); this
//     lets `rcf review` return a valid reviewAudit record on any repo,
//     even before the harness is set up;
//   - the SIZING policy (§6.3) and TEST-COMMAND resolver (§6.4).
//
// The wire-up: `rcf review` accepts `--mutation-runner <name>` (in a
// future iteration) or a dep-injected runner (this iteration). In tests,
// injection is direct. In production, the harness passes a runner that
// dispatches an Opus 4.7 subagent per the estate ladder.

/**
 * @typedef {object} MutationRunnerInput
 * @property {string} fbsId
 * @property {string[]} acIds                 the FBS's in-scope ACs
 * @property {object[]} testSuites            the TSes that cover any of the ACs
 * @property {object} sizing                  min/max/timeBudgetMs
 * @property {string} [testCommand]           resolved test command (§6.4)
 * @property {string} projectRoot
 */

/**
 * @typedef {object} MutationRunnerOutput
 * @property {import('./index.js').MutationSamplingRecord} record
 */

/**
 * @typedef {(input: MutationRunnerInput) => Promise<MutationRunnerOutput>} MutationRunner
 */

/**
 * Resolve the sizing policy for a mutation-sampling pass. Spec §6.3:
 * 10 min, 30 max, ~3 mutants per 50 LOC of changed function bodies,
 * default 10-minute time budget. LOC counting is the runner's job;
 * this returns the plain envelope.
 *
 * @param {object} [opts]
 * @param {number} [opts.timeBudgetMs]
 * @returns {{ min: number, max: number, timeBudgetMs: number }}
 */
export function defaultSizing({ timeBudgetMs = 10 * 60 * 1000 } = {}) {
  return { min: 10, max: 30, timeBudgetMs };
}

/**
 * Test command resolution (§6.4): manifest.testCommand -> flag ->
 * fallback. Returns the resolved command string OR the reason a
 * fallback was reached. Never throws — the caller records the reason
 * on the mutation-sampling record when applicable.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} [args.cliFlag]
 * @param {boolean} args.hasPackageJson
 * @returns {{ command: string|null, source: 'manifest'|'flag'|'fallback'|'unresolved' }}
 */
export function resolveTestCommand({ manifest, cliFlag, hasPackageJson }) {
  if (typeof cliFlag === 'string' && cliFlag.length > 0) {
    return { command: cliFlag, source: 'flag' };
  }
  if (typeof manifest?.testCommand === 'string' && manifest.testCommand.length > 0) {
    return { command: manifest.testCommand, source: 'manifest' };
  }
  if (hasPackageJson) return { command: 'npm test', source: 'fallback' };
  return { command: null, source: 'unresolved' };
}

/**
 * Default runner: emits a valid mutation-sampling record with zero
 * mutants and a `notes` explaining that no runner was wired. This is
 * the "no-op with honesty" path — the reviewAudit record stays valid,
 * the audit's verdict is not spoofed, and the operator sees an
 * explicit message rather than a silent green.
 *
 * @type {MutationRunner}
 */
export async function defaultMutationRunner() {
  return {
    record: {
      mode: 'agent-v1-not-wired',
      mutantsGenerated: 0,
      mutantsRun: 0,
      killed: 0,
      survived: 0,
      notes: 'No mutation-sampling runner supplied. Wire one via the harness (spec §6.5-§6.7) or run --skip-mutation to acknowledge the omission on the record.',
    },
  };
}

/**
 * Explicit skip: same shape as the default runner but says so.
 *
 * @type {MutationRunner}
 */
export async function skippedMutationRunner() {
  return {
    record: {
      mode: 'skipped',
      mutantsGenerated: 0,
      mutantsRun: 0,
      killed: 0,
      survived: 0,
      notes: 'Mutation sampling skipped by --skip-mutation.',
    },
  };
}

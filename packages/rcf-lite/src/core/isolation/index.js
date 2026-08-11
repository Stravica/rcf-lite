// Verifier-agent isolation-env recipe (spec §7.3). Defined once in core so
// both the (future) build agent-launch and verify-lite's launcher use the
// identical environment. In v1 only verify consumes it, but core is its
// correct home — the recipe is a shared-suite invariant, not a verify detail.
//
// Why both flags (proven in the persona programme, run-05 clean sweep):
// auto-memory-off ALONE was insufficient — a server-side OAuth profile fetch
// re-populated operator identity into the fresh agent session. The
// non-essential-traffic flag closed that leak. Verify launches its verifier
// agent with BOTH set by default; a run's report stamps which were applied
// (report.run.verifierIsolation) so the isolation is provenance, not a claim.

/**
 * Canonical isolation-env recipe. `autoMemory:false` mirrors the harness
 * config toggle; the two env vars are the process-level enforcement.
 * Frozen so no caller can mutate the shared recipe in place.
 *
 * @type {{ autoMemory: boolean, env: Readonly<Record<string, string>> }}
 */
export const ISOLATION_RECIPE = Object.freeze({
  autoMemory: false,
  env: Object.freeze({
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }),
});

/**
 * Build a child-process env with the isolation recipe layered over a base
 * env (defaults to the current process env). The recipe wins on conflict —
 * the whole point is that a leaked parent value cannot re-enable memory or
 * non-essential traffic in the verifier session.
 *
 * @param {Record<string, string|undefined>} [baseEnv] - env to layer onto (default process.env)
 * @returns {Record<string, string|undefined>}
 */
export function isolationEnv(baseEnv = process.env) {
  return { ...baseEnv, ...ISOLATION_RECIPE.env };
}

/**
 * The provenance stamp recorded in a run report's `verifierIsolation`
 * block (spec §5.3). Reports whether each isolation guarantee was applied.
 *
 * POLARITY (important, matches spec §5.3): each field is the FEATURE STATE in
 * the verifier session — i.e. whether that feature is ENABLED — NOT the state
 * of the corresponding CLAUDE_CODE_DISABLE_* env var. The recipe DISABLES both
 * features (env vars set to '1'), so the correct provenance is that both
 * features are OFF: `autoMemory: false` (auto-memory disabled) and
 * `nonEssentialTraffic: false` (non-essential traffic disabled). Both `false`
 * is the fully-isolated state, exactly as the §5.3 schema example shows.
 *
 * @returns {{ autoMemory: boolean, nonEssentialTraffic: boolean }}
 */
export function isolationProvenance() {
  return {
    autoMemory: ISOLATION_RECIPE.autoMemory,
    nonEssentialTraffic: false,
  };
}

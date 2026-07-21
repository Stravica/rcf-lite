// Verification orchestrator (spec §5, §8.2). Ties the pieces together in the
// exact order build-lite's finalise step would drive them: resolve the runtime
// profile → read the acceptance contract off the chain → (deployed) gate on
// reachability → provision prerequisites → compose the adversarial brief →
// launch the isolated verifier agent → validate/aggregate/stamp the verdict →
// build the ingestible report. Every failure is returned as data (RcfError),
// never a fabricated PASS (§9 false-confidence prohibition).

import { rcfError, isRcfError } from '@stravica-ai/rcf-lite-core/errors';
import { isolationProvenance } from '@stravica-ai/rcf-lite-core/isolation';

import {
  resolveProfile,
  checkDeployedReachability,
  isNotDeployed,
  verdictAuthorityFor,
} from '../profile/index.js';
import { readChain as defaultReadChain } from '../chain/index.js';
import { runProvisioning, cleanup as defaultCleanup } from '../provision/index.js';
import { composeBrief } from './brief.js';
import { resolveLauncher } from './launcher.js';
import { aggregateVerdict, validateFinding } from '../verdict/index.js';
import { buildReport } from '../report/index.js';

/**
 * Validate + normalise the raw findings an agent returned. A malformed finding
 * is an error-as-data, not a silent drop — the report contract (§5.2) requires
 * every finding to be chain-node-addressed.
 *
 * @param {unknown} rawFindings
 * @returns {{ findings: object[] } | import('@stravica-ai/rcf-lite-core/errors').RcfError}
 */
export function normaliseFindings(rawFindings) {
  if (!Array.isArray(rawFindings)) {
    return rcfError({ kind: 'validation', message: 'verifier agent must return a findings array' });
  }
  const findings = [];
  for (const raw of rawFindings) {
    const err = validateFinding(raw);
    if (err) return err;
    findings.push({
      severity: raw.severity,
      acId: raw.acId,
      journey: raw.journey,
      reproSteps: raw.reproSteps,
      evidence: raw.evidence,
    });
  }
  return { findings };
}

/**
 * Run a full verification. Returns `{ report }` on completion (including the
 * NOT-DEPLOYED / BLOCKED refusals, which are legitimate reports), or an
 * RcfError for usage / chain-load / agent failures the CLI maps to a non-zero
 * exit.
 *
 * @param {object} opts - the CLI-parsed run options
 * @param {object} [deps] - injectable seams (launchAgent, fetchImpl, signup, teardown, now, readChain)
 * @returns {Promise<{ report: object } | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function runVerification(opts = {}, deps = {}) {
  const now = deps.now ?? (() => new Date().toISOString());
  const readChain = deps.readChain ?? defaultReadChain;
  const startedAt = now();

  // 1. Resolve + validate the runtime declaration (§4).
  const resolved = resolveProfile({ profile: opts.profile, url: opts.url, parityEnv: opts.parityEnv });
  if (isRcfError(resolved)) return resolved;
  const { profile, url, parityEnv } = resolved;

  // 2. Read the acceptance contract off the chain (the ONLY structural input, §9).
  const chain = await readChain({ repo: opts.repo, chainRef: opts.chainRef });
  if (isRcfError(chain)) return chain;

  const verdictAuthority = verdictAuthorityFor(profile, parityEnv);

  // 3. Deployed reachability gate (§4). Only consulted for profile==='deployed'.
  let reachability = null;
  if (profile === 'deployed') {
    reachability = await checkDeployedReachability(url, { fetchImpl: deps.fetchImpl });
    if (isNotDeployed(profile, reachability)) {
      // Refusal to issue a verdict — never a soft pass (§4, §5.1).
      const report = buildReport({
        profile, url, parityEnv, reachability, chainRef: chain.chainRef, repo: opts.repo,
        persona: opts.persona, startedAt, finishedAt: now(),
        verifierIsolation: isolationProvenance(),
        verdict: 'NOT-DEPLOYED', verdictAuthority,
        findings: [], blockedAcs: [], provisioning: null,
      });
      return { report };
    }
  }

  // 4. Provision prerequisites (§6). Unprovisionable → BLOCKED (named), dependent ACs BLOCKED.
  const { provisioning, blockedAcs } = await runProvisioning({
    acs: chain.acs,
    url,
    provisionPath: opts.provision,
    mode: opts.provisionMode ?? 'run',
    signup: deps.signup,
  });

  // 5. Compose the adversarial brief from the chain ACs (§5, §9 guarantee 4).
  const brief = composeBrief({ acs: chain.acs, url, persona: opts.persona, chainRef: chain.chainRef });

  // Cleanup runs whether or not the launch succeeds — provisioned artefacts
  // must not be orphaned by a launch failure (§6 cleanup contract).
  const runCleanup = async () => {
    const cleanupFn = deps.cleanup ?? defaultCleanup;
    const cleanupResult = await cleanupFn({ provisioned: provisioning.provisioned, teardown: deps.teardown });
    provisioning.cleanupRan = cleanupResult.cleanupRan;
    provisioning.cleanupRemoved = cleanupResult.cleanupRemoved;
    if (cleanupResult.cleanupBlocked?.length) provisioning.cleanupBlocked = cleanupResult.cleanupBlocked;
  };

  // 6. Launch the isolated verifier agent (§7.3 isolation env, §9 fresh session).
  let launchResult;
  try {
    const launchAgent = await resolveLauncher(deps);
    launchResult = await launchAgent({ brief, url, profile });
  } catch (err) {
    // A verifier agent that could not run — or whose output could not be
    // ingested — is NEVER a fabricated PASS (§9). But the report is still
    // build-lite's next input (§5.4, §10 --out-always-written), so we build a
    // LAUNCH-FAILURE report carrying the error + preserved-transcript path so
    // the fix loop has something to ingest. Exit stays non-zero (gate trips).
    await runCleanup();
    const report = buildReport({
      profile, url, parityEnv, reachability, chainRef: chain.chainRef, repo: opts.repo,
      persona: opts.persona, startedAt, finishedAt: now(),
      verifierIsolation: isolationProvenance(),
      verdict: 'LAUNCH-FAILURE', verdictAuthority,
      findings: [], blockedAcs, provisioning,
      launchFailure: { message: err.message, rawOutputPath: err.rawOutputPath ?? null },
    });
    return { report };
  }

  // 7. Validate + stamp the findings (§5.2 chain-node addressing).
  const normalised = normaliseFindings(launchResult?.findings);
  if (isRcfError(normalised)) return normalised;
  const { findings } = normalised;

  // 8. Cleanup provisioned artefacts (§6 cleanup contract).
  await runCleanup();

  // 9. Aggregate the verdict — split, never averaged (§5.1).
  const verdict = aggregateVerdict({ findings, blockedAcs, notDeployed: false });

  // 10. Build the ingestible report (§5.3).
  const report = buildReport({
    profile, url, parityEnv, reachability, chainRef: chain.chainRef, repo: opts.repo,
    persona: opts.persona, startedAt, finishedAt: now(),
    verifierIsolation: isolationProvenance(),
    verdict, verdictAuthority,
    findings, blockedAcs, provisioning,
    runStats: launchResult?.runStats ?? null,
  });

  return { report };
}

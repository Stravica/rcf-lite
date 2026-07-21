// Report artifact (spec §5.3). The report is NOT a dead-end artifact — it is
// build-lite's next input (§5.4), so it is emitted chain-node-addressed and
// camelCase, with `schemaVersion` from day one so build-lite's ingest can
// version-gate. Credentials never appear in the report body (§10) — the
// builder passes an already-clean provisioning record, and redactSecrets is a
// defence-in-depth guard on top.

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';

import { redactSecrets } from '../provision/index.js';
import { VERDICTS } from '../verdict/index.js';

/** The report schema version. Present from day one for build-lite's version-gated ingest. */
export const SCHEMA_VERSION = '1';

const DEFAULT_PERSONA = 'generic-sceptic';

/**
 * Assemble the §5.3 report object. Pure — all runtime facts are passed in.
 *
 * @param {object} p
 * @returns {object} the report artifact
 */
export function buildReport(p) {
  const report = {
    schemaVersion: SCHEMA_VERSION,
    run: {
      profile: p.profile,
      url: p.url,
      parityEnv: Boolean(p.parityEnv),
      reachability: p.reachability ?? null,
      chainRef: p.chainRef ?? null,
      repo: p.repo ?? null,
      persona: p.persona ?? DEFAULT_PERSONA,
      startedAt: p.startedAt ?? null,
      finishedAt: p.finishedAt ?? null,
      verifierIsolation: p.verifierIsolation ?? { autoMemory: false, nonEssentialTraffic: false },
      // Agent usage/timing from the --output-format json envelope (§5.3, additive).
      // Omit-not-fake: null when the launcher could not report it.
      runStats: p.runStats ?? null,
    },
    verdict: p.verdict,
    verdictAuthority: p.verdictAuthority,
    findings: Array.isArray(p.findings) ? p.findings : [],
    blockedAcs: Array.isArray(p.blockedAcs) ? p.blockedAcs : [],
    provisioning: p.provisioning ?? null,
    // Present (non-null) only on a LAUNCH-FAILURE verdict: the agent could not
    // run or its output could not be ingested. Carries the error + the path to
    // the preserved raw transcript so the §5.4 fix loop has something to ingest.
    launchFailure: p.launchFailure ?? null,
  };
  // Defence-in-depth: never let a secret reach the report body (§10).
  return redactSecrets(report);
}

/**
 * Serialise a report to the on-disk artifact string (camelCase JSON).
 *
 * @param {object} report
 * @returns {string}
 */
export function serialiseReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Parse a report artifact back (for `rcf-verify report`). Errors as data.
 *
 * @param {string} raw
 * @returns {object | import('@stravica-ai/rcf-lite-core/errors').RcfError}
 */
export function parseReport(raw) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'parseFailure', message: `report is not valid JSON: ${err.message}` });
  }
  const shapeErr = validateReportShape(doc);
  if (shapeErr) return shapeErr;
  return doc;
}

/**
 * Minimal shape check on a report artifact.
 *
 * @param {object} doc
 * @returns {import('@stravica-ai/rcf-lite-core/errors').RcfError | null}
 */
export function validateReportShape(doc) {
  if (!doc || typeof doc !== 'object') {
    return rcfError({ kind: 'validation', message: 'report must be an object' });
  }
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    return rcfError({ kind: 'validation', message: `unsupported report schemaVersion: ${doc.schemaVersion ?? '(missing)'}`, field: 'schemaVersion' });
  }
  if (!VERDICTS.includes(doc.verdict)) {
    return rcfError({ kind: 'validation', message: `unknown verdict: ${doc.verdict}`, field: 'verdict' });
  }
  if (doc.verdictAuthority !== 'ship' && doc.verdictAuthority !== 'correctness') {
    return rcfError({ kind: 'validation', message: `verdictAuthority must be ship|correctness (got ${doc.verdictAuthority})`, field: 'verdictAuthority' });
  }
  if (!doc.run || typeof doc.run !== 'object') {
    return rcfError({ kind: 'validation', message: 'report.run is required', field: 'run' });
  }
  return null;
}

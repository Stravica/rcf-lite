// Prerequisite provisioning (spec §6, amendment 2). Adversarial verification
// usually can't start from nothing. One mechanism, three kinds of
// prerequisite the chain's ACs may imply: auth accounts (common), third-party
// service sandboxes/keys, and seeded test data.
//
// Hard rules this module enforces (each a §10 acceptance criterion):
//  - the `zzverify-` prefix on ALL provisioned artefacts, so they are
//    greppable and sweepable;
//  - credentials/keys go ONLY to the --provision file, NEVER inline, NEVER
//    echoed to logs or the report body (redactSecrets is the guard);
//  - what cannot be provisioned is BLOCKED (naming the missing prerequisite)
//    and its dependent ACs are marked BLOCKED — never silently skipped;
//  - cleanup removes provisioned artefacts and the report states what it did.

import { writeFile, readFile } from 'node:fs/promises';

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';

/** Greppable prefix on every provisioned artefact (accounts + data alike). */
export const ZZVERIFY_PREFIX = 'zzverify-';

/** v1 auth provisioning stands up at least this many accounts (multi-user isolation journeys). */
export const MIN_AUTH_ACCOUNTS = 2;

/** Field names whose VALUES must never reach a log or the report body. */
export const SECRET_FIELDS = Object.freeze(['password', 'token', 'secret', 'key', 'apiKey', 'credential', 'cookie']);

const AUTH_PATTERNS = /\b(sign[\s-]?in|sign[\s-]?up|log[\s-]?in|logout|register|registration|authenticat|account|password|credential|session|onboard)/i;
const SERVICE_PATTERNS = /\b(payment|stripe|checkout|billing|sandbox|webhook|third[\s-]?party|external api|e-?mail send|sms|twilio|sendgrid|oauth provider)/i;
const SEEDDATA_PATTERNS = /\b(admin[\s-]?(created|seeded)|seeded|pre[\s-]?populated|existing (record|row|dataset)|another user|user b\b|other user)/i;

/**
 * Classify the prerequisite kind an AC implies (or null if none). Matches on
 * the AC's given/when/then/description text. Heuristic — the honest hard part
 * (§6): where the route can't be derived, the caller BLOCKS rather than skips.
 *
 * @param {object} ac - a flattened AC ({acId, description, given, when, then})
 * @returns {'authAccount'|'serviceSandbox'|'seedData'|null}
 */
export function classifyPrerequisite(ac) {
  const text = [ac.description, ac.given, ac.when, ac.then, ac.title].filter(Boolean).join(' ');
  if (SERVICE_PATTERNS.test(text)) return 'serviceSandbox';
  if (SEEDDATA_PATTERNS.test(text)) return 'seedData';
  if (AUTH_PATTERNS.test(text)) return 'authAccount';
  return null;
}

/**
 * Derive the provisioning plan from the chain's ACs: which prerequisite kinds
 * are required, and which ACs depend on each. v1 automates authAccount against
 * signup-exposing apps; serviceSandbox / seedData routes are honestly BLOCKED
 * unless an out-of-band route is supplied (§6 v1 scope note).
 *
 * @param {Array<object>} acs
 * @returns {{ required: string[], acsByKind: Record<string, string[]> }}
 */
export function deriveProvisioningPlan(acs = []) {
  const acsByKind = {};
  for (const ac of acs) {
    const kind = classifyPrerequisite(ac);
    if (!kind) continue;
    (acsByKind[kind] ??= []).push(ac.acId);
  }
  return { required: Object.keys(acsByKind), acsByKind };
}

/**
 * Deep-redact secret values for anything bound for a log or the report body.
 * Returns a new object; input untouched. Any key in SECRET_FIELDS (case-
 * insensitive) has its value replaced with '[redacted]'.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_FIELDS.some((f) => f.toLowerCase() === k.toLowerCase())
        ? '[redacted]'
        : redactSecrets(v);
    }
    return out;
  }
  return value;
}

/**
 * Write provisioned credentials to the --provision file (spec §3 rule 3, §6).
 * This is the ONLY sink for secrets. Never returns the secrets to the caller
 * for logging.
 *
 * @param {string} provisionPath
 * @param {object} data - full provisioning record including credentials
 * @returns {Promise<import('@stravica-ai/rcf-lite-core/errors').RcfError | null>}
 */
export async function writeProvisionFile(provisionPath, data) {
  if (typeof provisionPath !== 'string' || provisionPath.length === 0) {
    return rcfError({ kind: 'usage', message: '--provision requires a file path', field: 'provision' });
  }
  try {
    await writeFile(provisionPath, JSON.stringify(data, null, 2), 'utf8');
    return null;
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `failed to write provision file: ${err.message}`, filePath: provisionPath, stack: err.stack });
  }
}

/**
 * Read a provisioning file (credentials/fixtures) back for a run/cleanup.
 *
 * @param {string} provisionPath
 * @returns {Promise<object | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function readProvisionFile(provisionPath) {
  try {
    return JSON.parse(await readFile(provisionPath, 'utf8'));
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `failed to read provision file: ${err.message}`, filePath: provisionPath, stack: err.stack });
  }
}

/**
 * Provision auth accounts against a signup-exposing app. The actual signup is
 * app-specific and agent-driven — supplied via the injected `signup` function
 * (the seam; §6 "the provisioning route is app-specific"). Without a signup
 * route the whole kind is BLOCKED, honestly.
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {number} [opts.count]
 * @param {((ctx: {url: string, username: string}) => Promise<object>)} [opts.signup]
 *   - returns account credentials; may throw to signal an unprovisionable app
 * @returns {Promise<{ provisioned: object[], blocked: object[], credentials: object[] }>}
 */
export async function provisionAuth({ url, count = MIN_AUTH_ACCOUNTS, signup } = {}) {
  const provisioned = [];
  const blocked = [];
  const credentials = [];
  if (typeof signup !== 'function') {
    blocked.push({ kind: 'authAccount', reason: 'cannot provision: app exposes no derivable signup route (invite-only / admin-seeded / out-of-band). See §6 deferred.' });
    return { provisioned, blocked, credentials };
  }
  const suffixes = 'abcdefghijklmnopqrstuvwxyz';
  for (let i = 0; i < Math.max(count, MIN_AUTH_ACCOUNTS); i += 1) {
    const ref = `${ZZVERIFY_PREFIX}${suffixes[i] ?? String(i)}`;
    try {
      const creds = await signup({ url, username: ref });
      provisioned.push({ kind: 'authAccount', ref });
      credentials.push({ ref, ...creds });
    } catch (err) {
      blocked.push({ kind: 'authAccount', reason: `cannot provision ${ref}: ${err.message}` });
    }
  }
  return { provisioned, blocked, credentials };
}

/**
 * Run provisioning end-to-end for a `run` (spec §6, run-internalised). Derives
 * the plan, provisions auth where a signup route exists, BLOCKS every other
 * required kind (naming the missing prerequisite), marks dependent ACs as
 * BLOCKED, and writes credentials to the --provision file only.
 *
 * @param {object} opts
 * @param {Array<object>} opts.acs
 * @param {string} opts.url
 * @param {string} [opts.provisionPath]
 * @param {'run'|'skip'} [opts.mode]
 * @param {((ctx: object) => Promise<object>)} [opts.signup] - injected signup route
 * @returns {Promise<{ provisioning: object, blockedAcs: object[] }>}
 */
export async function runProvisioning({ acs = [], url, provisionPath, mode = 'run', signup } = {}) {
  const provisioning = { provisioned: [], blocked: [], cleanupRan: false, cleanupRemoved: [] };
  const blockedAcs = [];

  if (mode === 'skip') return { provisioning, blockedAcs };

  const plan = deriveProvisioningPlan(acs);
  const allCredentials = [];

  for (const kind of plan.required) {
    const dependentAcIds = plan.acsByKind[kind] ?? [];
    if (kind === 'authAccount') {
      const { provisioned, blocked, credentials } = await provisionAuth({ url, signup });
      provisioning.provisioned.push(...provisioned);
      provisioning.blocked.push(...blocked);
      allCredentials.push(...credentials);
      // If auth could not be provisioned at all, its dependent ACs are BLOCKED.
      if (provisioned.length === 0) {
        const reason = blocked[0]?.reason ?? 'cannot provision: authAccount';
        for (const acId of dependentAcIds) blockedAcs.push({ acId, reason });
      }
    } else {
      // serviceSandbox / seedData — v1 honest BLOCK unless an out-of-band route exists.
      const reason = `cannot provision: ${kind} (out-of-band route required — §6 v1 deferred)`;
      provisioning.blocked.push({ kind, reason });
      for (const acId of dependentAcIds) blockedAcs.push({ acId, reason });
    }
  }

  // Credentials go ONLY to the provision file — never into `provisioning`
  // (which lands in the report body) and never returned for logging.
  if (allCredentials.length > 0 && provisionPath) {
    await writeProvisionFile(provisionPath, {
      schemaVersion: '1',
      url,
      credentials: allCredentials,
    });
  }

  return { provisioning, blockedAcs };
}

/**
 * Tear down provisioned artefacts (spec §6 cleanup contract). The actual
 * teardown is app-specific — supplied via the injected `teardown` function.
 * Records what it removed for the report.
 *
 * @param {object} opts
 * @param {object[]} [opts.provisioned] - [{kind, ref}]
 * @param {((ref: string) => Promise<void>)} [opts.teardown]
 * @returns {Promise<{ cleanupRan: boolean, cleanupRemoved: string[], cleanupBlocked: object[] }>}
 */
export async function cleanup({ provisioned = [], teardown } = {}) {
  const cleanupRemoved = [];
  const cleanupBlocked = [];
  if (typeof teardown !== 'function') {
    // No teardown route — report honestly rather than claim a clean sweep.
    for (const p of provisioned) cleanupBlocked.push({ ref: p.ref, reason: 'no teardown route supplied' });
    return { cleanupRan: false, cleanupRemoved, cleanupBlocked };
  }
  for (const p of provisioned) {
    try {
      await teardown(p.ref);
      cleanupRemoved.push(p.ref);
    } catch (err) {
      cleanupBlocked.push({ ref: p.ref, reason: err.message });
    }
  }
  return { cleanupRan: true, cleanupRemoved, cleanupBlocked };
}

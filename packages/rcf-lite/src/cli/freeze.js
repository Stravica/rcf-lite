// `rcf define freeze` subcommand handler (REQ-176; proposal
// 2026-09-22 §2.1, §2.5, §3.2 D8, §8.2 v3; Baz 2026-09-24 renumbering
// puts this verb in 0.29.0).
//
// The freeze verb is the only close verb: no change-object is minted,
// nothing else changes state. It runs `computeReadiness` (REQ-175)
// once over the live tree, freeze record and four ledgers; refuses
// (exit 4) on any stage state 'failing' after applying any --ack
// arguments; and, on success, writes `rcf/define/freeze.json` via
// `saveFreezeRecord` (REQ-172) plus the proposal §2.5 summary line
// the operator signs off.
//
// D8 queue work (appending new FBS, re-opening re-execute FBS) is
// the agent's authoring work per the playbook, NOT this verb; the
// verb only gates on D8's checks in `gates.js`.
//
// --ack is accepted only for the three warn-with-ack gates
// (define.shapes / D3 / shapes, define.crosscut / D5 / crosscut,
// define.consistency / D6 / consistency) per ADR-4124. --ack on any
// other gate is a usage refusal (exit 2); --ack without a paired
// --reason is a usage refusal.
//
// Admissibility refusal is informational per ADR-4123 / ADR-4124: the
// wrap runs first so the ruleset toolScope guard is honoured, and on
// refuse the CLI prints a stderr [warn] line but the freeze compute
// still runs and writes when the tree is freezeable.

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { resolveTestPointers, walkTree } from '#core/store';
import { checkCodeNodeResolution } from '#core/store';
import { findProjectRoot } from '../view/index.js';
import { loadFreezeRecord, saveFreezeRecord } from '../define/freeze-record.js';
import { loadAllLedgers } from '../define/ledgers.js';
import {
  STAGE_ALIASES,
  STAGE_GATES,
  STAGE_ORDER,
  STAGE_SHORT_NAMES,
  parseAcClass,
} from '../query/gates.js';
import { computeDelta, hashDocument } from '../query/delta.js';
import { computeReadiness, shortHash } from '../query/readiness.js';
import { runWithAdmissibilityGate } from '../query/index.js';

const OPTION_SPEC = {
  ack: { type: 'string', multiple: true },
  reason: { type: 'string', multiple: true },
  note: { type: 'string' },
  'litmus-attested': { type: 'string' },
  status: { type: 'boolean' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

/** Gates for which --ack is legal (proposal §2.5, ADR-4124). */
const ACKABLE_GATES = new Set([
  STAGE_GATES.D3, STAGE_GATES.D5, STAGE_GATES.D6,
]);

/** Reverse alias map: any accepted alias for the three ackable gates. */
const ACKABLE_ALIASES = /** @type {const} */ (() => {
  /** @type {Record<string, string>} */
  const out = {};
  for (const stage of ['D3', 'D5', 'D6']) {
    const gate = STAGE_GATES[stage];
    const short = STAGE_SHORT_NAMES[stage];
    out[gate] = gate;
    out[stage] = gate;
    out[short] = gate;
  }
  return out;
})();

export const HELP = `Usage: rcf define freeze [options]

Close a change on the tree by freezing again. Runs computeReadiness
once, refuses (exit 4) on any failing stage, and writes
rcf/define/freeze.json with fresh hashes plus the freeze context
slice-4's bundle --next and slice-5's viewer read.

The freeze verb is the only close verb: nothing is minted, nothing
else changes state. Editing the tree afterwards drives readiness to a
non-empty delta; closing that delta means running this verb again.

D8's queue-authoring work (appending new FBS for added ACs, re-opening
FBS the delta re-executes) is the agent's authoring work per the
playbook, not this verb. The verb only gates on D8's checks reported
by computeReadiness.

Options:
  --ack <gate>              Acknowledge a warn-with-ack gate's failure
                            at the current tree hash. Only three gates
                            are ackable: define.shapes (D3 / shapes),
                            define.crosscut (D5 / crosscut) and
                            define.consistency (D6 / consistency). Ack
                            on any other gate is a usage refusal.
                            Repeat --ack for multiple gates; every
                            --ack must be paired with a --reason.
  --reason <text>           Reason for the paired --ack. Repeatable
                            alongside --ack; the arities must match.
  --note <text>             Optional note to record on the freeze
                            (mnemonic for the change; readable via
                            --status).
  --litmus-attested <D3,..> Comma-separated D-names (D3 / D6) for
                            which the agent attests to having read the
                            elicitation prompts in the current session
                            (proposal §9 decision 7). Recorded in
                            freeze.litmus.attestedAt.
  --status                  Print the current freeze record and the
                            live delta summary; run no gates; write
                            nothing. Exits 0 even when unfrozen.
  --json                    Emit machine-readable JSON. On a freeze
                            success emits { record, summary, delta };
                            on --status emits { record, delta };
                            never printed on a refusal.
  --help                    Print this help.

Exit codes:
  0     Success (record written; --status; --help).
  2     Usage error (unknown --ack gate, --ack without --reason,
        unknown flag).
  4     Refused: at least one stage state is failing and no --ack
        covered it.
`;

/** @typedef {'blocking' | 'warnWithAck'} StagePolicy */

/**
 * Public entry.
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();
  const now = deps.now ?? (() => new Date());

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: false, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  if (flags.help) {
    stdout.write(HELP);
    return 0;
  }

  // --ack / --reason parsing (usage validation before any I/O).
  /** @type {Array<{ gate: string, reason: string }>} */
  let ackPairs;
  try {
    ackPairs = parseAckPairs(flags.ack, flags.reason);
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  // --status branch: read-only. No gates, no writes.
  if (flags.status) {
    return runStatus({ projectRoot, flags, stdout, stderr });
  }

  // Freeze branch.
  return runFreeze({
    projectRoot, flags, ackPairs, now, stdout, stderr,
  });
}

/**
 * Walk --ack and --reason multi-valued arrays in parallel; refuse on
 * unknown gate names, missing --reason, or count mismatch. Returns
 * the paired list normalised to canonical gate ids.
 *
 * @param {string[]|undefined} acks
 * @param {string[]|undefined} reasons
 * @returns {Array<{ gate: string, reason: string }>}
 */
function parseAckPairs(acks, reasons) {
  const ackArr = Array.isArray(acks) ? acks : [];
  const reasonArr = Array.isArray(reasons) ? reasons : [];
  if (ackArr.length !== reasonArr.length) {
    throw new Error(`--ack requires a matching --reason (got ${ackArr.length} ack(s) and ${reasonArr.length} reason(s))`);
  }
  /** @type {Array<{ gate: string, reason: string }>} */
  const out = [];
  const acceptedList = Object.keys(ACKABLE_ALIASES).sort().join(' | ');
  for (let i = 0; i < ackArr.length; i += 1) {
    const raw = ackArr[i];
    const canonical = ACKABLE_ALIASES[raw];
    if (!canonical) {
      throw new Error(`--ack ${raw} is not an ackable gate; accepted: ${acceptedList}`);
    }
    const reason = reasonArr[i];
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new Error(`--ack ${raw} requires a non-empty --reason`);
    }
    out.push({ gate: canonical, reason });
  }
  return out;
}

// ---------------------------------------------------------------------------
// --status branch
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {Record<string, unknown>} args.flags
 * @param {NodeJS.WritableStream} args.stdout
 * @param {NodeJS.WritableStream} args.stderr
 * @returns {Promise<number>}
 */
async function runStatus({ projectRoot, flags, stdout, stderr }) {
  let record;
  try {
    record = await loadFreezeRecord({ projectRoot });
  } catch (err) {
    stderr.write(`[error] freeze: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }
  const { tree } = await walkTree({ projectRoot });
  const ledgers = await loadAllLedgers({ projectRoot });
  const delta = computeDelta(tree, record, ledgers);

  if (flags.json) {
    stdout.write(`${JSON.stringify({ record, delta }, null, 2)}\n`);
    return 0;
  }
  if (!record) {
    stdout.write('never frozen\n');
    stdout.write(`Delta: ${delta.added.length} added, ${delta.changed.length} changed, ${delta.removed.length} removed (unfrozen tree; every id is 'added').\n`);
    return 0;
  }
  stdout.write(`${formatStatusLine(record)}\n`);
  stdout.write(`Delta: ${delta.changed.length} changed, ${delta.added.length} added, ${delta.removed.length} removed, ${delta.briefSince.length} brief statement(s) since.\n`);
  return 0;
}

/**
 * Compose the one-block text summary for `--status`.
 *
 * @param {import('../define/freeze-record.js').default | Record<string, unknown>} record
 * @returns {string}
 */
function formatStatusLine(record) {
  const r = /** @type {Record<string, unknown>} */ (record);
  const treeHash = typeof r.treeHash === 'string' ? r.treeHash : null;
  const frozenAt = typeof r.frozenAt === 'string' ? r.frozenAt : '(unknown)';
  const note = typeof r.note === 'string' && r.note.length > 0 ? r.note : '(none)';
  const counts = /** @type {any} */ (r.counts) ?? {};
  const litmus = /** @type {any} */ (r.litmus) ?? {};
  const versions = /** @type {any} */ (r.versions) ?? {};
  const gates = /** @type {any} */ (r.gates) ?? {};
  const acked = Object.entries(gates)
    .filter(([, g]) => g && g.state === 'acknowledged')
    .map(([gate, g]) => `${gate} ("${g.at?.reason ?? ''}")`);
  const ackedLine = acked.length > 0 ? acked.join('; ') : '(none)';
  const attested = Array.isArray(litmus.attestedAt) ? litmus.attestedAt.join(', ') : '';
  const overrideVal = r.override;
  const overrideStr = overrideVal === null || overrideVal === undefined
    ? 'null'
    : `${/** @type {any} */ (overrideVal).reason} by ${/** @type {any} */ (overrideVal).by} at ${/** @type {any} */ (overrideVal).at}`;
  const parts = [
    `Frozen at ${shortHash(treeHash)} on ${frozenAt}.`,
    `Note: ${note}.`,
    `Counts: ${counts.req ?? 0} REQ / ${counts.us ?? 0} US / ${counts.ac ?? 0} AC / ${counts.tac ?? 0} TAC / ${counts.adr ?? 0} ADR / ${counts.fbs ?? 0} FBS.`,
    `Acknowledged: ${ackedLine}.`,
    `Litmus: attestedAt [${attested}], readers ${litmus.readers ?? 0}.`,
    `Versions: rcfLite ${versions.rcfLite ?? '?'} / ruleset ${versions.ruleset ?? '?'} / schemas ${versions.schemas ?? '?'}.`,
    `Override: ${overrideStr}.`,
  ];
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Freeze branch
// ---------------------------------------------------------------------------

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {Record<string, unknown>} args.flags
 * @param {Array<{ gate: string, reason: string }>} args.ackPairs
 * @param {() => Date} args.now
 * @param {NodeJS.WritableStream} args.stdout
 * @param {NodeJS.WritableStream} args.stderr
 * @returns {Promise<number>}
 */
async function runFreeze({
  projectRoot, flags, ackPairs, now, stdout, stderr,
}) {
  const { tree, errors } = await walkTree({ projectRoot });
  const staleErrors = await checkCodeNodeResolution({ projectRoot, tree });
  const validateErrors = [...errors, ...staleErrors];

  const [priorFreeze, ledgers, testPointers, profileText] = await Promise.all([
    loadFreezeRecord({ projectRoot }),
    loadAllLedgers({ projectRoot }),
    resolveTestPointers({ projectRoot, tree }),
    readProfileText(projectRoot),
  ]);

  const chainRulesetVersion = typeof tree.manifest?.rulesetVersion === 'string'
    ? tree.manifest.rulesetVersion
    : null;

  // Compute the tree hash up front so we can synthesise a freeze
  // context that carries any --ack acknowledgements at the current
  // hash. The readiness compute then folds D3 / D5 / D6 to
  // 'acknowledged' in the same pass, which is what D8's priorStages
  // check reads. Applying acks post-readiness would leave D8 seeing
  // stale prior states and refusing on freeze:priorGates.
  const preHashDelta = computeDelta(tree, priorFreeze, ledgers);
  const currentTreeHash = preHashDelta.currentTreeHash;

  const ackedReasons = new Map(ackPairs.map((p) => [p.gate, p.reason]));
  const freezeForCompute = ackedReasons.size === 0
    ? priorFreeze
    : mergeAckedGates(priorFreeze, ackedReasons, currentTreeHash);

  const gated = await runWithAdmissibilityGate({
    tree,
    chainRulesetVersion,
    produce: () => computeReadiness(tree, {
      freeze: freezeForCompute,
      ledgers,
      profileText,
      testPointers,
      validateErrors,
    }),
  });
  if (gated.status === 'refused-admissibility') {
    stderr.write(`[warn] freeze: chain admissibility refused (informational; the freeze still ran). ${gated.refusal}\n`);
  }
  /** @type {import('../query/readiness.js').ReadinessResult} */
  const readiness = gated.status === 'refused-admissibility'
    ? computeReadiness(tree, {
      freeze: freezeForCompute, ledgers, profileText, testPointers, validateErrors,
    })
    : gated.payload;

  // The stages array already carries acknowledged states for any acked
  // gate at the current tree hash. Stamp the ack reasons onto the
  // matching stage entries so the freeze record and the summary block
  // carry the reason text.
  const stagesAfterAck = readiness.stages.map((stage) => {
    const reason = ackedReasons.get(stage.gate);
    if (!reason) return stage;
    return { ...stage, reason };
  });
  const freezeableAfterAck = stagesAfterAck.every(
    (s) => s.state === 'passed' || s.state === 'acknowledged' || s.state === 'notApplicable',
  );

  const preFreezeDelta = readiness.delta;

  if (!freezeableAfterAck) {
    printFailingBlock(stderr, stagesAfterAck);
    return 4;
  }

  // Build the freeze record body.
  const frozenAt = now().toISOString();
  // Sanity: the tree hash the readiness compute reports must match the
  // one we pre-computed. Never diverges in practice (both hash the
  // same live tree the same way); the assertion documents the
  // invariant for future maintainers.
  if (readiness.tree.currentTreeHash !== currentTreeHash) {
    stderr.write(`[error] freeze: internal invariant: tree hash mismatch between pre-compute and readiness (${currentTreeHash} vs ${readiness.tree.currentTreeHash})\n`);
    return 1;
  }
  const docHashes = computeDocHashes(tree, ledgers);
  const briefStatements = countBriefStatements(ledgers);
  const gates = buildGatesEntry(stagesAfterAck, currentTreeHash, frozenAt);
  const counts = deriveCounts(tree);
  const litmusAttested = parseLitmusAttested(flags['litmus-attested']);
  const litmus = { attestedAt: litmusAttested, readers: 0 };
  const versions = await readVersions(projectRoot);
  const note = typeof flags.note === 'string' ? flags.note : null;

  /** @type {Record<string, unknown>} */
  const record = {
    frozenAt,
    treeHash: currentTreeHash,
    docHashes,
    briefStatements,
    gates,
    counts,
    litmus,
    versions,
    note,
    override: null,
  };

  await saveFreezeRecord({ projectRoot, record: /** @type {any} */ (record) });

  const summary = formatSummary({
    firstFreeze: priorFreeze === null,
    currentTreeHash,
    preFreezeDelta,
    counts,
  });
  if (flags.json) {
    stdout.write(`${JSON.stringify({ record, summary, delta: preFreezeDelta }, null, 2)}\n`);
  } else {
    stdout.write(`${summary}\n`);
  }
  return 0;
}

/**
 * Print the failing-stage block: one line per failing stage, capped
 * at 20 ids per stage; a hint at the bottom naming the readiness
 * command for the operator to inspect further.
 *
 * @param {NodeJS.WritableStream} stderr
 * @param {import('../query/readiness.js').StageResult[]} stages
 */
function printFailingBlock(stderr, stages) {
  const failing = stages.filter((s) => s.state === 'failing');
  if (failing.length === 0) return;
  stderr.write('[error] freeze: refused; the following stage(s) are failing:\n');
  for (const s of failing) {
    const firstFailingCheck = s.checks.find((c) => !c.ok);
    const checkName = firstFailingCheck?.name ?? '(no check)';
    const ids = firstFailingCheck?.failing.slice(0, 20).map((f) => f.id) ?? [];
    stderr.write(`  ${s.stage} (${s.gate}): failing (${checkName}); failing ids: ${ids.join(', ') || '(none)'}\n`);
    const shortName = STAGE_SHORT_NAMES[s.stage] ?? s.stage;
    stderr.write(`    Run \`rcf define readiness --check ${shortName}\` to inspect.\n`);
  }
}

// ---------------------------------------------------------------------------
// Record-body helpers
// ---------------------------------------------------------------------------

/**
 * Recompute the docHashes map (standalone ids plus ledger:<name>
 * entries) to write into the freeze record. Matches the shape
 * computeDelta uses internally; the treeHash is already the whole
 * readiness result's currentTreeHash.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {import('../query/delta.js').LedgerBundle} ledgers
 * @returns {Record<string, string>}
 */
function computeDocHashes(tree, ledgers) {
  /** @type {Record<string, string>} */
  const out = {};
  const ids = tree.byId ? [...tree.byId.keys()].sort() : [];
  for (const id of ids) out[id] = hashDocument(tree.byId.get(id));
  for (const [name, body] of Object.entries(ledgers ?? {})) {
    if (body === undefined || body === null) continue;
    out[`ledger:${name}`] = hashDocument(body);
  }
  return out;
}

/**
 * Count of statements in the brief ledger (0 when absent).
 *
 * @param {import('../query/delta.js').LedgerBundle} ledgers
 * @returns {number}
 */
function countBriefStatements(ledgers) {
  const brief = /** @type {any} */ (ledgers?.brief);
  if (!brief || !Array.isArray(brief.statements)) return 0;
  return brief.statements.length;
}

/**
 * Return a freeze context that layers the requested acknowledgements
 * onto the prior freeze record's `gates` map at the current tree
 * hash. Consumed by `computeReadiness` so its foldState folds D3 / D5
 * / D6 to 'acknowledged' in the same pass. The returned object is a
 * shallow clone of the prior record with the gates map augmented; it
 * is used only for the compute and is not written to disk.
 *
 * When priorFreeze is null (first freeze), a stub `{ gates }` object
 * is returned. computeDelta still treats it as unfrozen (no
 * docHashes / no briefStatements), so the delta is the whole tree
 * exactly as it would be without the stub.
 *
 * @param {any} priorFreeze
 * @param {Map<string, string>} ackedReasons - gate id -> reason
 * @param {string} currentTreeHash
 * @returns {any}
 */
function mergeAckedGates(priorFreeze, ackedReasons, currentTreeHash) {
  const priorGates = /** @type {any} */ (priorFreeze?.gates) ?? {};
  /** @type {Record<string, any>} */
  const gates = { ...priorGates };
  for (const [gate, reason] of ackedReasons) {
    gates[gate] = {
      state: 'acknowledged',
      at: { hash: currentTreeHash, reason },
    };
  }
  if (priorFreeze === null || priorFreeze === undefined) {
    return { gates };
  }
  return { ...priorFreeze, gates };
}

/**
 * Assemble the freeze.gates map. Every stage in D1..D8 is recorded
 * so slice-5 viewer sees a consistent shape. Acknowledged stages
 * store their { hash, at, reason } stamp; passed / notApplicable
 * stages record their state with `at: null`.
 *
 * @param {import('../query/readiness.js').StageResult[]} stages
 * @param {string} currentTreeHash
 * @param {string} frozenAt
 * @returns {Record<string, { state: string, at: null | { hash: string, at: string, reason: string }, failing: Array<{ id: string, why: string }> }>}
 */
function buildGatesEntry(stages, currentTreeHash, frozenAt) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const stage of stages) {
    const failing = [];
    for (const check of stage.checks) {
      for (const f of check.failing) failing.push({ id: f.id, why: f.why });
    }
    if (stage.state === 'acknowledged') {
      out[stage.gate] = {
        state: 'acknowledged',
        at: {
          hash: currentTreeHash,
          at: frozenAt,
          reason: stage.reason ?? '(none)',
        },
        failing,
      };
    } else {
      out[stage.gate] = {
        state: stage.state,
        at: null,
        failing,
      };
    }
  }
  return out;
}

/**
 * Derive count aggregates from the walker tree. Counts:
 *   req / us / ac / acByClass / tac / interfaces (by kind) / adr / fbs
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Record<string, unknown>}
 */
function deriveCounts(tree) {
  const req = (tree.requirements ?? []).length;
  const userStories = tree.userStories ?? [];
  const us = userStories.length;
  let ac = 0;
  const acByClass = { happy: 0, edge: 0, failure: 0, mustNot: 0, nonFunctional: 0, unclassified: 0 };
  for (const story of userStories) {
    const list = Array.isArray(story?.acceptanceCriteria) ? story.acceptanceCriteria : [];
    ac += list.length;
    for (const acEntry of list) {
      const cls = parseAcClass(acEntry);
      switch (cls) {
        case 'happy': acByClass.happy += 1; break;
        case 'edge': acByClass.edge += 1; break;
        case 'failure': acByClass.failure += 1; break;
        case 'must-not': acByClass.mustNot += 1; break;
        case 'non-functional': acByClass.nonFunctional += 1; break;
        default: acByClass.unclassified += 1;
      }
    }
  }
  const tacs = tree.tacs ?? [];
  const tac = tacs.length;
  /** @type {Record<string, number>} */
  const interfaces = {};
  for (const t of tacs) {
    const list = Array.isArray(t?.interfaces) ? t.interfaces : [];
    for (const iface of list) {
      const kind = typeof iface?.kind === 'string' ? iface.kind : 'unknown';
      interfaces[kind] = (interfaces[kind] ?? 0) + 1;
    }
  }
  const adr = (tree.adrs ?? []).length;
  const fbs = (tree.fbsItems ?? []).length;
  return { req, us, ac, acByClass, tac, interfaces, adr, fbs };
}

/**
 * Parse the --litmus-attested comma-separated D-names.
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseLitmusAttested(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
}

/**
 * Read rcfLite, ruleset and schemas versions.
 *
 * rcfLite: packages/rcf-lite/package.json (this package). Located via
 * import.meta.url; falls back to '(unknown)' on any failure.
 * ruleset: src/ruleset/ruleset.json's rulesetVersion field when
 * present, else the rcfLite version (NV-BL-SR-02: ruleset version
 * follows the umbrella).
 * schemas: node_modules/@stravica-ai/rcf-schemas/package.json,
 * discovered via createRequire so the resolution obeys the working
 * project's node_modules.
 *
 * @param {string} projectRoot
 * @returns {Promise<{ rcfLite: string, ruleset: string, schemas: string }>}
 */
async function readVersions(projectRoot) {
  let rcfLite = '(unknown)';
  try {
    const pkgJson = await readFile(
      new URL('../../package.json', import.meta.url),
      'utf8',
    );
    const pkg = JSON.parse(pkgJson);
    if (typeof pkg.version === 'string') rcfLite = pkg.version;
  } catch { /* leave '(unknown)' */ }

  let ruleset = rcfLite;
  try {
    const rulesetJson = await readFile(
      new URL('../ruleset/ruleset.json', import.meta.url),
      'utf8',
    );
    const body = JSON.parse(rulesetJson);
    if (typeof body.rulesetVersion === 'string') ruleset = body.rulesetVersion;
  } catch { /* leave rcfLite */ }

  let schemas = '(unknown)';
  try {
    const req = createRequire(join(projectRoot, 'noop.js'));
    const schemasPkg = req('@stravica-ai/rcf-schemas/package.json');
    if (schemasPkg && typeof schemasPkg.version === 'string') schemas = schemasPkg.version;
  } catch {
    // Fall back to walking up from this module.
    try {
      const req = createRequire(import.meta.url);
      const schemasPkg = req('@stravica-ai/rcf-schemas/package.json');
      if (schemasPkg && typeof schemasPkg.version === 'string') schemas = schemasPkg.version;
    } catch { /* leave '(unknown)' */ }
  }
  return { rcfLite, ruleset, schemas };
}

/**
 * Read `rcf/.identity/profile.md` when it exists; null otherwise.
 * @param {string} projectRoot
 * @returns {Promise<string|null>}
 */
async function readProfileText(projectRoot) {
  try {
    return await readFile(join(projectRoot, 'rcf', '.identity', 'profile.md'), 'utf8');
  } catch { return null; }
}

/**
 * Compose the proposal §2.5 summary line.
 *
 * First freeze: "first freeze at <short>: <req> REQ, <us> stories,
 *                <ac> criteria, <interfaces> interfaces, <tac> TAC,
 *                <adr> ADR, <fbs> FBS."
 *
 * Incremental: "frozen at <short>: <n> REQ, <n> stories, <n> criteria,
 *               <n> interfaces added; <amended-ids> amended;
 *               <impactedFbs> re-execute."
 *
 * @param {object} args
 * @param {boolean} args.firstFreeze
 * @param {string} args.currentTreeHash
 * @param {import('../query/readiness.js').ReadinessDelta} args.preFreezeDelta
 * @param {Record<string, unknown>} args.counts
 * @returns {string}
 */
function formatSummary({
  firstFreeze, currentTreeHash, preFreezeDelta, counts,
}) {
  const shortH = shortHash(currentTreeHash);
  if (firstFreeze) {
    const ifaces = Object.values(/** @type {any} */ (counts.interfaces) ?? {})
      .reduce((a, b) => a + b, 0);
    return `first freeze at ${shortH}: ${counts.req ?? 0} REQ, ${counts.us ?? 0} stories, ${counts.ac ?? 0} criteria, ${ifaces} interfaces, ${counts.tac ?? 0} TAC, ${counts.adr ?? 0} ADR, ${counts.fbs ?? 0} FBS.`;
  }
  // Incremental: derive added-by-kind from delta.added ids (skipping
  // 'ledger:*' entries and ids the tree does not have a kind for).
  const addedByKind = { req: 0, us: 0, ac: 0, tac: 0, adr: 0, fbs: 0, interfaces: 0 };
  for (const id of preFreezeDelta.added) {
    if (id.startsWith('ledger:')) continue;
    if (id.startsWith('REQ-')) addedByKind.req += 1;
    else if (id.startsWith('US-')) addedByKind.us += 1;
    else if (id.startsWith('AC-')) addedByKind.ac += 1;
    else if (id.startsWith('TAC-')) addedByKind.tac += 1;
    else if (id.startsWith('ADR-')) addedByKind.adr += 1;
    else if (id.startsWith('FBS-')) addedByKind.fbs += 1;
  }
  // AC is inline under US; the proposal example counts criteria too.
  // We estimate criteria-added from the changed/added US: since inline
  // ACs ride inside the parent hash, standalone AC counts here are
  // usually zero unless the walker later exposes them. Keep the
  // proposal's four-kind sequence and treat interfaces-added as 0 for
  // now (interfaces ride inside TAC).
  const amended = preFreezeDelta.changed.filter((id) => !id.startsWith('ledger:'));
  const impactedFbsCount = preFreezeDelta.impactedFbs.length;
  return `frozen at ${shortH}: ${addedByKind.req} REQ, ${addedByKind.us} stories, ${addedByKind.ac} criteria, ${addedByKind.interfaces} interfaces added; ${amended.join(', ') || '(none)'} amended; ${impactedFbsCount} re-execute.`;
}

// Re-export the seams other modules use.
export { STAGE_GATES, STAGE_ORDER, STAGE_SHORT_NAMES, STAGE_ALIASES };

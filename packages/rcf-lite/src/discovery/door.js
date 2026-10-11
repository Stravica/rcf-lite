// The D0 define door (FBS-214, REQ-189, TAC-4142, ADR-4146).
//
// The three chain-write verbs that mint new structure guard on D0
// before any write: `rcf define ledger brief add`, `rcf define create`
// and `rcf define blueprint add`. The door reads the discovery context
// (journey.json; wireframes for a central product), runs
// `checkD0Discovery` and refuses with exit 4 when the stage is
// failing. Verbs that edit existing records (`update`, `delete`,
// `link`, `unlink`, resolve, list, readiness, questions, standards,
// design, decisions / concerns / probes ledger ops) are NOT gated
// (AC-18905-7).
//
// Exit code: 4 (same as a failing readiness --check). The message
// family: `[error] refused define: ...` naming the declared value,
// the failing check and the readiness command the operator runs to
// see the full picture (AC-18905-4). No other IO is done on refusal.
//
// Node built-ins only.

import { checkD0Discovery, STAGE_GATES } from '../query/gates.js';
import { loadDiscoveryContext } from './context.js';

/**
 * Check the D0 door for `projectRoot`. Returns `{ ok: true }` when the
 * stage is passed or notApplicable; writes a `[error] refused define`
 * message to `stderr` and returns `{ ok: false, exitCode: 4 }` when
 * the stage is failing.
 *
 * The caller runs this BEFORE any write. On refusal the tree is
 * byte-identical before and after the call (AC-18905-4).
 *
 * @param {object} args
 * @param {string} args.projectRoot   realpath of the project root
 * @param {NodeJS.WritableStream} args.stderr
 * @param {string} args.verb          short label for the error line (e.g. 'brief add', 'create', 'blueprint add')
 * @returns {Promise<{ ok: true } | { ok: false, exitCode: 4 }>}
 */
export async function checkD0Door({ projectRoot, stderr, verb }) {
  const discoveryContext = await loadDiscoveryContext({ projectRoot });
  const stage = checkD0Discovery({ discoveryContext });
  if (stage.state === 'passed' || stage.state === 'notApplicable') {
    return { ok: true };
  }
  // state === 'failing'. Build the refusal message. AC-18905-4 names
  // the declared value, the failing check, the failing ids and the
  // readiness check to run.
  const record = discoveryContext && discoveryContext.record ? discoveryContext.record : null;
  const declared = record && record.ui ? record.ui : 'null';
  const failingChecks = (stage.checks || []).filter((c) => !c.ok);
  const first = failingChecks[0];
  const checkName = first ? first.name : '(unknown)';
  const failingIds = first && Array.isArray(first.failing)
    ? first.failing.map((f) => f.id)
    : [];
  const idList = failingIds.length > 0 ? ` [${failingIds.join(', ')}]` : '';
  const allFailing = failingChecks.map((c) => c.name).join(', ');
  stderr.write(
    `[error] refused define: ${verb}: D0 (${STAGE_GATES.D0}) is failing on ${checkName}${idList} with ui declared ${declared}. `
    + `Resolve the D0 blockers (failing checks: ${allFailing}) with the discovery journey verbs (declare, add, import, review), `
    + `then re-run \`rcf define readiness --check discovery\`.\n`,
  );
  return { ok: false, exitCode: 4 };
}

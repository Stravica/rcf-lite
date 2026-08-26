// `rcf req-baseline <verb>` subcommand handler
// (elicitation-and-playbook-hardening-0.7.0-spec §5).
//
// Verbs (spec §5.4 / §13.3):
//   rcf req-baseline sweep [--req <id> | --all] [--dry-run] [--json] [--yes]
//   rcf req-baseline sweep --status [--json]
//   rcf req-baseline opt-out --req <id> --key <baselineKey> --reason "..." [--scope req|project]
//   rcf req-baseline opt-out --remove --req <id> --key <baselineKey>
//
// The sweep proposes any baseline AC not yet present on a US under the
// target REQ; the operator answers accept / opt-out / skip per candidate.
// Silence is refused: candidates left undecided stay OPEN, and Stage 1
// (rcf build --next) refuses any FBS binding an AC on a US that has
// open sweeps (spec §5.4 + §5.5 canonical text).
//
// Non-interactive callers (--yes accept-all, --dry-run preview) are
// legitimate; the moment-4 auto-enqueue path (spec §5.3) also produces
// OPEN candidates that this verb resolves.

import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';

import { walkTree } from '#core/store';

import { findProjectRoot } from '../view/index.js';
import {
  planSweep,
  applySweepDecisions,
  writeOptOut,
  removeOptOut,
  listOpenCandidates,
} from '../req-baseline/index.js';

const OPTION_SPEC = {
  req: { type: 'string' },
  all: { type: 'boolean' },
  key: { type: 'string' },
  reason: { type: 'string' },
  scope: { type: 'string' },
  remove: { type: 'boolean' },
  status: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  yes: { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf discover req-baseline <verb> [options]

Verbs:
  sweep [--req <id> | --all] [--status] [--dry-run] [--yes] [--json]
                             Walk every US under the target REQ (or all
                             classified REQs) and propose any baseline
                             ACs not yet present. Interactive by default
                             on a TTY; --yes accepts every candidate;
                             --dry-run prints the plan without writing.
                             --status prints the open-candidate list
                             (silence-refuses-build queue) without
                             prompting.

  opt-out --req <id> --key <baselineKey> --reason "..." [--scope req|project]
                             Record an operator ruling that removes a
                             baseline AC from the REQ (or the whole
                             project) and inherit the ruling on future
                             sweeps. Reason is at least 20 characters
                             (schema-enforced).

  opt-out --remove --req <id> --key <baselineKey>
                             Delete an existing opt-out; the next sweep
                             will re-propose the AC.

Options:
  --req <id>                 REQ to target
  --all                      Target every classified REQ in the tree
  --key <baselineKey>        Catalogue key (for example, auth.htmlLoginPage)
  --reason "..."             Operator ruling (at least 20 characters)
  --scope req|project        Opt-out scope; defaults to req
  --dry-run                  Preview only, do not write
  --yes                      Accept every proposed candidate (non-interactive)
  --status                   Show open-sweep candidates without prompting
  --json                     Emit machine-readable output
  --quiet                    Suppress non-error confirmations
  --help                     Print this help

Exit codes:
  0  success
  2  usage error (unknown flag, missing --req, no project root)
  3  validation failure on the written manifest
  4  refused (opt-out reason below the 20-character floor)
`;

/**
 * @param {string[]} argv
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    stderr.write(`[error] usage ${err.message}\n`);
    stderr.write(HELP);
    return 2;
  }
  const flags = parsed.values;
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(HELP); return 0; }
  if (positionals.length === 0) {
    stderr.write('[error] usage req-baseline: missing verb (sweep|opt-out)\n');
    stderr.write(HELP);
    return 2;
  }
  const verb = positionals[0];
  if (!['sweep', 'opt-out'].includes(verb)) {
    stderr.write(`[error] usage req-baseline: unknown verb ${verb} (expected sweep|opt-out)\n`);
    return 2;
  }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  const walkResult = await walkTree({ projectRoot });
  if (walkResult.errors.length > 0) {
    stderr.write(`[warn] tree has ${walkResult.errors.length} pre-existing issue(s); proceeding - writes are validated against the post-write state (run 'rcf validate' for details)\n`);
  }

  if (verb === 'sweep') {
    if (flags.status) {
      const open = listOpenCandidates(walkResult.tree, { reqId: flags.req ?? null });
      if (flags.json) {
        stdout.write(`${JSON.stringify(open, null, 2)}\n`);
        return 0;
      }
      if (open.length === 0) {
        stdout.write('no open baseline sweep candidates\n');
        return 0;
      }
      for (const item of open) {
        stdout.write(`${item.usId} (${item.reqId}) open: ${item.baselineKeys.join(', ')}\n`);
      }
      return 0;
    }

    if (!flags.req && !flags.all) {
      stderr.write('[error] usage req-baseline sweep: --req <id> or --all is required\n');
      return 2;
    }

    const plan = planSweep(walkResult.tree, { reqId: flags.req ?? null, all: Boolean(flags.all) });
    if (plan.candidates.length === 0) {
      if (!flags.quiet) stdout.write('no baseline candidates to propose\n');
      return 0;
    }

    if (flags['dry-run']) {
      if (flags.json) {
        stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      } else {
        for (const c of plan.candidates) {
          stdout.write(`[dry-run] would propose ${c.baselineKey} on ${c.usId} (${c.reqId})\n`);
        }
      }
      return 0;
    }

    // Resolve decisions.
    const decisions = [];
    if (flags.yes) {
      for (const c of plan.candidates) decisions.push({ candidate: c, action: 'accept' });
    } else {
      const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
      if (!isTty) {
        // Non-interactive with no --yes: leave every candidate OPEN. This
        // matches the moment-4 auto-enqueue posture (spec §5.3): a
        // baseline-blind US never silently ships; the operator must
        // resolve open sweeps before Stage 1 accepts an FBS binding it.
        if (!flags.quiet) stdout.write(`sweep left ${plan.candidates.length} candidate(s) OPEN (non-interactive; rerun with --yes to accept every candidate)\n`);
        return 0;
      }
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      for (const c of plan.candidates) {
        stdout.write(`\nREQ ${c.reqId} (${c.reqShape}) baseline for US ${c.usId}:\n`);
        stdout.write(`  ${c.baselineKey}: ${c.canonicalText}\n`);
        // eslint-disable-next-line no-await-in-loop
        const ans = (await rl.question('[a]ccept / [o]pt-out / [s]kip? ')).trim().toLowerCase();
        if (ans === 'a' || ans === 'accept') {
          decisions.push({ candidate: c, action: 'accept' });
        } else if (ans === 'o' || ans === 'opt-out') {
          // eslint-disable-next-line no-await-in-loop
          const reason = (await rl.question('reason (>= 20 chars): ')).trim();
          if (reason.length < 20) {
            stderr.write(`[error] refused opt-out: reason below 20-character floor for ${c.baselineKey}; leaving candidate OPEN\n`);
            continue;
          }
          decisions.push({ candidate: c, action: 'opt-out', reason });
        } else {
          // skip: leaves the candidate OPEN.
        }
      }
      rl.close();
    }

    const result = await applySweepDecisions({ projectRoot, tree: walkResult.tree, decisions });
    if (result && result.kind && typeof result.message === 'string') {
      stderr.write(`[error] ${result.kind} ${result.message}\n`);
      return 3;
    }
    if (flags.json) {
      stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    if (!flags.quiet) {
      stdout.write(`sweep: ${result.accepted} accepted, ${result.optedOut} opted out, ${result.left} left OPEN\n`);
    }
    return 0;
  }

  // verb === 'opt-out'
  if (flags.remove) {
    if (!flags.req || !flags.key) {
      stderr.write('[error] usage req-baseline opt-out --remove: --req and --key are required\n');
      return 2;
    }
    const result = await removeOptOut({ projectRoot, tree: walkResult.tree, reqId: flags.req, baselineKey: flags.key });
    if (result && result.kind && typeof result.message === 'string') {
      stderr.write(`[error] ${result.kind} ${result.message}\n`);
      return 3;
    }
    if (!flags.quiet) stdout.write(`opt-out removed for ${flags.req} ${flags.key}${result.removed ? '' : ' (no matching record found)'}\n`);
    return 0;
  }
  if (!flags.req || !flags.key || !flags.reason) {
    stderr.write('[error] usage req-baseline opt-out: --req, --key and --reason are required\n');
    return 2;
  }
  if (flags.reason.length < 20) {
    stderr.write(`[error] refused opt-out: --reason below 20-character floor (got ${flags.reason.length} chars); a one-word answer reads as silence, which is exactly what this ledger exists to prevent\n`);
    return 4;
  }
  const scope = flags.scope ?? 'req';
  if (!['req', 'project'].includes(scope)) {
    stderr.write(`[error] usage req-baseline opt-out: --scope must be req or project (got ${scope})\n`);
    return 2;
  }
  const result = await writeOptOut({
    projectRoot,
    tree: walkResult.tree,
    reqId: flags.req,
    baselineKey: flags.key,
    reason: flags.reason,
    scope,
  });
  if (result && result.kind && typeof result.message === 'string') {
    stderr.write(`[error] ${result.kind} ${result.message}\n`);
    return 3;
  }
  if (!flags.quiet) stdout.write(`opt-out ${result.id} recorded for ${flags.req} ${flags.key} (scope=${scope})\n`);
  return 0;
}

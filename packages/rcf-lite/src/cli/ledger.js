// `rcf define ledger <brief|decisions|concerns|probes> <add|resolve|list>`
// (REQ-173; proposal §8.2 v3).
//
// Sidecar-ledger CRUD. The intake-scan-against-frozen-statements part
// of `brief add --from <file>` is a seam here (slice 1 does not wire
// it): `rcf discover intake` is the intended caller in a later slice
// and the CLI exposes `--kind` and `--source` so a caller can feed
// them in. Exit codes match the rest of the CLI: 0 success, 2 usage
// error, 1 unexpected runtime failure.

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import {
  BRIEF_KINDS,
  LEDGER_NAMES,
  LedgerError,
  addEntry,
  isResolvedByGrammar,
  loadLedger,
  parseBriefFromFile,
  resolveEntry,
  saveLedger,
  updateEntry,
} from '../define/ledgers.js';
import { runIntakeScansOnDelta } from '../intake/orchestrator.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
  id: { type: 'string' },
  kind: { type: 'string' },
  text: { type: 'string' },
  from: { type: 'string' },
  source: { type: 'string' },
  reason: { type: 'string' },
  answer: { type: 'string' },
  question: { type: 'string' },
  option: { type: 'string', multiple: true },
  default: { type: 'string' },
  blocks: { type: 'string' },
  req: { type: 'string' },
  concern: { type: 'string' },
  disposition: { type: 'string' },
  finding: { type: 'string' },
  severity: { type: 'string' },
  scan: { type: 'boolean' },
  'no-scan': { type: 'boolean' },
  findings: { type: 'string' },
  'dry-run': { type: 'boolean' },
  'resolved-by': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf define ledger <name> <verb> [options]

Ledgers (proposal 2026-09-22 §2.5, §3.2 v3) are sidecars under
rcf/define/. Four ledgers, each one JSON file, each with one numbered
sequence for the life of the project.

Ledger names:
  brief                     D1 brief statements (kinded from a closed set)
  decisions                 D7 open / answered decisions (#241 format)
  concerns                  D5 (concern, REQ) pairs (applied | waived)
  probes                    D6 probe findings (severity: low | medium | high)

Verbs:
  add                       Append a new entry, next id
  update <id>               Patch named fields on an existing entry
  resolve <id>              Flip status to resolved, stamp resolvedAt
  list                      Print every entry (JSON with --json)

Common flags:
  --json                    Emit machine-readable envelope on list
  --help                    Print this help

brief add flags:
  --id <n>                  Optional positive integer. When set, the add
                            is idempotent by id (ruling R1 2026-10-05):
                            an entry at that id with identical content
                            exits 0 printing 'unchanged' (--json emits
                            {status:"unchanged",id:n}); different content
                            at the same id exits 3 naming the differing
                            fields; a free id is honoured as the override.
                            The harness carries --id back when it replays
                            a turn so the add is a no-op on replay.
  --kind <${BRIEF_KINDS.join('|')}>
                            Statement kind (default: capability)
  --text <text>             The statement text (mutually exclusive with --from)
  --from <path>             Read one statement per non-empty line from a file;
                            each line may carry [kind] and (source: ...) markers
  --source <span>           Default source span when a line has no marker
  --scan                    Run the intake scans over new statements against
                            existing ones (default on with --from, off with --text)
  --no-scan                 Skip scans
  --findings <path>         Harness-supplied findings JSON (same shape
                            rcf discover intake --input accepts). Each finding
                            becomes an openQuestion statement
  --dry-run                 Print the statements and findings that would be
                            minted; write nothing
  --json                    Emit { added[], findings[] } for scripting

decisions add flags:
  --question <text>         The decision question (required)
  --option <letter:text>    Repeatable option, format 'a:First option'
  --default <letter>        Default option letter
  --blocks <text>           What this decision blocks (a gate id, doc id)

concerns add flags:
  --req <req-id>            REQ the (concern, REQ) pair belongs to (required)
  --concern <slug>          Concern key (auth, retention, ...) (required)
  --disposition applied|waived
                            Disposition (required)
  --reason <text>           Reason (mandatory when disposition=waived)

probes add flags:
  --req <req-id>            REQ the probe finding sits on (required)
  --finding <text>          The finding text (required)
  --severity low|medium|high

resolve flags:
  --answer <text>           On decisions: the answer chosen (a letter, or free text)
  --reason <text>           On probes / concerns: the resolution note

update flags (any subset; validation runs as on add):
  brief:        --kind --text --source --resolved-by --blocks
  decisions:    --question --option --default --blocks
  concerns:     --concern --req --disposition --reason
  probes:       --req --finding --severity --reason
  --resolved-by must match the closed grammar:
    REQ-nnn | TAD.entity:<name> | PRD.user:<name>
    | TAD.system:<name> | TAC-nnnn | omitted:<reason>

Notes:
  - Every ledger file lives under rcf/define/. The loader treats missing
    files as empty ledgers; a malformed file is a hard error.
  - 'brief add --from <path>' parses one statement per line, supports
    the leading '[kind]' and trailing '(source: ...)' markers, mints
    statements, and (unless --no-scan) runs the mechanical intake scans
    over the new statements against existing ones, appending one
    openQuestion statement per finding with source 'scan:<kind>:<ids>'.
    See '--findings' for attested findings and '--dry-run' to preview
    without writing.
  - 'decisions list' prints the numbered format from #241: one decision
    per item; options with letters; the default; what it blocks.
`;

/**
 * @param {string[]} argv - argv slice after `ledger`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const cwd = deps.cwd ?? process.cwd();

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    stdout.write(HELP);
    return argv.length === 0 ? 2 : 0;
  }

  const name = argv[0];
  const verb = argv[1];
  if (!LEDGER_NAMES.includes(/** @type {any} */ (name))) {
    stderr.write(`[error] usage ledger: unknown name '${name}' (expected: ${LEDGER_NAMES.join(', ')})\n`);
    return 2;
  }
  if (!verb || !['add', 'update', 'resolve', 'list'].includes(verb)) {
    stderr.write("[error] usage ledger: expected verb 'add', 'update', 'resolve' or 'list'\n");
    return 2;
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv.slice(2), options: OPTION_SPEC, allowPositionals: true, strict: true,
    });
  } catch (err) {
    stderr.write(`[error] usage ${/** @type {Error} */ (err).message}\n`);
    return 2;
  }
  const flags = parsed.values;
  const positionals = parsed.positionals;
  if (flags.help) { stdout.write(HELP); return 0; }

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] usage no project root found (no rcf/manifest.json in this directory or any ancestor). Run `npx rcf init` to create and wire a project.\n');
    return 2;
  }

  try {
    if (verb === 'list') {
      return await runList({ projectRoot, name, flags, stdout });
    }
    if (verb === 'add') {
      return await runAdd({ projectRoot, name, flags, stdout, stderr });
    }
    if (verb === 'update') {
      return await runUpdate({ projectRoot, name, positionals, flags, stdout, stderr });
    }
    return await runResolve({ projectRoot, name, positionals, flags, stdout, stderr });
  } catch (err) {
    if (err instanceof LedgerError) {
      // Ruling R1 2026-10-05: a same-id-different-content refusal
      // exits 3 (not 1 and not 2) so a replaying harness can
      // distinguish 'you tried to overwrite a prior answer' from a
      // schema failure or a usage error. Update is the verb for that.
      if (err.code === 'conflict') {
        stderr.write(`[error] ledger: ${err.message}\n`);
        return 3;
      }
      stderr.write(`[error] ${err.code === 'usage' ? 'usage ' : ''}ledger: ${err.message}\n`);
      return err.code === 'usage' ? 2 : 1;
    }
    stderr.write(`[error] ledger: ${/** @type {Error} */ (err).message}\n`);
    return 1;
  }
}

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('../define/ledgers.js').LedgerName} args.name
 * @param {Record<string, unknown>} args.flags
 * @param {NodeJS.WriteStream} args.stdout
 * @returns {Promise<number>}
 */
async function runList({ projectRoot, name, flags, stdout }) {
  const body = await loadLedger({ projectRoot, name });
  if (flags.json) {
    stdout.write(`${JSON.stringify({ ledger: name, ...body }, null, 2)}\n`);
    return 0;
  }
  if (name === 'decisions') {
    stdout.write(renderDecisionsList(body));
    return 0;
  }
  stdout.write(renderGenericList(name, body));
  return 0;
}

/**
 * Render decisions in the numbered #241 format:
 *   1. <question>           [status]
 *      a) <option a>
 *      b) <option b>
 *      default: <letter>
 *      blocks: <text>
 *      answer: <text>       (when resolved)
 *
 * @param {Record<string, any>} body
 * @returns {string}
 */
export function renderDecisionsList(body) {
  const list = /** @type {any[]} */ (body.decisions ?? []);
  if (list.length === 0) return '(no decisions)\n';
  const lines = [];
  for (const d of list) {
    const status = d.status === 'resolved' ? 'resolved' : 'open';
    lines.push(`${d.id}. ${d.question}    [${status}]`);
    for (const opt of d.options ?? []) {
      lines.push(`   ${opt.letter}) ${opt.text}`);
    }
    if (d.default != null) lines.push(`   default: ${d.default}`);
    if (d.blocks) lines.push(`   blocks: ${d.blocks}`);
    if (status === 'resolved' && d.answer != null) lines.push(`   answer: ${d.answer}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * @param {import('../define/ledgers.js').LedgerName} name
 * @param {Record<string, any>} body
 * @returns {string}
 */
function renderGenericList(name, body) {
  const key = name === 'brief' ? 'statements' : name;
  const list = /** @type {any[]} */ (body[key] ?? []);
  if (list.length === 0) return `(no ${name} entries)\n`;
  const lines = [];
  for (const e of list) {
    const status = e.status === 'resolved' ? 'resolved' : 'open';
    if (name === 'brief') {
      lines.push(`${e.id}. [${e.kind}] ${e.text}    (${status})`);
      if (e.source) lines.push(`   source: ${e.source}`);
    } else if (name === 'concerns') {
      lines.push(`${e.id}. ${e.concern} on ${e.reqId}: ${e.disposition}    (${status})`);
      if (e.reason) lines.push(`   reason: ${e.reason}`);
    } else if (name === 'probes') {
      lines.push(`${e.id}. [${e.severity}] ${e.reqId}: ${e.finding}    (${status})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * @param {object} args
 */
async function runAdd({ projectRoot, name, flags, stdout, stderr }) {
  const body = await loadLedger({ projectRoot, name });
  const now = new Date().toISOString();

  // Ruling R1 2026-10-05: parse --id up front; a non-integer or negative
  // value is a usage error BEFORE loading / scanning the ledger.
  /** @type {number | undefined} */
  let idOverride;
  if (flags.id !== undefined) {
    const parsed = Number(flags.id);
    if (!Number.isInteger(parsed) || parsed < 1) {
      stderr.write(`[error] usage ledger: --id must be a positive integer, got '${flags.id}'\n`);
      return 2;
    }
    idOverride = parsed;
  }

  if (name === 'brief') {
    const kind = /** @type {string} */ (flags.kind ?? 'capability');
    if (!BRIEF_KINDS.includes(/** @type {any} */ (kind))) {
      stderr.write(`[error] usage ledger: brief --kind must be one of: ${BRIEF_KINDS.join(', ')}\n`);
      return 2;
    }
    if (flags.from && flags.text) {
      stderr.write('[error] usage ledger: brief add takes --text OR --from, not both\n');
      return 2;
    }
    if (!flags.from && !flags.text) {
      stderr.write('[error] usage ledger: brief add requires --text <text> or --from <path>\n');
      return 2;
    }
    if (idOverride !== undefined && flags.from) {
      // R1 identity is per entry; --from mints N entries, so --id has no
      // single target. Refuse the combination to keep the harness honest.
      stderr.write('[error] usage ledger: brief add --id applies to --text only (--from mints one entry per line and has no single id)\n');
      return 2;
    }
    if (flags['no-scan'] && flags.findings) {
      stderr.write('[error] usage ledger: brief add --no-scan and --findings cannot be combined\n');
      return 2;
    }
    // Scans default on with --from and off with --text (spec 2.2).
    const scansOn = flags['no-scan']
      ? false
      : (flags.scan ? true : Boolean(flags.from));

    let drafts;
    if (flags.from) {
      const raw = await readFile(String(flags.from), 'utf8');
      try {
        drafts = parseBriefFromFile(raw, {
          kind,
          source: flags.source ? String(flags.source) : String(flags.from),
        });
      } catch (err) {
        if (err instanceof LedgerError && err.code === 'usage') {
          stderr.write(`[error] usage ledger: ${err.message}\n`);
          return 2;
        }
        throw err;
      }
      if (drafts.length === 0) {
        stderr.write(`[error] usage ledger: brief --from ${flags.from} produced no non-empty lines\n`);
        return 2;
      }
    } else {
      const entry = { text: String(flags.text), kind };
      if (flags.source) entry.source = String(flags.source);
      drafts = [entry];
    }

    // Compute what WOULD be minted (for both the real path and dry-run).
    let cur = body;
    const added = [];
    /** @type {'added' | 'unchanged'} */
    let primaryStatus = 'added';
    for (const d of drafts) {
      // Only the single --text path reaches here with an idOverride (we
      // refused --id with --from above); a per-call idOverride is passed
      // on the first and only draft.
      const step = addEntry({
        name: 'brief', body: cur, entry: d, now,
        ...(idOverride !== undefined ? { id: idOverride } : {}),
      });
      cur = step.body;
      added.push(step.entry);
      if (step.status === 'unchanged') primaryStatus = 'unchanged';
    }

    // Ruling R1 2026-10-05 short-circuit: when --id landed on an entry
    // that already carried identical content, exit 0 with the unchanged
    // signal before any scan / finding work. A replayed turn is a no-op.
    if (primaryStatus === 'unchanged' && added.length === 1) {
      const existing = added[0];
      if (flags.json) {
        stdout.write(`${JSON.stringify({ status: 'unchanged', id: existing.id, entry: existing }, null, 2)}\n`);
      } else {
        stdout.write(`brief-ledger: unchanged ${existing.id}\n`);
      }
      return 0;
    }

    // Convert operator-supplied --findings into openQuestion statements.
    /** @type {Array<{ kind: string, text: string, source: string }>} */
    const findingStatements = [];
    if (flags.findings) {
      let findingsFile;
      try {
        findingsFile = JSON.parse(await readFile(String(flags.findings), 'utf8'));
      } catch (err) {
        stderr.write(`[error] usage ledger: brief add --findings: cannot read file: ${/** @type {Error} */ (err).message}\n`);
        return 2;
      }
      const findings = Array.isArray(findingsFile?.validationFindings)
        ? findingsFile.validationFindings
        : [];
      for (const f of findings) {
        if (typeof f?.kind !== 'string' || typeof f?.detail !== 'string') continue;
        findingStatements.push({
          kind: 'openQuestion',
          text: f.detail,
          source: `scan:${f.kind}`,
        });
      }
    }

    // Run mechanical scans (new against existing).
    if (scansOn) {
      const existing = /** @type {any[]} */ (body.statements ?? []);
      const scanResults = runIntakeScansOnDelta(added, existing);
      for (const r of scanResults) {
        findingStatements.push({
          kind: 'openQuestion',
          text: r.detail,
          source: `scan:${r.scanName}:${r.ids.join(',')}`,
        });
      }
    }

    // Mint the finding statements onto `cur` so they share the id space.
    const findingEntries = [];
    for (const fs of findingStatements) {
      const step = addEntry({ name: 'brief', body: cur, entry: fs, now });
      cur = step.body;
      findingEntries.push(step.entry);
    }

    if (flags['dry-run']) {
      if (flags.json) {
        stdout.write(`${JSON.stringify({ added, findings: findingEntries }, null, 2)}\n`);
      } else {
        stdout.write(`[dry-run] brief-ledger: would add ${added.length} statement(s), ids ${added.map((e) => e.id).join(', ') || '(none)'}\n`);
        if (findingEntries.length > 0) {
          stdout.write(`[dry-run] brief-ledger: would add ${findingEntries.length} openQuestion from findings, ids ${findingEntries.map((e) => e.id).join(', ')}\n`);
        }
      }
      return 0;
    }

    await saveLedger({ projectRoot, name: 'brief', body: cur });
    if (flags.json) {
      stdout.write(`${JSON.stringify({ added, findings: findingEntries }, null, 2)}\n`);
    } else {
      stdout.write(`brief-ledger: added ${added.length} statement(s), ids ${added.map((e) => e.id).join(', ')}`);
      if (findingEntries.length > 0) {
        stdout.write(`; added ${findingEntries.length} openQuestion from findings, ids ${findingEntries.map((e) => e.id).join(', ')}`);
      }
      stdout.write('\n');
    }
    return 0;
  }

  if (name === 'decisions') {
    if (!flags.question) {
      stderr.write('[error] usage ledger: decisions add requires --question <text>\n');
      return 2;
    }
    const options = parseOptionFlags(flags.option);
    if (options.error) {
      stderr.write(`[error] usage ledger: ${options.error}\n`);
      return 2;
    }
    const entry = {
      question: String(flags.question),
      options: options.value,
      default: flags.default ? String(flags.default) : null,
    };
    if (flags.blocks) entry.blocks = String(flags.blocks);
    const step = addEntry({
      name: 'decisions', body, entry, now,
      ...(idOverride !== undefined ? { id: idOverride } : {}),
    });
    if (step.status === 'unchanged') {
      if (flags.json) {
        stdout.write(`${JSON.stringify({ status: 'unchanged', id: step.entry.id, entry: step.entry }, null, 2)}\n`);
      } else {
        stdout.write(`decisions-ledger: unchanged ${step.entry.id}\n`);
      }
      return 0;
    }
    await saveLedger({ projectRoot, name: 'decisions', body: step.body });
    stdout.write(`decisions-ledger: added decision ${step.entry.id}\n`);
    return 0;
  }

  if (name === 'concerns') {
    if (!flags.req || !flags.concern || !flags.disposition) {
      stderr.write('[error] usage ledger: concerns add requires --req <req-id> --concern <slug> --disposition applied|waived\n');
      return 2;
    }
    if (flags.disposition === 'waived' && !flags.reason) {
      stderr.write('[error] usage ledger: concerns add --disposition waived requires --reason <text>\n');
      return 2;
    }
    const entry = {
      concern: String(flags.concern),
      reqId: String(flags.req),
      disposition: String(flags.disposition),
    };
    if (flags.reason) entry.reason = String(flags.reason);
    const step = addEntry({
      name: 'concerns', body, entry, now,
      ...(idOverride !== undefined ? { id: idOverride } : {}),
    });
    if (step.status === 'unchanged') {
      if (flags.json) {
        stdout.write(`${JSON.stringify({ status: 'unchanged', id: step.entry.id, entry: step.entry }, null, 2)}\n`);
      } else {
        stdout.write(`concern-ledger: unchanged ${step.entry.id}\n`);
      }
      return 0;
    }
    await saveLedger({ projectRoot, name: 'concerns', body: step.body });
    stdout.write(`concern-ledger: added concern ${step.entry.id}\n`);
    return 0;
  }

  // probes
  if (!flags.req || !flags.finding) {
    stderr.write('[error] usage ledger: probes add requires --req <req-id> --finding <text>\n');
    return 2;
  }
  const entry = {
    reqId: String(flags.req),
    finding: String(flags.finding),
    severity: flags.severity ? String(flags.severity) : 'medium',
  };
  const step = addEntry({
    name: 'probes', body, entry, now,
    ...(idOverride !== undefined ? { id: idOverride } : {}),
  });
  if (step.status === 'unchanged') {
    if (flags.json) {
      stdout.write(`${JSON.stringify({ status: 'unchanged', id: step.entry.id, entry: step.entry }, null, 2)}\n`);
    } else {
      stdout.write(`probe-ledger: unchanged ${step.entry.id}\n`);
    }
    return 0;
  }
  await saveLedger({ projectRoot, name: 'probes', body: step.body });
  stdout.write(`probe-ledger: added probe ${step.entry.id}\n`);
  return 0;
}

/**
 * `rcf define ledger <name> update <id>` subverb (REQ-173 amended,
 * US-17302). Field patches honour the same `add`-side validation.
 * `--resolved-by` on brief must match the closed pointer grammar; a
 * pointer outside the grammar refuses the write (exit 2).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('../define/ledgers.js').LedgerName} args.name
 * @param {string[]} args.positionals
 * @param {Record<string, unknown>} args.flags
 * @param {NodeJS.WriteStream} args.stdout
 * @param {NodeJS.WriteStream} args.stderr
 * @returns {Promise<number>}
 */
async function runUpdate({ projectRoot, name, positionals, flags, stdout, stderr }) {
  if (positionals.length !== 1) {
    stderr.write('[error] usage ledger: update expects exactly one <id>\n');
    return 2;
  }
  const id = Number(positionals[0]);
  if (!Number.isInteger(id) || id < 1) {
    stderr.write(`[error] usage ledger: update id must be a positive integer, got '${positionals[0]}'\n`);
    return 2;
  }

  // --resolved-by only lands on brief statements; the pointer grammar
  // is validated here (shape-only) BEFORE loading the ledger, so a
  // bad pointer never touches the file.
  if (flags['resolved-by'] !== undefined) {
    if (name !== 'brief') {
      stderr.write(`[error] usage ledger: --resolved-by applies to brief statements only\n`);
      return 2;
    }
    if (!isResolvedByGrammar(String(flags['resolved-by']))) {
      stderr.write(
        '[error] usage ledger: --resolved-by outside grammar (REQ-nnn | TAD.entity:<name> | PRD.user:<name> | TAD.system:<name> | TAC-nnnn | omitted:<reason>)\n',
      );
      return 2;
    }
  }

  const body = await loadLedger({ projectRoot, name });

  /** @type {Record<string, unknown>} */
  const patch = {};

  if (name === 'brief') {
    if (flags.kind !== undefined) {
      const kind = String(flags.kind);
      if (!BRIEF_KINDS.includes(/** @type {any} */ (kind))) {
        stderr.write(`[error] usage ledger: brief --kind must be one of: ${BRIEF_KINDS.join(', ')}\n`);
        return 2;
      }
      patch.kind = kind;
    }
    if (flags.text !== undefined) patch.text = String(flags.text);
    if (flags.source !== undefined) patch.source = String(flags.source);
    if (flags['resolved-by'] !== undefined) patch.resolvedBy = String(flags['resolved-by']);
    if (flags.blocks !== undefined) patch.blocks = String(flags.blocks);
  } else if (name === 'decisions') {
    if (flags.question !== undefined) patch.question = String(flags.question);
    if (flags.option !== undefined) {
      const parsedOpts = parseOptionFlags(flags.option);
      if (parsedOpts.error) {
        stderr.write(`[error] usage ledger: ${parsedOpts.error}\n`);
        return 2;
      }
      patch.options = parsedOpts.value;
    }
    if (flags.default !== undefined) patch.default = String(flags.default);
    if (flags.blocks !== undefined) patch.blocks = String(flags.blocks);
  } else if (name === 'concerns') {
    if (flags.concern !== undefined) patch.concern = String(flags.concern);
    if (flags.req !== undefined) patch.reqId = String(flags.req);
    if (flags.disposition !== undefined) patch.disposition = String(flags.disposition);
    if (flags.reason !== undefined) patch.reason = String(flags.reason);
  } else {
    // probes
    if (flags.req !== undefined) patch.reqId = String(flags.req);
    if (flags.finding !== undefined) patch.finding = String(flags.finding);
    if (flags.severity !== undefined) patch.severity = String(flags.severity);
    if (flags.reason !== undefined) patch.reason = String(flags.reason);
  }

  if (Object.keys(patch).length === 0) {
    stderr.write('[error] usage ledger: update needs at least one field flag to patch\n');
    return 2;
  }

  const step = updateEntry({ name, body, id, patch });
  await saveLedger({ projectRoot, name, body: step.body });
  stdout.write(`${name}-ledger: updated ${id}\n`);
  return 0;
}

async function runResolve({ projectRoot, name, positionals, flags, stdout, stderr }) {
  if (positionals.length !== 1) {
    stderr.write('[error] usage ledger: resolve expects exactly one <id>\n');
    return 2;
  }
  const id = Number(positionals[0]);
  if (!Number.isInteger(id) || id < 1) {
    stderr.write(`[error] usage ledger: resolve id must be a positive integer, got '${positionals[0]}'\n`);
    return 2;
  }
  const body = await loadLedger({ projectRoot, name });
  const now = new Date().toISOString();
  /** @type {Record<string, unknown>} */
  const patch = {};
  if (flags.answer) patch.answer = String(flags.answer);
  if (flags.reason) patch.reason = String(flags.reason);
  if (flags.answer) patch.answeredAt = now;
  const step = resolveEntry({ name, body, id, patch, now });
  await saveLedger({ projectRoot, name, body: step.body });
  stdout.write(`${name}-ledger: resolved ${id}\n`);
  return 0;
}

/**
 * Parse repeated `--option letter:text` into option records. Returns
 * `{ value }` on success or `{ error }` on any malformed input.
 *
 * @param {unknown} raw
 * @returns {{ value: Array<{ letter: string, text: string }> } | { error: string }}
 */
export function parseOptionFlags(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return { error: "decisions add requires at least one --option 'a:First option'" };
  }
  const value = [];
  for (const s of raw) {
    if (typeof s !== 'string') return { error: `--option value must be a string, got ${typeof s}` };
    const sep = s.indexOf(':');
    if (sep < 1) return { error: `--option must be 'letter:text', got '${s}'` };
    const letter = s.slice(0, sep).trim();
    const text = s.slice(sep + 1).trim();
    if (!letter || !text) return { error: `--option must be 'letter:text', got '${s}'` };
    value.push({ letter, text });
  }
  return { value };
}

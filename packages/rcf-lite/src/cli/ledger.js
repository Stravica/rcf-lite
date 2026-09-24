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
  loadLedger,
  parseBriefFromFile,
  resolveEntry,
  saveLedger,
} from '../define/ledgers.js';
import { findProjectRoot } from '../view/index.js';

const OPTION_SPEC = {
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
  resolve <id>              Flip status to resolved, stamp resolvedAt
  list                      Print every entry (JSON with --json)

Common flags:
  --json                    Emit machine-readable envelope on list
  --help                    Print this help

brief add flags:
  --kind <${BRIEF_KINDS.join('|')}>
                            Statement kind (default: capability)
  --text <text>             The statement text (mutually exclusive with --from)
  --from <path>             Read one statement per non-empty line from a file
  --source <span>           Optional source span label (file:line, URL, note)

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

Notes:
  - Every ledger file lives under rcf/define/. The loader treats missing
    files as empty ledgers; a malformed file is a hard error.
  - The 'brief add --from <path>' seam for running rcf discover intake
    against the frozen statements is wired in a later slice; this slice
    only splits by non-empty lines and mints ids.
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
  if (!verb || !['add', 'resolve', 'list'].includes(verb)) {
    stderr.write("[error] usage ledger: expected verb 'add', 'resolve' or 'list'\n");
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
    return await runResolve({ projectRoot, name, positionals, flags, stdout, stderr });
  } catch (err) {
    if (err instanceof LedgerError) {
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
    let drafts;
    if (flags.from) {
      const raw = await readFile(String(flags.from), 'utf8');
      drafts = parseBriefFromFile(raw, { kind, source: flags.source ? String(flags.source) : String(flags.from) });
      if (drafts.length === 0) {
        stderr.write(`[error] usage ledger: brief --from ${flags.from} produced no non-empty lines\n`);
        return 2;
      }
    } else {
      const entry = { text: String(flags.text), kind };
      if (flags.source) entry.source = String(flags.source);
      drafts = [entry];
    }
    // The intake-scan-against-frozen-statements seam: a later slice
    // calls the intake scans over drafts + the currently-frozen ledger
    // here. This slice mints ids and writes.
    let cur = body;
    const added = [];
    for (const d of drafts) {
      const step = addEntry({ name: 'brief', body: cur, entry: d, now });
      cur = step.body;
      added.push(step.entry);
    }
    await saveLedger({ projectRoot, name: 'brief', body: cur });
    stdout.write(`brief-ledger: added ${added.length} statement(s), ids ${added.map((e) => e.id).join(', ')}\n`);
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
    const step = addEntry({ name: 'decisions', body, entry, now });
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
    const step = addEntry({ name: 'concerns', body, entry, now });
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
  const step = addEntry({ name: 'probes', body, entry, now });
  await saveLedger({ projectRoot, name: 'probes', body: step.body });
  stdout.write(`probe-ledger: added probe ${step.entry.id}\n`);
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

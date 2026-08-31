// `rcf guidance [topic]` subcommand handler. Prints a guidance-pack
// document from the INSTALLED package to stdout, so the method is
// reachable from a consumer project on the CLI alone.
//
// Why this verb exists: the pack ships inside the package (package.json
// `files` includes `guidance`), but it is never copied into a consumer
// project. Guidance that pointed at a bare `guidance/<file>.md` path was
// therefore only reachable by someone sitting in the rcf-build-lite repo.
// MCP-wired harnesses reach the same content through `rcf://docs/<slug>`
// resources and the `rcf_*` prompts; this is the CLI-only route to it.
//
// Topics come from guidance/manifest.json - the same map the MCP layer
// reads - so there is one inventory and no duplication. Doc topics keep
// their manifest slug; prompt topics are addressed by filename minus
// extension (`build-cycle-playbook`, `elicitation-playbook`), which is
// the same slug convention.
//
// No project root is required: this reads the package, not the tree.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');
const GUIDANCE_DIR = join(PACKAGE_ROOT, 'guidance');

const OPTION_SPEC = {
  list: { type: 'boolean' },
  path: { type: 'boolean' },
  help: { type: 'boolean' },
};

export const HELP = `Usage: rcf guidance [topic] [options]

Print a guidance-pack document from the installed rcf-lite
package to stdout. The pack ships with the package and is never copied
into your project, so this verb is how a CLI-only agent reads the
method. MCP-wired harnesses can use the rcf://docs/<slug> resources and
the rcf_* prompts instead; the content is the same.

Topics (run 'rcf guidance' with no arguments to list them):
  overview                  What RCF is and the document hierarchy
  document-model            Document kinds, fields and relationships
  build-cycle               The 5-stage build cycle contract
  harness-template          The agent-instructions fragment rcf init writes
  build-cycle-playbook      Deep method: running the build cycle well
  elicitation-playbook      Deep method: drawing a valid tree out of a
                            conversation
  persona-programme         Persona programme: the tail-interview template

Platform-invariant printer (Track C+D):
  rcf guidance invariants   Print the platform invariants block from the
                            manifest (currently: never-skip-RCF).

Options:
  --list                    List the topics, one per line, and exit
  --path                    Print the file's absolute path instead of
                            its contents
  --help                    Print this help

Exit codes:
  0  success
  1  the pack could not be read from the installed package
  2  usage error (unknown topic, too many arguments)
`;

/**
 * Read the guidance manifest and flatten it into an ordered topic list.
 * Docs keep their manifest slug; prompts are addressed by filename
 * minus extension. Both resolve to a file inside guidance/.
 *
 * @param {string} [guidanceDir]
 * @returns {Promise<Array<{ slug: string, file: string, title: string }>>}
 */
export async function listTopics(guidanceDir = GUIDANCE_DIR) {
  const manifest = JSON.parse(await readFile(join(guidanceDir, 'manifest.json'), 'utf8'));
  const topics = [];
  for (const d of manifest.docs ?? []) {
    topics.push({ slug: d.slug, file: d.file, title: d.title });
  }
  // Note: Track C+D §8's `rcf guidance invariants` is deliberately NOT
  // registered as a listTopics entry. It is a virtual verb (no backing
  // file; it formats the platformInvariants[] array from the manifest),
  // handled by the `positionals[0] === 'invariants'` branch in main().
  // Listing it here would break the byte-faithful topic-serving contract
  // (topic → file bytes verbatim) that the pack-inventory tests lock.
  for (const p of manifest.prompts ?? []) {
    topics.push({
      slug: p.file.replace(/\.md$/, ''),
      file: p.file,
      title: p.description ?? p.name,
    });
  }
  return topics;
}

/**
 * @param {string[]} argv - argv slice after `guidance`
 * @param {object} [deps]
 * @returns {Promise<number>}
 */
export async function main(argv, deps = {}) {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const guidanceDir = deps.guidanceDir ?? GUIDANCE_DIR;

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
  if (positionals.length > 1) {
    stderr.write('[error] usage guidance: expected at most one <topic>\n');
    stderr.write(HELP);
    return 2;
  }

  let topics;
  try {
    topics = await listTopics(guidanceDir);
  } catch (err) {
    stderr.write(`[error] io guidance pack not readable at ${guidanceDir} (${err.message})\n`);
    return 1;
  }

  // No topic named: list what is available. Terse when --list, so the
  // output pipes cleanly; annotated otherwise, so a human sees titles.
  if (positionals.length === 0) {
    if (flags.list) {
      stdout.write(`${topics.map((t) => t.slug).join('\n')}\n`);
      return 0;
    }
    const width = Math.max(...topics.map((t) => t.slug.length));
    const lines = topics.map((t) => `  ${t.slug.padEnd(width)}  ${firstSentence(t.title)}`);
    stdout.write(`Guidance topics (rcf guidance <topic> prints one):\n${lines.join('\n')}\n`);
    return 0;
  }

  // Special virtual topic: `invariants` prints the platform-invariant
  // list from the manifest, not a guidance file. `--path` on this topic
  // resolves to the manifest itself.
  if (positionals[0] === 'invariants') {
    const manifestPath = join(guidanceDir, 'manifest.json');
    if (flags.path) {
      stdout.write(`${manifestPath}\n`);
      return 0;
    }
    let invariants;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      invariants = Array.isArray(manifest?.platformInvariants) ? manifest.platformInvariants : [];
    } catch (err) {
      stderr.write(`[error] io guidance invariants: ${err.message}\n`);
      return 1;
    }
    if (invariants.length === 0) {
      stdout.write('no platform invariants declared in this build\n');
      return 0;
    }
    const lines = [];
    lines.push('# Platform invariants');
    lines.push('');
    for (const [i, inv] of invariants.entries()) {
      lines.push(`## ${i + 1}. ${inv.title} (id: ${inv.id})`);
      lines.push('');
      lines.push(inv.text);
      lines.push('');
    }
    stdout.write(lines.join('\n'));
    return 0;
  }

  const topic = topics.find((t) => t.slug === positionals[0]);
  if (!topic) {
    stderr.write(`[error] usage guidance: no topic named '${positionals[0]}'. Known topics: ${topics.map((t) => t.slug).join(', ')}\n`);
    return 2;
  }
  const filePath = join(guidanceDir, topic.file);
  if (flags.path) {
    stdout.write(`${filePath}\n`);
    return 0;
  }
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    stderr.write(`[error] io guidance: ${topic.file} is mapped by the manifest but not readable (${err.message})\n`);
    return 1;
  }
  stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  return 0;
}

/** First sentence of a title/description, for the one-line topic list. */
function firstSentence(text) {
  const cut = String(text).split('. ')[0];
  return cut.length > 88 ? `${cut.slice(0, 85)}...` : cut;
}

// Preserve-operator-content contract (§2.7). --fix rewrites managed
// blocks WHOLESALE inside markers; every byte OUTSIDE the markers is
// preserved verbatim, including line endings, trailing whitespace, and
// operator sections on either side of the block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function freshInit(prefix = 'rcf-doc-preserve-') {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  const { code } = await runBin(tmp, ['init', '--project-name', 'PreserveTest', '--non-interactive']);
  assert.equal(code, 0);
  return tmp;
}

const BEGIN = '<!-- rcf:managed:begin -->';
const END = '<!-- rcf:managed:end -->';

function hashNonMarkerBytes(text) {
  // Everything outside the FIRST marker pair. If no markers present,
  // hash the whole thing.
  const beginAt = text.indexOf(BEGIN);
  const endAt = text.indexOf(END);
  if (beginAt < 0 || endAt < 0) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
  }
  const endIdxIncl = endAt + END.length + (text[endAt + END.length] === '\n' ? 1 : 0);
  const preamble = text.slice(0, beginAt);
  const trailer = text.slice(endIdxIncl);
  return createHash('sha256').update(preamble + trailer, 'utf8').digest('hex');
}

test('operator content before and after the block is byte-identical after --fix', async () => {
  const tmp = await freshInit();
  const original = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const augmented = `# Preamble\n\nProject rules the operator wrote.\n\n${original}\n\n## Trailer\n\nMore operator content, with  odd  spacing.\n`;
  await writeFile(join(tmp, 'CLAUDE.md'), augmented, 'utf8');
  const beforeHash = hashNonMarkerBytes(augmented);
  // Force stale inside the block.
  const withStaleBlock = augmented.replace('### RULE 1:', '### R1:');
  await writeFile(join(tmp, 'CLAUDE.md'), withStaleBlock, 'utf8');
  const { code } = await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  assert.equal(code, 0);
  const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const afterHash = hashNonMarkerBytes(after);
  assert.equal(afterHash, beforeHash, 'non-marker bytes changed');
  // The block content is restored to canonical.
  assert.match(after, /### RULE 1: Elicit first/);
});

test('idempotent no-op: --fix on already-clean state produces byte-identical filesystem', async () => {
  const tmp = await freshInit();
  const beforeClaude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const beforeAgents = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
  const beforeGitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  await runBin(tmp, ['doctor', '--fix']);
  await runBin(tmp, ['doctor', '--fix']);
  const afterClaude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const afterAgents = await readFile(join(tmp, 'AGENTS.md'), 'utf8');
  const afterGitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  assert.equal(afterClaude, beforeClaude);
  assert.equal(afterAgents, beforeAgents);
  assert.equal(afterGitignore, beforeGitignore);
});

test('CRLF line endings outside the block are preserved (no newline normalisation)', async () => {
  const tmp = await freshInit();
  const original = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  const crlfWrap = `# CRLF preamble\r\n\r\n${original}\r\n# CRLF trailer\r\n`;
  await writeFile(join(tmp, 'CLAUDE.md'), crlfWrap, 'utf8');
  // Force stale.
  const staled = crlfWrap.replace('### RULE 1:', '### RULE ONE:');
  await writeFile(join(tmp, 'CLAUDE.md'), staled, 'utf8');
  await runBin(tmp, ['doctor', '--fix', '--check', 'agent-instructions']);
  const after = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  assert.equal(after.startsWith('# CRLF preamble\r\n\r\n'), true, 'CRLF preamble preserved');
  assert.equal(/# CRLF trailer\r\n/.test(after), true, 'CRLF trailer preserved');
});

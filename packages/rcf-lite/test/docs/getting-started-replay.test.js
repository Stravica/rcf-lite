// Getting-started replay (Phase 8 §6.3). Replays the non-server command
// sequence of docs/getting-started.md in a temp dir, asserting exit
// codes and key output fragments, so the documented journey fails CI if
// the behaviour it narrates drifts (§D9 mechanical layer).
//
// SEQUENCE below mirrors the doc BY HAND (OQ-P8-6: mirrored constant,
// no markdown parsing) and is bound to the doc's numbered sections:
//   s2  = "2. Scaffold a project"
//   s4  = "4. Author the chain"
//   s5  = "5. Validate"
//   s6  = "6. Ask the traceability questions"
// Section 7 ("7. Drive the build loop") is not mirrored: its command
// sequence is parsed from the doc at runtime (the stage-keeper's ruling
// RC-24 on the round C DEFINE), each sh fenced block between the "## 7."
// heading and the next "## " heading in order, each with the plain fenced
// block that follows it as the output the doc shows.
// Section 3 (rcf view, long-running server) and section 8 (MCP) are
// excluded from CI replay per §6.4; they are manual-verification duty.
// If you edit the doc's commands in sections 2 to 6, edit SEQUENCE in the
// same PR.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { scratchDir } from '../_helpers/scratch.js';

const exec = promisify(execFile);
const bin = resolve(fileURLToPath(new URL('../..', import.meta.url)), 'bin', 'rcf.js');

const project = await scratchDir('rcf-gs-replay-');

async function rcf(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd: project, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

const SEQUENCE = {
  s2Init: ['init', '--non-interactive', '--project-name', 'Recipe Box'],
  // FBS-214: section 4 of docs/getting-started.md starts with a declare step.
  s4Declare: ['discover', 'journey', 'declare', '--ui', 'none'],
  s4Author: [
    ['define', 'update', 'PRD-001', '--set', 'problemStatement=Home cooks lose recipes across bookmarks, screenshots and notes apps.', '--set', 'objectives.0=Keep every recipe in one place and find it again by ingredient.'],
    ['define', 'update', 'REQ-001', '--set', 'title=Recipe capture', '--set', 'description=Users can save a recipe with a title, an ingredient list and a method.', '--set', 'domain=capture'],
    ['define', 'update', 'US-101', '--set', 'title=Save a recipe', '--set', 'asA=home cook', '--set', 'iWant=to save a recipe with its ingredients and method', '--set', 'soThat=I never lose it again', '--set', 'acceptanceCriteria.0.description=Saving a recipe with a title, at least one ingredient and a method succeeds'],
    ['define', 'create', 'req', '--parent', 'PRD-001', '--title', 'Recipe search'],
    ['define', 'update', 'REQ-002', '--set', 'description=Users can find saved recipes by ingredient.', '--set', 'domain=search'],
    ['define', 'create', 'us', '--parent', 'REQ-002', '--title', 'Find a recipe by ingredient'],
    ['define', 'update', 'US-201', '--set', 'asA=home cook', '--set', 'iWant=to search my recipes by ingredient', '--set', 'soThat=I can cook with what I already have', '--set', 'acceptanceCriteria.0.description=Searching for an ingredient lists every recipe that uses it'],
    ['define', 'create', 'ac', '--parent', 'US-201', '--description', 'Searching for an ingredient no recipe uses returns an empty list, not an error'],
  ],
  s4Read: ['define', 'read', 'US-201'],
  s4ReadField: ['define', 'read', 'REQ-002', '--field', 'title'],
  s4Tac: ['define', 'update', 'TAC-001', '--set', 'name=Search index', '--set', 'purpose=Maintain the ingredient-to-recipe index that search queries.', '--set', 'responsibilities.0=Index recipes by ingredient on save.'],
  s4Link: ['define', 'link', 'US-201', '--tac', 'TAC-001'],
  s4DeleteDryRun: ['define', 'delete', 'ADR-001', '--dry-run'],
  s4Delete: ['define', 'delete', 'ADR-001'],
  s5Validate: ['define', 'validate'],
  // REQ-164 (strict-by-default): the walkthrough shows both modes.
  // s6Coverage explores the shallow-any table on an intentionally-uncovered
  // scaffold (exit 0, gaps printed); s6CoverageStrict is the shipped default.
  s6Coverage: ['audit', 'coverage', '--mode', 'shallow-any'],
  s6TestLayer: [
    ['define', 'create', 'ts', '--parent', 'US-201', '--title', 'Ingredient search behaviour', '--purpose', 'Verify ingredient search returns complete and safe results.', '--test-level', 'integration', '--acs', 'AC-201-1,AC-201-2'],
    ['define', 'create', 'tc', '--parent', 'TS-001', '--ac', 'AC-201-1', '--slug', 'flour-search', '--description', 'Searching for flour lists every recipe that uses flour', '--test-pointer', 'test/search.test.js::flour search lists every matching recipe'],
    ['define', 'create', 'tc', '--parent', 'TS-001', '--ac', 'AC-201-2', '--slug', 'unknown-ingredient', '--description', 'Searching for dragon fruit returns an empty list', '--test-pointer', 'test/search.test.js::unknown ingredient returns an empty list'],
  ],
  s6CoverageStrict: ['audit', 'coverage', '--strict'],
  s6TraceBoth: ['audit', 'trace', 'US-201', '--both'],
  s6TraceBack: ['audit', 'trace', 'TC-001-flour-search', '--back'],
  s6Impact: ['audit', 'impact', 'TAC-001'],
  s6CoverageJson: ['audit', 'coverage', '--mode', 'shallow-any', '--format', 'json'],
};

// Section 7, parsed from docs/getting-started.md at runtime (RC-24).
const DOC = resolve(fileURLToPath(new URL('../..', import.meta.url)), 'docs', 'getting-started.md');

// Split one shell command line into words: single quotes literal, double
// quotes with backslash escapes, unquoted whitespace separating words.
function shellWords(line) {
  const words = [];
  let word = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'") {
      const end = line.indexOf("'", i + 1);
      assert.ok(end > i, `an unclosed single quote in: ${line}`);
      word = (word ?? '') + line.slice(i + 1, end);
      i = end;
    } else if (ch === '"') {
      let j = i + 1;
      let text = '';
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length) j += 1;
        text += line[j];
        j += 1;
      }
      assert.ok(j < line.length, `an unclosed double quote in: ${line}`);
      word = (word ?? '') + text;
      i = j;
    } else if (/\s/.test(ch)) {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? '') + ch;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

// The section's steps: each sh block's command lines (blank and # comment
// lines skipped) and the plain fenced block right after it, if any.
function sectionSevenSteps(markdown) {
  const all = markdown.split('\n');
  const start = all.findIndex((l) => /^## 7\. /.test(l));
  if (start < 0) return [];
  // The section ends at the next "## " heading outside a fenced block (an
  // output block may show a bundle's own "## " headings).
  const rest = all.slice(start + 1);
  let fenced = false;
  const stop = rest.findIndex((l) => {
    if (/^```/.test(l)) fenced = !fenced;
    return !fenced && /^## /.test(l);
  });
  const body = stop < 0 ? rest : rest.slice(0, stop);
  const blocks = [];
  for (let i = 0; i < body.length; i += 1) {
    const open = /^```(\S*)\s*$/.exec(body[i]);
    if (!open) continue;
    let j = i + 1;
    while (j < body.length && !/^```\s*$/.test(body[j])) j += 1;
    blocks.push({ lang: open[1], lines: body.slice(i + 1, j) });
    i = j;
  }
  const steps = [];
  blocks.forEach((b, k) => {
    if (b.lang !== 'sh') return;
    const next = blocks[k + 1];
    steps.push({
      commands: b.lines.map((l) => l.trim()).filter((l) => l && !l.startsWith('#')),
      output: next && next.lang === '' ? next.lines : null,
    });
  });
  return steps;
}

// ISO timestamps differ run to run; the doc shows one from its own run.
const stamp = (line) => line.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<timestamp>');

// Run one documented command line: rcf through the bin, `head -<n> <file>`
// read in the project; any other command is not replayable.
async function runDocCommand(line) {
  const [cmd, ...args] = shellWords(line);
  if (cmd === 'rcf') return rcf(args);
  if (cmd === 'head' && args.length === 2 && /^-\d+$/.test(args[0])) {
    try {
      const text = await readFile(join(project, args[1]), 'utf8');
      return { code: 0, stdout: `${text.split('\n').slice(0, Number(args[0].slice(1))).join('\n')}\n`, stderr: '' };
    } catch (err) {
      return { code: 1, stdout: '', stderr: `head: ${err.message}\n` };
    }
  }
  return { code: 127, stdout: '', stderr: `not a replayable command: ${line}\n` };
}

test('s2: rcf init scaffolds the project (exit 0)', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s2Init);
  assert.equal(code, 0);
  assert.match(stdout, /RCF project created\./);
  assert.match(stdout, /Document chain\s+scaffolded under rcf\//);
});

test('s4: declare the UI posture (section 4 preamble, exit 0)', async () => {
  // FBS-214 (AC-18905-9 + docs F7): the walkthrough now documents the
  // declare step at the top of section 4. We replay the exact command
  // the doc prints so a user following getting-started.md end to end
  // never hits the D0 door at "Author the chain".
  const { code, stderr } = await rcf(SEQUENCE.s4Declare);
  assert.equal(code, 0, `declare failed: ${stderr}`);
});

test('s4: the authoring sequence succeeds end to end (exit 0 each)', async () => {
  for (const args of SEQUENCE.s4Author) {
    const { code, stderr } = await rcf(args);
    assert.equal(code, 0, `rcf ${args.join(' ')} failed: ${stderr}`);
  }
});

test('s4: rcf read US-201 prints the authored story with both ACs', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s4Read);
  assert.equal(code, 0);
  const doc = JSON.parse(stdout);
  assert.equal(doc.title, 'Find a recipe by ingredient');
  assert.equal(doc.reqId, 'REQ-002');
  assert.deepEqual(doc.acceptanceCriteria.map((ac) => ac.id), ['AC-201-1', 'AC-201-2']);
});

test('s4: rcf read --field prints the single field', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s4ReadField);
  assert.equal(code, 0);
  assert.equal(stdout.trim(), '"Recipe search"');
});

test('s4: the TAC is authored and the story cross-links to it', async () => {
  assert.equal((await rcf(SEQUENCE.s4Tac)).code, 0);
  const { code, stdout } = await rcf(SEQUENCE.s4Link);
  assert.equal(code, 0);
  assert.match(stdout, /US-201 tacIds updated/);
});

test('s4: delete --dry-run plans, delete removes the placeholder ADR', async () => {
  const dry = await rcf(SEQUENCE.s4DeleteDryRun);
  assert.equal(dry.code, 0);
  assert.match(dry.stdout, /\(dry-run\)/);
  assert.match(dry.stdout, /would delete rcf\/adrs\/adr-001\.json/);
  const real = await rcf(SEQUENCE.s4Delete);
  assert.equal(real.code, 0);
  await assert.rejects(access(join(project, 'rcf', 'adrs', 'adr-001.json')));
});

test('s5: validate is clean (exit 0)', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s5Validate);
  assert.equal(code, 0);
  assert.match(stdout, /tree is clean/);
});

test('s5: a hand-broken reference fails validate with exit 3, restore is clean', async () => {
  const usPath = join(project, 'rcf', 'user-stories', 'us-201.json');
  const original = await readFile(usPath, 'utf8');
  await writeFile(usPath, original.replace('"reqId": "REQ-002"', '"reqId": "REQ-999"'));
  const broken = await rcf(SEQUENCE.s5Validate);
  assert.equal(broken.code, 3);
  assert.match(broken.stderr, /REQ-999/);
  await writeFile(usPath, original);
  assert.equal((await rcf(SEQUENCE.s5Validate)).code, 0);
});

test('s6: coverage reports zero covered before the test layer exists', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6Coverage);
  assert.equal(code, 0);
  assert.match(stdout, /Requirements: 2 {2}covered: 0 {2}covered-unresolved: 0 {2}uncovered: 2/);
});

test('s6: the TS/TC layer is created (exit 0 each), with the doc\'s test file written first', async () => {
  // The doc writes test/search.test.js before pointing test cases at it
  // (w-2026-07-28-005: coverage only counts a TC whose pointer resolves).
  await mkdir(join(project, 'test'), { recursive: true });
  await writeFile(join(project, 'test', 'search.test.js'), [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    "test('flour search lists every matching recipe', () => {});",
    "test('unknown ingredient returns an empty list', () => {});",
    '',
  ].join('\n'), 'utf8');
  for (const args of SEQUENCE.s6TestLayer) {
    const { code, stderr } = await rcf(args);
    assert.equal(code, 0, `rcf ${args.join(' ')} failed: ${stderr}`);
  }
});

test('s6: coverage now reports REQ-002 covered', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6Coverage);
  assert.equal(code, 0);
  assert.match(stdout, /Requirements: 2 {2}covered: 1 {2}covered-unresolved: 0 {2}uncovered: 1/);
  assert.match(stdout, /TC-001-flour-search/);
});

test('s6: a renamed test surfaces as unresolved per AC, and strict demotes the REQ to covered-unresolved', async () => {
  const testPath = join(project, 'test', 'search.test.js');
  const original = await readFile(testPath, 'utf8');
  await writeFile(testPath, original.replace('flour search lists every matching recipe', 'flour search finds recipes'));
  // Shallow-any: REQ-002 stays covered via its other resolving AC, but the
  // broken pointer is named at the AC level and in the footer.
  const shallow = await rcf(SEQUENCE.s6Coverage);
  assert.equal(shallow.code, 0);
  assert.match(shallow.stdout, /AC-201-1 {2}unresolved/);
  assert.match(shallow.stdout, /TC-001-flour-search\[unresolved\]/);
  assert.match(shallow.stdout, /test-missing/);
  // Strict: every AC must be covered by a resolving test, so the REQ drops
  // into the covered-unresolved column and the gate stays shut (exit 4).
  const strict = await rcf(SEQUENCE.s6CoverageStrict);
  assert.equal(strict.code, 4);
  assert.match(strict.stdout, /covered-unresolved: 1/);
  await writeFile(testPath, original);
  const restored = await rcf(SEQUENCE.s6Coverage);
  assert.match(restored.stdout, /covered: 1 {2}covered-unresolved: 0/);
});

test('s6: coverage --strict exits 4 while REQ-001 has a gap', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6CoverageStrict);
  assert.equal(code, 4);
  assert.match(stdout, /strict \(per-AC\)/);
});

test('s6: trace --both walks ancestors and descendants around the story', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6TraceBoth);
  assert.equal(code, 0);
  assert.match(stdout, /Trace pivot: US-201 {2}direction: both/);
  assert.match(stdout, /REQ-002/);
  assert.match(stdout, /TC-001-unknown-ingredient/);
});

test('s6: trace --back climbs from a test case to the PRD', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6TraceBack);
  assert.equal(code, 0);
  assert.match(stdout, /PRD-001/);
});

test('s6: impact labels the fan-out from the TAC', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6Impact);
  assert.equal(code, 0);
  assert.match(stdout, /review-arch/);
  assert.match(stdout, /re-run/);
});

test('s6: coverage --format json is machine-readable and agrees with the table', async () => {
  const { code, stdout } = await rcf(SEQUENCE.s6CoverageJson);
  assert.equal(code, 0);
  const report = JSON.parse(stdout);
  assert.equal(report.totals.requirements, 2);
  assert.equal(report.totals.covered, 1);
  assert.equal(report.totals.coveredUnresolved, 0);
});

test('s7: every command block of section 7 runs as docs/getting-started.md shows it', async () => {
  // Each sh block's commands run in order in the project sections 2 to 6
  // built. A block whose doc output carries an "[error] usage" line expects
  // its last command to exit 2, an "[error] refused" line exit 4, any other
  // "[error]" line a non-zero exit; every other command exits 0. Every
  // non-blank line of the doc output (timestamps aside) appears, in order,
  // among the lines the block's commands print on stdout and stderr.
  const steps = sectionSevenSteps(await readFile(DOC, 'utf8'));
  assert.ok(steps.length > 0, 'docs/getting-started.md has a "## 7." section with sh command blocks');
  for (const [k, step] of steps.entries()) {
    const shown = (step.output ?? []).map(stamp).filter((l) => l.trim());
    const error = shown.find((l) => l.startsWith('[error]'));
    const want = !error ? 0 : error.startsWith('[error] usage') ? 2 : error.startsWith('[error] refused') ? 4 : null;
    const printed = [];
    for (const [n, line] of step.commands.entries()) {
      const r = await runDocCommand(line);
      const last = n === step.commands.length - 1;
      const where = `section 7 block ${k + 1}, \`${line}\``;
      if (last && want === null) assert.notEqual(r.code, 0, `${where}: the doc shows an error, so it exits non-zero\n${r.stdout}${r.stderr}`);
      else assert.equal(r.code, last ? want : 0, `${where}: exit ${last ? want : 0}\n${r.stdout}${r.stderr}`);
      printed.push(...`${r.stdout}${r.stderr}`.split('\n').map(stamp));
    }
    let at = 0;
    for (const line of shown) {
      const found = printed.findIndex((p, i) => i >= at && p.trimEnd() === line.trimEnd());
      assert.ok(found >= 0, `section 7 block ${k + 1} (${step.commands.join(' && ')}): the doc shows "${line}"; printed:\n${printed.join('\n')}`);
      at = found + 1;
    }
  }
});

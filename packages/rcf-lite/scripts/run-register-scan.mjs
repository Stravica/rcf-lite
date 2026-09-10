#!/usr/bin/env node
// Register scan gate. Reads every file under the root blueprint shelf
// (`blueprints/`) and refuses any customer-register violation: internal
// operator names, work-item / dispatch / question ids, internal
// hostnames, internal decision references, and em-dashes.
//
// Word-boundary matching for the operator and host names so legitimate
// tokens (Bazel, Dex identity provider, dev-012, decision 10..29) do
// not false-positive. Case-insensitive on the operator / host / train
// name matchers so lowercase remnants (dave, baz, hq-estate) are hit.
//
// Exit 1 on any hit; prints `file:line:pattern:snippet` for each.
// Exit 2 on any unreadable file, missing shelf, non-directory shelf, or
// symlink under the shelf (symlinks are refused up front, and counted
// as part of the exit-2 message). Follows no symlinks; asserts the
// shelf holds exactly EXPECTED_BLUEPRINT_COUNT top-level directories so
// an empty (or truncated) shelf cannot silently pass. Update the
// constant when the shelf gains or drops a shipped blueprint (source of
// truth: the top-level `blueprints/` directory count on `origin/main`).
//
// Pass `--allow <file>` for a documented allow-list of paths (relative
// to the shelf root); prefer none. Set `--shelf <dir>` to point at a
// different shelf.

import { readFile, readdir, stat, lstat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const DEFAULT_SHELF = join(REPO_ROOT, 'blueprints');

// Source of truth: `ls -d blueprints/*/ | wc -l` on origin/main.
const EXPECTED_BLUEPRINT_COUNT = 39;

// Every entry is `{ name, test }` where `test` is `(line) => match[]`.
export const REGISTER_PATTERNS = [
  regex('Baz', /\bBaz\b/gi),
  regex('Dave', /\bDave\b/gi),
  regex('Dex', /\bDex\b/gi),
  regex('HQ', /\bHQ\b/gi),
  regex('hq-estate', /\bhq-estate\b/gi),
  regex('ops-01', /\bops-01\b/gi),
  regex('dev-01', /\bdev-01\b/gi),
  regex('smarthome', /\bsmarthome[a-z0-9-]*/gi),
  regex('thefootonline', /\bthefootonline[a-z0-9.-]*/gi),
  regex('work-item-id', /\bw-2026-[0-9]{2}-[0-9]{2}-[a-z0-9-]+/g),
  regex('dispatch-id', /\bd-2026-[0-9]{2}-[0-9]{2}-[0-9]{3}\b/g),
  regex('question-id', /\bq-2026-[0-9]{2}-[0-9]{2}-[0-9]{3}\b/g),
  regex('hardening-label', /\bH-[234]\b/g),
  regex('train-label', /\bT-[0-9]+\b/g),
  regex('decision-1-or-2', /\bdecision [12]\b/g),
  regex('Stravica-internal', /Stravica-internal/gi),
  regex('em-dash-U+2014', /—/g),
  regex(
    'train-family',
    /\bB[0-7][a-z]?[- ](platform|persistence|edge|deploy|messaging|storage|observability|security|application|delivery|jobs|email|core|tail|charts|hardening|review|pass)\b/gi
  ),
];

function regex(name, re) {
  return {
    name,
    test(line) {
      const hits = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        hits.push({ col: m.index + 1, match: m[0] });
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
      return hits;
    },
  };
}

async function walk(dir, symlinks, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) {
      symlinks.push(p);
      continue;
    }
    if (e.isDirectory()) {
      await walk(p, symlinks, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = { shelf: DEFAULT_SHELF, allow: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--allow') {
      const list = argv[++i];
      if (list) args.allow.push(...list.split(','));
    } else if (a === '--shelf') {
      args.shelf = resolve(argv[++i]);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let shelfStat;
  try {
    shelfStat = await lstat(args.shelf);
  } catch (err) {
    console.error(`[register-scan] shelf not found: ${args.shelf}`);
    process.exit(2);
  }
  if (shelfStat.isSymbolicLink()) {
    console.error(`[register-scan] shelf is a symlink; refusing to follow: ${args.shelf}`);
    process.exit(2);
  }
  if (!shelfStat.isDirectory()) {
    console.error(`[register-scan] shelf is not a directory: ${args.shelf}`);
    process.exit(2);
  }

  // Non-empty shelf assertion.
  const topEntries = await readdir(args.shelf, { withFileTypes: true });
  const topDirs = topEntries.filter((e) => e.isDirectory());
  if (topDirs.length !== EXPECTED_BLUEPRINT_COUNT) {
    console.error(
      `[register-scan] shelf has ${topDirs.length} top-level blueprint directories; expected exactly ${EXPECTED_BLUEPRINT_COUNT} (update EXPECTED_BLUEPRINT_COUNT when the shelf gains or drops a shipped blueprint).`
    );
    process.exit(2);
  }

  const symlinks = [];
  const files = (await walk(args.shelf, symlinks)).sort();
  if (symlinks.length > 0) {
    for (const s of symlinks) {
      console.error(`[register-scan] symlink encountered (refused): ${relative(args.shelf, s)}`);
    }
    console.error(`[register-scan] ${symlinks.length} symlink(s) under shelf; refusing to follow.`);
    process.exit(2);
  }
  const allow = new Set(args.allow);
  let hits = 0;
  const perPattern = new Map();
  const perSlug = new Map();
  for (const file of files) {
    const rel = relative(args.shelf, file);
    if (allow.has(rel)) continue;
    if (/\.(png|jpg|jpeg|gif|pdf|zip|ico|webp|woff2?)$/i.test(rel)) continue;
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch (err) {
      console.error(`[register-scan] unreadable file: ${rel}: ${err && err.code ? err.code : err}`);
      process.exit(2);
    }
    const lines = content.split(/\r?\n/);
    const slug = rel.split('/')[0];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      for (const p of REGISTER_PATTERNS) {
        const matches = p.test(line);
        if (matches.length === 0) continue;
        for (const m of matches) {
          console.log(`${rel}:${i + 1}:${p.name}:${m.match}`);
          hits += 1;
          perPattern.set(p.name, (perPattern.get(p.name) || 0) + 1);
          perSlug.set(slug, (perSlug.get(slug) || 0) + 1);
        }
      }
    }
  }
  console.log(
    `[register-scan] totals: hits=${hits}, files=${files.length}, slugs=${perSlug.size}, shelf=${args.shelf}, expectedBlueprints=${EXPECTED_BLUEPRINT_COUNT}`
  );
  if (hits > 0) {
    for (const [name, n] of [...perPattern.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[register-scan]   pattern ${name}: ${n}`);
    }
    for (const [slug, n] of [...perSlug.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`[register-scan]   slug ${slug}: ${n}`);
    }
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});

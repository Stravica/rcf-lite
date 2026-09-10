#!/usr/bin/env node
// Register scan gate. Reads every file under the root blueprint shelf
// (`blueprints/`) and refuses any customer-register violation: internal
// operator names, work-item / dispatch / question ids, internal
// hostnames, internal decision references, and em-dashes.
//
// Exit 1 on any hit; prints `file:line:pattern:snippet` for each.
// Pass `--allow <file>` for a documented allow-list of paths (relative
// to the shelf root); prefer none. Set `--shelf <dir>` to point at a
// different shelf.

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '..', '..');
const DEFAULT_SHELF = join(REPO_ROOT, 'blueprints');

// Case-sensitive substrings unless a pattern is declared as a RegExp.
// Every entry is `{ name, test }` where `test` is `(line) => match[]`.
export const REGISTER_PATTERNS = [
  substring('Baz'),
  substring('Dave'),
  substring('Dex'),
  substring('HQ'),
  substring('ops-01'),
  substring('dev-01'),
  substring('smarthome'),
  substring('thefootonline'),
  regex('work-item-id', /w-2026-[0-9]{2}-[0-9]{2}(?:-[a-z]+)?-[0-9]{3}/g),
  regex('dispatch-id', /d-2026-[0-9]{2}-[0-9]{2}-[0-9]{3}/g),
  regex('question-id', /q-2026-[0-9]{2}-[0-9]{2}-[0-9]{3}/g),
  regex('hardening-label', /\bH-[0-9]+\b/g),
  regex('train-label', /\bT-[0-9]+\b/g),
  substring('decision 1'),
  substring('decision 2'),
  substring('Stravica-internal'),
  regex('em-dash-U+2014', /—/g),
  regex('train-family', /\bB[0-7][a-z]?[- ](platform|persistence|edge|deploy|messaging|storage|observability|security|application|delivery|jobs|email|core|tail|charts|hardening|review)\b/gi),
];

function substring(needle) {
  return {
    name: needle,
    test(line) {
      const hits = [];
      let idx = 0;
      while ((idx = line.indexOf(needle, idx)) !== -1) {
        hits.push({ col: idx + 1, match: needle });
        idx += needle.length;
      }
      return hits;
    },
  };
}

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

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(p, out);
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
    shelfStat = await stat(args.shelf);
  } catch (err) {
    console.error(`[register-scan] shelf not found: ${args.shelf}`);
    process.exit(2);
  }
  if (!shelfStat.isDirectory()) {
    console.error(`[register-scan] shelf is not a directory: ${args.shelf}`);
    process.exit(2);
  }

  const files = (await walk(args.shelf)).sort();
  const allow = new Set(args.allow);
  let hits = 0;
  const perPattern = new Map();
  const perSlug = new Map();
  for (const file of files) {
    const rel = relative(args.shelf, file);
    if (allow.has(rel)) continue;
    // Skip binary media if any (blueprints ship text/markdown/json; be safe).
    if (/\.(png|jpg|jpeg|gif|pdf|zip|ico|webp|woff2?)$/i.test(rel)) continue;
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue;
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
  console.log(`[register-scan] totals: hits=${hits}, files=${files.length}, slugs=${perSlug.size}, shelf=${args.shelf}`);
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

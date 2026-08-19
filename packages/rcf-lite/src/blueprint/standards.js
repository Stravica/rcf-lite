// Standards-pack registration. Reference-by-default when the source
// lives inside the project root; copy into rcf/standards/<slug>/ only
// when the source lives outside.
//
// Manifest registration is authoritative (design-brief.md v2 §Corporate
// standards and personal patterns).

import { cp, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { updateManifest } from './manifest-writer.js';

const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.sourcePath - the standards folder path (absolute or repo-relative)
 * @param {string} args.slug
 * @param {string[]} args.tags
 * @param {'standard' | 'agent' | 'none'} args.testsProvidedBy
 * @param {'personal' | 'corporate'} args.provenance
 * @param {string} [args.summary]
 * @param {boolean} [args.dryRun]
 * @returns {Promise<{
 *   registered: boolean,
 *   entry: object,
 *   copied: boolean,
 *   copyPath?: string,
 *   alreadyRegistered?: boolean
 * } | import('../core/errors/index.js').RcfError>}
 */
export async function registerStandardsPack({
  projectRoot, tree, sourcePath, slug, tags, testsProvidedBy, provenance, summary, dryRun = false,
}) {
  if (!SLUG_PATTERN.test(slug)) {
    return rcfError({ kind: 'usage', message: `standards add: slug '${slug}' is not a valid kebab slug` });
  }
  if (!['standard', 'agent', 'none'].includes(testsProvidedBy)) {
    return rcfError({ kind: 'usage', message: `standards add: testsProvidedBy must be one of standard|agent|none` });
  }
  if (!['personal', 'corporate'].includes(provenance)) {
    return rcfError({ kind: 'usage', message: `standards add: provenance must be one of personal|corporate` });
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    return rcfError({ kind: 'usage', message: `standards add: at least one tag is required` });
  }

  const abs = resolve(sourcePath);
  try { await stat(abs); }
  catch (err) {
    return rcfError({ kind: 'missingFile', message: `standards add: source path does not exist: ${abs}`, filePath: abs });
  }

  const projectAbs = resolve(projectRoot);
  const rel = relative(projectAbs, abs);
  const isInsideRoot = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);

  let entry;
  let copied = false;
  let copyPath;
  if (isInsideRoot) {
    entry = {
      id: `std-${slug}`,
      slug,
      sourcePath: rel.split('\\').join('/'),
      tags,
      ...(summary ? { summary } : {}),
      testsProvidedBy,
      provenance,
    };
  } else {
    copyPath = `rcf/standards/${slug}`;
    const absCopy = join(projectRoot, copyPath);
    if (!dryRun) {
      try {
        await cp(abs, absCopy, { recursive: true, force: true });
        copied = true;
      } catch (err) {
        return rcfError({ kind: 'ioFailure', message: `standards add: copy failed: ${err.message}`, filePath: absCopy });
      }
    } else {
      copied = true; // reported to caller so dry-run output is coherent
    }
    entry = {
      id: `std-${slug}`,
      slug,
      sourcePath: abs,
      copyPath,
      tags,
      ...(summary ? { summary } : {}),
      testsProvidedBy,
      provenance,
    };
  }

  const existing = (tree.manifest?.standards ?? []).find((s) => s.slug === slug);
  const alreadyRegistered = existing && JSON.stringify(existing) === JSON.stringify(entry);
  if (alreadyRegistered) {
    // Short-circuit before rewriting the manifest -- mirrors
    // applyBlueprint's `alreadyApplied` fast-path (apply.js). Re-writing
    // the same bytes churns the manifest's mtime and forces every
    // consumer that watches it to re-load, so a truly idempotent call
    // stays a no-op end-to-end.
    return {
      registered: false,
      alreadyRegistered: true,
      entry,
      copied,
      ...(copyPath ? { copyPath } : {}),
    };
  }
  const manifestResult = await updateManifest({
    projectRoot,
    manifest: tree.manifest,
    mutate: (next) => {
      const list = Array.isArray(next.standards) ? next.standards : [];
      const filtered = list.filter((s) => s.slug !== slug);
      filtered.push(entry);
      next.standards = filtered;
    },
    dryRun,
  });
  if (manifestResult.kind) return manifestResult;

  return {
    registered: true,
    alreadyRegistered: false,
    entry,
    copied,
    ...(copyPath ? { copyPath } : {}),
  };
}

/**
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {object[]}
 */
export function listStandards(tree) {
  const list = tree.manifest?.standards ?? [];
  return [...list];
}

function isAbsolute(p) {
  return p.startsWith('/') || /^[A-Za-z]:/.test(p);
}

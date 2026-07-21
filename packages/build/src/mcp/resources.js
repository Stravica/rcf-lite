// MCP resources (Phase 7 §D15 / D15-A). Three URI forms over a fresh
// walk per call (D14):
//
//   rcf://tree         - project index: {id, kind, title, filePath} per doc
//   rcf://doc/<id>     - one resource per document id, incl. inline AC / TC
//   rcf://docs/<slug>  - static methodology docs from the Phase 7.5
//                        guidance pack, wired through guidance/manifest.json
//                        (the pack owns content; this file serves bytes)
//
// No subscriptions, no listChanged, no resource templates (spec §7).
// resources/list returns everything in one page; a cursor param is
// accepted and ignored. Unknown URIs are the MCP resources protocol
// error -32002.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JsonRpcError, RESOURCE_NOT_FOUND } from './server.js';
import { walkTree } from '../store/index.js';
import { pathForId } from '../store/loader.js';

const here = dirname(fileURLToPath(import.meta.url));
/** The guidance pack ships with the server install, not the served project. */
export const GUIDANCE_DIR = resolve(here, '..', '..', 'guidance');

const TREE_URI = 'rcf://tree';
const DOC_PREFIX = 'rcf://doc/';
const DOCS_PREFIX = 'rcf://docs/';

/**
 * Read and parse guidance/manifest.json - the Phase 7.5 contract file
 * (OQ-P7.5-1). Read per call: cheap, and the manifest is the single
 * source of truth for what is served (pack D2 deliberately excludes
 * README.md and manifest.json itself).
 *
 * @param {string} guidanceDir
 * @returns {Promise<{docs: Array<{slug: string, file: string, title: string}>, prompts: Array<object>}>}
 */
export async function readGuidanceManifest(guidanceDir) {
  const raw = await readFile(join(guidanceDir, 'manifest.json'), 'utf8');
  return JSON.parse(raw);
}

/**
 * Best-effort display title for a document. Kinds carry different
 * naming fields; inline AC / TC entries carry only a description.
 *
 * @param {object} doc
 * @returns {string | null}
 */
function titleOf(doc) {
  if (!doc || typeof doc !== 'object') return null;
  return doc.title ?? doc.name ?? doc.productName ?? doc.description ?? null;
}

/**
 * Relative file path for a document id; inline AC / TC ids resolve to
 * their parent's file.
 *
 * @param {import('../store/walker.js').TreeModel} tree
 * @param {string} id
 * @returns {string | null}
 */
function filePathFor(tree, id) {
  const resolved = pathForId(id);
  if (resolved) return `rcf/${resolved.relPath}`;
  const parentId = tree.parentByChild.get(id);
  if (!parentId) return null;
  const parentResolved = pathForId(parentId);
  return parentResolved ? `rcf/${parentResolved.relPath}` : null;
}

/**
 * Enumerate every document id in the tree: standalone docs (byId) plus
 * inline AC / TC ids (parentByChild keys not present in byId).
 *
 * @param {import('../store/walker.js').TreeModel} tree
 * @returns {Array<{id: string, kind: string, doc: object | null}>}
 */
function enumerateDocuments(tree) {
  const out = [];
  for (const [id, doc] of tree.byId.entries()) {
    out.push({ id, kind: tree.kindById.get(id) ?? 'unknown', doc });
  }
  for (const id of tree.parentByChild.keys()) {
    if (tree.byId.has(id)) continue;
    const kind = id.startsWith('AC-') ? 'ac' : id.startsWith('TC-') ? 'tc' : 'unknown';
    out.push({ id, kind, doc: resolveInlineDoc(tree, id) });
  }
  return out;
}

function resolveInlineDoc(tree, id) {
  const parentId = tree.parentByChild.get(id);
  if (!parentId) return null;
  const parent = tree.byId.get(parentId);
  if (!parent) return null;
  const entries = id.startsWith('AC-') ? parent.acceptanceCriteria : parent.testCases;
  return (entries ?? []).find((e) => e.id === id) ?? null;
}

/**
 * Create the resource registry bound to one project root.
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} [opts.guidanceDir]
 * @returns {{list: () => Promise<object>, read: (uri: string) => Promise<object>}}
 */
export function createResourceRegistry({ projectRoot, guidanceDir = GUIDANCE_DIR }) {
  async function buildTreeIndex() {
    const { tree } = await walkTree({ projectRoot });
    return {
      tree,
      index: {
        project: tree.manifest?.projectName ?? null,
        documents: enumerateDocuments(tree).map(({ id, kind, doc }) => ({
          id,
          kind,
          title: titleOf(doc),
          filePath: filePathFor(tree, id),
        })),
      },
    };
  }

  async function list() {
    // A broken tree does not block resources: the walker tolerates
    // per-document failures and this surface serves what loaded -
    // rcf_validate is the diagnosis channel (D18 posture).
    const { tree, index } = await buildTreeIndex();
    const manifest = await readGuidanceManifest(guidanceDir);
    const resources = [
      {
        uri: TREE_URI,
        name: 'tree',
        title: index.project ? `${index.project} document index` : 'RCF document index',
        description: 'Project document index: id, kind, title and file path per document, from a fresh tree walk.',
        mimeType: 'application/json',
      },
      ...enumerateDocuments(tree).map(({ id, kind, doc }) => ({
        uri: `${DOC_PREFIX}${id}`,
        name: id,
        ...(titleOf(doc) ? { title: `${id}: ${titleOf(doc)}` } : {}),
        description: `RCF ${kind} document ${id}`,
        mimeType: 'application/json',
      })),
      ...manifest.docs.map((d) => ({
        uri: `${DOCS_PREFIX}${d.slug}`,
        name: d.slug,
        title: d.title,
        description: `RCF methodology: ${d.title}. Canonical web reference: https://stravica.ai/rcf-methodology/`,
        mimeType: 'text/markdown',
      })),
    ];
    return { resources };
  }

  async function read(uri) {
    if (typeof uri !== 'string' || uri.length === 0) {
      throw new JsonRpcError(RESOURCE_NOT_FOUND, 'Resource not found', { uri });
    }
    if (uri === TREE_URI) {
      const { index } = await buildTreeIndex();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(index, null, 2),
        }],
      };
    }
    if (uri.startsWith(DOCS_PREFIX)) {
      const slug = uri.slice(DOCS_PREFIX.length);
      const manifest = await readGuidanceManifest(guidanceDir);
      const entry = manifest.docs.find((d) => d.slug === slug);
      if (!entry) {
        throw new JsonRpcError(RESOURCE_NOT_FOUND, 'Resource not found', { uri });
      }
      const text = await readFile(join(guidanceDir, entry.file), 'utf8');
      return { contents: [{ uri, mimeType: 'text/markdown', text }] };
    }
    if (uri.startsWith(DOC_PREFIX)) {
      const id = uri.slice(DOC_PREFIX.length);
      const { tree } = await walkTree({ projectRoot });
      const doc = tree.byId.get(id) ?? resolveInlineDoc(tree, id);
      if (!doc) {
        throw new JsonRpcError(RESOURCE_NOT_FOUND, 'Resource not found', { uri });
      }
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(doc, null, 2),
        }],
      };
    }
    throw new JsonRpcError(RESOURCE_NOT_FOUND, 'Resource not found', { uri });
  }

  return { list, read };
}

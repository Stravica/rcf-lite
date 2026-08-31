// HTTP handler for `/scope.json`. The live-client fetches this to
// resolve a `?blueprint=<slug>` URL query into the applied
// contribution list and the customised-since-apply subset.
//
// Three shapes:
//   GET /scope.json                    -> { blueprints: [{ slug, contributionCount, appliedAt, version }] }
//                                          (the applied blueprint index; used by the client to know
//                                          which slugs are valid before firing a scoped request)
//   GET /scope.json?blueprint=<slug>   -> { slug, appliedAt, version, contributionIds, customisedIds, missingSourceIds }
//   GET /scope.json?blueprint=<slug>   with slug not applied -> 404 { error: 'unknownBlueprint', slug }
//
// The endpoint is read-only. It reads manifest.json every call rather
// than piggy-backing on the cached tree state; the caller is a browser
// (small payload, low frequency), and a fresh read means scope answers
// track a re-apply immediately even if a tree-update SSE broadcast has
// not yet propagated.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { contributionsForBlueprint, detectCustomisations, listAppliedSlugs } from '../view/scope.js';

const MIME_JSON = 'application/json; charset=utf-8';

/**
 * Build a handler bound to a project root. Returns a function suitable
 * for wiring into the router as the `/scope.json` route.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {(root: string) => Promise<object|null>} [args._readManifest] - test seam
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createScopeHandler({ projectRoot, _readManifest, _detectCustomisations } = {}) {
  const readManifest = _readManifest ?? defaultReadManifest;
  const detectImpl = _detectCustomisations ?? detectCustomisations;
  return async function handle(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const slug = normaliseString(url.searchParams.get('blueprint'));
      const manifest = await readManifest(projectRoot);
      if (!slug) {
        respond(res, 200, {
          blueprints: appliedIndex(manifest),
        });
        return;
      }
      const found = contributionsForBlueprint(manifest, slug);
      if (!found.found) {
        respond(res, 404, { error: 'unknownBlueprint', slug });
        return;
      }
      const { customisedIds, missingSourceIds } = await detectImpl({
        projectRoot,
        record: found.record,
      });
      respond(res, 200, {
        slug,
        appliedAt: found.record.appliedAt ?? null,
        version: found.record.version ?? null,
        contributionIds: found.contributionIds,
        customisedIds,
        missingSourceIds,
      });
    } catch (err) {
      respond(res, 500, { error: 'ioFailure', message: err && err.message ? err.message : 'unknown' });
    }
  };
}

function appliedIndex(manifest) {
  const slugs = listAppliedSlugs(manifest);
  const list = manifest?.blueprints ?? [];
  return slugs.map((slug) => {
    const rec = list.find((b) => b?.slug === slug) ?? {};
    return {
      slug,
      version: rec.version ?? null,
      appliedAt: rec.appliedAt ?? null,
      contributionCount: Array.isArray(rec.contributions) ? rec.contributions.length : 0,
    };
  });
}

function normaliseString(v) {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function defaultReadManifest(projectRoot) {
  try {
    const raw = await readFile(join(projectRoot, 'rcf', 'manifest.json'), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function respond(res, status, body) {
  const buf = Buffer.from(`${JSON.stringify(body)}\n`, 'utf8');
  res.writeHead(status, { 'content-type': MIME_JSON, 'content-length': String(buf.length) });
  res.end(buf);
}

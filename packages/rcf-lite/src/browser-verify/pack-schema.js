// Pack schema validator for blueprint-shipped probe packs
// (visual round T-0, US-1701 AC-1701-1/2). CN-106.
//
// Validates a pack module's exported default object against the
// section 3.2 shape. Enforces the field-level rules the loader must
// refuse at load time (packName grammar and blueprint-slug prefix,
// version semver, blueprintSlug matches directory, appliesTo function
// referencing one of the three legal scoping seams, checks[] non-empty
// with an id / severity / description / async run per entry).
//
// Returns a plain-JS shape (not RcfError): the loader wraps refusals
// in its own diagnostic aggregate, so a single validation call reports
// every issue on one pack instead of stopping at the first.

const PACK_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const CHECK_ID_RE = /^AC-\d{3,}-\d+$/;
const SEVERITIES = new Set(['block', 'warn', 'advisory']);

const APPLIES_TO_TOKENS = [
  { key: 'route', matcher: /\broute\b|\bnavModel\b|\bpath\b/ },
  { key: 'tacIds', matcher: /\btacIds?\b/ },
  { key: 'blueprintTag', matcher: /blueprint:/ },
];

/**
 * Validate a pack module's exported default object.
 *
 * @param {object} args
 * @param {object} args.mod  the imported module (its `.default` is the pack object).
 * @param {string} args.blueprintSlug  the owning blueprint slug (directory).
 * @param {string} args.packAbsPath  absolute path of the pack file, for error context.
 * @returns {{ ok: true, pack: object } | { ok: false, errors: Array<{ field: string, message: string }> }}
 */
export function validatePackModule({ mod, blueprintSlug, packAbsPath }) {
  const errors = [];
  const pack = mod?.default;
  if (!pack || typeof pack !== 'object') {
    return { ok: false, errors: [{ field: 'default', message: `pack ${packAbsPath}: missing default export (expected an object)` }] };
  }

  if (typeof pack.packName !== 'string' || pack.packName.length === 0) {
    errors.push({ field: 'packName', message: `pack ${packAbsPath}: packName must be a non-empty string` });
  } else if (!PACK_NAME_RE.test(pack.packName)) {
    errors.push({ field: 'packName', message: `pack ${packAbsPath}: packName '${pack.packName}' must match ${PACK_NAME_RE}` });
  } else if (pack.packName !== blueprintSlug && !pack.packName.startsWith(`${blueprintSlug}-`)) {
    errors.push({ field: 'packName', message: `pack ${packAbsPath}: packName '${pack.packName}' must equal the blueprint slug '${blueprintSlug}' or start with '${blueprintSlug}-'` });
  }

  if (typeof pack.version !== 'string' || !SEMVER_RE.test(pack.version)) {
    errors.push({ field: 'version', message: `pack ${packAbsPath}: version must be semver (got ${JSON.stringify(pack.version)})` });
  }

  if (typeof pack.blueprintSlug !== 'string' || pack.blueprintSlug.length === 0) {
    errors.push({ field: 'blueprintSlug', message: `pack ${packAbsPath}: blueprintSlug must be a non-empty string` });
  } else if (pack.blueprintSlug !== blueprintSlug) {
    errors.push({ field: 'blueprintSlug', message: `pack ${packAbsPath}: blueprintSlug '${pack.blueprintSlug}' must match the enclosing directory '${blueprintSlug}'` });
  }

  if (typeof pack.appliesTo !== 'function') {
    errors.push({ field: 'appliesTo', message: `pack ${packAbsPath}: appliesTo is required and must be a function ({ fbs, uiBaseline, manifest }) => boolean` });
  } else {
    const source = String(pack.appliesTo);
    const matched = APPLIES_TO_TOKENS.filter((t) => t.matcher.test(source)).map((t) => t.key);
    if (matched.length === 0) {
      errors.push({
        field: 'appliesTo',
        message: `pack ${packAbsPath}: appliesTo must reference one of { route (or navModel/path), tacIds, blueprint:<slug> tag }; got source ${trimForError(source)}. The default '() => true' predicate is refused; scope the pack to the FBS surface it probes.`,
      });
    }
  }

  if (pack.boot !== undefined && pack.boot !== null && typeof pack.boot !== 'object') {
    errors.push({ field: 'boot', message: `pack ${packAbsPath}: boot must be an object or null when present (fields bootCommand, waitForUrl, waitForSelector are optional)` });
  }

  if (!Array.isArray(pack.checks) || pack.checks.length === 0) {
    errors.push({ field: 'checks', message: `pack ${packAbsPath}: checks must be a non-empty array` });
  } else {
    const seenIds = new Set();
    pack.checks.forEach((check, index) => {
      const at = `checks[${index}]`;
      if (!check || typeof check !== 'object') {
        errors.push({ field: at, message: `pack ${packAbsPath}: ${at} must be an object` });
        return;
      }
      if (typeof check.id !== 'string' || !CHECK_ID_RE.test(check.id)) {
        errors.push({ field: `${at}.id`, message: `pack ${packAbsPath}: ${at}.id must match ${CHECK_ID_RE} (got ${JSON.stringify(check.id)})` });
      } else if (seenIds.has(check.id)) {
        errors.push({ field: `${at}.id`, message: `pack ${packAbsPath}: ${at}.id '${check.id}' duplicates an earlier check on the same pack` });
      } else {
        seenIds.add(check.id);
      }
      if (!SEVERITIES.has(check.severity)) {
        errors.push({ field: `${at}.severity`, message: `pack ${packAbsPath}: ${at}.severity must be one of ${[...SEVERITIES].join(' | ')} (got ${JSON.stringify(check.severity)})` });
      }
      if (typeof check.description !== 'string' || check.description.length === 0) {
        errors.push({ field: `${at}.description`, message: `pack ${packAbsPath}: ${at}.description must be a non-empty string` });
      }
      if (typeof check.run !== 'function') {
        errors.push({ field: `${at}.run`, message: `pack ${packAbsPath}: ${at}.run must be an async function` });
      }
      if (check.dependsOn !== undefined && !(typeof check.dependsOn === 'string' || (Array.isArray(check.dependsOn) && check.dependsOn.every((d) => typeof d === 'string')))) {
        errors.push({ field: `${at}.dependsOn`, message: `pack ${packAbsPath}: ${at}.dependsOn must be a string or an array of strings (pre-check ids)` });
      }
    });
  }

  if (pack.preChecks !== undefined) {
    if (!Array.isArray(pack.preChecks)) {
      errors.push({ field: 'preChecks', message: `pack ${packAbsPath}: preChecks must be an array when present` });
    } else {
      const seenPre = new Set();
      pack.preChecks.forEach((pre, index) => {
        const at = `preChecks[${index}]`;
        if (!pre || typeof pre !== 'object') {
          errors.push({ field: at, message: `pack ${packAbsPath}: ${at} must be an object` });
          return;
        }
        if (typeof pre.id !== 'string' || pre.id.length === 0) {
          errors.push({ field: `${at}.id`, message: `pack ${packAbsPath}: ${at}.id must be a non-empty string` });
        } else if (seenPre.has(pre.id)) {
          errors.push({ field: `${at}.id`, message: `pack ${packAbsPath}: ${at}.id '${pre.id}' duplicates an earlier pre-check on the same pack` });
        } else {
          seenPre.add(pre.id);
        }
        if (!SEVERITIES.has(pre.severity)) {
          errors.push({ field: `${at}.severity`, message: `pack ${packAbsPath}: ${at}.severity must be one of ${[...SEVERITIES].join(' | ')} (got ${JSON.stringify(pre.severity)})` });
        }
        if (typeof pre.description !== 'string' || pre.description.length === 0) {
          errors.push({ field: `${at}.description`, message: `pack ${packAbsPath}: ${at}.description must be a non-empty string` });
        }
        if (typeof pre.run !== 'function') {
          errors.push({ field: `${at}.run`, message: `pack ${packAbsPath}: ${at}.run must be an async function` });
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, pack };
}

function trimForError(s) {
  const trimmed = String(s).replace(/\s+/g, ' ').trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

export const PACK_SCHEMA_INTERNALS = Object.freeze({
  PACK_NAME_RE,
  SEMVER_RE,
  CHECK_ID_RE,
  SEVERITIES,
  APPLIES_TO_TOKENS,
});

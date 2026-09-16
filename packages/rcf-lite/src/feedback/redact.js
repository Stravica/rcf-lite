// Feedback redactor (TAC-4103-feedback-redact, ADR-4103). Slice 2
// (FBS-181) ships the eight rules of design section 5, applied to any
// string that would leave the machine (issue title, body, evidence
// pointers). Pure, deterministic, no network, no LLM.
//
// Every replacement lands on a ledger of { rule, before, after, count }
// entries so `rcf feedback preview` can show the operator exactly what
// was stripped. Rule 8 is the second-pass refusal: if the redacted
// output still matches rule 5 (a secret-shaped run of characters), we
// return residual { line, snippet } markers so the caller can refuse
// the entry rather than send it.
//
// The eight rules, in canonical order (also the ledger's rule-name
// vocabulary): `project-root`, `absolute-path`, `email`, `hostname`,
// `private-ip`, `secret-token`, `operator-identity`, `size-shape`.
// Rule 6 in the design (operator identity) is applied AFTER rule 5
// (secret-token) so a name that looks like a random token is redacted
// as a token first; both are load-bearing and this ordering keeps the
// secret-shape check the last line of defence, which is what the
// residual-match refusal in rule 8 leans on.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLED_ALLOWLIST = JSON.parse(
  readFileSync(resolve(here, 'redact-allowlist.json'), 'utf8'),
);

/** Body size cap (bytes). Mirrors src/cli/feedback.js:BODY_CAP_BYTES. */
export const BODY_CAP_BYTES = 8 * 1024;

/**
 * @typedef {object} RedactionContext
 * @property {string | string[]} [projectRoot]     absolute path (redacted to `<project>`);
 *   an array carries every spelling that names the same root (the as-typed
 *   spelling AND its realpath, e.g. `/tmp/foo` and `/private/tmp/foo` on macOS)
 *   so a path expressed either way is stripped (design 5 rule 1, F-slice-2-06).
 * @property {string} [projectName]     manifest projectName (redacted to `<project>`)
 * @property {string} [operatorName]    identity ## Name line, or null
 * @property {string | string[]} [gitRemote]      git remote url or URLs (redacted to `<project-remote>`);
 *   an array carries every remote a `git remote -v` walk names (F-slice-2-07).
 * @property {string[]} [allowHosts]    extension list merged with the bundled allowlist
 */

/**
 * @typedef {object} LedgerRow
 * @property {string} rule
 * @property {string} before
 * @property {string} after
 * @property {number} count
 */

/**
 * @typedef {object} ResidualHit
 * @property {number} line              1-indexed line number in redacted output
 * @property {string} snippet           matched substring (already redacted string)
 * @property {string} pattern           short label for the pattern family
 */

/**
 * @typedef {object} RedactResult
 * @property {string} text              redacted string
 * @property {LedgerRow[]} ledger       ordered by rule application
 * @property {ResidualHit[]} residual   rule-8 second-pass hits (empty on ok)
 */

/**
 * Redact one string with the eight rules from design section 5.
 * Deterministic; safe to call repeatedly; no I/O beyond the bundled
 * allowlist read at module load.
 *
 * @param {string} input
 * @param {RedactionContext} [context]
 * @returns {RedactResult}
 */
export function redact(input, context = {}) {
  if (typeof input !== 'string') input = String(input ?? '');
  const ledger = [];
  let text = input;

  // Rule 1: project root -> <project>. Applied first so absolute paths
  // under it keep their relative tail rather than getting basename-only
  // treatment from rule 2. Accepts either a single string or an array
  // of spellings (typed AND realpath) so a path expressed either way
  // is stripped (F-slice-2-06).
  const projectRootSpellings = normaliseRootSpellings(context.projectRoot);
  for (const spelling of projectRootSpellings) {
    const norm = spelling.replace(/[/\\]+$/, '');
    text = replaceAndLog(text, escapedLiteral(norm), '<project>', 'project-root', ledger);
  }

  // Rule 2: other absolute paths -> <path>/<basename>. POSIX and
  // Windows shapes. Path segments allow letters, digits, dots,
  // hyphens, underscores, tildes, pluses, colons, at-signs and
  // spaces. A segment carrying a space (e.g. `/Users/john doe/work`)
  // is only accepted when it is followed by another path separator,
  // so a sentence with a lone `/tmp/x and other stuff` does not
  // swallow the trailing words (F-slice-2-06).
  const posixAbsRe = /(?<![A-Za-z0-9_/-])\/(?:Users|home|tmp|var|opt|private|etc|root)(?:\/(?:[A-Za-z0-9._+@~-]+(?:\s[A-Za-z0-9._+@~-]+)*(?=\/)|[A-Za-z0-9._+@~-]+))+/g;
  text = replaceRegex(text, posixAbsRe, (match) => {
    const bn = match.split('/').filter(Boolean).pop() ?? 'file';
    return `<path>/${bn}`;
  }, 'absolute-path', ledger);
  const winAbsRe = /(?<![A-Za-z0-9])[A-Z]:\\(?:(?:[A-Za-z0-9._+@~-]+(?:\s[A-Za-z0-9._+@~-]+)*(?=\\))|[A-Za-z0-9._+@~-]+)(?:\\(?:(?:[A-Za-z0-9._+@~-]+(?:\s[A-Za-z0-9._+@~-]+)*(?=\\))|[A-Za-z0-9._+@~-]+))+/g;
  text = replaceRegex(text, winAbsRe, (match) => {
    const bn = match.split('\\').pop() ?? 'file';
    return `<path>\\${bn}`;
  }, 'absolute-path', ledger);

  // Operator identity as a literal substitution happens BEFORE the
  // shape-based rules 3-6 so a git remote of the form
  // `git@github.com:owner/repo.git` is not first consumed by the email
  // rule. The operator-name literal likewise takes precedence over
  // any accidental shape overlaps. Accepts either a single remote or
  // an array (F-slice-2-07: `git remote -v` yields multiple).
  const gitRemotes = Array.isArray(context.gitRemote)
    ? context.gitRemote
    : (typeof context.gitRemote === 'string' && context.gitRemote.length > 0 ? [context.gitRemote] : []);
  for (const gr of gitRemotes) {
    text = replaceAndLog(text, escapedLiteral(gr), '<project-remote>', 'operator-identity', ledger);
  }
  if (context.operatorName) {
    const opName = context.operatorName.trim();
    if (opName.length > 0) {
      text = replaceAndLog(text, escapedLiteral(opName), '<operator>', 'operator-identity', ledger);
      for (const tok of opName.split(/\s+/)) {
        if (tok.length > 3) {
          text = replaceAndLog(text, `\\b${escapeRe(tok)}\\b`, '<operator>', 'operator-identity', ledger);
        }
      }
    }
  }
  if (context.projectName) {
    const pn = context.projectName.trim();
    if (pn.length > 0) {
      text = replaceAndLog(text, `\\b${escapeRe(pn)}\\b`, '<project>', 'operator-identity', ledger);
    }
  }

  // Rule 3: emails -> <email>. RFC-5322 lite; case-insensitive.
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  text = replaceRegex(text, emailRe, () => '<email>', 'email', ledger);

  // Rule 4: hostnames and URLs whose registrable domain is not on the
  // allowlist. URLs keep their path suffix; bare hostnames collapse.
  // Loopback (localhost, 127.0.0.1) and everything on the allowlist
  // survive; every other public hostname or URL loses its host.
  const allowHosts = new Set([
    ...BUNDLED_ALLOWLIST.hosts,
    ...(Array.isArray(context.allowHosts) ? context.allowHosts : []),
  ].map((h) => h.toLowerCase()));

  // URLs first (http/https), then bare hostnames.
  const urlRe = /https?:\/\/([A-Za-z0-9.-]+)((?::[0-9]+)?(?:\/[^\s)]*)?)/g;
  text = replaceRegex(text, urlRe, (_m, host, tail) => {
    if (isHostAllowed(host, allowHosts)) return `https://${host}${tail}`;
    return `<host>${tail}`;
  }, 'hostname', ledger);
  // Bare hostnames: a word that looks like a domain (has a dot,
  // ends with a 2+ letter TLD) and is not on the allowlist. Skip if
  // preceded by @ (already handled by rule 3), a slash or backslash
  // (path fragment; the winAbsRe substitution leaves `<path>\file.ext`
  // which must not fold to `<host>`), a digit-dot (IP handled by
  // rule 5b), or another word character (a longer host suffix).
  const bareHostRe = /(?<![@/\\\w.])(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?![\w.-])/g;
  text = replaceRegex(text, bareHostRe, (host) => {
    if (isHostAllowed(host, allowHosts)) return host;
    return '<host>';
  }, 'hostname', ledger);

  // Rule 5: private and link-local IPs -> <ip>. Loopback survives.
  // Deliberately named `private-ip` in the ledger vocabulary.
  const privateIpRe = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})\b/g;
  text = replaceRegex(text, privateIpRe, () => '<ip>', 'private-ip', ledger);
  // Any other public IPv4 outside loopback also collapses.
  const publicIpRe = /\b(?!127\.)(?!0\.)(?:\d{1,3}\.){3}\d{1,3}\b/g;
  text = replaceRegex(text, publicIpRe, () => '<ip>', 'private-ip', ledger);

  // F-slice-2-05: IPv6 is also part of rule 4 (design 5 explicitly
  // names fc00::/7). Match unique-local (fc00::/7), link-local
  // (fe80::/10) and generic IPv6 shapes (including :: compression),
  // but keep loopback `::1`. Runs after IPv4 so a `::ffff:10.0.0.1`
  // mapped-address form still folds sensibly.
  const ipv6LoopbackRe = /(?<![0-9A-Fa-f:])::1(?![0-9A-Fa-f:])/g;
  const ipv6Re = /(?<![0-9A-Fa-f:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|:(?::[0-9A-Fa-f]{1,4}){1,7})(?![0-9A-Fa-f:])/g;
  // Protect loopback markers before the general pattern runs.
  const LOOPBACK_TOKEN = 'IPV6LO';
  const savedLoopback = [];
  text = text.replace(ipv6LoopbackRe, (m) => {
    savedLoopback.push(m);
    return `${LOOPBACK_TOKEN}${savedLoopback.length - 1}${LOOPBACK_TOKEN}`;
  });
  text = replaceRegex(text, ipv6Re, () => '<ip>', 'private-ip', ledger);
  text = text.replace(new RegExp(`${LOOPBACK_TOKEN}(\\d+)${LOOPBACK_TOKEN}`, 'g'), (_m, i) => savedLoopback[Number(i)]);

  // Rule 6: secret-looking strings -> <redacted:secret>. This block is
  // the last line of defence and rule 8's residual check re-runs it.
  text = redactSecrets(text, ledger);

  // Rule 8a: size / shape. Strip control characters; normalise dashes
  // to ASCII hyphens (register rule and keeps fingerprint input stable);
  // truncate to BODY_CAP_BYTES with an explicit marker.
  const before = text;
  let ctrl = 0;
  text = text.replace(/[ --]/g, () => {
    ctrl += 1;
    return '';
  });
  // Normalise dashes: em (—), en (–), figure (‒),
  // horizontal bar (―), hyphen (‐), non-breaking hyphen
  // (‑), minus sign (−). All become ASCII hyphen.
  const dashRe = /[‐-―−]/g;
  let dashes = 0;
  text = text.replace(dashRe, () => {
    dashes += 1;
    return '-';
  });
  let truncated = 0;
  if (Buffer.byteLength(text, 'utf8') > BODY_CAP_BYTES) {
    text = truncateToBytes(text, BODY_CAP_BYTES - 32);
    text = `${text}\n[truncated by rcf feedback]\n`;
    truncated = 1;
  }
  if (ctrl > 0 || dashes > 0 || truncated > 0) {
    ledger.push({
      rule: 'size-shape',
      before: `${before.length} chars, ${ctrl} control, ${dashes} dashes${truncated ? ', over cap' : ''}`,
      after: `${text.length} chars`,
      count: ctrl + dashes + truncated,
    });
  }

  // Rule 8b: second-pass residual secret check. Any surviving match
  // for the rule-5 pattern family names the failing line and lets
  // `submit` refuse without sending. `preview` shows the same list so
  // the agent can rewrite the body.
  const residual = findResidualSecrets(text);

  return { text, ledger, residual };
}

/**
 * Detect residual secrets in already-redacted text. Wider than the
 * first-pass `redactSecrets` set: the residual check drops the word-
 * boundary anchors so a token buried inside a longer identifier
 * (a shape the first pass would skip) still trips the refusal. Used
 * by `preview` for the disclosure line and by `submit` (slice 4) for
 * the refusal.
 *
 * @param {string} text
 * @returns {ResidualHit[]}
 */
export function findResidualSecrets(text) {
  // F-slice-2-04: the residual pass runs the SAME pattern family the
  // first pass used, plus the word-boundary-loosened token variants
  // so a secret buried inside a longer identifier still trips the
  // refusal. Every rule-5 family is represented: what leaves the
  // machine cannot include a shape the first pass would have caught
  // even after later normalisation.
  const primaries = secretPatterns();
  const looseTokens = [
    { name: 'github-token',  re: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
    { name: 'github-pat',    re: /github_pat_[A-Za-z0-9_]{20,}/g },
    { name: 'aws-access',    re: /AKIA[0-9A-Z]{16}/g },
    { name: 'stripe',        re: /sk_(?:live|test)_[A-Za-z0-9]{20,}/g },
    { name: 'openai',        re: /sk-[A-Za-z0-9]{20,}/g },
    { name: 'slack',         re: /xox[abp]-[A-Za-z0-9-]{10,}/g },
    { name: 'jwt',           re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
    { name: 'bearer',        re: /Bearer\s+[A-Za-z0-9._~+/=-]{4,}/g },
  ];
  const residualPatterns = [...primaries, ...looseTokens];
  const lines = text.split('\n');
  /** @type {ResidualHit[]} */
  const hits = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    for (const { name, re } of residualPatterns) {
      re.lastIndex = 0;
      const m = re.exec(lines[i]);
      if (m) {
        const key = `${name}|${i + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ line: i + 1, snippet: m[0].slice(0, 80), pattern: name });
      }
    }
  }
  return hits;
}

/**
 * Merge the bundled allowlist with the per-project extension.
 * Public helper so callers can preview the merged set (doctor,
 * `feedback status` in slice 5) without re-implementing the merge.
 *
 * @param {string[]} [extend]
 * @returns {string[]}
 */
export function allowedHosts(extend = []) {
  return [...new Set([
    ...BUNDLED_ALLOWLIST.hosts,
    ...(Array.isArray(extend) ? extend : []),
  ].map((h) => h.toLowerCase()))];
}

// -- internal helpers -----------------------------------------------------

/**
 * Fold a `projectRoot` context value (string, array of strings, or
 * nullish) into a deduped array of spellings, longest first, so
 * `/private/tmp/foo` is stripped before `/tmp/foo` would leave the
 * trailing tail untouched.
 *
 * @param {string | string[] | null | undefined} value
 * @returns {string[]}
 */
function normaliseRootSpellings(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    if (typeof s !== 'string' || s.length === 0) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

function replaceAndLog(text, pattern, replacement, rule, ledger) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  let count = 0;
  let sample = null;
  const out = text.replace(re, (match) => {
    count += 1;
    if (sample === null) sample = match;
    return typeof replacement === 'function' ? replacement(match) : replacement;
  });
  if (count > 0) {
    ledger.push({
      rule,
      before: String(sample),
      after: typeof replacement === 'function' ? replacement(sample) : replacement,
      count,
    });
  }
  return out;
}

function replaceRegex(text, re, replacer, rule, ledger) {
  let count = 0;
  let sampleBefore = null;
  let sampleAfter = null;
  const out = text.replace(re, (match, ...args) => {
    const after = replacer(match, ...args);
    if (after === match) return match;
    count += 1;
    if (sampleBefore === null) {
      sampleBefore = match;
      sampleAfter = after;
    }
    return after;
  });
  if (count > 0) {
    ledger.push({ rule, before: sampleBefore, after: sampleAfter, count });
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapedLiteral(s) {
  return escapeRe(s);
}

function isHostAllowed(host, allowSet) {
  const h = host.toLowerCase();
  if (allowSet.has(h)) return true;
  // Match by registrable-domain suffix: `sub.github.com` matches
  // `github.com` when the allowlist has `github.com`.
  for (const allowed of allowSet) {
    if (h === allowed) return true;
    if (h.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function truncateToBytes(text, maxBytes) {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= maxBytes) return text;
  // Truncate at a UTF-8 boundary. Buffer.toString('utf8') on a slice
  // that lands mid-codepoint would emit replacement chars; walk back
  // to the last complete codepoint.
  let cut = maxBytes;
  while (cut > 0 && (buf[cut] & 0xc0) === 0x80) cut -= 1;
  return buf.slice(0, cut).toString('utf8');
}

// Secret patterns are the closed vocabulary rule 5 (secret-token in the
// ledger) applies. Kept as a module-scope helper so `findResidualSecrets`
// runs the same set the redactor used.
//
// F-slice-2-01: `kv-secret` must catch short and quoted values too;
// any well-known key name paired with any non-empty value is a secret.
// F-slice-2-02: `authorization` matches to end of line so the header
// value AND the credential fold together.
// F-slice-2-03: `pem` matches the whole BEGIN..END block, not just
// the BEGIN delimiter, so the key payload leaves with it.
function secretPatterns() {
  return [
    { name: 'github-token',  re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g },
    { name: 'github-pat',    re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
    { name: 'aws-access',    re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'stripe',        re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
    { name: 'openai',        re: /\bsk-[A-Za-z0-9]{20,}\b/g },
    { name: 'slack',         re: /\bxox[abp]-[A-Za-z0-9-]{10,}\b/g },
    { name: 'jwt',           re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
    { name: 'pem',           re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
    { name: 'bearer',        re: /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/g },
    { name: 'authorization', re: /^[ \t]*authorization[ \t]*:[^\n]+/gim },
    // Well-known key names paired with ANY non-empty value are
    // secrets by convention. The value class stays permissive so
    // short and quoted values (e.g. "password": "abc") fold too.
    { name: 'kv-secret',     re: /(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)["' ]*[:=][ \t]*(?:"[^"\n]+"|'[^'\n]+'|[^\s,;)}\]]+)/gi },
    // High-entropy blob. Anchored to non-word boundaries so it does not
    // fold with the specific patterns above; excludes 7/12/40-char
    // hex-only sha values (git object shape).
    { name: 'entropy-blob',  re: /\b(?![0-9a-f]{7}\b)(?![0-9a-f]{12}\b)(?![0-9a-f]{40}\b)(?=[A-Za-z0-9_-]{32,})(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9_-]{32,}\b/g },
  ];
}

function redactSecrets(input, ledger) {
  let text = input;
  for (const { re } of secretPatterns()) {
    text = replaceRegex(text, re, () => '<redacted:secret>', 'secret-token', ledger);
  }
  // F-slice-2-09: keep every distinct before/after pair so the
  // operator disclosure ledger shows exactly what was stripped.
  // Consecutive secret-token rows are folded ONLY when they share
  // the same before text (a plain deduplication); the count is the
  // sum of hits. Distinct samples stay as their own rows so a
  // maintainer reading `preview` can see the full list, not one
  // concatenated line.
  const folded = [];
  for (const row of ledger) {
    if (row.rule !== 'secret-token') {
      folded.push(row);
      continue;
    }
    const twin = folded.find((r) => r.rule === 'secret-token' && r.before === row.before);
    if (twin) twin.count += row.count;
    else folded.push({ ...row });
  }
  ledger.length = 0;
  for (const r of folded) ledger.push(r);
  return text;
}

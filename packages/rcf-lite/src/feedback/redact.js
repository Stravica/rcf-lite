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

  // Rule 1.5: KV-secret early guard runs BEFORE the absolute-path
  // pass. A body like `/tmp/cache password=Abc12345` was previously
  // consumed by the terminal-directory extension of the path regex
  // (the space plus `password` folded into the path match), so the
  // `password` key label vanished into `<path>` and the kv-secret
  // pass then saw a bare `=Abc12345` with no key label to bind. The
  // guard redacts every `keyname=value` pair first, so the path
  // sweep only sees `/tmp/cache <redacted:secret>` and cannot swallow
  // the key. Round 3: R-P0-3 P0 regression from round 2.
  const kvSecretGuardRe = /(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)["'\s]*[:=][ \t]*(?:"(?:\\.|[^"\\\n])+"|'(?:\\.|[^'\\\n])+'|[^\s,;)}\]]+)/gi;
  text = replaceEachDistinct(text, kvSecretGuardRe, '<redacted:secret>', 'secret-token', ledger);

  // Rule 2: other absolute paths -> <path>/<basename>. POSIX and
  // Windows shapes. Path segments allow letters, digits, dots,
  // hyphens, underscores, tildes, pluses, colons, at-signs and
  // spaces. A non-terminal segment carrying spaces (e.g.
  // `/Users/john doe/work` or `/Users/john  doe/work` with a double
  // space) is accepted when it is followed by another separator, so
  // any width of whitespace between tokens folds. A terminal
  // (no-separator) segment accepts a space continuation of any width
  // (`[ \t]+`) so `/Users/john  doe` (double space) also folds; a
  // sentence like `in /Users/john doe end here` still folds only
  // `/Users/john doe` because the continuation is a single word,
  // not the rest of the sentence (F-slice-2-06).
  // Terminal-segment shape: a first word with a `.` looks like a
  // filename (no space continuation - space starts a sentence again,
  // as in `/foo.js line 42`); a first word without a `.` looks like
  // a directory (allow one continuation - `john doe` is one dir on
  // macOS). This split avoids swallowing the trailing sentence when
  // the path ends in a filename.
  const posixAbsRe = /(?<![A-Za-z0-9_/-])\/(?:Users|home|tmp|var|opt|private|etc|root)(?:\/(?:[A-Za-z0-9._+@~-]+(?:\s+[A-Za-z0-9._+@~-]+)*(?=\/)|[A-Za-z0-9_+@~-]+(?:[ \t]+[A-Za-z0-9._+@~-]+)?|[A-Za-z0-9._+@~-]+))+/g;
  text = replaceRegex(text, posixAbsRe, (match) => {
    const bn = match.split('/').filter(Boolean).pop() ?? 'file';
    // A basename with a space is almost always a username directory
    // (e.g. macOS `Users/First Last`); dropping the basename keeps
    // the personal name off the wire (F-slice-2-06 terminal case).
    if (/\s/.test(bn)) return '<path>';
    return `<path>/${bn}`;
  }, 'absolute-path', ledger);
  const winAbsRe = /(?<![A-Za-z0-9])[A-Z]:\\(?:(?:[A-Za-z0-9._+@~-]+(?:\s+[A-Za-z0-9._+@~-]+)*(?=\\))|[A-Za-z0-9_+@~-]+(?:[ \t]+[A-Za-z0-9._+@~-]+)?|[A-Za-z0-9._+@~-]+)(?:\\(?:(?:[A-Za-z0-9._+@~-]+(?:\s+[A-Za-z0-9._+@~-]+)*(?=\\))|[A-Za-z0-9_+@~-]+(?:[ \t]+[A-Za-z0-9._+@~-]+)?|[A-Za-z0-9._+@~-]+))+/g;
  text = replaceRegex(text, winAbsRe, (match) => {
    const bn = match.split('\\').pop() ?? 'file';
    if (/\s/.test(bn)) return '<path>';
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
  // F-slice-2-05: preserve loopback in every legal spelling - `::1`,
  // the fully expanded `0:0:0:0:0:0:0:1`, and every zero-padded
  // variant of it (`0000:0000:0000:0000:0000:0000:0000:0001`, etc).
  // A single `::1` matcher would let the expanded forms fall through
  // to the general ipv6 pattern and get redacted against design 5
  // rule 4's loopback exemption.
  const ipv6LoopbackRe = /(?<![0-9A-Fa-f:])(?:::1|(?:0{1,4}:){7}0{0,3}1)(?![0-9A-Fa-f:])/g;
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

  // Rule 8a-early: dash normalisation runs BEFORE the rule-6 secret
  // pass so em-dash-delimited shapes (e.g. `—BEGIN PRIVATE KEY—`)
  // reach the secret patterns as ASCII forms. Doing this later would
  // let a PEM block with em-dashes on the delimiters slip both the
  // first-pass PEM regex (needs `-`) AND the residual pass because
  // the residual scan runs after this normalisation - R-P0-2.
  // Normalise dashes: em (—), en (–), figure (‒),
  // horizontal bar (―), hyphen (‐), non-breaking hyphen
  // (‑), minus sign (−). All become ASCII hyphen.
  const dashRe = /[‐-―−]/g;
  let dashes = 0;
  text = text.replace(dashRe, () => {
    dashes += 1;
    return '-';
  });

  // Rule 6: secret-looking strings -> <redacted:secret>. This block is
  // the last line of defence and rule 8's residual check re-runs it.
  text = redactSecrets(text, ledger);

  // Rule 8a-late: size / shape. Strip control characters; truncate to
  // BODY_CAP_BYTES with an explicit marker. Dash normalisation is now
  // in 8a-early above; the size-shape ledger row still totals both.
  const before = text;
  let ctrl = 0;
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, () => {
    ctrl += 1;
    return '';
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
  // F-slice-2-04 / R-P0-2: the residual pass runs the SAME pattern
  // family the first pass used, plus the word-boundary-loosened
  // token variants so a secret buried inside a longer identifier
  // still trips the refusal. Scans the WHOLE text with each pattern
  // (not line-by-line) so multiline shapes such as a PEM block are
  // matched: a per-line loop could never see a BEGIN..END pair on
  // its own line. Every rule-5 family is represented: what leaves
  // the machine cannot include a shape the first pass would have
  // caught even after later normalisation.
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
  /** @type {ResidualHit[]} */
  const hits = [];
  const seen = new Set();
  // Round 3: also scan a diacritic-stripped shadow copy so a key
  // label carrying a Latin-1 supplement letter (`pássword=Abc12345`,
  // `sécret=X`, homoglyph variants) still trips the residual pass and
  // submit refuses fail-closed. The shadow scan preserves byte
  // offsets by mapping combining marks and diacritics to their base
  // ASCII counterparts one codepoint at a time; every non-ASCII
  // codepoint that is not a diacritic marker collapses to a single
  // `_` placeholder so line and column offsets survive intact.
  const shadow = stripDiacritics(text);
  const scans = [
    { source: text, label: '' },
    ...(shadow !== text ? [{ source: shadow, label: 'unicode-key' }] : []),
  ];
  for (const { source, label } of scans) {
    for (const { name, re } of residualPatterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(source)) !== null) {
        // Line number = 1 + count of newlines before m.index. Uses
        // `text` (not `source`) because the shadow preserves newline
        // positions, so the raw text's line count is authoritative
        // for what the operator sees on stdout.
        let line = 1;
        for (let i = 0; i < m.index; i += 1) {
          if (text.charCodeAt(i) === 10) line += 1;
        }
        // Snippet is drawn from the RAW text so the operator sees the
        // actual bytes at the offending line, not the placeholder.
        const rawSnippet = text.slice(m.index, m.index + m[0].length);
        const snippet = rawSnippet.replace(/\s+/g, ' ').slice(0, 80);
        const pattern = label ? `${label}:${name}` : name;
        const key = `${pattern}|${line}|${snippet}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ line, snippet, pattern });
        }
        // Guard against zero-width matches (defensive; no such pattern
        // in the set today, but a future pattern with an optional
        // group could hang the loop otherwise).
        if (re.lastIndex === m.index) re.lastIndex += 1;
      }
    }
  }
  hits.sort((a, b) => a.line - b.line || a.pattern.localeCompare(b.pattern));
  return hits;
}

/**
 * Return a copy of `input` where every non-ASCII codepoint that carries
 * a base ASCII letter (via NFKD decomposition) is folded to that letter,
 * every remaining non-ASCII codepoint collapses to `_`, and every ASCII
 * character passes through untouched. The output has the same length in
 * codepoints as the input, so `String.prototype.replace` match indices
 * carry over one-for-one for line-number arithmetic in the residual pass.
 * Fail-closed: on any exception, return the input unchanged so the raw
 * scan is still authoritative.
 *
 * @param {string} input
 * @returns {string}
 */
function stripDiacritics(input) {
  try {
    let out = '';
    for (let i = 0; i < input.length; i += 1) {
      const c = input.charCodeAt(i);
      if (c < 128) { out += input[i]; continue; }
      // Preserve UTF-16 code-unit alignment. A high surrogate plus a
      // low surrogate is one non-BMP codepoint; emit two `_` so the
      // shadow has the same `.length` and regex offsets carry over
      // unchanged for line-number arithmetic.
      if (c >= 0xD800 && c <= 0xDBFF) {
        out += '__';
        i += 1;
        continue;
      }
      // BMP non-ASCII: NFKD fold to the first ASCII letter or digit
      // in the decomposition (e.g. `á` -> `a` + combining acute).
      // If nothing ASCII remains, collapse to `_` so the placeholder
      // holds the offset without introducing pattern shapes of its own.
      const decomposed = input[i].normalize('NFKD');
      let picked = null;
      for (const dch of decomposed) {
        const cc = dch.charCodeAt(0);
        if ((cc >= 48 && cc <= 57) || (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122)) {
          picked = dch;
          break;
        }
      }
      out += picked ?? '_';
    }
    return out;
  } catch {
    return input;
  }
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

/**
 * Variant of `replaceRegex` that logs ONE ledger row per distinct
 * before-sample the pattern matched, not one row per pattern call.
 * Two `password=A` and `password=B` hits in a single field both land
 * as their own rows so the operator disclosure ledger names every
 * secret that was stripped (F-slice-2-09 within-field case).
 *
 * @param {string} text
 * @param {RegExp} re                     a /g flag is required
 * @param {string} replacement            the after text (constant)
 * @param {string} rule                   ledger row rule name
 * @param {LedgerRow[]} ledger
 * @returns {string}
 */
function replaceEachDistinct(text, re, replacement, rule, ledger) {
  const counts = new Map();
  const out = text.replace(re, (match) => {
    counts.set(match, (counts.get(match) ?? 0) + 1);
    return replacement;
  });
  for (const [before, count] of counts) {
    ledger.push({ rule, before, after: replacement, count });
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
    // R-P0-2: broaden PEM to accept 1..5 dashes on each delimiter so a
    // block whose fences were folded by dash normalisation earlier in
    // the pass (em-dash `—BEGIN...—` -> `-BEGIN...-`) still
    // matches. The eight-rule ordering keeps this the last line of
    // defence before the residual scan.
    { name: 'pem',           re: /-{1,5}BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-{1,5}[\s\S]*?-{1,5}END (?:[A-Z0-9 ]+ )?PRIVATE KEY-{1,5}/g },
    { name: 'bearer',        re: /\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/g },
    { name: 'authorization', re: /^[ \t]*authorization[ \t]*:[^\n]+/gim },
    // Well-known key names paired with ANY non-empty value are
    // secrets by convention. The value class stays permissive so
    // short and quoted values (e.g. "password": "abc") fold too.
    // R-P0-1: allow tab (and any whitespace) between key and the
    // `:` / `=` separator; the previous ["' ]* class dropped tabs
    // and let `password\t=Abc12345` slip past the redactor.
    // F-slice-2-01: quoted values with an embedded escaped quote
    // (`"ab\"cd"`) previously truncated at the first `"`; the value
    // alternatives now consume `\<any>` escape sequences too.
    { name: 'kv-secret',     re: /(?:secret|token|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)["'\s]*[:=][ \t]*(?:"(?:\\.|[^"\\\n])+"|'(?:\\.|[^'\\\n])+'|[^\s,;)}\]]+)/gi },
    // High-entropy blob. Anchored to non-word boundaries so it does not
    // fold with the specific patterns above; excludes 7/12/40-char
    // hex-only sha values (git object shape).
    { name: 'entropy-blob',  re: /\b(?![0-9a-f]{7}\b)(?![0-9a-f]{12}\b)(?![0-9a-f]{40}\b)(?=[A-Za-z0-9_-]{32,})(?=.*[A-Z])(?=.*[a-z])(?=.*\d)[A-Za-z0-9_-]{32,}\b/g },
  ];
}

function redactSecrets(input, ledger) {
  let text = input;
  for (const { re } of secretPatterns()) {
    text = replaceEachDistinct(text, re, '<redacted:secret>', 'secret-token', ledger);
  }
  // F-slice-2-09: keep every distinct before/after pair so the
  // operator disclosure ledger shows exactly what was stripped.
  // `replaceEachDistinct` already writes one row per distinct
  // before-sample WITHIN a single pattern, so two different
  // `password=A` / `password=B` hits in the same field are two rows.
  // The fold below dedupes across DIFFERENT patterns that produced
  // the same before text (e.g. a token caught by both a specific
  // pattern and the loose entropy-blob) and sums their counts.
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

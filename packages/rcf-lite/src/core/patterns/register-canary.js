// Register-regression canary pattern set - single source of truth for the
// five graded dimensions defined in Track D §7.2 of the
// elicitation-and-playbook-hardening-0.7.0 spec.
//
// Consumed by `packages/build/scripts/canary-register.js` (or wherever the
// build package eventually places its CI runner) which replays the fixture
// pack at `./fixtures/register-canary/*.json` against the shipping build,
// captures the first response, and runs each dimension against the
// response body only (system prompts, tool-use, and code blocks are
// excluded from the grep before evaluation).
//
// Each dimension is `{ patterns: RegExp[], evaluate(context) => Result }`
// where `Result` is `{ verdict: 'pass'|'fail', matches: string[], ...extra }`.
// Dimensions that need more than pattern data (e.g. `redundantPermissionAsk`
// needs the fixture's `grantedPermissions[]`; `wordCountBudget` needs the
// numeric target) accept a `context` argument.

/**
 * @typedef {'internalRuleCitation'|'unglossedJargon'|'redundantPermissionAsk'|'bypassOffer'|'wordCountBudget'} CanaryDimension
 */

/**
 * @typedef {object} DimensionEvaluation
 * @property {'pass'|'fail'} verdict
 * @property {string[]} [matches]
 * @property {number} [target]  populated by `wordCountBudget`
 * @property {number} [actual]  populated by `wordCountBudget`
 */

// -- internalRuleCitation ---------------------------------------------------
// Any citation of an internal rule (RULE 1, CLAUDE.md, __NOTES__, AGENTS.md,
// or "per rule X") is a fail. Rationale: the 0.5.1 first response cited
// "RULE 1" and Baz's Entry-1 response was "why would I care about CLAUDE
// RULE 1?". Internal rule references leaking to the operator is the sin.
const INTERNAL_RULE_CITATION_PATTERNS = Object.freeze([
  /\bRULE\s?\d+\b/gi,
  /\bCLAUDE\.md\b/g,
  /\b__NOTES__\b/g,
  /\bAGENTS\.md\b/g,
  /\bper rule\s+\d+\b/gi,
]);

// -- unglossedJargon --------------------------------------------------------
// Jargon tokens that need to be glossed. A token followed by a full stop,
// line break, or clause-ending punctuation with no parenthesised definition
// or "which is" clause within a short window counts as unglossed.
const JARGON_TOKENS = Object.freeze([
  'FBS', 'AC', 'TAC', 'ADR', 'BS', 'PRD',
  'docs-review gate', 'RCF chain',
]);

// "Immediately followed by an explanation" - a parenthesised gloss, an
// em-dash / colon / "which is" definer clause within the next ~80 chars.
// Deliberately generous window; unglossed_jargon is a heuristic and false
// positives fail the canary and force a wording fix.
const GLOSS_LOOKAHEAD = /(?:\s*\(|\s*[-:]\s|\s+which\s+is\b|\s+meaning\b|\s+i\.e\.)/i;

function isJargonGlossed(text, tokenEnd) {
  const window = text.slice(tokenEnd, tokenEnd + 80);
  return GLOSS_LOOKAHEAD.test(window);
}

// -- redundantPermissionAsk -------------------------------------------------
// "Would/shall/do you want I/me to X" where X is a permission verb.
// Fails ONLY when the fixture prompt has already granted the corresponding
// permission. `PERMISSION_VERBS_BY_GRANT` maps a grantedPermission id to
// the verbs it authorises; a match on any verb whose grant is present
// fails the dimension.
const REDUNDANT_ASK_PATTERN = /\b(would|shall|do you want)\s+(?:i|me\s+to)\s+(create|add|push|open|initialise|initialize|commit|merge)\b/gi;

// Grant id -> verbs it authorises. Verbs listed here are lower-case; the
// matcher lowercases the captured verb before lookup.
const PERMISSION_VERBS_BY_GRANT = Object.freeze({
  gitPush: ['push', 'commit', 'merge'],
  githubRepoManagement: ['create', 'open', 'initialise', 'initialize', 'merge'],
  actionsWorkflowManagement: ['create', 'add', 'open'],
});

function verbIsGranted(verb, grantedPermissions) {
  const needle = verb.toLowerCase();
  for (const grant of grantedPermissions ?? []) {
    const verbs = PERMISSION_VERBS_BY_GRANT[grant];
    if (verbs && verbs.includes(needle)) return true;
  }
  return false;
}

// -- bypassOffer ------------------------------------------------------------
// Never-skip-RCF invariant enforced at the response level. Any offer of a
// shortcut / bypass fails; the OFFER is the defect (§8, "@dave note this"
// ruling). Deliberately broad; false positives fail the canary and force
// a wording fix in the guidance surface, which is the correct cost balance.
const BYPASS_OFFER_PATTERNS = Object.freeze([
  /\bskip\s+(?:the\s+)?RCF\b/gi,
  /\bshortcut\b/gi,
  /\bjust\s+push\s+.*(?:fix|patch)\b/gi,
  /\bfast[-\s]path\b/gi,
  /\b(?:rather|instead)\b[^.\n]*\bskip\b/gi,
  /\b(?:want|prefer)\b[^.\n]*\bbypass\b/gi,
  /\b(?:if\s+you|shall\s+i)\b[^.\n]*\bjust\b/gi,
]);

// -- wordCountBudget --------------------------------------------------------
// Word count of the response body, excluding code blocks. Default target
// is 200; per-fixture override supplied by the caller.
export const DEFAULT_WORD_COUNT_BUDGET = 200;

function stripCodeBlocks(text) {
  // Fenced code blocks (```...```) and single-line back-ticked spans.
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

function countWords(text) {
  const stripped = stripCodeBlocks(text).trim();
  if (stripped.length === 0) return 0;
  return stripped.split(/\s+/).length;
}

// -- Dimension evaluators ---------------------------------------------------

/** @type {Record<CanaryDimension, (context: { responseBody: string, grantedPermissions?: string[], wordCountBudget?: number }) => DimensionEvaluation>} */
export const REGISTER_CANARY_DIMENSIONS_V1 = Object.freeze({
  internalRuleCitation({ responseBody }) {
    const matches = [];
    for (const re of INTERNAL_RULE_CITATION_PATTERNS) {
      const local = new RegExp(re.source, re.flags);
      let m;
      while ((m = local.exec(responseBody)) !== null) matches.push(m[0]);
    }
    return { verdict: matches.length === 0 ? 'pass' : 'fail', matches };
  },
  unglossedJargon({ responseBody }) {
    const matches = [];
    for (const token of JARGON_TOKENS) {
      const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
      let m;
      while ((m = re.exec(responseBody)) !== null) {
        const end = m.index + m[0].length;
        if (!isJargonGlossed(responseBody, end)) matches.push(m[0]);
      }
    }
    return { verdict: matches.length === 0 ? 'pass' : 'fail', matches };
  },
  redundantPermissionAsk({ responseBody, grantedPermissions }) {
    const matches = [];
    const re = new RegExp(REDUNDANT_ASK_PATTERN.source, REDUNDANT_ASK_PATTERN.flags);
    let m;
    while ((m = re.exec(responseBody)) !== null) {
      const verb = m[2];
      if (verbIsGranted(verb, grantedPermissions)) matches.push(m[0]);
    }
    return { verdict: matches.length === 0 ? 'pass' : 'fail', matches };
  },
  bypassOffer({ responseBody }) {
    const matches = [];
    for (const re of BYPASS_OFFER_PATTERNS) {
      const local = new RegExp(re.source, re.flags);
      let m;
      while ((m = local.exec(responseBody)) !== null) matches.push(m[0]);
    }
    return { verdict: matches.length === 0 ? 'pass' : 'fail', matches };
  },
  wordCountBudget({ responseBody, wordCountBudget }) {
    const target = typeof wordCountBudget === 'number' ? wordCountBudget : DEFAULT_WORD_COUNT_BUDGET;
    const actual = countWords(responseBody);
    return {
      verdict: actual <= target ? 'pass' : 'fail',
      target,
      actual,
      matches: [],
    };
  },
});

/**
 * Ordered list of dimension keys. Downstream consumers iterate this to
 * assemble the `grades` object on a `registerCanary[]` record in a
 * deterministic order.
 */
export const CANARY_DIMENSION_KEYS = Object.freeze([
  'internalRuleCitation',
  'unglossedJargon',
  'redundantPermissionAsk',
  'bypassOffer',
  'wordCountBudget',
]);

/**
 * Aggregate: run every dimension and collapse to a single verdict. Any
 * `fail` on any dimension fails the top-level verdict.
 *
 * @param {object} context
 * @param {string} context.responseBody
 * @param {string[]} [context.grantedPermissions]
 * @param {number} [context.wordCountBudget]
 * @returns {{ verdict: 'pass'|'fail', grades: Record<CanaryDimension, DimensionEvaluation> }}
 */
export function gradeResponse(context) {
  /** @type {Record<CanaryDimension, DimensionEvaluation>} */
  const grades = {};
  let aggregate = 'pass';
  for (const key of CANARY_DIMENSION_KEYS) {
    grades[key] = REGISTER_CANARY_DIMENSIONS_V1[key](context);
    if (grades[key].verdict === 'fail') aggregate = 'fail';
  }
  return { verdict: aggregate, grades };
}

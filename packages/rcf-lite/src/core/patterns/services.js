// Third-party service seed pattern set - single source of truth for
// service-dependency detection across the 0.7.0 verification-integrity
// train.
//
// Consumed by:
//   - `packages/rcf-lite/src/preflight/scanner.js` (Track A pre-flight service
//     candidate scanner, verification-integrity-cluster-spec §4.3 / §8.3);
//     the scanner walks PRD + TAD prose, calls `matchServiceSignals(text)`,
//     and packages each hit into a `preFlightConfig.servicesInScope[]`
//     candidate with per-match provenance (doc path, section anchor, the
//     matched phrase and its category).
//   - `packages/rcf-lite/src/verify/provision/index.js` (verify's provisioning
//     heuristic, spec §5.3 / §8.4); verify's existing `SERVICE_PATTERNS`
//     regex is superseded by this shared set so the "email channel" miss
//     that motivated the whole cluster (d-2026-07-30-142 investigation)
//     cannot recur from regex drift between packages.
//
// The pattern set is data, not a classifier: consumers own the "what field
// the signal came from" packaging and any interactive-session grouping.
// This module exposes the categorised keyword sets plus a convenience
// matcher that returns per-hit provenance in document order.
//
// Match rules per spec §4.4:
//   - Case-insensitive.
//   - Word-boundary anchored on the leading side (the matcher wraps every
//     pattern as `\b<pattern>`, mirroring the sibling ui-shapes / req-shapes
//     idiom); stem-suffixed forms (`emails`, `webhooks`, `providers`) match
//     by design.
//   - Any single match triggers a service candidate. False positives are
//     cheap (the interactive session dismisses them); false negatives are
//     the failure mode this seed set exists to close (`email channel` was
//     missed by the old regex — d-142 rec 2).
//   - Categorisation is non-exclusive: the same phrase (`provider`, `api`)
//     legitimately fires under multiple categories, and every hit is
//     recorded independently so the scanner can present them as separate
//     candidates for the operator to merge or dismiss.
//
// Interpretation of the spec's "× verbs" shorthand (`storageCdn`, `llmAi`,
// `analyticsTelemetry`, `featureFlags`): where §4.4 writes "× verbs"
// without enumerating a per-category verb list, the shared
// `GENERIC_SERVICE_VERBS` set below is used — the union of every explicit
// verb spelled out by the four categories that DO enumerate (email,
// payment, sms/voice, auth, search). This is the sole interpretation call
// in transcribing §4.4; every token, vendor and explicitly-enumerated verb
// is ship-verbatim.

/**
 * @typedef {'emailDelivery'|'payment'|'smsVoice'|'auth'|'storageCdn'|'llmAi'|'analyticsTelemetry'|'featureFlags'|'search'} ServiceCategory
 */

/**
 * @typedef {'token'|'verb'|'vendor'} ServiceSignalRole
 */

/**
 * @typedef {object} ServiceSignalMatch
 * @property {ServiceCategory} category
 * @property {ServiceSignalRole} role
 * @property {string} pattern        source pattern string that matched
 * @property {string} match          exact substring the pattern captured
 * @property {number} index          offset of the match inside `text`
 */

// Canonical category id list. Order is spec §4.4 document order so the
// scanner's presentation to the operator stays stable across runs.
export const SERVICE_CATEGORY_KEYS = Object.freeze([
  'emailDelivery',
  'payment',
  'smsVoice',
  'auth',
  'storageCdn',
  'llmAi',
  'analyticsTelemetry',
  'featureFlags',
  'search',
]);

// Shared verb set used by every category whose spec §4.4 entry writes
// "× verbs" without an explicit enumeration. Composed as the union of every
// verb the spec DOES enumerate, in first-appearance document order.
// Exported for tests and for consumers that want to reason about the
// interpretation call directly.
export const GENERIC_SERVICE_VERBS = Object.freeze([
  'send',
  'deliver',
  'dispatch',
  'notify',
  'route',
  'channel',
  'provider',
  'processor',
  'gateway',
  'api',
]);

/**
 * The nine-category third-party-service seed set, transcribed verbatim from
 * verification-integrity-cluster-spec §4.4. Each category exposes three
 * frozen arrays:
 *
 *   - `tokens`  the generic terms that name the service concept.
 *   - `verbs`   the actions that co-occur with tokens in service-mentioning
 *               prose; equals `GENERIC_SERVICE_VERBS` for the four
 *               categories whose spec entry writes "× verbs".
 *   - `vendors` the explicit vendor names spec §4.4 lists separately (empty
 *               for `emailDelivery`, whose §4.4 entry lists vendors inline
 *               with tokens — this transcription preserves that spec shape
 *               rather than re-sorting vendors out of the token list).
 *
 * Every array is `Object.freeze`d so downstream classifiers cannot mutate
 * the shared source.
 *
 * @type {Readonly<Record<ServiceCategory, {tokens: readonly string[], verbs: readonly string[], vendors: readonly string[]}>>}
 */
export const SERVICE_SEED_PATTERNS_V1 = Object.freeze({
  // Email delivery §4.4: `email|smtp|mailer|resend|sendgrid|mailgun|postmark|ses\b|mailtrap|sparkpost`
  //   × `send|deliver|dispatch|notify|route|channel|provider`
  // (Vendor names live inline in the token list per §4.4; `vendors` empty
  // here preserves that spec transcription.)
  emailDelivery: Object.freeze({
    tokens: Object.freeze([
      'email',
      'smtp',
      'mailer',
      'resend',
      'sendgrid',
      'mailgun',
      'postmark',
      'ses\\b',
      'mailtrap',
      'sparkpost',
    ]),
    verbs: Object.freeze([
      'send',
      'deliver',
      'dispatch',
      'notify',
      'route',
      'channel',
      'provider',
    ]),
    vendors: Object.freeze([]),
  }),
  // Payment §4.4: `payment|checkout|billing|invoice|charge|payout|refund`
  //   × `provider|processor|gateway|api`;
  //   explicit vendors `stripe|braintree|adyen|paypal|square`.
  payment: Object.freeze({
    tokens: Object.freeze([
      'payment',
      'checkout',
      'billing',
      'invoice',
      'charge',
      'payout',
      'refund',
    ]),
    verbs: Object.freeze([
      'provider',
      'processor',
      'gateway',
      'api',
    ]),
    vendors: Object.freeze([
      'stripe',
      'braintree',
      'adyen',
      'paypal',
      'square',
    ]),
  }),
  // SMS/voice §4.4: `sms|voice|call|dial` × `provider|api`;
  //   explicit vendors `twilio|vonage|messagebird`.
  smsVoice: Object.freeze({
    tokens: Object.freeze([
      'sms',
      'voice',
      'call',
      'dial',
    ]),
    verbs: Object.freeze([
      'provider',
      'api',
    ]),
    vendors: Object.freeze([
      'twilio',
      'vonage',
      'messagebird',
    ]),
  }),
  // Auth (identity provider) §4.4: `oauth|oidc|saml|sso|social login`
  //   × `provider`;
  //   explicit vendors `auth0|clerk|okta|firebase auth|cognito|supabase auth`.
  auth: Object.freeze({
    tokens: Object.freeze([
      'oauth',
      'oidc',
      'saml',
      'sso',
      'social login',
    ]),
    verbs: Object.freeze([
      'provider',
    ]),
    vendors: Object.freeze([
      'auth0',
      'clerk',
      'okta',
      'firebase auth',
      'cognito',
      'supabase auth',
    ]),
  }),
  // Storage/CDN §4.4: `s3|r2|gcs|blob storage|cdn` × verbs;
  //   explicit vendors `cloudflare r2|aws s3|gcs|azure blob`.
  storageCdn: Object.freeze({
    tokens: Object.freeze([
      's3',
      'r2',
      'gcs',
      'blob storage',
      'cdn',
    ]),
    verbs: GENERIC_SERVICE_VERBS,
    vendors: Object.freeze([
      'cloudflare r2',
      'aws s3',
      'gcs',
      'azure blob',
    ]),
  }),
  // LLM/AI §4.4: `llm|inference|completion|embedding|model api` × verbs;
  //   explicit vendors `anthropic|openai|gemini|mistral|cohere|replicate`.
  llmAi: Object.freeze({
    tokens: Object.freeze([
      'llm',
      'inference',
      'completion',
      'embedding',
      'model api',
    ]),
    verbs: GENERIC_SERVICE_VERBS,
    vendors: Object.freeze([
      'anthropic',
      'openai',
      'gemini',
      'mistral',
      'cohere',
      'replicate',
    ]),
  }),
  // Analytics/telemetry §4.4: `analytics|telemetry|event tracking` × verbs;
  //   explicit vendors `posthog|segment|mixpanel|amplitude|datadog`.
  analyticsTelemetry: Object.freeze({
    tokens: Object.freeze([
      'analytics',
      'telemetry',
      'event tracking',
    ]),
    verbs: GENERIC_SERVICE_VERBS,
    vendors: Object.freeze([
      'posthog',
      'segment',
      'mixpanel',
      'amplitude',
      'datadog',
    ]),
  }),
  // Feature flags §4.4: `feature flag|toggle` × verbs;
  //   explicit vendors `launchdarkly|growthbook|flagsmith`.
  featureFlags: Object.freeze({
    tokens: Object.freeze([
      'feature flag',
      'toggle',
    ]),
    verbs: GENERIC_SERVICE_VERBS,
    vendors: Object.freeze([
      'launchdarkly',
      'growthbook',
      'flagsmith',
    ]),
  }),
  // Search §4.4: `search|index` × `api|provider`;
  //   explicit vendors `algolia|elasticsearch|typesense|meilisearch`.
  search: Object.freeze({
    tokens: Object.freeze([
      'search',
      'index',
    ]),
    verbs: Object.freeze([
      'api',
      'provider',
    ]),
    vendors: Object.freeze([
      'algolia',
      'elasticsearch',
      'typesense',
      'meilisearch',
    ]),
  }),
});

// Role iteration order for the matcher; consumers reading per-hit
// provenance can rely on this being stable across releases.
const ROLES = /** @type {const} */ (['tokens', 'verbs', 'vendors']);
const ROLE_TO_SINGULAR = /** @type {const} */ ({
  tokens: 'token',
  verbs: 'verb',
  vendors: 'vendor',
});

/**
 * Scan `text` against `SERVICE_SEED_PATTERNS_V1` and return every match, in
 * document order, tagged with the category and role (`token` / `verb` /
 * `vendor`) that produced it. A single `text` may yield many hits — bare
 * `provider` legitimately fires under email, payment, sms/voice, auth and
 * search — and each hit is recorded separately so the scanner can present
 * them as candidates for the operator to merge or dismiss (spec §4.5).
 *
 * @param {string} text
 * @returns {ServiceSignalMatch[]}
 */
export function matchServiceSignals(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  /** @type {ServiceSignalMatch[]} */
  const results = [];
  for (const category of SERVICE_CATEGORY_KEYS) {
    const bucket = SERVICE_SEED_PATTERNS_V1[category];
    for (const roleKey of ROLES) {
      const patterns = bucket[roleKey];
      const role = ROLE_TO_SINGULAR[roleKey];
      for (const pattern of patterns) {
        // Leading `\b` prevents matching inside a longer word (e.g. `sms`
        // inside `smsapi` would still be blocked by `\bsms`, but `smsapi`
        // as a bare id has no leading word char anyway; the anchor blocks
        // things like `damsms`). NO trailing `\b`, so stem-suffixed forms
        // (`emails`, `providers`, `webhooks`, `deliveries`) still match.
        // Spec §4.4 over-collects by design.
        const re = new RegExp(`\\b${pattern}`, 'gi');
        let m;
        while ((m = re.exec(text)) !== null) {
          results.push({
            category,
            role,
            pattern,
            match: m[0],
            index: m.index,
          });
          if (m.index === re.lastIndex) re.lastIndex += 1; // zero-width safety
        }
      }
    }
  }
  // Document-order stable sort (matches accumulate category-by-category,
  // role-by-role, then pattern-by-pattern; this sort restores overall
  // offset order so the scanner walks hits left-to-right through the doc).
  results.sort((a, b) => a.index - b.index);
  return results;
}

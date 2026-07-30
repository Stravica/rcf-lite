// Tests for `@stravica-ai/rcf-lite-core/patterns/services` - the
// third-party service seed set consumed by the Track A pre-flight scanner
// (verification-integrity-cluster-spec §4.3 / §8.3) and by verify's
// provisioning heuristic (§5.3 / §8.4) once the 0.7.0 build/verify cars
// land.
//
// AC coverage:
//   - services-01: `SERVICE_SEED_PATTERNS_V1` exposes every category from spec §4.4 in document order
//   - services-02: every category is non-empty on `tokens`
//   - services-03: `matchServiceSignals` fires on an email token
//   - services-04: `matchServiceSignals` fires on a payment token AND an explicit vendor
//   - services-05: `matchServiceSignals` fires on an SMS token and a Twilio vendor mention
//   - services-06: `matchServiceSignals` fires on an auth token (OAuth) and the Auth0 vendor
//   - services-07: `matchServiceSignals` fires on a storage token and vendor
//   - services-08: `matchServiceSignals` fires on an LLM token and vendor
//   - services-09: `matchServiceSignals` fires on an analytics token and vendor
//   - services-10: `matchServiceSignals` fires on a feature-flag token and vendor
//   - services-11: `matchServiceSignals` fires on a search token and vendor
//   - services-12: the d-142 regression - "email channel" is caught
//   - services-13: `SERVICE_SEED_PATTERNS_V1` and inner arrays are frozen
//   - services-14: matching is case-insensitive
//   - services-15: hits are returned in document order (stable sort)
//   - services-16: hits carry per-match provenance (category, role, pattern, match, index)
//   - services-17: `GENERIC_SERVICE_VERBS` equals the union of explicitly-listed verbs
//   - services-18: `SERVICE_CATEGORY_KEYS` matches `Object.keys(SERVICE_SEED_PATTERNS_V1)`
//   - services-19: empty / non-string input yields an empty array

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SERVICE_SEED_PATTERNS_V1,
  SERVICE_CATEGORY_KEYS,
  GENERIC_SERVICE_VERBS,
  matchServiceSignals,
} from '../../src/patterns/services.js';

test('services-01: SERVICE_SEED_PATTERNS_V1 exposes every category from spec §4.4 in document order', () => {
  const expected = [
    'emailDelivery',
    'payment',
    'smsVoice',
    'auth',
    'storageCdn',
    'llmAi',
    'analyticsTelemetry',
    'featureFlags',
    'search',
  ];
  assert.deepEqual(Object.keys(SERVICE_SEED_PATTERNS_V1), expected);
  assert.deepEqual([...SERVICE_CATEGORY_KEYS], expected);
});

test('services-02: every category is non-empty on tokens', () => {
  for (const category of SERVICE_CATEGORY_KEYS) {
    const bucket = SERVICE_SEED_PATTERNS_V1[category];
    assert.ok(Array.isArray(bucket.tokens), `${category}.tokens missing`);
    assert.ok(Array.isArray(bucket.verbs), `${category}.verbs missing`);
    assert.ok(Array.isArray(bucket.vendors), `${category}.vendors missing`);
    assert.ok(bucket.tokens.length > 0, `${category}.tokens empty`);
  }
});

test('services-03: matchServiceSignals fires on an email token', () => {
  const signals = matchServiceSignals('Outbound recovery email is dispatched to the operator.');
  const emailHits = signals.filter((s) => s.category === 'emailDelivery').map((s) => s.match.toLowerCase());
  assert.ok(emailHits.some((m) => m === 'email'));
  // "dispatched" also fires (stem match on `dispatch`).
  assert.ok(emailHits.some((m) => m.startsWith('dispatch')));
});

test('services-04: matchServiceSignals fires on a payment token AND an explicit vendor', () => {
  const signals = matchServiceSignals('Checkout goes through Stripe as the payment provider.');
  const paymentHits = signals.filter((s) => s.category === 'payment');
  const roles = new Set(paymentHits.map((s) => s.role));
  assert.ok(roles.has('token'));
  assert.ok(roles.has('vendor'));
  assert.ok(roles.has('verb'));
  const matches = paymentHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.includes('checkout'));
  assert.ok(matches.includes('payment'));
  assert.ok(matches.includes('stripe'));
  assert.ok(matches.includes('provider'));
});

test('services-05: matchServiceSignals fires on an SMS token and a Twilio vendor mention', () => {
  const signals = matchServiceSignals('Send an SMS via Twilio when the call is unanswered.');
  const smsHits = signals.filter((s) => s.category === 'smsVoice');
  const matches = smsHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.includes('sms'));
  assert.ok(matches.includes('twilio'));
  assert.ok(matches.includes('call'));
});

test('services-06: matchServiceSignals fires on an auth token (OAuth) and the Auth0 vendor', () => {
  const signals = matchServiceSignals('Sign-in flows through the OAuth provider managed by Auth0.');
  const authHits = signals.filter((s) => s.category === 'auth');
  const matches = authHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.includes('oauth'));
  assert.ok(matches.includes('auth0'));
  assert.ok(matches.includes('provider'));
});

test('services-07: matchServiceSignals fires on a storage token and vendor', () => {
  const signals = matchServiceSignals('Uploads land in blob storage on Cloudflare R2.');
  const storageHits = signals.filter((s) => s.category === 'storageCdn');
  const matches = storageHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.some((m) => m === 'blob storage'));
  assert.ok(matches.some((m) => m === 'cloudflare r2'));
});

test('services-08: matchServiceSignals fires on an LLM token and vendor', () => {
  const signals = matchServiceSignals('Completions are streamed from the Anthropic inference API.');
  const llmHits = signals.filter((s) => s.category === 'llmAi');
  const matches = llmHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.some((m) => m.startsWith('completion')));
  assert.ok(matches.some((m) => m === 'anthropic'));
  assert.ok(matches.some((m) => m === 'inference'));
});

test('services-09: matchServiceSignals fires on an analytics token and vendor', () => {
  const signals = matchServiceSignals('Event tracking is forwarded to PostHog for analytics.');
  const analyticsHits = signals.filter((s) => s.category === 'analyticsTelemetry');
  const matches = analyticsHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.some((m) => m === 'event tracking'));
  assert.ok(matches.some((m) => m === 'posthog'));
  assert.ok(matches.some((m) => m === 'analytics'));
});

test('services-10: matchServiceSignals fires on a feature-flag token and vendor', () => {
  const signals = matchServiceSignals('The kill-switch is a feature flag managed by LaunchDarkly.');
  const flagHits = signals.filter((s) => s.category === 'featureFlags');
  const matches = flagHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.some((m) => m === 'feature flag'));
  assert.ok(matches.some((m) => m === 'launchdarkly'));
});

test('services-11: matchServiceSignals fires on a search token and vendor', () => {
  const signals = matchServiceSignals('Full-text search is served by Algolia through the search API.');
  const searchHits = signals.filter((s) => s.category === 'search');
  const matches = searchHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.some((m) => m === 'search'));
  assert.ok(matches.some((m) => m === 'algolia'));
  assert.ok(matches.some((m) => m === 'api'));
});

test('services-12: the d-142 regression - "email channel" is caught', () => {
  // The exact watchpost failure mode that motivated the whole seed set.
  // Verify's old SERVICE_PATTERNS regex missed "email channel" and marked
  // FBS-011 provisioning as non-service. This seed set MUST catch it.
  const signals = matchServiceSignals('Email channel via Resend delivers recovery emails.');
  const emailHits = signals.filter((s) => s.category === 'emailDelivery');
  const matches = emailHits.map((s) => s.match.toLowerCase());
  assert.ok(matches.some((m) => m === 'email'), 'email token missing');
  assert.ok(matches.some((m) => m === 'channel'), 'channel verb missing - d-142 regression');
  assert.ok(matches.some((m) => m === 'resend'), 'resend vendor missing');
  // And the derived scanner-level signal: at least one emailDelivery hit exists.
  assert.ok(emailHits.length >= 3);
});

test('services-13: SERVICE_SEED_PATTERNS_V1 and inner arrays are frozen', () => {
  assert.throws(() => { SERVICE_SEED_PATTERNS_V1.newCategory = { tokens: [], verbs: [], vendors: [] }; });
  assert.throws(() => { SERVICE_SEED_PATTERNS_V1.payment.tokens.push('bad'); });
  assert.throws(() => { SERVICE_SEED_PATTERNS_V1.payment.vendors.push('bad'); });
  assert.throws(() => { SERVICE_SEED_PATTERNS_V1.emailDelivery.verbs.push('bad'); });
  assert.throws(() => { GENERIC_SERVICE_VERBS.push('bad'); });
  assert.throws(() => { SERVICE_CATEGORY_KEYS.push('bad'); });
});

test('services-14: matching is case-insensitive', () => {
  const upper = matchServiceSignals('STRIPE handles the CHECKOUT.');
  const lower = matchServiceSignals('stripe handles the checkout.');
  assert.ok(upper.some((s) => s.match.toLowerCase() === 'stripe'));
  assert.ok(lower.some((s) => s.match.toLowerCase() === 'stripe'));
  assert.ok(upper.some((s) => s.match.toLowerCase() === 'checkout'));
  assert.ok(lower.some((s) => s.match.toLowerCase() === 'checkout'));
});

test('services-15: hits are returned in document order (stable sort)', () => {
  const signals = matchServiceSignals(
    'Stripe checkout kicks off, then Twilio sends an SMS, then Resend delivers an email.',
  );
  for (let i = 1; i < signals.length; i += 1) {
    assert.ok(
      signals[i].index >= signals[i - 1].index,
      `hit ${i} out of order: ${JSON.stringify(signals[i - 1])} then ${JSON.stringify(signals[i])}`,
    );
  }
  // And the first vendor mentioned is Stripe (the leftmost hit that carries a vendor role).
  const firstVendor = signals.find((s) => s.role === 'vendor');
  assert.equal(firstVendor?.match.toLowerCase(), 'stripe');
});

test('services-16: hits carry per-match provenance (category, role, pattern, match, index)', () => {
  const signals = matchServiceSignals('Charged to Stripe as the payment provider.');
  assert.ok(signals.length >= 1);
  const first = signals[0];
  assert.equal(typeof first.category, 'string');
  assert.ok(SERVICE_CATEGORY_KEYS.includes(first.category));
  assert.ok(['token', 'verb', 'vendor'].includes(first.role));
  assert.equal(typeof first.pattern, 'string');
  assert.equal(typeof first.match, 'string');
  assert.equal(typeof first.index, 'number');
});

test('services-17: GENERIC_SERVICE_VERBS equals the union of explicitly-listed verbs', () => {
  // The four spec §4.4 categories that DO enumerate their verbs are the
  // input to the union (email, payment, sms/voice, auth, search).
  const explicit = [
    ...SERVICE_SEED_PATTERNS_V1.emailDelivery.verbs,
    ...SERVICE_SEED_PATTERNS_V1.payment.verbs,
    ...SERVICE_SEED_PATTERNS_V1.smsVoice.verbs,
    ...SERVICE_SEED_PATTERNS_V1.auth.verbs,
    ...SERVICE_SEED_PATTERNS_V1.search.verbs,
  ];
  const union = [...new Set(explicit)];
  assert.deepEqual([...GENERIC_SERVICE_VERBS], union);
  // And the four "× verbs" categories point AT the shared array (identity check).
  assert.equal(SERVICE_SEED_PATTERNS_V1.storageCdn.verbs, GENERIC_SERVICE_VERBS);
  assert.equal(SERVICE_SEED_PATTERNS_V1.llmAi.verbs, GENERIC_SERVICE_VERBS);
  assert.equal(SERVICE_SEED_PATTERNS_V1.analyticsTelemetry.verbs, GENERIC_SERVICE_VERBS);
  assert.equal(SERVICE_SEED_PATTERNS_V1.featureFlags.verbs, GENERIC_SERVICE_VERBS);
});

test('services-18: SERVICE_CATEGORY_KEYS matches Object.keys(SERVICE_SEED_PATTERNS_V1)', () => {
  assert.deepEqual([...SERVICE_CATEGORY_KEYS], Object.keys(SERVICE_SEED_PATTERNS_V1));
});

test('services-19: empty / non-string input yields an empty array', () => {
  assert.deepEqual(matchServiceSignals(''), []);
  assert.deepEqual(matchServiceSignals(null), []);
  assert.deepEqual(matchServiceSignals(undefined), []);
  assert.deepEqual(matchServiceSignals(42), []);
});

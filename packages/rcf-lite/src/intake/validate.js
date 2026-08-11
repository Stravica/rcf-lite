// Intake-validation scans (spec §6.4 phase 2).
//
// Deterministic scans applied over the raw artefact text; each finding
// carries a `kind` from the schema enum
//   impliedButNotStated | contradiction | missingLoadBearingConstraint |
//   otherDeclared
// The "otherDeclared" bucket carries a free-text `kindDescription`; the
// deterministic scans in this module never emit "otherDeclared" — that
// bucket exists for the intake-worker subagent reader (spec §6.6),
// which is out of the v1 build scope for this ship.
//
// The scans are BROAD by design; the operator resolves each finding at
// phase 2 before phase 3 hands off to elicitation.

/**
 * @typedef {'impliedButNotStated'|'contradiction'|'missingLoadBearingConstraint'|'otherDeclared'} FindingKind
 */

/**
 * @typedef {object} IntakeFinding
 * @property {FindingKind} kind
 * @property {string} detail
 * @property {string} [kindDescription]
 */

const SERVICE_HINTS = [
  { name: 'Resend', envHint: /RESEND_?API_?KEY/i },
  { name: 'Twilio', envHint: /TWILIO_(?:AUTH_)?TOKEN|TWILIO_ACCOUNT_SID/i },
  { name: 'SendGrid', envHint: /SENDGRID_?API_?KEY/i },
  { name: 'Stripe', envHint: /STRIPE_(?:SECRET|API)_KEY/i },
  { name: 'Slack', envHint: /SLACK_(?:BOT_)?TOKEN|SLACK_WEBHOOK/i },
];

const NEGATED_LOGIN_PHRASES = /\bno (?:login|sign[-\s]?in|auth|authenticat(?:ion|ed))\s+(?:is|required|needed)?/i;
const HAS_ADMIN_UI = /\b(admin(?:istrator)?|dashboard|admin panel|admin route)\b/i;
const HAS_WEB_UI = /\b(browser|html|web page|dashboard|admin)\b/i;
const HAS_BROWSER_SIGNIN = /\b(browser sign[-\s]?in|sign[-\s]?in page|login page|html login)\b/i;
const HAS_API_ONLY = /\b(api[-\s]?only|programmatic (?:client|access)|sdk[-\s]?driven|no browser)\b/i;

/**
 * Scan one artefact and return the deterministic findings.
 *
 * @param {string} text
 * @returns {IntakeFinding[]}
 */
export function scanArtefactForFindings(text) {
  const t = typeof text === 'string' ? text : '';
  const findings = [];

  // impliedButNotStated: brief mentions a web UI but never names the
  // sign-in surface (HTML login page vs API-only).
  if (HAS_WEB_UI.test(t) && !HAS_BROWSER_SIGNIN.test(t) && !HAS_API_ONLY.test(t)) {
    findings.push({
      kind: 'impliedButNotStated',
      detail: 'artefact names a web UI (browser / HTML / dashboard) but does not name whether a browser sign-in page is in scope. The current wording could ship as API-only or with an HTML login; both are consistent with the brief. Resolve before REQ drafting so downstream ACs land on the right shape.',
    });
  }

  // contradiction: brief says "no login required" alongside an admin UI.
  if (NEGATED_LOGIN_PHRASES.test(t) && HAS_ADMIN_UI.test(t)) {
    findings.push({
      kind: 'contradiction',
      detail: 'artefact says "no login required" in one section and names an admin dashboard elsewhere. An unauthenticated admin surface is either a mistake in the brief or a deliberate posture that changes every auth AC downstream.',
    });
  }

  // missingLoadBearingConstraint: brief names a third-party service but
  // does not name the credential env var.
  for (const svc of SERVICE_HINTS) {
    const nameRe = new RegExp(`\\b${svc.name}\\b`, 'i');
    if (nameRe.test(t) && !svc.envHint.test(t)) {
      findings.push({
        kind: 'missingLoadBearingConstraint',
        detail: `artefact names ${svc.name} as an integration but does not name the credential env var. Track A preflight will refuse to accept the service without a declared credential; capture the name now so the preflight session runs against a concrete key.`,
      });
    }
  }

  return findings;
}

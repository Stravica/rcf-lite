// Deployment-gate barrel. Shared primitives downstream project probes
// (TAC-210 external-service-dependency provisioning; TAC-211 core-flow
// end-to-end) import so the placeholder-detection ruleset lives in ONE
// place and extends via a rcf-lite minor bump, not a per-project fork.
//
// Watchpost first-production defect (w-2026-08-24-005, class cure
// w-2026-08-24-006) is the reason this module exists: the app shipped
// with RESEND_API_KEY set to a placeholder, the only login path was
// inert, the gap was filed as a "quirk" note, and sign-off still said
// DEPLOYED. The SPA blueprint v1.3.0 contributions bind those class
// rules; this module is the shared enforcement handle.

export { detectPlaceholderCredentialShape, PLACEHOLDER_DETECTOR_VERSION } from './placeholder-detector.js';

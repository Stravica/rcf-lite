# application-spa CHANGELOG


## 1.5.3 - 2026-09-10

Dimension-b acceptance-criteria-sufficiency cleanup on US-1134 and US-1135: each story previously shipped a single AC. AC-1134-2 added to bind the icon-adherence probe refusal path on inline-SVG or unknown-alias violations against the primary-navigation slot (ownerRef TAC-208.interfaces.runIconAdherenceProbe). AC-1135-2 added to bind the signed-in and post-sign-out deep-link preservation and return-to flow on the app shell (ownerRef TAC-201.responsibilities[0]). Chain-consistency lint zero on pass 1 and pass 2.

## 1.5.2 (B6a application core completion pass, 2026-09-09)

- Donor hand-sweep on all 197 ACs: flipped 19 additional ACs from fixed to template where the assertion carries a project-set literal (per-project section inventories, viewport table widths, journey-inventory checkpoints and events, per-route empty-state text, cache-invalidation entry sets, canonical URL shapes cache keys derive from, offline telemetry buffer bound N, per-route payload budgets, external-dependency inventory, deferral-record path and metadata, core-flow definitions, plus the two review-fix-pass flips on AC-1111-5 tablist activation mode and AC-1116-2 journey preservation set). Each flipped AC carries an Applying agent sets: <specific values> clause. Final split: 173 fixed / 24 template.
- Review fix pass 2026-09-10: F-1 vendorCitation added to AC-1126-4 (WCAG 2.5.8 target-size-minimum) and AC-1126-7 (WCAG 2.2 recommendation); F-2 completion sweep flipped AC-1111-5 and AC-1116-2 to template with Applying agent sets clauses; F-6 internal work-item ids stripped from README v1.2.0 and v1.3.0 changelog paragraphs, from TAC-209 responsibility and tradeoffs, from TAC-210 and TAC-211 purpose, and from AC-1131-3 (the class defect is named without the internal id); F-7 spa guide counts corrected to 76 documents / 35 user stories / 197 acceptance criteria.

## 1.5.1 (B6a application core hardening, 2026-09-09)

- B6a hardening pass: chain-consistency lint zero (pass1 + pass2); added deliveredBy to every REQ pointing at a TAC responsibility or interface, added ownerRef and disposition to every AC per section 7b, closed case drifts on `content-security-policy` in REQ-018, AC-1125-1 and AC-1131-1 to match the owner spelling on TAC-209.
- Added AC-1123-6 (telemetry buffer overflow with drop-oldest and drop-count observability on reconnect) covering the 2026-09-08 review finding F-1 on TAC-206.responsibilities[3], and AC-1107-6 (theme persistence failure: visible session-only theme, aria-live unsaved announcement, no persisted preference) covering F-2 on TAC-202.responsibilities[2].



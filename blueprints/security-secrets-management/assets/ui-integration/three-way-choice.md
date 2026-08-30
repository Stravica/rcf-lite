# The three-way UI choice (elicitation and outcomes)

At first apply the working agent elicits one of three outcomes for the operator-facing Secrets Management surface and records the choice on the manifest header field `uiIntegration.mode`.

## The elicitation

Ask the operator:

> Where should the operator-facing Secrets Management page live?
>
> A. Integrate a Secrets page into an existing project admin UI. Choose this when the project already ships an admin surface (a dashboard, an operations console) and one more page fits.
>
> B. Adopt a separate admin-SPA blueprint that hosts the Secrets page as one of its screens. Choose this when the project does not yet have an admin surface and building a small one is the right move.
>
> C. Decline a UI entirely; rely on the CLI plus the audit stream. Choose this when the project is small, the operator is the only human on the loop, and a page adds surface without adding value.

Record the answer as `uiIntegration.mode: 'integrate' | 'admin-spa' | 'none'` in the manifest.

## Outcome A: `integrate`

The blueprint contributes the field contract for the Secrets page (TAC-905); the host project implements the page inside its existing admin UI. Each row on the page carries:

- `name` (the manifest logical name)
- `environment` (the active environment for this page's view; the page may offer an environment switcher)
- `owner` (from the manifest entry)
- `lastRotatedAt` (from the vendor)
- `rotationDays` (from the manifest entry)
- `required` (from the manifest entry)

No cell renders a secret value. A "request rotation" action per row hands off to the project's own rotation procedure (a link, a modal describing the vendor's rotation flow, an operator-authored runbook); the blueprint does not itself run the rotation.

## Outcome B: `admin-spa`

The blueprint records the choice; the project applies the companion admin-SPA blueprint (unshipped at v1.0.0, promotion signal: the third project asks for this outcome) which hosts the Secrets page as one of its screens against the same field contract. Until the companion ships, this outcome is a placeholder: the operator's stated intent is that when the companion exists, that is where the page will live.

## Outcome C: `none`

The blueprint contributes nothing to the operator UI surface. The CLI and the audit stream are the only operator-facing surfaces this blueprint ships. A project that later wants a UI can supersede the choice by re-eliciting and picking `integrate` or `admin-spa` at that point; the change is a manifest header edit and the corresponding TAC realisation.

## What the choice must NOT do

- The choice must not force the presence of a UI on a project that does not want one.
- The choice must not force the absence of a UI on a project that already has an admin surface where one more page belongs.
- The choice must not, at any outcome, put a secret value on a rendered page. The field contract fixes the surface; no outcome relaxes it.

# Contrast audit report

WCAG 2.1 AA (`>= 4.5:1` text; `>= 3:1` large text and non-text UI boundaries). Approximate pairs are
rules that declare `color` without a block-level `background` / `background-color`; the audit records
the worst-case against the three ancestor-surface candidates `--sv-canvas` / `--sv-surface` / `--sv-raised`.

Light pairs: 181 (failures: 0).
Dark pairs: 191 (failures: 0).

## Light theme

| selector | state | theme | fg | bg | fg (resolved) | bg (resolved) | ratio | threshold | kind | pass | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `body` | default | light | `var(--sv-ink)` | `var(--sv-canvas)` | #111927 | #f6f8fc | 16.57:1 | 4.5:1 | text | yes |  |
| `.brand` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.product .name` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.product .sub` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `nav.tabs button` | default | light | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `nav.tabs button:hover` | hover | light | `var(--sv-ink)` | `var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes |  |
| `nav.tabs button[aria-selected="true"]` | aria-selected | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `h2.tab-heading` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 3:1 | large-text | yes (approx) | bg inherited |
| `.group-heading` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `article.doc h3` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `article.doc h4` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `article.doc h5` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.field-list dl dt` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.field-list table.field-table th` | default | light | `var(--sv-ink)` | `var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes |  |
| `.ac-meta` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.ac-pills .ac-pill` | default | light | `var(--sv-link)` | `var(--colour-ac)` | #2447eb | #e0e7ff | 5.37:1 | 4.5:1 | text | yes |  |
| `details.doc-details > summary` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.nested-details > h4` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.raw-json summary` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.raw-json summary:hover` | hover | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `a` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `a:hover` | hover | light | `var(--sv-hover)` | `(inherited) ~ var(--sv-raised)` | #1737c7 | #eef2f8 | 7.76:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `code` | default | light | `var(--sv-link)` | `var(--sv-code)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes |  |
| `.status.notStarted` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.inProgress` | default | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.status.complete` | default | light | `var(--sv-success)` | `var(--sv-successbg)` | #116b4d | #e7f4ed | 5.74:1 | 4.5:1 | text | yes |  |
| `.status.verified` | default | light | `var(--sv-success)` | `var(--sv-successbg)` | #116b4d | #e7f4ed | 5.74:1 | 4.5:1 | text | yes |  |
| `.status.blocked` | default | light | `var(--sv-danger)` | `var(--sv-dangerbg)` | #b4233b | #fdecf0 | 5.68:1 | 4.5:1 | text | yes |  |
| `.status.draft` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.review` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.needsRevision` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.approved` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.superseded` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.deprecated` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.proposed` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.accepted` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.approved` | default | light | `var(--sv-success)` | `var(--sv-successbg)` | #116b4d | #e7f4ed | 5.74:1 | 4.5:1 | text | yes |  |
| `.status.accepted` | default | light | `var(--sv-success)` | `var(--sv-successbg)` | #116b4d | #e7f4ed | 5.74:1 | 4.5:1 | text | yes |  |
| `.status.deprecated` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.status.superseded` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.broken` | default | light | `var(--sv-danger)` | `var(--sv-dangerbg)` | #b4233b | #fdecf0 | 5.68:1 | 4.5:1 | text | yes |  |
| `.tree-errors` | default | light | `var(--sv-danger)` | `var(--sv-dangerbg)` | #b4233b | #fdecf0 | 5.68:1 | 4.5:1 | text | yes |  |
| `.tree-errors h2` | default | light | `var(--sv-danger)` | `(inherited) ~ var(--sv-raised)` | #b4233b | #eef2f8 | 5.76:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer a` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer .sep` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer .live` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `#rcf-scope-banner` | default | light | `var(--sv-warning)` | `var(--sv-warningbg)` | #895000 | #fff3dc | 5.95:1 | 4.5:1 | text | yes |  |
| `#rcf-scope-banner a` | default | light | `var(--sv-danger)` | `(inherited) ~ var(--sv-raised)` | #b4233b | #eef2f8 | 5.76:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-group-btn` | default | light | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.pm-group-btn:hover` | hover | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.pm-group-btn[aria-selected="true"]` | aria-selected | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.pm-status-filter` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-status-select` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.pm-bulk-btn` | default | light | `var(--sv-muted)` | `var(--sv-surface)` | #536176 | #ffffff | 6.29:1 | 4.5:1 | text | yes |  |
| `.pm-bulk-btn:hover` | hover | light | `var(--sv-ink)` | `var(--sv-active)` | #111927 | #e9eeff | 15.21:1 | 4.5:1 | text | yes |  |
| `.pm-group-heading` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-jump-chip` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.pm-jump-chip:hover` | hover | light | `var(--sv-hover)` | `var(--sv-active)` | #1737c7 | #e9eeff | 7.53:1 | 4.5:1 | text | yes |  |
| `.pm-jump-chip .pm-jump-count` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.pm-bucket > summary.pm-bucket-heading` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-bucket-count` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-mini` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.pm-mini-approved` | default | light | `var(--sv-success)` | `var(--sv-successbg)` | #116b4d | #e7f4ed | 5.74:1 | 4.5:1 | text | yes |  |
| `.pm-mini-review` | default | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.pm-mini-draft` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.pm-mini-needsRevision` | default | light | `var(--sv-danger)` | `var(--sv-dangerbg)` | #b4233b | #fdecf0 | 5.68:1 | 4.5:1 | text | yes |  |
| `.pm-mini-superseded` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.pm-bucket-empty` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-empty-toggle` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.pm-empty-toggle:hover` | hover | light | `var(--sv-ink)` | `var(--sv-active)` | #111927 | #e9eeff | 15.21:1 | 4.5:1 | text | yes |  |
| `.pm-group[data-pm-loading="true"] .pm-jump-nav::after` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-blueprint-badge` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.pm-blueprint-cap-heading` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-blueprint-cap-count` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.rcf-row > summary` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.rcf-row > summary .id` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.rcf-badge .rcf-badge-label` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge .rcf-badge-value` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--facet` | default | light | `var(--sv-ink)` | `var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes |  |
| `.rcf-badge--facet .rcf-badge-value` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--accent` | default | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.rcf-badge--accent .rcf-badge-label` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--accent .rcf-badge-value` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-text` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-filterbar .rcf-filter-label` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-select` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-filterbar .rcf-filter-toggle` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-count` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-expand` | default | light | `var(--sv-link)` | `none ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg unresolved |
| `.rcf-filterbar .rcf-filter-expand:hover` | hover | light | `var(--sv-hover)` | `(inherited) ~ var(--sv-raised)` | #1737c7 | #eef2f8 | 7.76:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-empty-state` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.rcf-empty-state .rcf-empty-state-title` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-empty-state .rcf-empty-state-action` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-toast` | default | light | `var(--sv-canvas)` | `var(--sv-ink)` | #f6f8fc | #111927 | 16.57:1 | 4.5:1 | text | yes |  |
| `.rcf-subtabs button` | default | light | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.rcf-subtabs button:hover` | hover | light | `var(--sv-ink)` | `var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes |  |
| `.rcf-subtabs button[aria-selected="true"]` | aria-selected | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.rcf-row.needs-work > summary .rcf-badge--accent` | default | light | `var(--sv-warning)` | `(inherited) ~ var(--sv-raised)` | #895000 | #eef2f8 | 5.82:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-req-needswork` | default | light | `var(--sv-warning)` | `var(--sv-warningbg)` | #895000 | #fff3dc | 5.95:1 | 4.5:1 | text | yes |  |
| `.rcf-req-stories > h4` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-req-slice > summary` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-req-raw > summary` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-prd-requirements-open` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-head` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-total` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-input` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-entity-selector-result` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-result-id` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-result-facet` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-chip` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-entity-selector-chip:hover` | hover | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.rcf-entity-selector-chip:hover .rcf-badge-value` | hover | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-architecture-head-id` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-section-title > strong` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-preview` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-empty` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-raw > summary` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-arch-row > summary .id` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-build-head-id` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-build-stat-n` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 3:1 | large-text | yes (approx) | bg inherited |
| `.rcf-build-stat-l` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-spec-order` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-spec-id` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-pill--build-queue` | default | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.rcf-spec-block > h4` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-select` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-chip` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-chip[aria-pressed="true"]` | aria-pressed | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-canvas` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-colhead` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-lane-head` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-node` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-node-id` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-node-tag` | default | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-inspector-body h4` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-search-btn` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn:hover` | hover | light | `var(--sv-ink)` | `var(--sv-active)` | #111927 | #e9eeff | 15.21:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn:focus-visible` | focus-visible | light | `var(--sv-ink)` | `var(--sv-active)` | #111927 | #e9eeff | 15.21:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn:active` | active | light | `var(--sv-ink)` | `var(--sv-active)` | #111927 | #e9eeff | 15.21:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn .rcf-search-icon` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 3:1 | ui-boundary | yes (approx) | bg inherited |
| `.rcf-search-btn .rcf-search-kbd` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-search-btn .rcf-search-kbd kbd` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-theme-btn` | default | light | `var(--sv-ink)` | `transparent ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.rcf-theme-btn:hover` | hover | light | `var(--sv-ink)` | `var(--sv-active)` | #111927 | #e9eeff | 15.21:1 | 4.5:1 | text | yes |  |
| `.rcf-theme-btn[aria-pressed="true"]` | aria-pressed | light | `var(--sv-onbutton)` | `var(--sv-button)` | #ffffff | #2447eb | 6.61:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-close` | default | light | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.rcf-lookup-label` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-status` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-kind` | default | light | `var(--sv-pill-text, #2a3550)` | `var(--sv-pill-bg, #e4e9f4)` | #2a3550 | #e4e9f4 | 10.01:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-ac` | default | light | `#4a2a7a` | `#ede1ff` | #4a2a7a | #ede1ff | 8.83:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-us` | default | light | `#1f3f78` | `#d8e8ff` | #1f3f78 | #d8e8ff | 8.29:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-req` | default | light | `#1f5733` | `#d5efe0` | #1f5733 | #d5efe0 | 6.99:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-tac` | default | light | `#704000` | `#ffe6cc` | #704000 | #ffe6cc | 7.20:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-adr` | default | light | `#7a2222` | `#ffd9d9` | #7a2222 | #ffd9d9 | 7.78:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-fbs` | default | light | `#2a3550` | `#e2e7f2` | #2a3550 | #e2e7f2 | 9.83:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-ts` | default | light | `#5a2070` | `#f3dbff` | #5a2070 | #f3dbff | 8.74:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-prd` | default | light | `#705300` | `#fff2b8` | #705300 | #fff2b8 | 6.37:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-tad` | default | light | `#0f3f6a` | `#cfe9ff` | #0f3f6a | #cfe9ff | 8.64:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-bs` | default | light | `#333333` | `#e4e4e4` | #333333 | #e4e4e4 | 9.94:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-parent` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-snippet` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-empty` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-pill` | default | light | `var(--sv-ink)` | `var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--ok` | default | light | `var(--sv-success)` | `var(--sv-successbg)` | #116b4d | #e7f4ed | 5.74:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--warn` | default | light | `var(--sv-warning)` | `var(--sv-warningbg)` | #895000 | #fff3dc | 5.95:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--fail` | default | light | `var(--sv-danger)` | `var(--sv-dangerbg)` | #b4233b | #fdecf0 | 5.68:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--info` | default | light | `var(--sv-link)` | `var(--sv-active)` | #2447eb | #e9eeff | 5.71:1 | 4.5:1 | text | yes |  |
| `.rcf-chain-term` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-question-group__head h3` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--q` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.rcf-badge--count` | default | light | `var(--sv-muted)` | `var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes |  |
| `.rcf-po-reqwork__table th` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-reqwork__id` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-reqwork__empty` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-engineer-section .rcf-row.doc-row > summary .id` | default | light | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #111927 | #eef2f8 | 15.68:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-stage-legend` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |
| `.rcf-stage-legend__table th` | default | light | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #536176 | #eef2f8 | 5.60:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-stage-legend__table .rcf-stage-legend__code code` | default | light | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #2447eb | #eef2f8 | 5.89:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-stage-legend__close` | default | light | `var(--sv-ink)` | `var(--sv-surface)` | #111927 | #ffffff | 17.61:1 | 4.5:1 | text | yes |  |

## Dark theme

| selector | state | theme | fg | bg | fg (resolved) | bg (resolved) | ratio | threshold | kind | pass | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `body` | default | dark | `var(--sv-ink)` | `var(--sv-canvas)` | #edf2fa | #0b111b | 16.83:1 | 4.5:1 | text | yes |  |
| `.brand` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.product .name` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.product .sub` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `nav.tabs button` | default | dark | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `nav.tabs button:hover` | hover | dark | `var(--sv-ink)` | `var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes |  |
| `nav.tabs button[aria-selected="true"]` | aria-selected | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `h2.tab-heading` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 3:1 | large-text | yes (approx) | bg inherited |
| `.group-heading` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `article.doc h3` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `article.doc h4` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `article.doc h5` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.field-list dl dt` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.field-list table.field-table th` | default | dark | `var(--sv-ink)` | `var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes |  |
| `.ac-meta` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.ac-pills .ac-pill` | default | dark | `var(--sv-link)` | `var(--colour-ac) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg unresolved |
| `details.doc-details > summary` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.nested-details > h4` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.raw-json summary` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.raw-json summary:hover` | hover | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `a` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `a:hover` | hover | dark | `var(--sv-hover)` | `(inherited) ~ var(--sv-raised)` | #c0cdff | #182334 | 10.10:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `code` | default | dark | `var(--sv-link)` | `var(--sv-code)` | #a3b5ff | #0d1521 | 9.26:1 | 4.5:1 | text | yes |  |
| `.status.notStarted` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.inProgress` | default | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.status.complete` | default | dark | `var(--sv-success)` | `var(--sv-successbg)` | #80d9b1 | #102d24 | 8.77:1 | 4.5:1 | text | yes |  |
| `.status.verified` | default | dark | `var(--sv-success)` | `var(--sv-successbg)` | #80d9b1 | #102d24 | 8.77:1 | 4.5:1 | text | yes |  |
| `.status.blocked` | default | dark | `var(--sv-danger)` | `var(--sv-dangerbg)` | #ffa3b3 | #361c28 | 8.23:1 | 4.5:1 | text | yes |  |
| `.status.draft` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.review` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.needsRevision` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.approved` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.superseded` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.deprecated` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.proposed` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.accepted` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.approved` | default | dark | `var(--sv-success)` | `var(--sv-successbg)` | #80d9b1 | #102d24 | 8.77:1 | 4.5:1 | text | yes |  |
| `.status.accepted` | default | dark | `var(--sv-success)` | `var(--sv-successbg)` | #80d9b1 | #102d24 | 8.77:1 | 4.5:1 | text | yes |  |
| `.status.deprecated` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.status.superseded` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.broken` | default | dark | `var(--sv-danger)` | `var(--sv-dangerbg)` | #ffa3b3 | #361c28 | 8.23:1 | 4.5:1 | text | yes |  |
| `.tree-errors` | default | dark | `var(--sv-danger)` | `var(--sv-dangerbg)` | #ffa3b3 | #361c28 | 8.23:1 | 4.5:1 | text | yes |  |
| `.tree-errors h2` | default | dark | `var(--sv-danger)` | `(inherited) ~ var(--sv-raised)` | #ffa3b3 | #182334 | 8.38:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer a` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer .sep` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `footer.app-footer .live` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `#rcf-scope-banner` | default | dark | `var(--sv-warning)` | `var(--sv-warningbg)` | #f1ca7a | #322712 | 9.39:1 | 4.5:1 | text | yes |  |
| `#rcf-scope-banner a` | default | dark | `var(--sv-danger)` | `(inherited) ~ var(--sv-raised)` | #ffa3b3 | #182334 | 8.38:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-group-btn` | default | dark | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.pm-group-btn:hover` | hover | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.pm-group-btn[aria-selected="true"]` | aria-selected | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.pm-status-filter` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-status-select` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.pm-bulk-btn` | default | dark | `var(--sv-muted)` | `var(--sv-surface)` | #aab7ca | #101925 | 8.70:1 | 4.5:1 | text | yes |  |
| `.pm-bulk-btn:hover` | hover | dark | `var(--sv-ink)` | `var(--sv-active)` | #edf2fa | #1d2c50 | 12.22:1 | 4.5:1 | text | yes |  |
| `.pm-group-heading` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-jump-chip` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.pm-jump-chip:hover` | hover | dark | `var(--sv-hover)` | `var(--sv-active)` | #c0cdff | #1d2c50 | 8.78:1 | 4.5:1 | text | yes |  |
| `.pm-jump-chip .pm-jump-count` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.pm-bucket > summary.pm-bucket-heading` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-bucket-count` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-mini` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.pm-mini-approved` | default | dark | `var(--sv-success)` | `var(--sv-successbg)` | #80d9b1 | #102d24 | 8.77:1 | 4.5:1 | text | yes |  |
| `.pm-mini-review` | default | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.pm-mini-draft` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.pm-mini-needsRevision` | default | dark | `var(--sv-danger)` | `var(--sv-dangerbg)` | #ffa3b3 | #361c28 | 8.23:1 | 4.5:1 | text | yes |  |
| `.pm-mini-superseded` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.pm-bucket-empty` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-empty-toggle` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.pm-empty-toggle:hover` | hover | dark | `var(--sv-ink)` | `var(--sv-active)` | #edf2fa | #1d2c50 | 12.22:1 | 4.5:1 | text | yes |  |
| `.pm-group[data-pm-loading="true"] .pm-jump-nav::after` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-blueprint-badge` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.pm-blueprint-cap-heading` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.pm-blueprint-cap-count` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.rcf-row > summary` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.rcf-row > summary .id` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.rcf-badge .rcf-badge-label` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge .rcf-badge-value` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--facet` | default | dark | `var(--sv-ink)` | `var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes |  |
| `.rcf-badge--facet .rcf-badge-value` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--accent` | default | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.rcf-badge--accent .rcf-badge-label` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--accent .rcf-badge-value` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-text` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-filterbar .rcf-filter-label` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-select` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-filterbar .rcf-filter-toggle` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-count` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-filterbar .rcf-filter-expand` | default | dark | `var(--sv-link)` | `none ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg unresolved |
| `.rcf-filterbar .rcf-filter-expand:hover` | hover | dark | `var(--sv-hover)` | `(inherited) ~ var(--sv-raised)` | #c0cdff | #182334 | 10.10:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-empty-state` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.rcf-empty-state .rcf-empty-state-title` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-empty-state .rcf-empty-state-action` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-toast` | default | dark | `var(--sv-canvas)` | `var(--sv-ink)` | #0b111b | #edf2fa | 16.83:1 | 4.5:1 | text | yes |  |
| `.rcf-subtabs button` | default | dark | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.rcf-subtabs button:hover` | hover | dark | `var(--sv-ink)` | `var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes |  |
| `.rcf-subtabs button[aria-selected="true"]` | aria-selected | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `details.rcf-row.needs-work > summary .rcf-badge--accent` | default | dark | `var(--sv-warning)` | `(inherited) ~ var(--sv-raised)` | #f1ca7a | #182334 | 10.14:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-req-needswork` | default | dark | `var(--sv-warning)` | `var(--sv-warningbg)` | #f1ca7a | #322712 | 9.39:1 | 4.5:1 | text | yes |  |
| `.rcf-req-stories > h4` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-req-slice > summary` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-req-raw > summary` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-prd-requirements-open` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-head` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-total` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-input` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-entity-selector-result` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-result-id` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-result-facet` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-entity-selector-chip` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-entity-selector-chip:hover` | hover | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.rcf-entity-selector-chip:hover .rcf-badge-value` | hover | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-architecture-head-id` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-section-title > strong` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-preview` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-empty` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-tad-raw > summary` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-arch-row > summary .id` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-build-head-id` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-build-stat-n` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 3:1 | large-text | yes (approx) | bg inherited |
| `.rcf-build-stat-l` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-spec-order` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-spec-id` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-pill--build-queue` | default | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.rcf-spec-block > h4` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-select` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-chip` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-chip[aria-pressed="true"]` | aria-pressed | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-canvas` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-colhead` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-lane-head` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-node` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-node-id` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-dag-node-tag` | default | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.rcf-dag-inspector-body h4` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-search-btn` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn:hover` | hover | dark | `var(--sv-ink)` | `var(--sv-active)` | #edf2fa | #1d2c50 | 12.22:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn:focus-visible` | focus-visible | dark | `var(--sv-ink)` | `var(--sv-active)` | #edf2fa | #1d2c50 | 12.22:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn:active` | active | dark | `var(--sv-ink)` | `var(--sv-active)` | #edf2fa | #1d2c50 | 12.22:1 | 4.5:1 | text | yes |  |
| `.rcf-search-btn .rcf-search-icon` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 3:1 | ui-boundary | yes (approx) | bg inherited |
| `.rcf-search-btn .rcf-search-kbd` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-search-btn .rcf-search-kbd kbd` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-theme-btn` | default | dark | `var(--sv-ink)` | `transparent ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.rcf-theme-btn:hover` | hover | dark | `var(--sv-ink)` | `var(--sv-active)` | #edf2fa | #1d2c50 | 12.22:1 | 4.5:1 | text | yes |  |
| `.rcf-theme-btn[aria-pressed="true"]` | aria-pressed | dark | `var(--sv-onbutton)` | `var(--sv-button)` | #0b111b | #a3b5ff | 9.56:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-close` | default | dark | `var(--sv-muted)` | `transparent ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg transparent -> inherited |
| `.rcf-lookup-label` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-status` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-kind` | default | dark | `var(--sv-pill-text, #2a3550)` | `var(--sv-pill-bg, #e4e9f4)` | #2a3550 | #e4e9f4 | 10.01:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-ac` | default | dark | `#4a2a7a` | `#ede1ff` | #4a2a7a | #ede1ff | 8.83:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-us` | default | dark | `#1f3f78` | `#d8e8ff` | #1f3f78 | #d8e8ff | 8.29:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-req` | default | dark | `#1f5733` | `#d5efe0` | #1f5733 | #d5efe0 | 6.99:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-tac` | default | dark | `#704000` | `#ffe6cc` | #704000 | #ffe6cc | 7.20:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-adr` | default | dark | `#7a2222` | `#ffd9d9` | #7a2222 | #ffd9d9 | 7.78:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-fbs` | default | dark | `#2a3550` | `#e2e7f2` | #2a3550 | #e2e7f2 | 9.83:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-ts` | default | dark | `#5a2070` | `#f3dbff` | #5a2070 | #f3dbff | 8.74:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-prd` | default | dark | `#705300` | `#fff2b8` | #705300 | #fff2b8 | 6.37:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-tad` | default | dark | `#0f3f6a` | `#cfe9ff` | #0f3f6a | #cfe9ff | 8.64:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-kind-bs` | default | dark | `#333333` | `#e4e4e4` | #333333 | #e4e4e4 | 9.94:1 | 4.5:1 | text | yes |  |
| `.rcf-lookup-parent` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-snippet` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-lookup-empty` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `html[data-theme="dark"] .rcf-lookup-kind-ac` | default | dark | `#e2c9ff` | `rgba(140, 90, 220, 0.3) over var(--sv-raised)` | #e2c9ff | #3b3466 | 7.51:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-us` | default | dark | `#c4dcff` | `rgba(80, 130, 220, 0.3) over var(--sv-raised)` | #c4dcff | #294066 | 7.44:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-req` | default | dark | `#c3eacc` | `rgba(80, 170, 110, 0.3) over var(--sv-raised)` | #c3eacc | #294c45 | 7.21:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-tac` | default | dark | `#ffd4a8` | `rgba(200, 130, 60, 0.3) over var(--sv-raised)` | #ffd4a8 | #4d4036 | 7.25:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-adr` | default | dark | `#ffc9c9` | `rgba(220, 100, 100, 0.3) over var(--sv-raised)` | #ffc9c9 | #533742 | 7.25:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-ts` | default | dark | `#e8c9ff` | `rgba(180, 110, 220, 0.3) over var(--sv-raised)` | #e8c9ff | #473a66 | 6.89:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-fbs` | default | dark | `#d4dbea` | `rgba(140, 150, 170, 0.3) over var(--sv-raised)` | #d4dbea | #3b4657 | 6.87:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-prd` | default | dark | `#ffe88b` | `rgba(200, 170, 60, 0.3) over var(--sv-raised)` | #ffe88b | #4d4c36 | 7.15:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-tad` | default | dark | `#c7e6ff` | `rgba(80, 160, 220, 0.3) over var(--sv-raised)` | #c7e6ff | #294966 | 7.23:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `html[data-theme="dark"] .rcf-lookup-kind-bs` | default | dark | `#d9d9d9` | `rgba(160, 160, 160, 0.3) over var(--sv-raised)` | #d9d9d9 | #414954 | 6.45:1 | 4.5:1 | text | yes (approx) | bg semi-transparent |
| `.rcf-pill` | default | dark | `var(--sv-ink)` | `var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--ok` | default | dark | `var(--sv-success)` | `var(--sv-successbg)` | #80d9b1 | #102d24 | 8.77:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--warn` | default | dark | `var(--sv-warning)` | `var(--sv-warningbg)` | #f1ca7a | #322712 | 9.39:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--fail` | default | dark | `var(--sv-danger)` | `var(--sv-dangerbg)` | #ffa3b3 | #361c28 | 8.23:1 | 4.5:1 | text | yes |  |
| `.rcf-pill--info` | default | dark | `var(--sv-link)` | `var(--sv-active)` | #a3b5ff | #1d2c50 | 6.94:1 | 4.5:1 | text | yes |  |
| `.rcf-chain-term` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-question-group__head h3` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-badge--q` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.rcf-badge--count` | default | dark | `var(--sv-muted)` | `var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes |  |
| `.rcf-po-reqwork__table th` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-reqwork__id` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-reqwork__empty` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-po-engineer-section .rcf-row.doc-row > summary .id` | default | dark | `var(--sv-ink)` | `(inherited) ~ var(--sv-raised)` | #edf2fa | #182334 | 14.06:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-stage-legend` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |
| `.rcf-stage-legend__table th` | default | dark | `var(--sv-muted)` | `(inherited) ~ var(--sv-raised)` | #aab7ca | #182334 | 7.78:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-stage-legend__table .rcf-stage-legend__code code` | default | dark | `var(--sv-link)` | `(inherited) ~ var(--sv-raised)` | #a3b5ff | #182334 | 7.99:1 | 4.5:1 | text | yes (approx) | bg inherited |
| `.rcf-stage-legend__close` | default | dark | `var(--sv-ink)` | `var(--sv-surface)` | #edf2fa | #101925 | 15.73:1 | 4.5:1 | text | yes |  |

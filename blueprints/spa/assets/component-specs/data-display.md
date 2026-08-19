# Component specs: data display

Contracts for card, table, tabs, and pagination (spa-US-1111).

## Card

Anatomy: surface-raised fill, radius-md, elevation-1, space-4 or space-6 internal padding, optional media slot, heading, body, actions row. Clickable-whole-card: exactly one link covering the card with one accessible name; secondary actions inside remain independently operable without nested-interactive violations (AC-1111-1). Hover on clickable cards: elevation-2 shift. Cards never carry their own bespoke palette; intent accents come from semantic tokens.

## Table

Markup: semantic table, thead/th with scope, caption or labelled heading. Column headers associate to cells (AC-1111-2). Sortable headers are buttons inside th exposing aria-sort, cycling none, ascending, descending (AC-1111-3). Row density: space-3 vertical padding; zebra striping optional via surface-raised; row hover highlight where rows act. Below 768: card layout per row, or a table-scoped horizontal scroll container with a visible affordance; the page never scrolls horizontally (AC-1105-4). Owns its state quartet: skeleton rows for loading, in-table empty state, in-table error with retry (AC-1111-4). Bulk selection, where declared: header checkbox supports all and indeterminate; selected count surfaces with the bulk actions.

## Tabs

Pattern (AC-1111-5): tablist with tab roles; one Tab stop; ArrowLeft/ArrowRight move between tabs (Home and End jump); activation mode declared per use (automatic on focus, or manual with Enter/Space); each panel labelled by its tab. Active tab: primary underline or fill indicator meeting 3:1 non-text contrast plus a non-colour signal. Persistence, where the journey spec declares it, serialises the active tab to the URL or stored state (AC-1111-6). Overflowing tab sets scroll within the tablist with affordances, never wrap into a second row.

## Pagination

Anatomy: previous, numbered window or position statement, next; optional page-size select. Impossible moves render disabled with state exposed, not hidden (AC-1111-7). Current page exposed via aria-current. Page changes update the canonical URL (AC-1111-8) and move focus predictably to the updated collection region. Cursor-paginated collections without total counts state relative position honestly (for example "Page 3") without inventing totals.

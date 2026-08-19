# Viewport table

The ratified baseline breakpoints (spa-REQ-004) and the layout behaviour declared at each. Every declared route must render without page-level horizontal overflow at all four widths (AC-1105-1).

| Breakpoint | Width | Container max-width | Columns | Navigation | Tables |
|---|---|---|---|---|---|
| bp-360 | 360px | 100% minus space-4 gutters | 4 | Top bar with menu disclosure; side nav closed | Card layout or scoped scroll container |
| bp-768 | 768px | 720px | 8 | Top bar full; side nav collapsible | Card layout or scoped scroll container up to 768; full table above |
| bp-1024 | 1024px | 960px | 12 | Top bar full; side nav open where declared | Full table |
| bp-1440 | 1440px | 1280px | 12 | Top bar full; side nav open where declared | Full table |

Rules that hold at every width:

- Reflow, not scale: layout reorganises between breakpoints (AC-1105-2); between the named widths the layout is fluid within the active column grid.
- Body text: minimum 14px below 768, minimum 16px at 768 and above; fluid between (spa-REQ-020).
- Interactive targets: minimum 24x24 CSS pixels at every width (AC-1105-6).
- Safe areas: shell chrome applies safe-area insets on notched viewports (spa-REQ-003).
- Test the four named widths as the floor, not the ceiling: resize continuously between 360 and 1440 when verifying reflow (AC-1127-3).

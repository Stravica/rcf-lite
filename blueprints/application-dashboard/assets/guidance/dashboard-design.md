# Dashboard design guidance

A packaged asset shipped with the `application-dashboard` blueprint. Read at apply, referenced at project-side review, and cited from every REQ, ADR and pack check that anchors on a design rule. The applying agent honours the eight sections below. Where a section names an AC id, the rule is a runtime-observable AC on this blueprint (the ship gate refuses on failure). Where a section stays operator guidance, the applying agent honours it and the shipping surface is reviewed by hand.

Sources are cited by URL at each section. Five bodies of work anchor this guidance:

- Nielsen Norman Group research on how people read on the web: https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
- Stephen Few's dashboard-design library at Perceptual Edge: https://www.perceptualedge.com/library.php
- Edward Tufte, The Visual Display of Quantitative Information (Wikipedia reference): https://en.wikipedia.org/wiki/The_Visual_Display_of_Quantitative_Information
- GOV.UK Design System patterns index: https://design-system.service.gov.uk/patterns/
- WCAG 2.2 Understanding docs: https://www.w3.org/WAI/WCAG22/Understanding/

## 1. Primary KPI placement

The primary KPI is the reader's anchor. Place it top-left on every ratified breakpoint (1440, 1024, 360). NN/g's F-shaped-pattern reading research reports that the top-left region of a text-heavy layout is where a reader's eye lands first; that is the spot the anchor tile has to occupy. On a 360 phone layout the tile row reflows to one column and the primary KPI stays first in DOM order and top of the stack.

The primary KPI kind is one of five values (ADR-2001): `revenue`, `active-users`, `error-rate`, `throughput`, `custom`. A `custom` value carries a short operator name in `data-kpi-name`. A dashboard with no primary KPI fails project-side review.

Sources:
- NN/g F-shaped pattern of reading: https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
- Stephen Few, Dashboard Design for Rich and Rapid Monitoring (Perceptual Edge): https://www.perceptualedge.com/articles/visual_business_intelligence/dd_for_rapid_monitoring.pdf

Hardens into AC-19102-1.

## 2. Tile density and count limits

Keep the tile row to at most eight tiles. Beyond eight the glance value drops sharply; a reader scanning a nine-tile row misses the middle tiles on the first fixation and either scrolls or gives up. If the dashboard needs more metrics, break them into a second view (a drilldown), not a longer row.

A stat tile carries one number. A stat tile that tries to carry a mini-chart and three numbers is a small dashboard inside a dashboard; move it to its own dashboard slot instead.

The primary tile can be visually heavier than the supporting tiles (a larger value, an accent border) but the shape stays a stat tile: one metric, one context line, one state.

Sources:
- Stephen Few, Dashboard Confusion Revisited (Perceptual Edge): https://www.perceptualedge.com/articles/visual_business_intelligence/dboard_confusion_revisited.pdf
- Tufte on chartjunk (Wikipedia summary of the concept): https://en.wikipedia.org/wiki/Chartjunk

Stays operator guidance.

## 3. Timeframe and filter chrome

The timeframe picker is one of the most-touched controls on the surface. Ship three presets by recommendedDefault (ADR-2002): `last-7-days`, `last-30-days`, `quarter-to-date`. `last-7-days` is the ship default unless the operator elicits an override. Operators may supply their own preset set (a fiscal-year window, a shift window) at apply; missing presets are ignored, extra presets append.

Filter chrome exposes each operator-configured filter as a labelled interactive control (a `<button>`, a `<select>`, or an `<input>`), keyboard-reachable in reading order before the tile row. A hover-only filter is refused; a dropdown that opens on hover fails the accessibility contract.

Sources:
- GOV.UK Design System patterns index (the standalone filter pattern page has been retired; the index is the current landing): https://design-system.service.gov.uk/patterns/
- WCAG 2.2 Understanding SC 2.1.1 Keyboard: https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html
- WCAG 2.2 Understanding SC 1.4.13 Content on Hover or Focus: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html

Hardens into AC-19105-1 and the fan-out rule under AC-19104-1.

## 4. Loading, empty and error states

Every tile carries the same four-state contract: `loading`, `empty`, `error`, `populated`. Each state has a distinct visual cue and a distinct accessible name; the state's cue is not colour-only (WCAG 1.4.1). A loading tile renders a skeleton or a spinner; an empty tile renders a labelled empty-state block; an error tile renders a labelled error block with the recorded reason; a populated tile renders the metric.

Every tile wraps its content in a `role="region"` element with `aria-live="polite"` so a state change is announced to assistive tech.

Sources:
- NN/g on empty states: https://www.nngroup.com/articles/empty-state-interface-design/
- WCAG 2.2 Understanding SC 1.4.1 Use of Colour: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- WCAG 2.2 Understanding SC 4.1.3 Status Messages: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html

Hardens into AC-19103-1 and AC-19103-2.

## 5. Colour and contrast

Dashboard tiles read at a glance; low contrast punishes the reader. Text on a tile carries at least 4.5:1 contrast against its background (WCAG 1.4.3); state-cue graphics carry 3:1 non-text contrast (WCAG 1.4.11). If the shipped chart region reuses the application-charts render shell, the palette contract comes from ADR-1902 on that blueprint; the shipped light and dark categorical palettes are contrast-safe by default.

Colour alone never carries state or series distinction: pair colour with a shape, a pattern or a label. Traffic-light state cues (red, orange, green) recur as a defect on shipped dashboards; pair the colour with an icon, a label or a text state.

Sources:
- WCAG 2.2 Understanding SC 1.4.3 Contrast Minimum: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WCAG 2.2 Understanding SC 1.4.11 Non-text Contrast: https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html

Stays operator guidance for the tile row; hardens for the chart region through application-charts AC-18102-1 and AC-18105-1.

## 6. When a table beats a chart

If the reader's question is what the value is, ship a stat tile. If the reader's question is how the values compare across a small set, ship a stat tile row and a table. If the reader's question is how the values move over time, ship a chart. If the reader wants to sort, filter, page, select, or export a table of records, ship the `application-datatable` blueprint's table; the dashboard's tile row is not a replacement.

A chart with three data points is a table. A pie chart with more than four slices is a table. A dashboard that overuses charts to fill space produces the chartjunk Tufte warned against; a table is often the honest shape.

The dashboard's chart region delegates rendering to the application-charts render shell (TAC-1901); the accessibility, palette, text-alternative and keyboard-traversal ACs on that blueprint apply. The paired text-alternative table is one of those ACs (application-charts AC-18103-1), so the reader always has the table view for the chart.

Sources:
- The Visual Display of Quantitative Information (Wikipedia reference): https://en.wikipedia.org/wiki/The_Visual_Display_of_Quantitative_Information
- NN/g Choosing Chart Types (video): https://www.nngroup.com/videos/choosing-chart-types/
- NN/g Comparison Tables, 5 scenarios (video): https://www.nngroup.com/videos/comparison-tables/

Stays operator guidance; the shell contract enforces the chart-region mount through the render shell (AC-19101-2).

## 7. Refresh cadence and staleness

Every dashboard reader wants to know how fresh the data is. The shell renders one `as of <ISO-8601>` stamp on the shell root and every tile carries the same stamp. On a timeframe or filter change the shell refetches every tile with the same boundary, waits for the batch, and updates the stamp. A tile whose stamp drifts from the shell root is a defect.

Auto-refresh is off by default. An operator elicits a refresh interval at apply if the surface genuinely needs unattended refresh (an ops screen, an event-day dashboard); the elicited interval sets `data-auto-refresh` on the shell root to the elicited seconds. A dashboard that refreshes every 30 seconds without an operator opt-in wastes budget and produces distracting motion; a dashboard that refreshes on a hidden tab drops keystrokes in the operator's active tab.

Sources:
- Nielsen, Response Times: The 3 Important Limits (NN/g): https://www.nngroup.com/articles/response-times-3-important-limits/
- Stephen Few, Dashboard Design for Real-Time Situation Awareness (Perceptual Edge): https://www.perceptualedge.com/articles/Whitepapers/Dashboard_Design.pdf

Hardens into AC-19104-1 (fan-out and stamp) and AC-19104-2 (auto-refresh default).

## 8. Anti-patterns

Read this list against the shipped surface; if any of the following applies, fix it before ship.

- The primary KPI is anywhere other than top-left.
- A tile carries the same number as another tile at a different boundary and the reader compares them.
- The tile row has more than eight tiles.
- A state (loading, empty, error) is signalled by colour alone.
- The dashboard auto-refreshes without an operator opt-in.
- The export handle is a hover-only dropdown.
- A canvas-only chart with no text-alternative surface (this is caught by application-charts AC-18103-1 on the chart region).
- The dashboard renders a chartjunk grid (three overlapping bar charts, a rainbow-gradient donut) to fill space.
- The dashboard mixes stale tiles and fresh tiles under one `as of` stamp.
- The dashboard names a "primary KPI" that is not the reader's actual anchor question.

Sources:
- Stephen Few, Common Pitfalls in Dashboard Design (Perceptual Edge whitepaper): https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf
- Stephen Few, Why Most Dashboards Fail (Perceptual Edge): https://www.perceptualedge.com/articles/misc/WhyMostDashboardsFail.pdf
- NN/g Data Visualizations for Dashboards (video): https://www.nngroup.com/videos/data-visualizations-dashboards/

Stays operator guidance; individual patterns harden through the ACs the guidance names above.

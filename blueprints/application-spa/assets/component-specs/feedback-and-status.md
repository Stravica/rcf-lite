# Component specs: feedback and status

Contracts for alert, banner, empty state, loading and skeleton, error state, and spinner (application-spa-US-1112).

## Alert

Intents: info (accent), success, warning, danger, each pairing intent colour, intent icon from the alias registry, and a non-colour signal (AC-1112-1). Anatomy: icon, optional title, body, optional actions, optional dismiss. Dynamic alerts announce via live region (polite; assertive for danger) without stealing focus (AC-1112-2). Static page-load alerts are ordinary content. Body copy follows application-spa-REQ-017: situation plus next step.

## Banner

Lives in the shell-owned slot below the top bar; pushes layout, never overlaps (AC-1112-3). One banner at a time; priority order: offline (application-spa-US-1121) beats promotional. Dismissible when the condition is not persistent; persistent conditions (offline) clear themselves when resolved. Full-width, surface-raised or intent-toned fill, space-3 vertical padding.

## Empty state

Shape per assets/wireframes/empty.md: visual, headline naming the absent content, filling action (AC-1112-4). Context-specific copy per instance (AC-1117-3).

## Skeleton and loading

Skeletons mirror the incoming layout: text lines, avatar circles, card blocks in the target geometry (AC-1112-5). Shimmer within motion tokens; static under reduced motion (AC-1119-5). Region marked busy for assistive technology; skeletons themselves are hidden from the accessibility tree. Appear-delay of roughly 150ms so cached-fast loads never flash a skeleton (AC-1117-6).

## Error state

Shape per assets/wireframes/error.md region variant: intent icon, what failed in user terms, consequence, retry or alternative (AC-1112-6). Distinguishes user-fixable from system failure (AC-1117-4). Never a raw exception or internal id (AC-1124-4).

## Spinner

Indeterminate operations only, where no content shape is known (AC-1112-7). Always paired with an accessible label naming the operation. Sizes: inline (1em, inside buttons per the busy contract) and regional (space-8). Uses onSurfaceMuted or intent colour; rotation duration from motion tokens; static-with-label under reduced motion.

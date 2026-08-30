# Component specs: overlays

Contracts for modal, drawer, tooltip, popover, and toast (application-spa-US-1110). Shared rules: token-driven surfaces and backdrops in both themes; Escape closes topmost-first (AC-1110-8); motion from motion tokens honouring reduced motion.

## Modal

Focus: trapped while open; initial focus on the first meaningful element (never a destructive action, AC-1108-3); returns to trigger on close (AC-1110-1). Background inert. Dismissal: Escape and explicit close always; backdrop click only for non-destructive intents (AC-1110-2). Structure: labelled by its heading; described by its body where useful. Sizing: max-width per breakpoint; full-screen at 360 where content demands; internal scroll, never page scroll behind. Enter: motion-base ease-out; exit motion-fast.

## Drawer

Modal contract plus: slides from the declared edge; full-width at 360, token-sized panel above (AC-1110-3). Used for secondary flows that keep page context relevant; anything demanding full attention is a modal or a route.

## Tooltip

Trigger: hover and keyboard focus, short token delay; hides on blur, pointer-leave, and Escape (AC-1110-4). Content: text only, no interactive content; interactive needs a popover. Wired via aria-describedby. Never the only carrier of essential information. Positions to stay in-viewport.

## Popover

Opens on activation, receives focus, returns it on close; closes on Escape and outside click; repositions within the viewport (AC-1110-5). Carries interactive content (menus, filter panels, the [...] overflow menu). Menu-flavoured popovers add menu semantics with arrow-key traversal (AC-1103-3).

## Toast

One shell-owned region (AC-1110-6): top-right above 768, bottom full-width at 360. Auto-dismiss on motion-token-derived duration scaled to content length; hover and focus pause the timer. Announced via polite live region; assertive only for danger toasts. Never receives focus automatically; never the only path to an action (AC-1110-7). Maximum three visible; older toasts collapse into a count. Each toast: intent icon (semantic alias), one sentence, optional single action, dismiss control.

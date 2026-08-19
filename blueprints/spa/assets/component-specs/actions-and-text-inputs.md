# Component specs: actions and text inputs

Contracts for buttons, text inputs, and textareas (spa-US-1108). Not code: the working agent implements these against the tokens in assets/tokens.

## Button

Variants: primary (primary/onPrimary), secondary (surface-raised + border, onSurface), ghost (transparent, primary text), destructive (danger/onDanger).

| State | Spec |
|---|---|
| default | Variant fill and text tokens; radius-sm; space-2 vertical, space-4 horizontal padding; target 24x24 minimum |
| hover | Perceptible shift of the variant fill (token-derived, both themes); cursor pointer |
| focus | focusRing outline, 2px offset 2px; never outline suppression without replacement |
| active | Pressed shift of fill; no layout movement |
| disabled | Reduced-emphasis fill; excluded from Tab order; aria-disabled or disabled; boundary still 3:1 |
| busy | Inline spinner replaces or precedes label; label persists or is announced; repeat activation ignored (AC-1108-2) |

Semantics: real button element (or role plus full keyboard equivalence). Enter and Space activate. Icon-only buttons carry an accessible name (AC-1118-4). Destructive buttons never take default focus in confirmations (AC-1108-3).

## Text input

Anatomy: visible label (programmatically associated), control, optional helper text, error slot. Placeholder is a hint, never the label (AC-1108-5).

| State | Spec |
|---|---|
| default | surface background, border token boundary, radius-sm, onSurface text |
| focus | focusRing outline; border may echo the ring colour |
| disabled | surface-sunken fill; excluded from Tab; announced disabled |
| error | danger border and icon; message in error slot wired via aria-describedby with aria-invalid (AC-1108-6) |
| success | success border or icon where confirmation is meaningful; never colour alone (AC-1126-6) |

Behaviour: validation timing per spa-US-1113. Attributes per data intent: type, inputmode, autocomplete (AC-1113-6). Text at text-body size; 16px minimum on mobile to avoid zoom-on-focus.

## Textarea

Text-input contract plus: resizable within declared min and max rows (AC-1108-7), content scrolls inside the control when full, character-count indicator where a limit exists (count exposed to assistive technology as it approaches the limit).

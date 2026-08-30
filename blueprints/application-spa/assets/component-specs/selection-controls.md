# Component specs: selection controls

Contracts for select, checkbox, radio group, switch, and combobox (application-spa-US-1109). All render default, hover, focus, disabled, and error states from tokens in both themes, and meet the 24x24 target including label hit area.

## Select

Keyboard: Enter, Space, or arrows open; arrows traverse; type-ahead jumps; Enter commits; Escape cancels and restores the prior value (AC-1109-1). Semantics: native select preferred; a styled listbox must replicate the full grammar and expose expanded state and active option. Long option lists scroll within the popup; the popup repositions to stay in-viewport.

## Checkbox

States: unchecked, checked, indeterminate (parent-of-mixed only). Space toggles. The label is part of the hit area. Indeterminate is set programmatically and announced (AC-1109-2). Error state renders the danger boundary plus message per the input contract.

## Radio group

Grouped under a fieldset with a legend (or labelled group role). One Tab stop; arrows move selection and selection follows focus; exactly one checked member (AC-1109-3). Wrapping: arrows cycle from last to first.

## Switch

Role switch with checked state exposed; Space and Enter toggle (AC-1109-4). Applies immediately, no submit; a pending toggle shows busy and reverts visibly on failure (application-spa-US-1120 optimistic contract). Label states the thing controlled, not the current value. On and off are distinguishable without colour alone: thumb position plus track token.

## Combobox

Grammar (AC-1109-5): typing filters the listbox; ArrowDown enters and traverses it; Enter commits the active option; Escape closes without commit; Tab commits-or-closes per declared mode and always exits. ARIA: combobox role, aria-expanded, aria-activedescendant (or focus-moving equivalent), listbox with option roles. Zero matches renders the designed no-matches message inside the listbox (AC-1109-6). Async option loading shows an in-listbox loading state, never a frozen popup. Multi-select variants render choices as dismissible chips inside the field with each chip keyboard-removable.

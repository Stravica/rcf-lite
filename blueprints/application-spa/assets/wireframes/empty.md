# Wireframe: empty state

The shape every empty region follows (AC-1112-4, AC-1117-3). Rendered inside the region it fills: a full route body, a table body, a combobox listbox, or an aside.

## Shape (any width)

```
+--------------------------------------------+
|                                            |
|              [ icon / small                |
|                illustration ]              |
|                                            |
|        h2/h3  No items yet                 |
|                                            |
|   Body: one sentence naming what will      |
|   appear here and why it is useful.        |
|                                            |
|          [ + Create your first item ]      |
|          [ secondary: learn more ]         |
|                                            |
+--------------------------------------------+
```

## Rules

- Three elements always: visual, headline naming the absent content, primary filling action (AC-1112-4). The secondary action is optional.
- Copy is context-specific: an empty "Items" list and an empty search result do not share copy (AC-1117-3); filtered-empty offers "clear filters" instead of "create".
- The visual uses the icon set through semantic aliases (application-spa-REQ-011), muted tones, decorative and hidden from assistive technology (AC-1118-4).
- Never renders while loading is still possible (AC-1117-6); the data layer must have settled on empty.
- Vertical centring within the region above 768; top-aligned with space-12 padding at 360.
- Template copy here is a shape, not shippable text (AC-1124-5).

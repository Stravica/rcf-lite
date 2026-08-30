# Wireframe: form (create and edit)

The canonical mutation surface. Realises the application-spa-REQ-007 contract end to end; the forms engine (TAC-205) owns timing and error binding.

## 1024 and above

```
+--------------------------------------------------------------------------+
| shell                                                                    |
+----------------+---------------------------------------------------------+
| side nav       | breadcrumb: Home / Items / New item                     |
|                | h1 New item                                             |
|                |                                                         |
|                | [ error summary: appears here on failed submit,        |
|                |   one link per failed field, focus lands here ]        |
|                |                                                         |
|                | Title (required)                                        |
|                | [_______________________________________________]      |
|                | helper text: what a good title looks like              |
|                |                                                         |
|                | Owner (required)          Status                        |
|                | [ combobox............v ] [ select.........v ]          |
|                |                                                         |
|                | Description                                             |
|                | [ textarea                                       ]      |
|                | [                                                ]      |
|                |                                                         |
|                | Tags                                                    |
|                | [ chip input___________________ ]                       |
|                |                                                         |
|                | [Cancel]                        [Create item]           |
+----------------+---------------------------------------------------------+
```

## 360

Single column, labels above fields, actions full-width with the primary action last and reachable without scrolling past unrelated content. Field-appropriate mobile keyboards via inputmode and type (AC-1113-6).

## States

- Field error: danger border, message under the field, aria-describedby wired (AC-1113-4); clears live on correction (AC-1113-1).
- Failed submit: summary renders and takes focus (AC-1113-2, AC-1113-3); values preserved (AC-1113-7).
- Submitting: primary button busy per AC-1108-2; fields stay readable, not blanked.
- Offline submit: queued-or-refused explicitly, payload intact (AC-1121-3).
- Success: route per journey spec, confirmation visible, affected collections updated (AC-1117-5).
- Dirty-leave: navigating away with unsaved changes asks for confirmation via modal (AC-1110-1).

## Notes

Required marking is visible and programmatic (AC-1113-5). Autocomplete tokens on personal-data fields (AC-1113-6). No motion during entry (AC-1119-4).

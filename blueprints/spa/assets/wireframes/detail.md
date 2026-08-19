# Wireframe: detail (single resource)

The canonical single-resource surface at the resource's canonical URL. Deep-linkable cold (AC-1101-6), breadcrumbed when nested (AC-1101-3).

## 1024 and above

```
+--------------------------------------------------------------------------+
| shell                                                                    |
+----------------+---------------------------------------------------------+
| side nav       | breadcrumb: Home / Items / Quarterly readiness review   |
|                | h1 Quarterly readiness review     [Edit] [... menu]     |
|                | status chip | owner | updated timestamp                 |
|                |                                                         |
|                | +--- main column (8 cols) ---+ +-- aside (4 cols) ----+ |
|                | | h2 Description             | | h2 Properties        | |
|                | | body text ...              | | owner    Alex Morgan | |
|                | |                            | | status   active      | |
|                | | h2 Activity                | | created  date        | |
|                | | timeline entries ...       | | tags     chips       | |
|                | +----------------------------+ +----------------------+ |
+----------------+---------------------------------------------------------+
```

## 360

Single column: header block, properties (collapsed into a definition list), description, activity. The overflow menu carries secondary actions; the primary action stays visible.

## States

- Loading: skeleton for header block and both columns.
- Error, not found: the 404 surface (AC-1101-4); removed resource: the 410 surface (AC-1101-5).
- Error, load failure: error-state component with retry; the shell and breadcrumb still render.
- Success after edit: updated values render without reload on every route that displays this resource (AC-1120-6).
- Re-entry: cached render, background revalidation (AC-1120-2).

## Behaviour contracts

- The [... menu] is an accessible popover (AC-1110-5); destructive entries open a confirmation modal with focus on the safe action (AC-1108-3).
- Timestamps format through locale APIs (AC-1122-3).

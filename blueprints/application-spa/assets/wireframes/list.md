# Wireframe: list (collection)

The canonical collection surface: filterable, sortable, paginated. One of these exists per listable resource class, always at the collection's canonical URL (application-spa-REQ-001).

## 1024 and above

```
+--------------------------------------------------------------------------+
| shell (as dashboard)                                                     |
+----------------+---------------------------------------------------------+
| side nav       | breadcrumb: Home / Items          (if depth > 2)        |
|                | h1 Items (128)                     [+ New item]         |
|                |                                                         |
|                | [ filter: status v ] [ filter: owner v ] [ search... ]  |
|                | active filters as dismissible chips                     |
|                |                                                         |
|                | +-----------------------------------------------------+ |
|                | | Title ^        | Status      | Owner    | Updated v | |
|                | |-----------------------------------------------------| |
|                | | item title     | status chip | avatar   | date      | |
|                | | item title     | status chip | avatar   | date      | |
|                | |  ... 25 rows per page ...                           | |
|                | +-----------------------------------------------------+ |
|                |                                                         |
|                | [< Prev]  Page 3 of 6  [Next >]        25 per page v    |
+----------------+---------------------------------------------------------+
```

## 360

Filters collapse into a single Filters disclosure showing an active-count badge. Rows render as cards: title prominent, status chip, owner, updated; the primary action stays visible without horizontal scroll (AC-1105-4).

## States

- Loading: skeleton rows matching the column silhouette (AC-1111-4).
- Empty, no data: empty-state component; headline names the resource, primary action creates the first one (AC-1112-4).
- Empty, filtered to zero: distinct copy naming the filters, action clears them; do not reuse the no-data state.
- Error: error-state component inside the table region with retry (AC-1111-4).
- Success after create or edit: list reflects the write without manual refresh (AC-1120-3), confirmation per the journey spec.

## Behaviour contracts

- Sort headers expose aria-sort and cycle predictably (AC-1111-3).
- Page and named filters serialise to the URL so positions are shareable (AC-1111-8).
- Pagination controls disable impossible moves rather than hiding them (AC-1111-7).

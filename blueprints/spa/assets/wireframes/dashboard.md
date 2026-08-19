# Wireframe: dashboard

The authenticated home surface. Composes summary cards, a primary collection preview, and recent activity. Realise with the tokens in assets/tokens; all copy is placeholder shape, replaced per spa-US-1124.

## 1024 and above

```
+--------------------------------------------------------------------------+
| [skip-link (visible on focus)]                                           |
| banner: logo | nav: Overview* Items Reports | search | theme | user menu |
+----------------+---------------------------------------------------------+
| side nav       | h1 Dashboard                                            |
| (if declared)  |                                                         |
|  Overview*     | +-- card --------+ +-- card --------+ +-- card -------+ |
|  Items         | | metric label   | | metric label   | | metric label  | |
|  Reports       | | 128            | | 42             | | 7 needs care  | |
|                | | delta context  | | delta context  | | warning tone  | |
|                | +----------------+ +----------------+ +---------------+ |
|                |                                                         |
|                | h2 Recent items                    [View all ->]        |
|                | +-----------------------------------------------------+ |
|                | | item title      | status chip | owner | updated     | |
|                | | item title      | status chip | owner | updated     | |
|                | | item title      | status chip | owner | updated     | |
|                | +-----------------------------------------------------+ |
|                |                                                         |
|                | h2 Activity                                             |
|                | | avatar  actor did thing on item        timestamp     | |
|                | | avatar  actor did thing on item        timestamp     | |
+----------------+---------------------------------------------------------+
| contentinfo: product name | version | support link                        |
+--------------------------------------------------------------------------+
```

## 360

Single column: cards stack full-width (surface-raised, elevation-1), recent items render as cards per the table rule (AC-1105-4), activity list below. Navigation collapses into the menu disclosure; the theme toggle stays reachable in the top bar.

## States

- Loading: skeletons mirror the three cards and the list rows (AC-1112-5); no full-page spinner.
- Empty (new account): each region renders its empty state; the recent-items region leads with the primary create action (AC-1112-4).
- Error: failed regions render the error-state component with retry, healthy regions still render; one failed query never blanks the dashboard.
- Re-entry: cached data renders instantly, then revalidates (AC-1120-2).

## Landmarks and structure

banner, navigation, main (unique), contentinfo (AC-1103-5). Exactly one h1. Cards are not clickable wholesale unless the whole card is one link (AC-1111-1).

# Wireframe: error states

Three distinct error surfaces, all fed by the problem-details envelope (ADR-204) and all phrased per spa-REQ-017.

## Region error (a data load failed inside a healthy page)

```
+--------------------------------------------+
|         [ alert icon, danger alias ]       |
|    h3  We could not load your items        |
|    Body: The connection to the server      |
|    failed. Your other work is unaffected.  |
|            [ Try again ]                   |
+--------------------------------------------+
```

Renders inside the failed region only; shell, navigation, and healthy regions stay live. Retry re-runs the query (AC-1121-2). 4xx-class problems adapt copy to the user-fixable cause; 5xx-class problems say it is not the user's fault (AC-1117-4).

## Route error (404 / 410)

```
+--------------------------------------------------------------------------+
| shell (navigation fully present)                                         |
|                                                                          |
|        h1  There is nothing at this address                              |
|        Body: The link may be mistyped or the page may have moved.        |
|        [ Go to dashboard ]   [ search affordance if declared ]           |
+--------------------------------------------------------------------------+
```

404 says "never existed or moved"; 410 names the resource as removed, in past tense, with a path to its collection (AC-1101-4, AC-1101-5).

## Application error (error boundary caught a crash)

```
+--------------------------------------------------------------------------+
| shell if the shell boundary survived, otherwise minimal branded frame    |
|                                                                          |
|        h1  Something went wrong on our side                              |
|        Body: The page hit a problem it could not recover from.           |
|        Nothing you did caused this.                                      |
|        [ Reload this page ]   [ Go to dashboard ]                        |
+--------------------------------------------------------------------------+
```

The boundary reports with route and component context (AC-1123-3). No stack traces, exception names, or internal ids anywhere on any of the three surfaces (AC-1124-4).

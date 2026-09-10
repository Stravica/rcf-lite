# e2e test-case template (application-spa blueprint)

A paste-in shape for a `testLevel: e2e` test suite plus one test case bound
to a browser-facing acceptance criterion contributed by this blueprint.
Copy the fenced blocks into your project chain, fill in the placeholders,
and author the pointed-to test file under `tests/e2e/`.

This template is the driver-seam contract between blueprint-contributed
browser-facing ACs and the project's e2e suite. It uses the same
`rcf verify browser` driver seam the browser-verify pack uses, so the
same Playwright installation the invariants drive against also drives
the e2e case (one browser, two responsibilities).

## What this covers, and what it does not

- **Covers:** the AC end to end at a user-observable browser surface. One
  test case per AC. Sits in the project chain as coverage that
  `rcf audit coverage --strict` reads, and runs in the pull-request-checks
  `e2e` CI job the delivery-ci-workflows blueprint materialises.
- **Does not cover:** every rendering variation the browser-verify
  invariants already cover. If the concern is "is the CSP stamped
  correctly?" or "does the layout reflow at 360px?", write it as an
  invariant on the browser-verify TAC, not as a project e2e test.

## Test-suite shape

```json
{
  "tsId": "TS-N01-application-spa-e2e",
  "prdId": "PRD-001",
  "reqId": "application-spa-REQ-011",
  "version": "1.0.0",
  "status": "draft",
  "title": "Application e2e",
  "description": "End-to-end test cases against the shipped application, driven by a real browser through the browser-verify driver seam. One test case per browser-facing AC.",
  "testLevel": "e2e",
  "testCases": [
    {
      "id": "TC-N01-nav-renders-home-signed-in",
      "description": "Primary-nav icon renders at the expected size on the home route in a real browser across the SPA blueprint's declared themes",
      "acCoverage": ["application-spa-AC-1134-1"],
      "testPointer": "tests/e2e/nav.spec.js::navRendersOnHomeSignedIn",
      "scope": "deployed"
    }
  ],
  "createdAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>"
}
```

## Test file shape (Playwright, project-owned)

```js
// tests/e2e/nav.spec.js
// Driven through the same Playwright installation the browser-verify TAC
// uses. `rcf verify browser <fbs-id>` covers the invariant sweep on this
// page; this file covers the AC end to end.

import { test, expect } from '@playwright/test';

test('nav renders on home signed in', async ({ page }) => {
  await page.goto('/');
  const icon = page.locator('[data-nav-icon="primary"]');
  await expect(icon).toBeVisible();
  const box = await icon.boundingBox();
  // Read from the project's iconAlias size token for the primary-nav slot.
  expect(box.width).toBe(24);
  expect(box.height).toBe(24);
});
```

## The driver seam, in one sentence

The e2e test drives the app through the same Playwright installation that
the browser-verify pack drives, so the invariant sweep and the coverage
anchor run against the same shipped runtime and the same headless browser.
When `@playwright/mcp` is pinned in `rcf verify run`, the same pin is what
CI installs to run this file.

## Non-goal

The e2e case is the coverage anchor for one AC. It is not the place to
enumerate every rendering variation the browser-verify invariants already
cover, and it is not a substitute for a `rcf verify run` pass at the ship
gate. Both run in CI; neither replaces the other.

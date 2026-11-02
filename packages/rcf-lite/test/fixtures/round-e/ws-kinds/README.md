# ws-kinds

A workspace whose rcf project is its root, holding one package per runner
kind beside the nodeTest case of ws-two: `apps/web` (the c-playwright
fixture project of test/fixtures/rc-46, its package.json, lockfile,
playwright.config.ts and src copied in by the test, with a vitest test and
a Playwright spec of its own) and `apps/js` (plain JavaScript under the
legacy runner). Each bound test reads `fixtures/title.json` or
`fixtures/config.json` relative to its package directory. The test
installs `apps/web`'s devDependencies with npm ci; nothing installed is
committed.

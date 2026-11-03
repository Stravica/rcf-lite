# ws-two

A two-package pnpm workspace in the layout pnpm gives by default, its rcf
project at the workspace root. `apps/api` depends on `ms` and on the
workspace package `@ws/lib` (`apps/lib`); `apps/api/fixtures/config.json`
is read relative to `apps/api`. The test that copies this world writes the
installed layout next to it (node_modules is never committed): `ms` only
under `node_modules/.pnpm/ms@2.1.3/node_modules/ms`, linked from
`apps/api/node_modules/ms` by a relative link, nothing of it at the root;
`apps/api/node_modules/@ws/lib`, a relative link to `apps/lib` inside a real
scope directory; and a stand-in `tsx` in `apps/api/node_modules/.bin`
(one test writes it in the root's `node_modules/.bin` instead, as a root
devDependency, nothing of it in `apps/api`).
The PATH-order test keeps the stand-in `tsx` in `apps/api/node_modules/.bin`
and also writes a stand-in `tsx` that exits 1 in the root's
`node_modules/.bin` and another on the caller's PATH, and it installs the
real vitest in the root's `node_modules` (npm ci of the rc-46 `b-vitest`
lockfile in a scratch directory of its own, its entries then moved in), so
vitest sits in the root's `node_modules/.bin` alone, nothing of it in
`apps/api`; this world's own package.json stays as committed and no
lockfile is written in it. `apps/api/test/vitest.test.mjs` is a vitest
test; every other test file is a node:test file.
Test files end in `.test.mjs` so the package suite's `test/**/*.test.js`
glob never runs them.

# ws-two

A two-package pnpm workspace in the layout pnpm gives by default, its rcf
project at the workspace root. `apps/api` depends on `ms` and on the
workspace package `@ws/lib` (`apps/lib`); `apps/api/fixtures/config.json`
is read relative to `apps/api`. The test that copies this world writes the
installed layout next to it (node_modules is never committed): `ms` only
under `node_modules/.pnpm/ms@2.1.3/node_modules/ms`, linked from
`apps/api/node_modules/ms` by a relative link, nothing of it at the root;
`apps/api/node_modules/@ws/lib`, a relative link to `apps/lib` inside a real
scope directory; and a stand-in `tsx` in `apps/api/node_modules/.bin`.
Test files end in `.test.mjs` so the package suite's `test/**/*.test.js`
glob never runs them.

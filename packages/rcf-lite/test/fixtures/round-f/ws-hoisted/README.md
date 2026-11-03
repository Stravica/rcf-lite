# ws-hoisted

A two-package npm workspace in npm's hoisted layout, its rcf project at the
workspace root (round F). `apps/api` depends on the workspace package
`@ws/lib` (`apps/lib`). The test that copies this world writes the
installed layout next to it (node_modules is never committed):
`node_modules/@ws/lib` in the rcf project root's own node_modules, a
relative link to `../../apps/lib`, as `npm install` links a workspace
package, and nothing in `apps/api/node_modules`. As committed, `apps/lib`'s
package.json exports its source, `./src/index.js` (F-4, the rcf project's
own node_modules link re-pointed into the working copy).

`apps/api/src/index.js#welcome` is the api's own code, importing `@ws/lib`
by name, and `apps/api/test/welcome.test.mjs` its test (F-9, the WESPA
shape: the code under test lives in the package that imports the
sibling). The F-9 tests rewrite `apps/lib`'s package.json to name an entry
that is gitignored build output (`dist/index.js` as `main` and `exports`,
or one shape per step of the entry rule: `exports`, then `main`, then
`index.js`), write that build next to the source (a copy of it), and add
it to `.gitignore`, so the entry is present in the repository and absent
at HEAD. Test files end in `.test.mjs` so the package suite's
`test/**/*.test.js` glob never runs them.

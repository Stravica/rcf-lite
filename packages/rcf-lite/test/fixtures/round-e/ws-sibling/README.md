# ws-sibling

A workspace whose rcf project is `packages/a`, beside a sibling package
`packages/b` with its own node_modules. The test that copies this world
moves the rcf init project into `packages/a`, lays these files over the
repository, and writes `packages/b/node_modules/bpkg` (never committed).
The bound test of `packages/a` writes `w.txt` inside `../b/node_modules/bpkg`
on every run.

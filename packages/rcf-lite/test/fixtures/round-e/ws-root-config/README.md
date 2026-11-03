# ws-root-config

A workspace whose rcf project is its root, holding a vitest config at that
root (`vitest.config.mjs`) and its tests in a nested package: `apps/web`
(its own package.json) with `checks/title.check.mjs`, a file name vitest
collects only through the root config's `include`
(`apps/*/checks/**/*.check.mjs`). The test copies the root `package.json`
and `package-lock.json` from test/fixtures/rc-46/b-vitest (vitest as the
root's devDependency) and installs them with npm ci; nothing installed is
committed. Run at the rcf project root, the nested test is collected and
passes; run at `apps/web`, it is not.

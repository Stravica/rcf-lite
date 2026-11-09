# py-strength

A small Python project for the `rcf audit test-strength` tests over Python
sources (test/cli/audit-test-strength-py.test.js). The tests copy it over a
project made by `rcf init`, write the Code Node records and bound test cases
their criterion names into the copy, and commit it.

- `src/paths.py`: top-level functions. `warm` calls `canonical` as a statement,
  so callRemoval on `canonical` has a call site; nothing calls `record` as a
  statement.
- `src/config.py`: the class `Config` with `__init__`, plain methods, a
  classmethod and an async method. `from_text` calls `merge` as a statement.
- `src/words.py` and `src/report.py`: `remember_word` in `words.py` has its only
  statement-level call site in `report.py`, so callRemoval on it scores across
  files.
- `src/slug.js`: one JavaScript module, the declared entry, beside them.
- `test/*.test.mjs`: node:test tests. The Python ones run the Python through the
  host's `python3` as a child process (`test/_harness/python.mjs`) and assert on
  what it prints. `test/record.test.mjs` is deliberately weak: it cannot tell
  `record` from a body of `pass`.
- `rcf/test-strength.json`: the entry, the harness and one nodeTest runners entry.
- `shims/python3-3.8/python3`: a `python3` that reports 3.8.18, and
  `shims/python3-no-version/python3`: one that prints nothing and exits 1 on
  `--version`; the tests put each on PATH in place of the host's. Neither is
  copied into the project.

No npm dependencies, no keychain, no network and no secrets. The `.test.mjs`
names keep these tests out of the repository's own suite glob.

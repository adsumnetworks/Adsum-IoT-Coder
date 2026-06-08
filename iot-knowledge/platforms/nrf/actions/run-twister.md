# Action: Run Host Tests via Twister (actions/run-twister.md)

## When Used
Called from `workflows/test-validate.md` Step 3 (host-tier validation, no hardware required). Builds
and runs a project's Zephyr/`ztest` test applications on `native_sim` and reports PASS/FAIL.

## Pre-conditions
- A `tests/` directory containing `testcase.yaml` (or legacy `sample.yaml`) exists in the project —
  confirm with `list_files` / `search_files` (`file_pattern=testcase.yaml`) before running anything.
- If none exists, do NOT fabricate a command — go to **Scaffolding** below instead.

## Run the tests

Twister lives at `<ZEPHYR_BASE>/scripts/twister` (resolve `ZEPHYR_BASE` from the nRF Connect
Terminal env or `build_info.yml`). Run it through `nrf_device_tool` (`action="execute"` —
`rules/nrf-terminal.md`; the terminal pre-loads `ZEPHYR_BASE`):

```bash
<ZEPHYR_BASE>/scripts/twister -T <path/to/tests> -p native_sim
```

- `-T <path>` — the test root (the directory **containing** `testcase.yaml`, not the file).
- `-p native_sim` — runs host-side, no board needed; this is the fast everyday tier.
- To run one scenario only: add `--scenario <path/to/your.test.scenario.name>` (the dotted name comes
  from `testcase.yaml`'s `tests:` key).
- To just discover what would run first: `--list-tests -T <path>` (use this when the user asks
  "what tests do I have" before committing to a run).

**Equivalent single-app shortcut** (when there's exactly one test app and no need for Twister's
filtering): `west build -b native_sim -t run` from the test app directory — Twister runs underneath.

## Reading the result
Twister writes `twister.json` / `twister.xml` to `twister-out/` (or `--outdir` if passed). Don't parse
the JSON unless asked for detail — the **console summary line** (`PASSED`/`FAILED`/`SKIPPED` counts +
per-suite status) is sufficient for the standard report. Pass `-i`/`--inline-logs` so failure detail
prints to stdout instead of needing a second file read.

| Console marker | Meaning |
|---|---|
| `PASS` | scenario built and asserted clean |
| `FAIL` | build succeeded but a `zassert_*` failed — read the inline log for the failing assertion + line |
| `BLOCK` / `ERROR` | build or environment failure — treat as a build error, not a test failure (route to `actions/build.md` triage) |
| `SKIPPED` / `FILTERED` | scenario doesn't apply to `native_sim` (check `platform_allow` in `testcase.yaml`) |

On `FAIL`, correlate the failing `zassert_*` line with the test source — never guess which assertion
fired; read the inline log or the suite's `.log` under `twister-out/`.

## Scaffolding — when no test suite exists
Offer to create a minimal `ztest` module (ground every line from `embedded-code-guidance-ncs-zephyr`
or a real Zephyr integration-test sample via `actions/find-sample.md` — never invent assertions about
*this* project's behavior). The minimum viable layout is 4 files under `tests/<area>/`:

```
tests/<area>/
├── CMakeLists.txt      # find_package(Zephyr) + target_sources(app PRIVATE src/*.c)
├── testcase.yaml       # tests: <suite>.<case>: { platform_allow: [native_sim], tags: ... }
├── prj.conf            # CONFIG_ZTEST=y
└── src/main.c          # ZTEST_SUITE(...) + ZTEST(suite, case) { zassert_* }
```

Scaffold only the **framework** (suite registration + one trivial `zassert_true` smoke case). Writing
real assertions about *this project's* behavior requires reading its actual modules first — propose
that as the immediate follow-up, don't bundle invented assertions into the scaffold.

## Rules
- Never claim a test "passed" without a console `PASS`/summary line backing it — no inferring from
  "the build succeeded."
- A clean build is necessary but not sufficient — `BLOCK`/`ERROR` vs `FAIL` vs `PASS` are different
  things; report them as such, don't collapse them into "it worked" / "it didn't."
- Keep results compact: scenario name + status + (on failure) the one assertion line that fired.

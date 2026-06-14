# Action: Set Up CI (actions/setup-ci.md)

## When Used
Called from `workflows/test-validate.md` Step 8 after a green run, when the user wants the build (and
host/QEMU tests) to run automatically on every push/PR. GitHub Actions is the default target.

## Why CI is worth it on ESP
The official **`espressif/idf` Docker image** carries a pinned ESP-IDF + toolchains, so CI builds the
firmware with zero local setup and catches "works on my machine" config drift. Host (`linux` target)
and QEMU tests run in the same Linux container — no board needed in CI.

## The workflow file — `.github/workflows/build.yml`
Pin the IDF version to the project's (`dependencies.lock` `idf: version:`). Two common shapes:

**A. Build only (the floor — always offer this):**
```yaml
name: ESP-IDF build
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - name: Build firmware
        uses: espressif/esp-idf-ci-action@v1
        with:
          esp_idf_version: v5.5         # match the project's IDF version
          target: esp32s3               # match CONFIG_IDF_TARGET
          path: '.'
```

**B. Build + host/QEMU tests (when a Unity suite exists):** run inside the IDF container and call the
same `pytest` from `actions/run-tests.md` (Tier A host or Tier Q QEMU — never on-hardware in cloud CI):
```yaml
  test:
    runs-on: ubuntu-latest
    container: espressif/idf:release-v5.5
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - name: Host tests (linux target)
        shell: bash
        run: |
          . $IDF_PATH/export.sh
          pip install pytest-embedded pytest-embedded-idf
          idf.py --preview set-target linux build
          pytest --target linux --embedded-services idf
      # For QEMU instead: pip install pytest-embedded-qemu;
      #   idf_tools.py install qemu-xtensa (or qemu-riscv32); pytest -m qemu --embedded-services idf,qemu
```

## Rules & guardrails
- **Match the IDF version** to the project (`dependencies.lock` / `idf.py --version`) — a different IDF
  in CI builds different code. Don't default to `latest`.
- **`submodules: recursive`** — IDF projects often vendor components as git submodules; without this the
  build fails on missing sources. Managed (registry) components are fetched by the build, not submodules.
- **No on-hardware tests in cloud CI** — GitHub runners have no board. Hardware (Tier B) stays local or
  on a self-hosted runner; only Tier A/Q belong in cloud CI.
- **Secrets** (Wi-Fi creds, tokens) never go in the committed workflow or `sdkconfig.defaults` — use
  GitHub Secrets and inject at build, or keep them out of CI builds.
- Anything outside your reach (first `git push`, enabling Actions, adding secrets) → apply core Rule 11:
  say exactly what the user must do and how to verify it (the green check on the PR).

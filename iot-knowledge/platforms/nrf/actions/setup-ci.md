---
id: adsum/nrf/actions/setup-ci
title: "Action: Set Up Firmware CI — GitHub Actions"
type: action
version: 1.1.0
owner: adsum-core
author: adsum
license: LicenseRef-Adsum-Proprietary
tier: certified
delivery: downloaded
domain: embedded-iot
platform: nrf
---

# Action: Set Up Firmware CI — GitHub Actions (actions/setup-ci.md)

## When Used
Called from `workflows/test-validate.md` (the "durable setup" offer) or when the user asks for
CI / automated tests on GitHub. Pre-condition: the project is a git repo (ideally on GitHub).

## What CI can and cannot run — set expectations FIRST
- **Cloud runners build firmware and run simulator ztest.** The CI container is **Linux**, so
  `native_sim` Twister runs there even when the dev's own machine is Windows/macOS — CI is the
  cleanest board-free tier and often beats a local QEMU install.
- **There is NO board in the cloud.** On-target tests require a **self-hosted runner** with a DK
  physically attached (Nordic's Asset Tracker Template pattern). Mention it; don't scaffold it
  unless asked.
- **Trigger policy (Nordic's own practice):** PR → build + simulator tests (fast, no hardware);
  nightly → slow/full suites. Don't put hours-long jobs on every PR.

## The workflow file (grounded template)

Create `.github/workflows/firmware-ci.yml`:

```yaml
name: Firmware CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  build-and-test:
    runs-on: ubuntu-24.04
    container:
      image: ghcr.io/nrfconnect/sdk-nrf-toolchain:v3.0.2   # pin to the project's NCS version
    defaults:
      run:
        shell: bash    # REQUIRED — toolchain env vars are only set in bash sessions
    steps:
      - uses: actions/checkout@v4
        with:
          path: workspace/app          # app in a subdir; west workspace forms around it

      - name: Initialize west workspace
        working-directory: workspace
        run: |
          west init -l app
          west update --narrow -o=--depth=1

      - name: Build firmware
        working-directory: workspace
        run: west build -p -b <board>/<soc> app

      - name: Run ztest suites (native_sim)
        working-directory: workspace
        run: |
          apt-get update && apt-get install -y gcc gcc-multilib   # native_sim host toolchain (not in the image)
          zephyr/scripts/twister -T app/tests -p native_sim -i
```

## Fill-ins — resolve these, never commit placeholders
- **Image tag = the project's NCS version** (from the `west.yml` manifest revision or
  `build_info.yml`). Never `latest` — a silent SDK bump is a classic phantom CI failure.
- **`<board>/<soc>`** via `actions/build.md` board resolution.
- **Twister step only if a test suite exists** (`testcase.yaml` — see `actions/run-twister.md`).
  No suite → drop that step, and offer the run-twister **Scaffolding** recipe first.
- **Freestanding app (no `west.yml` in the repo)?** `west init -l` needs a manifest. Offer to add a
  minimal `west.yml` pinning `sdk-nrf` at the project's NCS version — without a pinned manifest, CI
  cannot reproduce the build. Nordic's `nrfconnect/ncs-example-application` repo is the official
  reference for the manifest + CI layout; point the user there for the full-featured version.

## Rules
- `shell: bash` in the container job is **mandatory** — without it `west` is not on PATH (GitHub
  overrides the container entry point; the toolchain env only loads in bash).
- `native_sim` is correct **in CI** regardless of the dev's OS — do not transplant the local
  Windows/QEMU target logic from `run-twister.md` into the cloud job.
- No flashing, no `ACCEPT_JLINK_LICENSE` in cloud CI — there is no board. Flash/on-target steps
  belong only on a self-hosted runner.
- A CI simulator pass proves **logic**, not radio/sensor/timing — same honesty rule as
  `run-twister.md`. Say so in the summary when CI goes green.
- Commit the workflow file via the standard terminal (`git`), not the nRF terminal.

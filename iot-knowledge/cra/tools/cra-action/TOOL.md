---
id: adsum/cra/tools/cra-action
title: "cra-action"
type: tool
version: 1.0.0
owner: adsum-core
author: Redouane Elmagroud
co_authors:
  - handle: ismail-hamdad
    name: Ismail Hamdad
license: Apache-2.0
tier: certified
delivery: bundled
domain: cra
min_ext: "0.3.0"
runtime: host
host_tool: triggerCveScan
usage: 'sbom=<path to the generated SBOM> [build=<dir>]'
safety: [network]
readonly: false
---

Built into the extension. The door to the CVE scan: it reads the generated SBOM, runs the scan, and writes the dated evidence artifacts. It stays host code on purpose — the host is what guarantees the scan actually ran and that the report cannot claim a count it did not earn. The scan ENGINE behind it moves to a downloadable Tool bit so its advisory tables can be corrected between releases; the guarantee does not move with it.

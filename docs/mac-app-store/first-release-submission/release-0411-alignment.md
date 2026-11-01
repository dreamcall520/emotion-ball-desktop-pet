# 0.4.11 source alignment and package comparison

The MAS source includes release v0.4.11 (b89f8ded64c6112446ef1e9b69d1d4d221a8005b), including the independent idle-look state and natural motion for Xiaoyu. The mas-first gates and approved free-customization copy remain.

Validation: 481 targeted checks passed. The initial full run passed 3475/3476; the customization DOM fixture crossed an asynchronous dialog-close callback. The fixture now waits for that lifecycle and the current clip to settle, preserving the complete playback-state assertions. The second full run passed 3476/3476. Logs are in ../evidence/first-release-0411-20261101/.

MAS-first packaging now retains Chinese and English runtime localizations; 54 packaging/language checks passed. No new signed package or measured package reduction yet.

The user clarified that both local integration and in-pet chat should reuse an already-installed Codex and its authorized access, without bundling another copy. The website package does discover the installed CLI and use the default login. MAS external execution and directory access remain to be verified. Do not replace official quota with local usage observations, or remove the bundled helper before a working replacement is proven.

Existing uploaded build 1793528828 remains version 0.4.10. Source alignment and passing tests do not replace that upload.

The local comparison report is in the project output/ directory. Website ZIP: 248673480 bytes; DMG: 263950328 bytes; previous MAS PKG: 353845560 bytes. MAS adds 265464803 expanded bytes, principally the 267422644-byte bundled Codex component.

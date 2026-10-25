# ZCode + WorkBuddy combined acceptance 0.4.07

Integration branch: `integration/zcode-workbuddy-20261025`.
Parents: ZCode `42474bd` and WorkBuddy `23bfd1d`, both based on main `03b7aac`.
This is an independent local acceptance build, not a main-branch or public release.

- One chat source menu routes Codex, ZCode and WorkBuddy; each keeps its own history and model preference. Switching is blocked while replying/connecting. Disabling the selected integration returns to Codex and releases its connection; re-enabling creates a fresh adapter.
- Free-mode cards use the existing shared stack in order Codex/API/ZCode/WorkBuddy. The group chooses below or above without moving the pet. When the fourth card cannot fit it is hidden; if the remaining group cannot fit the requested cards stay hidden until space returns. Single/dual and peek placement retain their existing rules.
- Detail windows suppress other cards and restore the requested combination on close. API size changes also reposition WorkBuddy outside the four-card case.
- Codex/ZCode/WorkBuddy use one guard source state; Codex updates cannot overwrite ZCode quotas or WorkBuddy practice. Notices rotate in the existing quota slot without increasing their frequency.
- `node desktop-pet/scripts/package-combined-acceptance.js` packages `球球桌宠-联动整合验收` with bundle ID `local.xiaokun.emotionball.pet.combined-acceptance` and a separate `userData` directory of the same name. Automatic release updates are disabled for acceptance builds.

Validation: full Node tests, native hidden four-card geometry and transitions, packaged WorkBuddy fixture integration, packaged ZCode real read-only integration (zero model messages), source/staging/ASAR comparison, native DMG/ZIP extraction and ad-hoc signature checks. Mock screenshots are test fixtures, not real account balances or user visual acceptance.

Not covered: user visual acceptance, paid/team accounts, Intel, notarization, cross-day/expiry behavior or physical multi-display regression. No pet artwork was replaced. Existing source branches and formal installation/data are preserved.

## 2026-10-25 acceptance revision 2

- A tucked-to-peeked wake gives an enabled shortcut panel priority before any quota card can be shown. An untouched panel yields to cards after 2 seconds; hovering a shortcut or using it keeps the normal interactive session. Staying over the pet does not re-open the panel repeatedly. Free-mode 450ms hover behavior is preserved.
- Four edge cards fade in/out over 180ms with fixed geometry; stale hide callbacks cannot hide a reopened card. Lock, interruption and shutdown paths remain immediate.
- Settings now have separate internal Codex/API pages, no duplicated API sidebar link, and a separate shortcuts/general navigation group. Codex and ZCode each have display-settings and quota/tasks sections. Codex status is a left-aligned summary with fresh quota data and local recently synced task counts, not individual tasks rendered as disabled settings.
- Collapsed Codex cards show the Codex source plus the short quota period; other sources and expanded card behavior are retained.

Validation: 2159 Node tests; final-ASAR native shortcut timing (5 scenarios), four-card placement/fade (92 cases), source badge DOM/overflow (288 combinations), settings DOM/actions/alignment. Hidden fixture tests do not constitute user visual acceptance. API connection remains unavailable until the user supplies a usable Admin Key; no sample balance is substituted.

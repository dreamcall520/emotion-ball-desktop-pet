# Independent ZCode link acceptance

Base: origin/main `03b7aac49cf4b4639771a8dfa9ac7212ad75db84` (0.4.06). Branch: `feature/zcode-link`. No dependency additions, main merge or release.

`npm test`: **1976 passed**. See the checked implementation plan for native checks and limitations.

Build: `node desktop-pet/scripts/package-zcode-acceptance.js`. Output is `dist/zcode-acceptance/球球桌宠-ZCode验收-darwin-arm64/球球桌宠-ZCode验收.app`, unique bundle `local.xiaokun.emotionball.pet.zcode-acceptance`. Ordinary launch uses `~/Library/Application Support/球球桌宠-ZCode验收`; update checks are disabled for this candidate.

Real account/protocol probes are recorded in [protocol-probes-redacted.json](protocol-probes-redacted.json). They contain no auth or device identifiers. Packaged UI integration uses `PET_SMOKE_ZCODE_LINK_ONLY=1` with the existing smoke runner, `PET_SMOKE_APP_PATH`, the candidate executable name and an absolute `PET_SMOKE_ARTIFACT_DIR`; it requires a separate smoke profile and makes exactly one real model request. It never resumes or cancels existing user tasks.

Verified packaged integration: actual toggles/card/IPC, four balance buckets and trends, automatic ZCode source for a fresh conversation, explicit source switching, a real GLM-5.3-Flash reply and a hop observed in the pet renderer, separate transcripts and disable fallback to Codex. Existing Codex UI/chat regression passes.

Task monitoring exposes only individually verified running/waiting rows and keeps total coverage unknown. Opening a row offers the normal ZCode app entry because no public per-task deep link was verified. New unread results require an observed verified active turn first; old terminal records are not backfilled. Paid/team real accounts, actual tool approvals, Intel, broad multiple-display coverage and notarization remain unverified.

Final candidate ASAR SHA256: `b70d413e3edf8a144de9730158c9a0c2c9ead0f345148ee54268a205274b4079`. Distribution DMG/ZIP signatures, readonly mount/native extraction and exact ASAR match passed; the original installed app and settings were unchanged. This is an acceptance build, not a production release or user acceptance.


## Visual return — 2026-10-25

Three user-reported UI issues were corrected without changing Codex defaults: ZCode consent now reuses the actual Codex consent page/CSS/avatar with fixed source-scoped IPC and independent cancellation; the trend page replaces four header tabs with a compact custom bucket picker plus a full selected description; the collapsed card caption is always 额度, with full bucket information kept in title/aria.

Final packaged `PET_SMOKE_ZCODE_STYLE_ONLY=1` passed: light/dark consent matches the Codex reference geometry, cancel/disable/lock cannot grant access, explicit confirm enables the real balance, the short card is legible and the new picker changes the bucket through real IPC. This run sent no model requests. Existing packaged Codex regression again passed 16 cards / 88 panel surfaces / 36 pointer clicks. Native fixture matrices additionally cover 320/404 trend widths and 1/2/4-bucket card widths. The final 267 package files match source/staging; DMG readonly mount and ZIP native extraction/signature/ASAR checks pass. Formal and existing candidate settings remain unchanged. The prior mounted candidate was left running; user visual acceptance is pending.

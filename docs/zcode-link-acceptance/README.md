# Independent ZCode link acceptance

Base: origin/main `03b7aac49cf4b4639771a8dfa9ac7212ad75db84` (0.4.06). Branch: `feature/zcode-link`. No dependency additions, main merge or release.

`npm test`: **1966 passed**. See the checked implementation plan for native checks and limitations.

Build: `node desktop-pet/scripts/package-zcode-acceptance.js`. Output is `dist/zcode-acceptance/球球桌宠-ZCode验收-darwin-arm64/球球桌宠-ZCode验收.app`, unique bundle `local.xiaokun.emotionball.pet.zcode-acceptance`. Ordinary launch uses `~/Library/Application Support/球球桌宠-ZCode验收`; update checks are disabled for this candidate.

Real account/protocol probes are recorded in [protocol-probes-redacted.json](protocol-probes-redacted.json). They contain no auth or device identifiers. Packaged UI integration uses `PET_SMOKE_ZCODE_LINK_ONLY=1` with the existing smoke runner, `PET_SMOKE_APP_PATH`, the candidate executable name and an absolute `PET_SMOKE_ARTIFACT_DIR`; it requires a separate smoke profile and makes exactly one real model request. It never resumes or cancels existing user tasks.

Verified packaged integration: actual toggles/card/IPC, four balance buckets and trends, automatic ZCode source for a fresh conversation, explicit source switching, a real GLM-5.3-Flash reply and a hop observed in the pet renderer, separate transcripts and disable fallback to Codex. Existing Codex UI/chat regression passes.

Task monitoring exposes only individually verified running/waiting rows and keeps total coverage unknown. Opening a row offers the normal ZCode app entry because no public per-task deep link was verified. New unread results require an observed verified active turn first; old terminal records are not backfilled. Paid/team real accounts, actual tool approvals, Intel, broad multiple-display coverage and notarization remain unverified.

Final candidate ASAR SHA256: `8b37eb0c7773f3440cf9a751522f9cdfa1d363bb2b7f20595b658edd082d49a3`. Distribution DMG/ZIP signatures, readonly mount/native extraction and exact ASAR match passed; the original installed app and settings were unchanged. This is an acceptance build, not a production release or user acceptance.

# Installed Codex integration: development acceptance

Source version 0.4.11. The user explicitly requested reusing the already-installed Codex application and its existing account, without bundling another Codex executable.

Implemented: two explicit, separately scoped App/account-directory selections; atomic persisted grant; no credential copying; no automatic login/logout; original account shared by chat and quota; task-log permission remains separate. Replacing an expired source invalidates old chat clients and quota. Scope leases remain until owned subprocess exit.

Validation:

- 3497/3497 full tests passed. The final two copy adjustments passed 323 relevant tests.
- Native sandbox probes: installed CLI version, protocol initialization in an empty directory, then an expressly approved original-account query all succeeded. Both parent and child were sandboxed. No model request occurred in the probes.
- Genuine Electron MAS development candidate: selected the installed App and original account directory; original login and weekly quota restored without an independent login.
- Exactly one approved synthetic message was sent with GPT-6-Luna after the first-send consent: the requested test received the expected response. No additional model messages were sent.
- Normal exit and restart: App/directory grants, original-account connection, quota and the single test conversation restored without a picker or login. The final development candidate was then exited normally.
- This is development acceptance, not a runtime test of the distribution package and not App Review approval.

Final signed package checkpoint: 0.4.11 / 1793537989, 235601526 bytes. The earlier uploaded package was 353845560 bytes; reduction 118244034 bytes (33.4168%). No bundled Codex or WorkBuddy directory exists. Chinese/English runtime localization pruning removed 46403745 expanded bytes. The 12 reviewed business files match the signed ASAR; staged package.json transformation is expected.

One final packaging attempt failed because Apple's timestamp service was unavailable; a normal retry succeeded without weakening signature or timestamp settings. Receipts and full test logs are in ../evidence/first-release-0411-20261101/.

The 0.4.11 upload selection was cancelled before opening/uploading the file after the user requested the upcoming 0.4.12 skin fixes. No 0.4.11 build was uploaded. Uploaded App Store build 1793528828 remains 0.4.10 until a new version is uploaded and associated.

Pending: merge the completed 0.4.12 fix commit, validate its affected rendering paths, rebuild, and resume upload. Full submission still requires the outstanding App Privacy/age-rating/review-access preparation; none is represented as complete here.

---
name: release
description: This skill should be used when designing, implementing, reviewing, or operating OpenWaggle releases, version bumps, release-intent files, changelog/GitHub release notes, updater channels, or Alpha/Beta/RC/Stable update-track behavior.
---

# OpenWaggle Release & Versioning

Use this skill to keep OpenWaggle release behavior aligned with the OpenWaggle v1 release policy. Treat this policy as runtime/SDK-agnostic source of truth for future release/versioning work unless the maintainer explicitly changes it.

## Load first

Before changing release, versioning, updater, changelog, GitHub workflow, or update-track behavior:

1. Read `docs/release-and-versioning.md` when it exists or has been updated.
2. Read PRD issue `#90` for historical context if implementation details are unclear, but keep release/versioning decisions independent of any one runtime, CLI, or SDK.
3. Inspect the current release workflow, updater service, updater IPC/preload API, Settings About/Updates UI, and sidebar logo/footer version UI before editing.
4. Preserve the project rules in `AGENTS.md`, especially branch workflow, no commits without approval, no unknown-work reverts, no casts, and Electron QA for renderer/preload/IPC changes.

## Core policy

Keep automation, but make release intent explicit.

## Runtime/SDK agnosticism

Keep release policy independent of any one runtime, CLI, or SDK. The current v1 train may be motivated by a runtime migration, but `/release` must remain reusable if OpenWaggle later supports or switches to another runtime integration.

- Describe release readiness in product terms: launch, provider/auth/model selection, project selection, prompt execution, streaming/tool rendering, persistence, sessions, branching, install/update, and blocker status.
- Do not encode Pi-specific terms, files, adapters, or SDK behaviors into release policy unless the task is explicitly about the Pi implementation.
- Keep runtime-specific implementation details in runtime integration skills/docs, not in `/release`.
- If a future CLI/SDK becomes part of OpenWaggle, apply the same Alpha/Beta/RC/Stable, release-intent, changelog, updater, and UI policies to that integration.


- Stop using commit messages as the source of truth for version bumps.
- Require every PR to be release-classified:
  - product/user-impacting PRs include one or more `.release/changes/<slug>.md` files;
  - internal-only PRs carry an explicit `release:none` classification;
  - no release classification means no merge.
- Treat Alpha/Beta/RC/Stable as release-train state owned by the release workflow, not as fields repeated in every release-intent file.
- Consume release-intent files into `CHANGELOG.md` and GitHub Release notes during publication, then delete consumed files in the release commit.
- Keep one root `CHANGELOG.md` as canonical permanent release history.
- Generate GitHub Release notes from the same source as the changelog.

## Version train

Use the v1 release train:

```txt
1.0.0-alpha.N
1.0.0-beta.N
1.0.0-rc.N
1.0.0
```

Meanings:

- Alpha: internal / early dogfood; foundational migration may still be hardening.
- Beta: opt-in public validation; the v1 application/runtime foundation is usable and remaining work is hardening.
- RC: release-candidate freeze; release blockers only.
- Stable: normal/default users.

Keep the base version fixed at `1.0.0` throughout the v1 prerelease train. Use real semantic impact values in release-intent entries during v1, but do not let those values move the base version away from `1.0.0` before stable.

After v1:

- `patch` means a bug fix.
- `minor` means a user-facing capability.
- `major` means an incompatible product/runtime/data break and starts the next major train.

## Stage transitions

Move stages by objective criteria, not by whether the product feels perfect.

### Alpha start

Cut `1.0.0-alpha.1` only once the runtime-backed app is end-to-end dogfoodable:

- packaged app launches;
- at least one hosted provider can be authenticated and selected;
- project selection works;
- standard prompt path works through the active runtime integration;
- streaming/tool activity renders truthfully enough to inspect;
- basic session persistence/reopen works;
- no known startup/data-loss corruption blocker exists;
- alpha updater channel can deliver the next alpha.

Use curated standard release-intent entries for `1.0.0-alpha.1`; do not backfill one file per historical migration commit.

### Alpha to Beta

Move to Beta when the v1 application/runtime foundation is end-to-end usable and remaining work is hardening/validation, not foundational migration:

- the selected v1 runtime integration is the only default runtime path;
- provider/model/auth flows work through OpenWaggle-owned runtime adapter services;
- standard chat and Waggle operate on the v1 runtime foundation;
- session persistence/reopen and product-level branching work;
- streaming/tool rendering is truthful enough for real testing;
- install/update can deliver prerelease builds;
- no known data-loss or launch-blocking bugs remain.

### Beta to RC

Move to RC when v1 scope is complete/frozen:

- no open `v1-required` work remains;
- no open `release-blocker` bugs remain;
- critical user path validation passes;
- user-facing install/provider/session/basic usage docs are accurate enough;
- all known non-blockers are labeled or tracked as post-v1;
- a `release/1.0` branch/release plan exists;
- RC freeze rules begin.

### RC to Stable

Promote RC to stable after a 7-day validation window with no unresolved release blockers. If a blocker is found:

1. Fix only the blocker.
2. Cut a new RC.
3. Restart the 7-day validation window.

Stable `1.0.0` must rebuild from the same source content as the final validated RC, changing only version/release metadata.

## Release publication

- Product-impacting merge to `main` publishes the active prerelease stage automatically:
  - active Alpha stage -> next `1.0.0-alpha.N`;
  - active Beta stage -> next `1.0.0-beta.N`.
- `release:none` merges do not publish app releases.
- One product-impacting merged PR produces one app prerelease build, even when the PR contains multiple release-intent files.
- RC and Stable require a release PR / release-plan gate before publishing.
- Bot release commits update `package.json`, `CHANGELOG.md`, and consumed release-intent files.
- Prevent release loops from bot commits.
- Fail closed when version, tag, GitHub release classification, or updater metadata is inconsistent.

## Release-intent files

Use this schema:

```md
---
impact: patch | minor | major | none
area: runtime | sessions | providers | ui | installer | updater | user-docs | internal
audience: users | prerelease-users | developers
milestone: v1 | post-v1
---

Human-facing release note.
```

Rules:

- One file equals one release note entry.
- User/prerelease entries must use user-facing wording.
- Technical wording is allowed only for `audience: developers`.
- `impact: none` is optional and only for notable developer/internal audit entries.
- Ordinary internal-only PRs should use `release:none` instead of noisy `impact: none` files.
- `area: user-docs` means public/user-facing documentation, primarily website docs.
- Internal specs, learnings, lessons, and architecture notes are normally `area: internal`, `audience: developers`, and either `release:none` or `impact: none` only when worth auditing.
- Group generated release notes by `area`, not by `impact`.
- Exclude developer/internal entries from GitHub Release notes by default; allow them in `CHANGELOG.md` under Internal/Developer when useful.

Impact rules:

- Alpha: `impact: major` is allowed.
- Beta: `impact: major` is discouraged and requires explicit review/approval.
- RC: `impact: major` is blocked unless it is an unavoidable release-blocker fix with maintainer approval.
- Post-v1 stable: `impact: major` starts the next major train.

## Changelog, GitHub Releases, and announcements

- Start the formal generated changelog with the v1 release train.
- Add a note that older `0.x-alpha.N` builds used the legacy release process and remain available in GitHub Releases.
- Keep Alpha/Beta/RC release notes incremental.
- Generate stable `1.0.0` notes as a curated draft from the whole v1 train, then manually edit before publishing.
- Generate curated summaries for stable major/minor releases.
- Use generated incremental notes for stable patch releases by default.
- Generate X.com announcement draft material only for stable major/minor releases by default.
- Do not generate public announcement drafts for Alpha/Beta/RC/patch releases by default.

## Update tracks

Expose exactly these user-selectable update tracks in Settings:

```txt
Stable
Beta
Alpha
```

Do not expose RC as a separate user-selectable track initially.

Eligibility:

```txt
Stable -> stable only
Beta   -> beta, rc, stable
Alpha  -> alpha, beta, rc, stable
```

Selection rules:

- Always offer the newest eligible non-downgrade update for the selected track.
- Never let Stable receive Beta, Alpha, or RC builds.
- Never let Beta receive Alpha builds.
- Let Alpha advance to Beta, RC, and Stable when those are the best eligible builds.
- Let Beta advance to RC and Stable.
- Let users switch to a lower-risk track at any time.
- Make track changes affect future updates only.
- Do not support downgrades.
- When switching down from Alpha/Beta before Stable catches up, explain that the user will receive the next eligible newer build on the selected track.
- Require confirmation every time the user switches into Alpha.
- Use inline explanatory copy for Beta.

Use separate concepts:

- Installed build kind comes from the raw semver version (`alpha`, `beta`, `rc`, or stable).
- Selected update track is persisted user preference and controls future update eligibility.
- Do not infer selected update track only from installed version once Settings opt-in exists.

## Update UX

Implement update UX as a first-class in-app flow. Do not push users to scripts or manual installer hunting for Alpha/Beta opt-in.

- Check automatically on startup.
- Check periodically in the background.
- Check immediately after selected update track changes.
- Show an update button only when an eligible update is available or an update action is in progress.
- Keep download/install user-initiated.
- Make the update button do the whole action:
  1. user clicks update;
  2. app downloads update;
  3. app automatically restarts/installs after download completes.
- If an agent run is active, confirm before updating/restarting.
- Make restart behavior clear in button tooltip/copy.
- Prefer `autoDownload = false` and explicit download on click.

## Sidebar/version UI

- Show a compact badge next to the main logo only for installed prerelease builds:
  - Alpha for `*-alpha.N`;
  - Beta for `*-beta.N`;
  - RC for `*-rc.N`.
- Show no logo badge for stable builds.
- Derive the badge from installed version only, not selected update track.
- Show the full raw version string for all builds near the Settings/footer area.
- Keep the raw version visible for support, feedback, logs, and screenshots.

## Implementation guidance

Prefer deep, testable modules:

- release policy engine: version parsing, build kind, update-track eligibility, maturity ordering, no-downgrade behavior, best-update selection;
- release-intent parser/validator: schema validation and policy checks;
- release notes generator: changelog/GitHub notes/curated draft generation;
- updater orchestration: automatic checks, manual download, auto restart after user action, active-run confirmation;
- Settings update-track UI model;
- sidebar version badge/footer model.

Respect hexagonal boundaries:

- Put pure release policy and semver/update eligibility logic in shared/domain-style modules with no Electron dependency.
- Keep Electron updater integration in main-process infrastructure/application code behind typed IPC.
- Keep renderer components focused on UI state and typed preload APIs.
- Validate runtime data at boundaries with shared schema helpers.

## Testing expectations

Test external behavior, not implementation details.

Add tests for:

- version parsing and installed build kind;
- Stable/Beta/Alpha eligibility;
- newest eligible non-downgrade selection;
- Alpha advancing to Beta/RC/Stable;
- Beta never receiving Alpha;
- Stable never receiving prereleases;
- switching down without downgrade;
- release-intent schema validation;
- release note grouping by area;
- GitHub notes excluding developer entries;
- changelog including developer/internal entries when appropriate;
- bot release dry-run version/changelog/consumption behavior;
- Settings update-track selection, Beta copy, Alpha confirmation every time;
- sidebar prerelease badge and footer raw version;
- update button hidden/available/downloading behavior;
- active-run confirmation before update/restart.

Run Electron QA after renderer, preload, IPC, or updater changes. Validate the real app because update UX crosses main/preload/renderer boundaries.

## Do not do

- Do not reintroduce commit-message-driven versioning as the release source of truth.
- Do not publish Alpha/Beta/RC builds to Stable users.
- Do not make Beta users eligible for Alpha builds.
- Do not treat raw semver prerelease suffix as a replacement for selected update-track state.
- Do not support downgrades as part of this policy.
- Do not create a side-by-side Canary app unless the maintainer explicitly opens that scope.
- Do not require scripts/manual downloads as the primary Alpha/Beta opt-in UX.
- Do not backfill detailed release-intent entries for every old `0.x-alpha.N` release.
- Do not ask the maintainer to reconfirm decisions already locked in this policy unless implementation discovers a real conflict.

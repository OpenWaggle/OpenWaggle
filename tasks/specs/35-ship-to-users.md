# 35 — Ship to Users

**Status:** Planned
**Priority:** P2
**Category:** Distribution
**Depends on:** Core app stability, provider setup docs, release ownership
**Origin:** Spec 11

---

## Goal

Turn OpenWaggle from a developer-built Electron app into a release process that can ship supported installers to end users on:

- macOS Intel (`x64`)
- macOS Apple Silicon (`arm64`)
- Windows (`x64`)
- Linux (`x64`)

This spec is intentionally pragmatic: it documents what OpenClaw does well, where OpenWaggle already overlaps, and the concrete missing work before GitHub Releases can be treated as real user install surfaces.

## Current State

### What OpenWaggle already has

- `electron-builder` is already wired in `package.json`.
- `electron-builder.yml` already defines installer targets:
  - macOS `dmg` for `x64` and `arm64`
  - Windows `nsis` for `x64`
  - Linux `AppImage` for `x64`
- Build scripts already exist:
  - `pnpm build:mac`
  - `pnpm build:win`
  - `pnpm build:linux`

### What is still missing for real end-user distribution

- No release workflow in `.github/workflows/`.
- No documented release checklist for OpenWaggle.
- macOS builds are explicitly unsigned today (`identity: null`), so Gatekeeper/notarization UX is not release-ready.
- No Windows code-signing plan, which means SmartScreen reputation will be weak.
- No installer smoke tests for built artifacts.
- No publication flow for GitHub Releases, checksums, or a download page.
- No auto-update channel.

## OpenClaw Comparison

OpenClaw is useful as a release-process reference, but not as a 1:1 platform target reference.

### What OpenClaw does that we should replicate

- A clear install entrypoint for users:
  - `install.sh` for macOS/Linux
  - `install.ps1` for Windows
- A documented release checklist with explicit validation before publishing.
- Installer smoke coverage in CI (`install-smoke.yml`).
- A dedicated macOS packaging flow with signing, notarization, DMG creation, and release artifacts.
- Platform docs that are explicit about what is supported today vs planned later.

### What OpenClaw does not prove for us

- OpenClaw does **not** currently ship a native Windows desktop app.
- OpenClaw does **not** currently ship a native Linux desktop app.
- Its desktop release discipline is strongest on macOS because its native companion app is macOS-first.

Conclusion:

- We should copy OpenClaw’s **release rigor**.
- We should not copy its **platform scope limitation**.
- OpenWaggle still needs a true native desktop release path for Windows and Linux in addition to macOS.

## Recommended Release Surface

### Phase 1 release surface

Ship through GitHub Releases first.

- macOS:
  - `OpenWaggle-<version>-mac-arm64.dmg`
  - `OpenWaggle-<version>-mac-x64.dmg`
- Windows:
  - `OpenWaggle-<version>-win-x64.exe`
- Linux:
  - `OpenWaggle-<version>-linux-x64.AppImage`
- Release notes
- SHA-256 checksum file

### Phase 2 release surface

After the first stable signed releases:

- Website download page with platform detection
- Auto-updates via `electron-updater`
- Optional Homebrew cask for macOS
- Optional winget package for Windows

## Platform Matrix

| Platform | Current builder target | Current status | Required work before user release |
| --- | --- | --- | --- |
| macOS Intel | DMG (`x64`) | Local artifact only | Apple Developer ID signing, notarization, stapling, release CI on macOS |
| macOS Apple Silicon | DMG (`arm64`) | Local artifact only | Same as Intel; decide between separate builds vs universal build |
| Windows x64 | NSIS | Local artifact only | Windows signing cert, release CI on Windows, installer validation |
| Linux x64 | AppImage | Local artifact only | Release CI on Linux, runtime validation on clean distro, checksum publication |

## Product Decisions Needed

### 1) macOS packaging shape

Choose one:

- Separate `x64` and `arm64` DMGs
- A single universal macOS build

Recommendation:

- Start with separate `x64` and `arm64` DMGs because the current config already matches that.
- Revisit universal later only if user support friction justifies the added build/signing complexity.

### 2) Windows/Linux architecture scope

Recommendation:

- Treat Windows `x64` and Linux `x64` as the first supported user targets.
- Do not promise Windows ARM or Linux ARM until we add dedicated CI and runtime validation for them.

### 3) Auto-update timing

Recommendation:

- Do **not** block the first public release on auto-update.
- First ship signed/manual downloads.
- Add `electron-updater` once release artifacts and signing are stable.

## Implementation Plan

### Phase A — Make the current matrix honest

- [ ] Update docs to distinguish local developer installers from signed/public user installers.
- [ ] Add a release-support matrix to docs.
- [ ] Add a release ownership checklist for maintainers.

### Phase B — macOS release readiness

- [ ] Enroll in Apple Developer Program.
- [ ] Create `build/entitlements.mac.plist`.
- [ ] Remove `identity: null` from `electron-builder.yml` for release builds.
- [ ] Configure `CSC_LINK` and `CSC_KEY_PASSWORD`.
- [ ] Add notarization credentials and workflow secrets.
- [ ] Produce notarized DMGs and validate install on both Intel and Apple Silicon.

### Phase C — Windows release readiness

- [ ] Acquire a code-signing certificate.
- [ ] Configure Windows signing in `electron-builder`.
- [ ] Build NSIS on a Windows runner.
- [ ] Validate install/uninstall and first launch on a clean Windows VM.
- [ ] Document SmartScreen expectations until reputation improves.

### Phase D — Linux release readiness

- [ ] Build AppImage on Linux CI.
- [ ] Validate launch on a clean Ubuntu machine.
- [ ] Publish checksums and troubleshooting notes for common distro library issues.
- [ ] Decide whether `.deb` should be added after AppImage ships.

### Phase E — CI/CD

- [ ] Add `.github/workflows/ci.yml` for typecheck, lint, tests.
- [ ] Add `.github/workflows/release.yml` for tag-triggered desktop builds.
- [ ] Upload all platform artifacts to GitHub Releases.
- [ ] Publish SHA-256 checksums with each release.
- [ ] Keep signing secrets restricted to release workflows.

### Phase F — Installer verification

- [ ] Add smoke tests for each artifact type:
  - macOS: app opens, preload boots, renderer loads
  - Windows: NSIS install + first launch
  - Linux: AppImage launches on clean host
- [ ] Add a documented manual QA checklist for first-run flows:
  - settings open
  - provider connection setup
  - project selection
  - first message send

### Phase G — Optional polish after first ship

- [ ] Add `electron-updater`
- [ ] Add website download page
- [ ] Add Homebrew cask
- [ ] Add winget package

## Files Likely To Change

### Release infra

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `package.json`
- `electron-builder.yml`
- `build/entitlements.mac.plist`

### App/runtime

- `src/main/index.ts`
- `src/main/updater.ts`
- `src/shared/types/ipc.ts`

### Docs

- `docs/user-guide/getting-started.md`
- `docs/user-guide/developer-guide.md`
- `README.md`
- `tasks/specs/35-ship-to-users.md`

## Definition of Done

- A tagged release produces signed installers for macOS, Windows, and Linux.
- macOS artifacts install cleanly on both Intel and Apple Silicon without Gatekeeper bypass instructions.
- Windows installer launches successfully on a clean machine.
- Linux AppImage launches successfully on a clean supported distro.
- GitHub Release contains release notes, artifacts, and checksums.
- Docs clearly state supported platforms, install method, and known limitations.

## Review Notes

### 2026-03-10 analysis

- OpenWaggle already has the correct high-level Electron packaging tool (`electron-builder`) and initial platform targets.
- The main gap is not “can we build artifacts?”; it is “can we ship trusted artifacts with repeatable validation?”
- OpenClaw’s strongest transferable pattern is its release discipline:
  - scripted packaging
  - explicit platform docs
  - installer smoke tests
  - macOS signing/notarization pipeline
- OpenClaw is **not** evidence that native Windows/Linux desktop shipping is solved; OpenWaggle must own that work directly.

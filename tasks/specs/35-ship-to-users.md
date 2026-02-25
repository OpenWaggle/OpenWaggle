# 35 — Ship to Users

**Status:** Planned
**Priority:** P4
**Category:** Feature
**Depends on:** Core fixes (Specs 01-24) should be largely addressed first
**Origin:** Spec 11

---

## Goal

Get OpenWaggle from local dev project to publicly downloadable product. Users can discover it (website), download it (GitHub Releases), install it, and get help (docs + community).

## Phases

### Phase 1: Repository & Release Foundation
- [ ] Public repo setup (README, LICENSE, CONTRIBUTING, SECURITY, CHANGELOG)
- [ ] Code signing (macOS — blocked on Apple Developer enrollment)
- [ ] Auto-updates via `electron-updater`
- [ ] In-app feedback system (creates GitHub issues)
- [ ] First-run UX polish (API key preflight, welcome screen, app menu, about dialog)
- [ ] UX hardening (offline detection, conversation export, rate limit errors, keyboard shortcuts panel)

### Phase 2: CI/CD Pipeline
- [ ] CI workflow (lint, typecheck, tests on push/PR)
- [ ] Release workflow (tag-triggered, builds all platforms, creates draft release)

### Phase 3: Website
- [ ] Astro + Tailwind v4 static site at `openwaggle.ai`
- [ ] Landing page, download page, privacy policy
- [ ] Platform-detected download CTA

### Phase 4: Documentation
- [ ] Getting started guide
- [ ] Provider setup pages (one per provider)
- [ ] Features documentation

### Phase 5: Community & Distribution
- [ ] Discord server
- [ ] GitHub Discussions
- [ ] Homebrew Cask (post-launch)

## Prerequisites (Manual / External)

- [ ] Apple Developer Program enrollment ($99/year)
- [ ] Create GitHub org `openwaggle`
- [ ] Register domain `openwaggle.ai`
- [ ] Create Discord server

## Files to Create

- `README.md`, `LICENSE`, `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- `.github/ISSUE_TEMPLATE/bug_report.yml`, `.github/ISSUE_TEMPLATE/config.yml`
- `build/entitlements.mac.plist`
- `src/main/updater.ts`
- `src/main/feedback/submit-feedback.ts`
- `src/renderer/src/components/feedback/FeedbackDialog.tsx`

## Files to Modify

- `package.json` — add electron-updater, publish config
- `electron-builder.yml` — signing, notarization, publish
- `src/main/index.ts` — auto-updater, app menu
- `src/shared/types/ipc.ts` — update + feedback channels

# 02 — API Key Plaintext Fallback Warning

**Status:** Completed
**Priority:** P1
**Severity:** Critical
**Depends on:** None
**Origin:** H-02

---

## Problem

`src/main/store/settings.ts:247` — when `safeStorage.isEncryptionAvailable()` returns false, `encryptApiKey()` silently stores the raw API key string in the electron-store config file. The only signal is a `logger.warn()` that the user will never see.

This can happen on: Linux without a keyring daemon, headless environments, VMs, CI runners.

## What Exists

- `encryptApiKey()` at line 245–253: falls back to plaintext on encryption unavailability
- `decryptApiKey()` at line 256–269: returns empty string if encryption is unavailable and key was encrypted, but doesn't handle the reverse case
- Logger warning at line 260 — invisible to users

## Implementation

- [x] Surface encryption state through settings payload (`Settings.encryptionAvailable`) via `settings:get`.
- [x] On settings load, compute encryption availability (`safeStorage.isEncryptionAvailable()`).
- [x] In the active renderer settings page (`ConnectionsSection`), show a visible warning banner when encryption is unavailable and at least one API key exists.
- [x] Preserve plaintext fallback behavior while ensuring users are explicitly warned in-app.
- [x] Auto-migrate existing plaintext provider API keys to encrypted storage when keyring encryption becomes available.
- [x] If auto-migration fails, expose a user-facing warning instructing manual key re-save for encryption.

## Files to Touch

- `src/main/store/settings.ts` — add encryption availability check to settings getter
- `src/shared/types/settings.ts` — add `securityWarnings` to Settings or create new IPC channel
- `src/renderer/src/components/settings/` — render warning banner

## Tests

- Unit: settings getter includes warning when encryption unavailable
- Unit: warning absent when encryption available

## Review (2026-02-27)

- Added unencrypted API key warning in the active settings experience:
  - `src/renderer/src/components/settings/sections/ConnectionsSection.tsx`
- Added manual re-save warning in the active settings experience when automatic re-encryption fails.
- Added component tests for warning visibility conditions:
  - `src/renderer/src/components/settings/__tests__/ConnectionsSection.component.test.tsx`
  - Shows warning when `encryptionAvailable === false` and at least one key is set.
  - Hides warning when encryption is available.
  - Hides warning when no keys are configured.
- Added settings-store migration tests:
  - `src/main/store/settings.unit.test.ts`
  - Auto-migrates plaintext provider keys when encryption is available.
  - Flags `apiKeysRequireManualResave` when migration encryption fails.
- Verification:
  - `pnpm test:component -- src/renderer/src/components/settings/__tests__/ConnectionsSection.component.test.tsx` (pass)
  - `pnpm check` (pass)
  - `npx -y react-doctor@latest . --verbose --diff main` (score 99, no new errors)

## Risk if Skipped

API keys leak to disk in plaintext on affected systems. User has no idea.

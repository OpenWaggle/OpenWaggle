# 02 — API Key Plaintext Fallback Warning

**Status:** Planned
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

- [ ] Add a `securityWarnings` field to `Settings` (or a separate IPC query `'settings:get-security-warnings'`).
- [ ] On settings load, check `safeStorage.isEncryptionAvailable()`. If false and any provider has a non-empty API key, include `'api-keys-unencrypted'` in the warnings array.
- [ ] In the renderer settings panel, show a visible warning banner: "Your API keys are stored unencrypted on this system. Install a keyring (e.g., gnome-keyring, kwallet) to enable encryption."
- [ ] Never silently store keys in plaintext without the user's awareness.

## Files to Touch

- `src/main/store/settings.ts` — add encryption availability check to settings getter
- `src/shared/types/settings.ts` — add `securityWarnings` to Settings or create new IPC channel
- `src/renderer/src/components/settings/` — render warning banner

## Tests

- Unit: settings getter includes warning when encryption unavailable
- Unit: warning absent when encryption available

## Risk if Skipped

API keys leak to disk in plaintext on affected systems. User has no idea.

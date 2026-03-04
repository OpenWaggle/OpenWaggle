# 04 — Electron Security Defaults

**Status:** Done
**Priority:** P1
**Severity:** Critical
**Depends on:** None
**Origin:** H-17

---

## Problem

Electron apps have a long history of security misconfigurations. The project uses `contextBridge` (good), but there's no documented verification of:

- `nodeIntegration: false` on the renderer BrowserWindow
- `contextIsolation: true`
- `sandbox: true` on the renderer
- `webSecurity: true`
- Content Security Policy (CSP) headers
- `allowRunningInsecureContent: false`

If any of these are misconfigured, the renderer has full Node.js access, and any XSS in markdown rendering escalates to arbitrary code execution.

## Implementation

- [x] Audit `src/main/index.ts` (or wherever `BrowserWindow` is created) for all `webPreferences` settings. Verify and document each.
- [x] Add a CSP meta tag or `session.defaultSession.webRequest.onHeadersReceived` handler that sets `Content-Security-Policy` with:
  - `script-src 'self'`
  - `connect-src 'self' ws://localhost:*` (for devtools)
  - `img-src 'self' data:` (for inline images)
  - `style-src 'self' 'unsafe-inline'` (Tailwind needs inline styles)
- [x] Add a startup assertion in main process that verifies `nodeIntegration === false` and `contextIsolation === true` at runtime.
- [x] Document the security posture in CLAUDE.md under a "Security" section.

## Files to Touch

- `src/main/index.ts` — BrowserWindow creation, CSP header
- `CLAUDE.md` — document security settings

## Review

- Added `src/main/security/electron-security.ts` with:
  - `SECURE_WEB_PREFERENCES` policy constants
  - `assertSecureWebPreferences(...)` startup guard (fail-fast)
  - CSP builder + header merge helper + idempotent `installCspHeaders(...)`
- Updated `src/main/index.ts` to:
  - use explicit secure `webPreferences` values (`nodeIntegration/contextIsolation/sandbox/webSecurity/allowRunningInsecureContent`)
  - assert the final BrowserWindow preferences before window creation
  - install CSP response headers on the renderer session
  - exit app on bootstrap failure (`app.exit(1)`) to preserve fail-closed behavior
- Updated `src/renderer/index.html` CSP meta to mirror the enforced policy.
- Documented security posture in both `CLAUDE.md` (spec requirement) and `AGENTS.md` (canonical mirror for agent workflows).
- Added tests:
  - `src/main/security/electron-security.unit.test.ts`
  - `e2e/security-csp.e2e.test.ts`
- Verification evidence (2026-03-04):
  - `pnpm test:unit` ✅
  - `pnpm test:e2e:headless` ✅
  - `pnpm check` ✅
  - `pnpm prepush:main` ✅
  - `npx -y react-doctor@latest . --verbose --diff main` ✅ (100/100)

## Tests

- Unit: startup assertion catches misconfigured webPreferences
- Integration: CSP blocks inline scripts

## Risk if Skipped

A single XSS vulnerability in markdown rendering gives an attacker (or a hallucinating LLM crafting malicious output) full Node.js access — file system, shell, network.

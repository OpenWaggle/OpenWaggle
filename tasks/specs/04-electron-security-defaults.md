# 04 — Electron Security Defaults

**Status:** Planned
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

- [ ] Audit `src/main/index.ts` (or wherever `BrowserWindow` is created) for all `webPreferences` settings. Verify and document each.
- [ ] Add a CSP meta tag or `session.defaultSession.webRequest.onHeadersReceived` handler that sets `Content-Security-Policy` with:
  - `script-src 'self'`
  - `connect-src 'self' ws://localhost:*` (for devtools)
  - `img-src 'self' data:` (for inline images)
  - `style-src 'self' 'unsafe-inline'` (Tailwind needs inline styles)
- [ ] Add a startup assertion in main process that verifies `nodeIntegration === false` and `contextIsolation === true` at runtime.
- [ ] Document the security posture in CLAUDE.md under a "Security" section.

## Files to Touch

- `src/main/index.ts` — BrowserWindow creation, CSP header
- `CLAUDE.md` — document security settings

## Tests

- Unit: startup assertion catches misconfigured webPreferences
- Integration: CSP blocks inline scripts

## Risk if Skipped

A single XSS vulnerability in markdown rendering gives an attacker (or a hallucinating LLM crafting malicious output) full Node.js access — file system, shell, network.

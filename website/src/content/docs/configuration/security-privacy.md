---
title: "Security & Privacy"
description: "Current security boundaries for Electron, storage, provider auth, terminal, and Pi tools."
order: 5
section: "Configuration"
---

## Electron Boundary

The renderer runs with:

- Node integration disabled.
- Context isolation enabled.
- Sandbox enabled.
- Strict Content Security Policy.
- Typed IPC through the preload bridge.

## Local Data

OpenWaggle stores app-owned state locally. Settings, sessions, and session projections live in SQLite. Waggle presets live in user-data JSON and project `.openwaggle/settings.json`.

Provider credentials are not owned by the SQLite session projection. They are resolved through Pi auth storage, environment variables, or project/custom provider configuration.

## Voice

Voice transcription runs locally. Audio is not sent to an external speech-to-text provider.

## Terminal And Pi Bash

The built-in terminal is a user-authorized interactive shell, not a sandbox. Each shell receives a
fresh snapshot of the app's environment so the user's toolchains, locale, authentication sockets,
proxies, display session, and other exported variables continue to work. That also means terminal
commands and their child processes can read credentials or secrets present in that environment.

OpenWaggle removes its own control variables and known Electron/Node code-injection variables before
spawn. It also removes AppImage runtime paths on Linux, then sets terminal capability markers. This
narrow launch cleanup is not a secret filter and should not be treated as one.

Terminal output is stored locally under the app's user-data directory so panes can restore recent
scrollback. Each terminal is capped at 5,000 lines and 10 MiB; storage uses user-private directory
and file permissions on platforms that support them. Closing a pane or tab, or deleting its session,
deletes that terminal's retained history. A full app restart sanitizes terminal queries, clipboard
controls, input modes, and full-screen TUI state before replaying old output into a new emulator.

Terminal links require `Cmd`-click on macOS or `Ctrl`-click on Windows/Linux. Only HTTP(S), safe
`file:` links, and recognized file references are routed; other schemes are rejected. Files inside
the active Working path can open in OpenWaggle, while paths outside it can open only in the user's
remembered choice from the supported external-editor list; they never gain workspace access.

When **Open web links in** is set to **OpenWaggle**, HTTP(S) links use a native, Session-owned
Browser preview. Its page process is sandboxed with Node integration disabled; permissions,
downloads, device access, certificate exceptions, embedded credentials, unapproved popups, and
non-HTTP(S) navigation are denied. OpenWaggle chrome owns navigation and can hand the current URL to
the system browser explicitly. A Session's bounded native views may remain alive while hidden so a
background run can continue; explicit close, Session deletion, renderer/window teardown, or app
teardown ends them. A trusted OpenWaggle renderer reload retains the same owner bindings and native
views, while any navigation away from the trusted app document revokes the bindings and disposes the
views. A crashed preview page process gets at most three automatic reload attempts in 30 seconds;
navigation, replacement, and close cancel pending recovery.

Persistent Browser profiles isolate cookies and site data by Electron partition; Incognito uses an
in-memory partition. Cookie import copies bounded compatible records into a persistent OpenWaggle
profile and never writes to the source browser. It may invoke the operating system's credential
helper to decrypt the selected source. Windows imports are limited to Firefox and Helium. OpenWaggle
does not offer other Chromium sources there because it cannot decrypt Chrome 127+ app-bound cookie
encryption safely. Agent Browser preview access is separately configurable.
When disabled, or when its setting cannot be read, both the tools and their prompt guidance are
withheld, and every service operation rechecks that authority to revoke already-running turns.
Enabled page-control operations still use scoped approval, exact Session ownership, and bounded
cancellation; real user input interrupts agent control.

Browser annotations run in an isolated JavaScript world and place their controls in a closed shadow
root. Element, region, and drawing collections, text fields, source stacks, stroke points, and the
complete payload are bounded before main accepts them. Temporary style previews are restored after
the screenshot or cancellation. The resulting attachment labels selectors, HTML, computed styles,
and other page-derived metadata as untrusted content; annotating does not send it until you send the
composer draft. React source attribution is optional and omitted when the page does not expose
reliable development metadata.

**Add selection to chat** puts a bounded terminal selection into a removable composer context chip,
labels it with its Working path and checkout provenance, and marks it as untrusted terminal output.
Nothing is sent to a model until you send the draft. Treat command output as potentially adversarial
even when it came from a local tool.

Pi's `bash` tool is executed by Pi and currently follows Pi SDK shell-environment behavior. Do not
assume the built-in terminal's shell selection, startup integration, or launch cleanup applies to Pi
tool calls.

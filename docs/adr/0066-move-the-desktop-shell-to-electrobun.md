---
status: proposed
---

# Move the Desktop Shell to Electrobun

Status: proposed. It amends ADR 0064, which put the Electron shell behind ports and deferred the move to Electrobun. The move ships only once the Electrobun build matches or beats the best Electron build on every OS in download size, installed size, cold and warm window-ready time, idle memory and memory after a turn.

The desktop shell ports of ADR 0064 let OpenWaggle replace Electron with Electrobun. The main process then runs on Bun, built with `bun build` as one ES module for the Bun target, which keeps lazy module initializers and `import.meta`.

## Decision

A spike ran the real renderer on Electrobun 2.0.6 on macOS, Windows, Ubuntu 24.04 and Ubuntu 22.04. Compared with Electron, the download was 41–59 MB instead of 247–272 MB, before adding the main-process payload. Idle memory was roughly halved, and macOS packaging took 42–54s instead of 145–169s. Electrobun has no equivalent for 7 of the 25 Electron surfaces OpenWaggle uses, and 10 more need workarounds. Each one is solved as follows:

- **Electron is removed in the same change.** The ports of ADR 0064 keep the Electron adapter shippable while the Electrobun adapters are built.
- **System webview by default.** The app uses WKWebView, WebView2 and WebKitGTK. CEF is used only where Chrome DevTools Protocol automation needs it, which today is the browser preview.
- **Loopback origins replace custom schemes.** Each trust domain (renderer, each extension, each MCP app frame, inline visualizations, session resources) gets its own `Bun.serve` origin on `127.0.0.1`. This keeps origin isolation, real CSP and COOP/COEP headers, and streaming. Each request needs a per-launch token, and the Host checks the token. Sharing one `views://` origin is rejected because it loses isolation. An upstream scheme-handler patch can replace the servers later.
- **The preload contract stays; only the transport changes.** The typed IPC channels run over Electrobun's typed RPC.
- **Terminals use `Bun.spawn({ terminal })`.** It works on all three OSes, including ConPTY. That removes node-pty, which is unreliable under Bun and whose Linux prebuild already needs glibc 2.42.
- **Secrets move to the OS keychain through Bun.** On first launch, an idempotent migrator re-encrypts the existing `safeStorage` data.
- **User data stays where it is.** An `AppPaths` port resolves today's `openwaggle` userData directory on every channel. The first launch imports Electron's renderer `localStorage`, and the migration state is recorded so it can resume.
- **Existing installs update through the feed they already read.** The release pipeline publishes transition artifacts in electron-updater's format:
  - macOS: the Electrobun `.app`, signed with the same Team ID and bundle identifier.
  - Windows: an NSIS wrapper.
  - Linux: an AppImage wrapper.

  After the transition, Electrobun's updater takes over with the same stable and beta channels.
- **Platform minimums are kept.** Stock Electrobun needs macOS 14 and glibc 2.38. OpenWaggle builds the Electrobun native layer from a pinned upstream tag plus its own patches, targeting macOS 13.4 and glibc 2.35, and offers those patches upstream. Windows ships the WebView2 bootstrapper.
- **Gaps with no Electrobun API get small native helpers:** single-instance lock, login items, dock badge, resume detection, protocol-client registration, renderer crash detection and system proxy. Sentry moves to `@sentry/bun` and `@sentry/browser`.

## Consequences

- The release workflow, updater, signing and supported-platform documentation must cover the Electrobun build before it ships, including updating existing Electron installs and moving their user data (`docs/electrobun-transition.md`).
- The Electrobun native layer is built from `vendor/electrobun/` by `.github/workflows/electrobun-native.yml`, and its floor guards run on every devkit.

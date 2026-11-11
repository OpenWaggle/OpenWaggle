# Electrobun webview shell

How the Electrobun shell (ADR 0064) serves the app's pages from loopback trusted origins, carries
IPC over the webview RPC, injects the preload and enforces web security in the system webviews.
Load when touching `src/main/adapters/electrobun/` webview, window, origin or security modules,
`src/preload/electrobun-*.ts`, `scripts/build-electrobun-preload.ts`,
`src/shared/structured-wire.ts`, `src/shared/types/desktop-shell-rpc.ts`, extension frame and
runtime module URLs, or renderer error reporting (`sentry-renderer.ts`).

## Trusted origins on loopback

- Electrobun has no custom schemes (only `views://`), so every trusted domain/host is its own
  `Bun.serve` on `127.0.0.1:<port>`; the port is the origin. `originOf` returns
  `http://127.0.0.1:<port>/<capability>`; Electron's returns `<scheme>://<host>`. Core code builds
  page-facing URLs through `trustedOrigins.originOf` (MCP and visualization frame URLs, session
  resource URLs, the visualization asset URL and CSP via `sourcesOf`), never from the scheme.
- Capability = 32-char base64url HMAC-SHA256 of `domain\nhost` under a per-launch secret; any
  other path is an empty 404. Chosen over cookies (ignore ports, so shared by every loopback
  server and readable by local listeners) and headers (pages cannot set them on frame and
  subresource requests). Threat model in `electrobun-trusted-origins.ts`.
- Handlers see the scheme form (`openwaggle://app/index.html`), so protocol modules are shared.
  `locate(url)` maps loopback back to that form; renderer surfaces report it from `getURL()` and
  navigation events, so `isTrustedRendererDocument` and friends work unchanged.
- `codeCache` domains remember their port (`<userData>/trusted-origin-ports.json`) so
  localStorage and compiled code survive restarts; other hosts take fresh ports and send
  `Clear-Site-Data: "storage"` on their first document. WebKit cannot clear storage per origin
  (`WKWebsiteDataStore` records group all ports under `127.0.0.1`), hence the header.
- Cost: 1000 servers measured at 0.04 ms and ~16 KB RSS each; each holds an fd. MCP and
  visualization frames call `trustedOrigins.release` when unregistered. Hardening option not
  taken: one server per domain with `frame-<id>.localhost` hosts (exact-port CSP), blocked on
  WebKitGTK resolving `*.localhost` only with nss-myhostname/systemd-resolved.

## Web security

- Renderer CSP is a response header of the renderer's loopback server
  (`setDocumentHeaders('renderer', rendererDocumentHeaders)`), built by
  `buildContentSecurityPolicy(electrobunRendererPolicySources())` plus `ws://127.0.0.1:*` for the
  RPC socket. Electron's policy string is byte-identical to before. Vite dev pages get none.
- Electrobun `navigationRules` apply to the main frame only (macOS
  `shouldApplyMainFrameNavigationRules`; subframes are allowed with no event), so frames are
  confined by the renderer's `frame-src` plus per-host capabilities. Open: `frame-src
  http://127.0.0.1:*` lets a frame navigate itself to another local HTTP server (credential-less
  GET).
- Main window rules: `["^*", "<renderer base>/*"]` (last match wins). `will-navigate` reports
  `{url, allowed}` as a JSON string; refused ones go to `openLink`. `new-window-open` (parsed
  object) always goes to `openLink`: Electrobun never opens popups itself.
- `sandbox: true` turns the webview RPC off; the app window uses `sandbox: false`.

## RPC, preload and surfaces

- Wire: Electrobun RPC is JSON. `structuredTransport` wraps a transport with
  `encodeStructured`/`decodeStructured` (`$ow` tags: Uint8Array and every typed array, Date, Map,
  Set, bigint, undefined, NaN, Error). Schema `DesktopShellRpc`: `shell:invoke`, `shell:send`,
  `shell:toggle-devtools` (page to main), `shell:event`, `shell:focus`, `shell:heartbeat` (main
  to page). The preload overrides Electroview's default transport right after construction;
  host messages queued before that arrive undecoded (only tagged values differ).
- Electrobun's RPC rejects with `error.message` only; the page sees the handler's message
  without Electron's "Error invoking remote method" prefix (`ipcFailureMessage` reads both).
- No crash event in WebKit/WebView2: surfaces send `shell:heartbeat` every 5 s with a 5 s
  timeout; 3 misses in a row emit `render-process-gone` and reload the page.
- Preload: `bun run build:electrobun-preload` (Vite IIFE, ~31 KB) aliases `./electron-transport`
  and `./error-reporting-bridge` to the Electrobun modules and `electrobun/view` to the devkit
  browser SDK. The main window injects it as a string after
  `globalThis.__openwaggleRendererArguments = [...]` (the `additionalArguments` equivalent,
  read by `rendererArguments()` in both transports). Injected scripts run in the page world (no
  context isolation in WKWebView/WebView2), main frame only.
- Windows: ids are Electrobun `BrowserWindow` ids, surface ids are webview ids. Automation
  forces `hidden: true, activate: false`; `reveal`/`revealInactive`/`focus` throw
  `AutomationDesktopUiError`. No `ready-to-show`: the first `dom-ready` reveals. No fullscreen
  events, no taskbar overlay icon, no reload/zoom keys to swallow (WebKit binds none); F12 is
  sent by the preload. `scripts/standards/electron-automation.ts` owns
  `electrobun-window-policy.ts` and rejects `new (sdk.BrowserWindow)(`, `.activate()` and
  `.unminimize()` elsewhere.

## Renderer in WebKit

- WKWebView has no `requestIdleCallback` (measured); `idle-callback-polyfill.ts` is the first
  import of `main.tsx`. `env.isDevelopment` is `import.meta.env.DEV` (a loopback http origin is
  production). UA reads use `navigator.userAgent` only; nothing uses `userAgentData`.
- Hidden-window proof (macOS 26, native renderer): a throwaway Hutch app
  (`bunx electrobun build --env=dev`, launcher run directly with `setDockIconVisible(false)`)
  served the page and a frame from loopback, the preload's invoke returned a `Uint8Array` and a
  `Date` intact, CSP blocked an inline script and `fetch('https://example.com')` while the RPC
  socket connected, and `reveal` threw under automation with the window still hidden.

## Extensions on loopback

- The renderer builds extension module URLs in render, so it needs the base synchronously: main
  passes `--openwaggle-extension-runtime-base=<originOf('extension-runtime', 'runtime')>`
  (`trustedOriginBaseRendererArguments(origins)`, both main windows, their own adapter) and the
  preload exposes `window.api.getTrustedOriginBases()`, which throws when main passed none. An
  IPC invoke was not taken: it would add a loading state to every frame mount. Electron passes
  `openwaggle-extension://runtime`, so its module URLs are byte-identical.
- Main builds frame URLs (`registerExtensionFrame`) from `originOf('extension-frame', 'frame')`.
  The frame CSP names `sourcesOf` of that host and of the runtime host (exact ports on
  Electrobun, the same scheme sources as before on Electron) plus the bootstrap's origin. A
  bootstrap is trusted when it starts with `originOf('renderer', 'app')/` or is the Vite dev
  origin; only the dev origin gets the Vite sockets in `connect-src` (it used to be any localhost
  URL, which on Electrobun is every built bootstrap).
- The frame document path carries the capability (`/<cap>/frames/<id>/index.html`);
  `extensionFrameIdFromPath` reads it from the end. The bootstrap module loads cross-origin from
  the renderer server, which sends `access-control-allow-origin: *`.
- All extension frames share host `frame`, one origin, as on Electron. A host per extension
  would separate their storage; not done.

## Renderer error reports

- One lazy chunk, `sentry-renderer.ts`, holds both SDKs, picked at runtime by the preload's
  global: `__SENTRY_IPC__` starts `@sentry/electron/renderer`; the Electrobun bridge's
  `__OPENWAGGLE_ERROR_REPORT_ENVELOPES__` (only with the reporting switch) starts
  `@sentry/browser`. Not a build-time alias: both shells load one renderer build, and the Electron
  renderer SDK is the browser SDK plus a few KB, so the chunk barely grows. Revisit if an
  Electrobun-only renderer build appears.
- Browser SDK: the shared options policy, the placeholder DSN (no transport starts without one),
  `sendClientReports: false`, and a `createTransport` that hands each envelope string to
  `window.api.sendErrorReportEnvelope` (`error-reporting:renderer-envelope`, exempt from the
  backend gate) → `reportRendererEnvelope` → `ErrorReporter.captureRendererEnvelope`. Electron's
  reporter has none, so the channel drops envelopes there.
- Frames under the page base (`new URL('./', location.href)`) are rewritten to
  `openwaggle://app/` (`RENDERER_CODE_LOCATION_PREFIX`): the code rules keep them as app code and
  no report carries the port or capability. Other loopback frames (extension modules) become
  `<external>`.
- The browser SDK always sets `environment` (`production` by default): `rendererEnvelopeEvents`
  drops the renderer's release and environment so the main SDK applies its own.

## Still open

- `src/main/error-reporting.ts` still loads the Electron main reporter; until the shell switch
  binds the Bun reporter, Electrobun renderer envelopes reach no `captureRendererEnvelope`.
- Dropped/picked files have no paths in the system webviews: `prepareSelectedAttachments`
  rejects with a reason.
- Session resource requests are tied to their owner page by Electron's `webRequest` frame
  identity (`shouldBlockSessionResourceRequest`); on Electrobun only the per-resource token and
  the host capability guard them. The bindings in `src/main/desktop-shell/` still point at
  Electron.

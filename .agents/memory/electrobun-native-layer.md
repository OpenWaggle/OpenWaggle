# Electrobun native layer

Building Electrobun's native layer for OpenWaggle's platform floor (`vendor/electrobun/`), the
floor guards that read Electrobun apps, and CEF/CDP behaviour of the browser preview.
Load when touching `vendor/electrobun/`, `scripts/check-native-platform-floor.ts` or
`scripts/check-macos-sdk-symbols.ts`, `.github/workflows/electrobun-native.yml`, or the Electrobun
browser preview.

- Stock Electrobun 2.0.6 hard-codes macOS 14.0 (`package/scripts/macos-release.js`, and Zig
  `os_version_min` when no target is given) and builds Linux on Ubuntu 24.04 (glibc 2.39, GLIBCXX
  3.4.32). Its prebuilt owned dependencies (zig-bsdiff, zig-zstd, zig-asar, electrobun-dawn) carry
  the same floors, so `build.ts` rebuilds all four. Pin their peeled commits: `git ls-remote`
  shows annotated tags as a tag object plus a `^{}` commit, and fetching the tag object resolves to
  the other SHA.
- A packaged Electrobun app is a wrapper `.app` whose launcher is the self-extractor plus
  `Resources/<hash>.tar.zst` (the real app). dyld does not enforce `minos` on a directly executed
  binary, but LaunchServices refuses an app whose binaries need a newer macOS
  (`kLSIncompatibleSystemVersionErr`, seen on a 13.4 VM with the stock build). Hutch writes no
  `LSMinimumSystemVersion`; `hooks/macos-launch-version.ts` adds 12.0 so patch 0003's launcher can
  explain the 13.4 requirement.
- macOS CEF browser previews in a `persist:*` partition never opened on stock 2.0.6: macOS calls
  `CreateBrowserSync`, which returns null until the request context's browser context is
  initialized, and an on-disk profile initializes asynchronously. The CDP endpoint then lists no
  preview target. Linux and Windows use async `CreateBrowser` and work. Patch 0004 creates the
  browser from `OnRequestContextInitialized`.
- Hutch's cottontail runtime needs glibc 2.38, so it cannot run in the Ubuntu 22.04 build
  container. Upstream's build scripts are Bun-compatible: Linux runs them with Bun
  (`HUTCH_BINARY=bun`) and `npm ci`. App packaging with Hutch still runs on a newer host.
- Windows CI: Bun's shell and scripts find Git for Windows' GNU tar first, which reads `C:\...` as
  a remote host. Use `%SystemRoot%\System32\tar.exe` (bsdtar). Checkouts that `git am` patches need
  `core.autocrlf=false` and `-text` patch files.
- `scripts/check-macos-sdk-symbols.ts` checks strong imports against the macOS 13.3 SDK's `.tbd`
  stubs. Newer SDK stubs list system libraries for `arm64e` only, so arm64 lookups accept both.
  Objective-C messages have no symbol (stock `CADisplayLink` use passed it), which is why patch 0002
  compiles with `-Werror=unguarded-availability`.
- GitHub has no macOS 13 runner and cannot nest VMs. Run macOS 13.4 locally with Tart 2.6.x
  (`ghcr.io/cirruslabs/macos-ventura-vanilla:13.4`; Tart 2.41 rejects that image's old disk layout),
  SSH as admin/admin, and launch GUI apps with `sudo launchctl asuser 501 sudo -u admin ...`.
  `screencapture` there lacks Screen Recording permission and captures only the desktop.
- The Electrobun Browser preview (`src/main/adapters/electrobun/browser-preview/`) drives CEF
  `BrowserView`s over CEF's DevTools endpoint and finds each page by a random `about:blank#<marker>`
  first URL in `/json/list`. An app cannot pick the CEF port itself: its Worker starts after the
  main thread entered the native event loop (CEF reads the port once), and Bun's `process.env`
  never reaches `getenv`. Patch 0007 has the launcher reserve a loopback port for
  `chromiumFlags['remote-debugging-port'] = 'launch'`; the adapter removes the variable from
  `process.env` so terminals and tools do not inherit it.
- Stock 2.0.6 CEF gaps the preview hit: removing a CEF view on macOS closed its whole window (CEF's
  default `DoClose`, patch 0008); a named non-`persist:` partition got a new in-memory context per
  webview (patch 0009); `webviewSetPageZoom` is WKWebView-only (zoom is CDP device metrics);
  `Session` cookies and storage reach WebKit or WebView2 stores, never CEF (use CDP `Network.*` and
  `Storage.*` from a page in the partition); `BrowserView` has no frame or visibility setter (bind
  core `resizeWebview`/`webviewSetHidden`). A page restored from the back-forward cache runs no
  script, so titles also come from `Page.getNavigationHistory`.
- CEF `persist:*` partitions live under `Application Support/<identifier>/<channel>/CEF/<name>` on
  macOS with no `@available` gate, so CEF preview profiles persist on macOS 13.4 and 14+ alike;
  patch 0002's in-memory stores apply to system-webview (WKWebView) partitions only.
- App config the preview needs: `bundleCEF: true` on every OS; `defaultRenderer: 'native'` on macOS
  and Windows (system-webview shell, CEF previews), `'cef'` on Linux, because one Linux process
  cannot mix CEF and WebKitGTK views; `chromiumFlags: { 'remote-debugging-port': 'launch' }` and
  never `remote-allow-origins`. The adapter creates `renderer: 'cef'` views either way.
- The element picker runs in the page script's isolated world over `Runtime.evaluate`. It waits
  for the user far longer than a CDP command may, so it returns at once and reports through the
  world-only `Runtime.addBinding`, tagged with a token. A result counts only from the main frame
  world it started in, and a destroyed world ends the pick as a cancel would. CDP screenshot clips
  are in document CSS pixels, so add `cssVisualViewport.pageX/pageY` to a viewport rectangle.
- A local `package.ts` build bundles stock `node_modules/electrobun` binaries without the vendor
  patches. On macOS, previews there never appear on the DevTools port (no patch 0004), so native
  preview checks need the CI-built devkit or the adapter probe.

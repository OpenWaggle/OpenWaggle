# Electrobun native layer

OpenWaggle's Electrobun shell (ADR 0066) runs on Electrobun's native layer: the launcher and
self-extractor, `libElectrobunCore`, the native wrapper, the CEF wrapper and helpers, and Electrobun's
own Zig tools (bspatch, zig-zstd, libasar). Upstream builds them for newer systems than OpenWaggle
supports, so OpenWaggle builds them itself from a pinned release plus the patches in this directory.

| Platform | Upstream 2.0.6 | OpenWaggle floor | How |
| --- | --- | --- | --- |
| macOS arm64, x64 | 14.0 | 13.4 (launch 12.0) | patches 0001 to 0004, 0006 to 0011, 0014 to 0016 and 0020, Zig tools and Dawn rebuilt for 13.4 |
| Linux x64 | glibc 2.39, GLIBCXX 3.4.32 | glibc 2.35, GLIBCXX 3.4.30 | patches 0001, 0005, 0006, 0007, 0009 to 0011 and 0020, built in Ubuntu 22.04 (`linux/Dockerfile`), Zig `x86_64-linux-gnu.2.35` |
| Windows x64 | Windows 10 | Windows 10 | upstream build with patches 0006, 0007, 0009 to 0013 and 0020, plus the WebView2 Evergreen bootstrapper |

The floors come from `scripts/supported-platform-floor.ts`. Linux arm64 and Windows arm64 are not
release targets (docs/release-and-versioning.md), so they are not built.

## Files

- `VERSION`: `<upstream version>-openwaggle.<n>`. Bump `n` when a patch or a build input changes.
- `sources.ts`: the pinned upstream commit, Electrobun's own Zig dependencies and Dawn, Zig, Hutch, the macOS
  13.3 SDK used for the symbol check, and the WebView2 bootstrapper. Every pin is a commit or a
  sha256, never a tag alone.
- `patches/`: `git format-patch` output, applied with `git am` on the pinned commit. Each one is
  written to be sent upstream as is.
- `build.ts`: checks out the pin, applies the patches, rebuilds the Zig dependencies and
  electrobun-dawn (WebGPU, with its own CMake configuration) for the floor,
  runs upstream's release build with the floor settings, and writes a devkit, the release tarballs
  and `manifest.json` to `out/electrobun-native/<platform>-<arch>`.
- `linux/Dockerfile`: the Ubuntu 22.04 build image (GCC 12, the GTK and WebKitGTK development
  packages, Node and Bun).
- `hooks/macos-launch-version.ts`: an app build hook that writes `LSMinimumSystemVersion` 12.0, so
  macOS 12 to 13.3 open the app and the launcher explains the 13.4 requirement (patch 0003).
- `api-types.ts` and `types/`: the SDK's declarations, generated from the Hutch devkit. Electrobun
  2.x ships its SDK as TypeScript source in the devkit (`bunx electrobun prepare` writes
  `.hutch/devkit`, pinned by the root `hutch.config.ts`), so the repository type-checks the shell
  adapters against these declarations (the `electrobun`, `electrobun/main` and `electrobun/view`
  paths in `tsconfig.node.json`), and the main build bundles the devkit source. The generator
  declares the SDK's open `unknown` maps as JSON maps (`types/json.d.ts`), since Electrobun reads
  and writes them as JSON. Regenerate after a version bump:
  `bunx electrobun prepare && bun vendor/electrobun/api-types.ts`.
- `probe/`: a small Electrobun app with a system-webview shell and a CEF browser preview (on Windows,
  no CEF: WebView2's Chromium environment, patch 0013). CI packages it against the devkit and drives
  the preview over CDP, and checks that the shell and the preview keep the same-origin policy.
- `ci/linux-display.sh`: Xvfb, a window manager and a session bus for launching on CI.

## Patches

1. **build: make the macOS deployment target and Linux glibc target configurable.**
   `ELECTROBUN_MACOS_DEPLOYMENT_TARGET`, `ELECTROBUN_MACOS_LAUNCHER_DEPLOYMENT_TARGET`,
   `ELECTROBUN_LINUX_GLIBC_VERSION` and `ELECTROBUN_LINUX_ABI_BASELINE`. Unset, nothing changes.
2. **macos: support a macOS 13 deployment target in the native wrapper.** `CADisplayLink` (macOS
   14) behind `@available` with a `CVDisplayLink` fallback; per-partition in-memory
   `WKWebsiteDataStore` on macOS 13 instead of the shared default store; the wrapper compiles with
   `-Werror=unguarded-availability` so an unguarded newer API cannot ship again.
3. **launcher: explain the minimum macOS instead of failing to start.** Below
   `ELECTROBUN_MACOS_REQUIRED_VERSION` the launcher shows an alert naming the version and exits 1.
4. **macos: open CEF browsers in a new persistent partition.** `CreateBrowserSync` returns null
   until a request context is initialized, and a `persist:*` partition initializes asynchronously.
   On macOS every CEF webview in such a partition failed to open, which is why the CDP endpoint
   listed no preview target. The browser is now created from `OnRequestContextInitialized`.
5. **linux: build the Wayland screen capture on Ubuntu 22.04.** GLib 2.72 needs
   `<gio/gunixfdlist.h>` and `gio-unix-2.0`; PipeWire 0.3.48 lacks `<spa/param/buffers.h>`, the
   video transform metadata and `SPA_CHUNK_FLAG_EMPTY`, which are defined as their protocol values.
6. **launcher: forward the launcher's arguments to the main process.** The launcher ran `bun
   main.js` with nothing after it, so the app never saw a protocol link or file Windows and Linux
   pass as arguments, nor `--use-mock-keychain`. Every argument now follows `main.js` in order,
   except the launcher's private `--automation` and macOS's `-psn_*`.
7. **launcher: choose a CEF remote debugging port per launch.** With
   `chromiumFlags['remote-debugging-port'] = 'launch'` the launcher reserves a free loopback port
   before the native core starts CEF and sets `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT` through
   `setenv` (`SetEnvironmentVariableW` on Windows) and in `process.env` for the app's Worker. The
   app cannot do this itself: its Worker starts after CEF has read the port, and Bun's
   `process.env` never reaches `getenv`. Without the patch, CEF reads `launch` as invalid and
   keeps remote debugging off. An `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT` already in the
   environment wins, so a QA driver can choose the port.
8. **macos: keep the window when a CEF webview is removed.** CEF's default `DoClose` sends
   `performClose:` to the view's window, so removing one CEF `BrowserView` closed its whole window
   (closing a Browser preview tab would close OpenWaggle). `DoClose` returns true outside shutdown,
   as the Windows wrapper already does.
9. **cef: share one in-memory context per named partition.** A partition without `persist:` got a
   new in-memory context for every webview, so two webviews of one partition shared no cookies.
   Named partitions now keep one context for the process, as Electron's do; an omitted partition
   still gets its own.
10. **launcher: hand the forwarded arguments to the app's Worker.** `main.js` starts the app in a
   Bun Worker, whose `process.argv` holds only the runtime and its script unless the Worker is
   given `argv`, so the arguments patch 0006 forwards stopped there: a protocol link, a file or an
   `openwaggle` command the launcher was started with never reached the app. The Worker now gets
   `process.argv.slice(2)`.
11. **prepare: accept an update from a sibling of the installed release directory.** The native
   update prepare required the request's base URL to equal the `baseUrl` baked into the installed
   bundle, but OpenWaggle's updater selects a release by its own directory
   (`releases/download/<tag>/`), never the one the installed app was built for, so every download
   failed with `InvalidUpdateIdentity`. The request may now name the baked directory or a sibling
   of it (same parent, one more segment, no separators, dot segments or encoded slashes); the
   identifier, channel and base hash checks are unchanged.
12. **windows: keep the same-origin policy on in WebView2.** Every WebView2 browser process started
   with `--disable-web-security --allow-insecure-localhost`, so any page, the app's own windows
   included, could read every other origin, the app's loopback servers among them. Both switches
   are gone; macOS and Linux system webviews never turned the policy off.
13. **windows: serve CEF webviews from WebView2 when CEF is not bundled.** A `renderer: "cef"`
   webview in a build without CEF opens in WebView2's Chromium environment: its own user data
   folder (`<LOCALAPPDATA>\<identifier>\<channel>\WebView2Chromium`), so its own browser process,
   the only one with `--remote-debugging-port`, on the port CEF would have used
   (`ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT`, then `chromiumFlags`, then the dev scan) and with no
   `remote-allow-origins`. The app's system-webview windows never appear on the port. A browser
   process serves one port, so partitions are WebView2 profiles of that one environment:
   `persist:<name>` the on-disk profile `<name>`, any other name an InPrivate profile shared by its
   webviews, an empty partition an InPrivate profile of its own; names other than short lowercase
   ASCII are hashed (`shared/webview2_chromium_environment.h`, with a test). The environment starts
   with the first such webview, never at launch. OpenWaggle's Windows build ships no CEF.
20. **ffi: keep each C string's buffer alive until the native call has read it.** `toCString`
   returned `ptr(Buffer.from(...))` and dropped the Buffer, so a garbage collection between it and
   the native call could free and reuse the bytes; `createWebview` builds six such strings for one
   call. The webview's secret key then arrived short and the app quit at startup ("Webview secret
   key must contain exactly 32 bytes"). Each Buffer now stays referenced until the next macrotask.
   Patches 0020 on are packaging and Linux fixes (0012 and 0013 are Windows, 0014 on macOS).
14. **macos: start CEF with the first CEF webview, not at launch.** With CEF bundled,
   `startEventLoop` ran `CefInitialize` and `CefRunMessageLoop` at every launch, so an app with no
   CEF webview open still started CEF's GPU and utility processes and waited for CEF before its
   window. The main thread now always runs `[NSApp run]` (with `ElectrobunNSApplication`), and the
   first CEF webview starts CEF on it with `external_message_pump`: `OnScheduleMessagePumpWork`
   drives `CefDoMessageLoopWork` on the main thread (cefclient's
   `MainMessageLoopExternalPumpMac`). `CefShutdown` runs at exit only if CEF started; a failed
   start falls back to WKWebView. The wrapper no longer links the framework: it loads it with
   `cef_load_library` when CEF starts, through `libcef_dll_wrapper`'s dylib stubs, as CEF's
   helpers do. Patches 0012 and 0013 are Windows'.
15. **macos: load CEF from a component directory when the app does not bundle it.** CEF now
   starts from the first directory holding `Chromium Embedded Framework.framework`:
   `ELECTROBUN_CEF_DIR` from the launch environment, the bundle's `Contents/Frameworks`, or the CEF
   component directory (below). `framework_dir_path` and `browser_subprocess_path` point there; the
   NSApplication is always `ElectrobunNSApplication`, since CEF may arrive after launch. The helper
   no longer links the framework at `@executable_path/../../../../Frameworks`, which only an app
   bundle has; `CefScopedLibraryLoader::LoadInHelper` loads it from beside the helper apps.
16. **macos: warm a WebContent process at launch for the first webview.** A first WKWebView
   waited for WebKit to launch and initialize its WebContent process
   (`WebProcess::platformInitializeWebProcess` took 0.3-0.8 s on a macOS runner) after the app had
   loaded its code and asked for the window. `startEventLoop` now calls WebKit's
   `-[WKProcessPool _warmInitialProcess]` SPI on a pool that every `WKWebViewImpl` then uses, so
   that work overlaps the app's startup and the first page takes the warmed process (WebKit logs
   `markIsNoLongerInPrewarmedPool`). `ELECTROBUN_WARM_WEBCONTENT=0` turns it off.

## CEF component (macOS)

Release macOS builds do not bundle CEF (`macosBundlesCef` in `scripts/electrobun/app-config.ts`;
Dev builds still do, and `OPENWAGGLE_MACOS_BUNDLE_CEF=1|0` overrides). The app installs CEF as a
component before its first Browser preview. The contract, for the native layer, the app and the
release:

- **Install directory:** `$HOME/Library/Application Support/<identifier>/cef/<CEF_VERSION>-<arch>/`.
  `<identifier>` is the app's Electrobun identifier (`Resources/version.json`), `<CEF_VERSION>` the
  native layer's `CEF_VERSION` (`156.0.7+g47dbc1d+chromium-156.0.8078.17`), `<arch>` `arm64` or
  `x64`. The native layer resolves it when CEF starts, so a component installed after launch is
  used.
- **Layout:** `Chromium Embedded Framework.framework/` and the helper apps `bun Helper.app`,
  `bun Helper (GPU).app`, `bun Helper (Renderer).app`, `bun Helper (Plugin).app` and
  `bun Helper (Alerts).app`, side by side, the same as an app's `Contents/Frameworks`. The helpers
  are the devkit's `process_helper`. The installer adds `component.json` (`schemaVersion`,
  `cefVersion`, `arch`, `sha256` of the archive).
- **Archive:** `cef-component-<cef>-darwin-<arch>.tar.xz` (no `+` in asset names), those entries at
  its top level, built and signed by `bun scripts/electrobun/cef-component.ts build --devkit <devkit>
  --arch <arch> [--identity …]`. The framework and helpers are signed with the app's identity,
  hardened runtime and `build/entitlements.electrobun.mac.plist`, so a helper and the framework it
  loads have the same Team ID; the app's `disable-library-validation` lets `bun` load it. About
  100 MB compressed, 345 MB installed (arm64).
- **Manifest:** `src/main/adapters/electrobun/cef-component/manifest.json` pins `cefVersion` and,
  per `darwin-<arch>`, the asset's `url`, `sha256` and `size`;
  `cef-component.ts pin --arch <arch> --url <url> --archive <file>` writes an entry. There is no
  runtime override: a test build points it elsewhere by rewriting the file before `bun run build`.
- **Verification:** the app streams the download into the `cef/` directory, checks its size and
  sha256 against the manifest before extracting anything, clears `com.apple.quarantine` (the pinned
  hash is the trust root; quarantined helpers would meet Gatekeeper), extracts with `/usr/bin/tar
  -xJf` into a staging directory and renames it into place.
- **Retention:** a component is current while its `component.json` matches the manifest. App updates
  keep it; a manifest that pins another CEF version or asset installs the new one and prunes every
  other entry of `cef/`. A change to `cef_process_helper_mac.cc` needs a new asset even at the same
  CEF version.
- **Publishing:** the asset lives on its own release (`cef-component-<cef>-r<n>`), not on each app
  release, because its sha256 is committed before the app that verifies it is built.

## Building

```bash
bun vendor/electrobun/build.ts                      # macOS (Xcode) or Windows (MSVC, Hutch)
bun vendor/electrobun/build.ts --linux-container    # Linux, in the Ubuntu 22.04 image
```

App builds use the result through `HUTCH_ELECTROBUN_DEVKIT_ROOT=out/electrobun-native/<target>/devkit`.
On Linux, upstream's build scripts run with Bun and npm, because Hutch's cottontail runtime needs
glibc 2.38.

## Proving the floor

`.github/workflows/electrobun-native.yml` (also `workflow_call`) builds every target and fails when:

- a devkit or packaged-probe binary exceeds the floor (`scripts/check-native-platform-floor.ts`,
  which reads Electrobun wrappers and their self-extracting payloads, and `--devkit` trees);
- a macOS binary binds a symbol or system library the macOS 13.3 SDK lacks
  (`scripts/check-macos-sdk-symbols.ts`; weak imports are allowed). Objective-C messages have no
  symbol to check, which is what patch 0002's compiler errors cover;
- the probe does not render its shell, or its CEF preview cannot be navigated, screenshotted, clicked
  and typed into over CDP, on macOS arm64 and x64, Windows x64, and Linux x64, the Linux build also on
  an Ubuntu 22.04 runner.

GitHub has no macOS 13 runner and its macOS runners cannot nest virtual machines, so a real macOS
13.4 launch runs locally on Apple silicon: the `ghcr.io/cirruslabs/macos-ventura-vanilla:13.4`
image in Tart 2.6.x (newer Tart rejects that image's disk layout), SSH as `admin`, and the probe
started in the GUI session with `sudo launchctl asuser 501 sudo -u admin`. The Intel build cannot be
run this way; its floor rests on the `minos` and SDK checks.

## Bumping Electrobun

Change the tag and commit in `sources.ts`, the dependency versions to the ones the new release's
`package/src/shared/build-dependencies.ts` names, `VERSION`, and the probe's `hutch.config.ts`. Then
rebase the patches: `git am` them on the new tag, fix what no longer applies, and `git format-patch
--zero-commit --no-signature --no-numbered` them back here.

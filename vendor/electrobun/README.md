# Electrobun native layer

OpenWaggle's Electrobun shell (ADR 0066) runs on Electrobun's native layer: the launcher and
self-extractor, `libElectrobunCore`, the native wrapper, the CEF wrapper and helpers, and Electrobun's
own Zig tools (bspatch, zig-zstd, libasar). Upstream builds them for newer systems than OpenWaggle
supports, so OpenWaggle builds them itself from a pinned release plus the patches in this directory.

| Platform | Upstream 2.0.6 | OpenWaggle floor | How |
| --- | --- | --- | --- |
| macOS arm64, x64 | 14.0 | 13.4 (launch 12.0) | patches 0001 to 0004 and 0007, Zig tools and Dawn rebuilt for 13.4 |
| Linux x64 | glibc 2.39, GLIBCXX 3.4.32 | glibc 2.35, GLIBCXX 3.4.30 | patches 0001, 0005 and 0007, built in Ubuntu 22.04 (`linux/Dockerfile`), Zig `x86_64-linux-gnu.2.35` |
| Windows x64 | Windows 10 | Windows 10 | upstream build with patch 0007, plus the WebView2 Evergreen bootstrapper |

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
  paths in `tsconfig.node.json`), and the main build bundles the devkit source. Regenerate after a
  version bump: `bunx electrobun prepare && bun vendor/electrobun/api-types.ts`.
- `probe/`: a small Electrobun app with a system-webview shell and a CEF browser preview. CI packages
  it against the devkit and drives the preview over CDP.
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
   except the launcher's private `--automation` and macOS's `-psn_*`. Windows keeps upstream's
   launcher until it is built here, so it still drops them.
7. **launcher: choose a CEF remote debugging port per launch.** With
   `chromiumFlags['remote-debugging-port'] = 'launch'` the launcher reserves a free loopback port
   before the native core starts CEF and sets `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT` through
   `setenv` (`SetEnvironmentVariableW` on Windows) and in `process.env` for the app's Worker. The
   app cannot do this itself: its Worker starts after CEF has read the port, and Bun's
   `process.env` never reaches `getenv`. Without the patch, CEF reads `launch` as invalid and
   keeps remote debugging off. An `ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT` already in the
   environment wins, so a QA driver can choose the port.

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

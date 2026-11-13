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

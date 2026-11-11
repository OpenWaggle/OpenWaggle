# Moving existing installs from Electron to Electrobun

ADR 0066 decides that existing Electron installs update to the Electrobun
build through the feed they already read, and keep all their data. This page says how that works,
what each operating system checks, what the bench proved, and what is still open. The code lives in
`src/main/electron-migration/` (first launch) and `scripts/electrobun-transition/` with
`build/electrobun-transition/` (release artifacts).

## The path an install takes

1. The installed Electron app (any Beta or Alpha build, or Stable once it exists) checks for updates as
   it does today: `src/main/update-feed.ts` lists the GitHub releases, picks the newest eligible one
   that has its platform's metadata file, and electron-updater reads `<feed>-mac.yml`,
   `<feed>.yml` or `<feed>-linux.yml` from it.
2. The first Electrobun release publishes, beside its Electrobun artifacts, one **transition
   artifact** per platform in electron-updater's format and the metadata files that point to it.
3. The user presses Restart to update. electron-updater installs the transition artifact the same
   way it installs any update, and the Electrobun app starts.
4. The Electrobun app's first launch runs the migrator: it finds the same userData, imports the
   renderer `localStorage`, re-seals the `safeStorage` secrets with a key kept in the OS keychain,
   and resets the browser-preview partitions.
5. From then on, Electrobun's updater updates the app from GitHub Releases on the same channel.

No extra Electron release is needed: nothing in the installed Electron app changes.

## What electron-updater checks, and how each artifact passes

| Platform | electron-updater and OS checks | Transition artifact | How it passes |
| --- | --- | --- | --- |
| All | `sha512` (base64) and `size` of the file named in the metadata. A `.blockmap` enables a differential download, otherwise the full file is downloaded. | `scripts/electrobun-transition/update-metadata.ts` writes the metadata; `scripts/prepare-update-channel-metadata.ts` copies it to every eligible channel, as for Electron builds. | The file hash is computed from the published file. No blockmap is published: nothing in the old install matches the new bytes, and the bench shows electron-updater downloads the full file. |
| macOS | The file must be a `.zip` whose name has the arch (`-arm64.zip` / `-x64.zip`). Squirrel.Mac (ShipIt) installs it only if the new bundle satisfies the running app's **designated requirement**: `identifier "com.openwaggle.app"` and, for Developer ID, the same Team ID. ShipIt also aborts while other instances run (the product already stops the Session Host). | `openwaggle-<version>-<arch>.zip`: the unwrapped, signed Electrobun `OpenWaggle.app`, zipped with `ditto` (`macos-transition-zip.ts`). | The app is signed with the release Developer ID and the bundle identifier `com.openwaggle.app`. `macos-transition-zip.ts` runs `codesign --verify -R=<requirement>` with the installed build's requirement before it zips, so a wrong identity fails the release, not users' updates. |
| macOS | ShipIt names the installed bundle after the new bundle's `CFBundleExecutable`, and on macOS 11+ relaunches through `Contents/Frameworks/Squirrel.framework/Resources/ShipIt` inside the new bundle. | `macos-transition-bundle.ts`, run before signing. | It renames Electrobun's `launcher` to `OpenWaggle` and adds a minimal `Squirrel.framework` whose `ShipIt` (`build/electrobun-transition/squirrel-relaunch.c`) only opens the bundle. Without it, the first bench run installed `/Applications/launcher.app` and never relaunched. |
| Windows | Runs the file as `<installer> --updated /S --force-run`. Verifies the Authenticode publisher only when the installed `app-update.yml` names a `publisherName`; OpenWaggle's Windows builds are unsigned, so it does not. `isAdminRightsRequired` decides whether `elevate.exe` is used. | `openwaggle-<version>-x64.exe`: an NSIS wrapper (`build/electrobun-transition/windows-transition.nsi`, built by `windows-transition-installer.ts`). | The wrapper runs Electrobun's Setup and waits until `%LOCALAPPDATA%\com.openwaggle.app\<channel>\app\bin\launcher.exe` and Setup's uninstall entry exist (Setup then waits for a Close click before it would start the app, so the wrapper closes it and starts the app itself), runs the old uninstaller silently without `--delete-app-data` (so `%APPDATA%\openwaggle` stays), then writes `openwaggle.cmd` back into the old install directory (the one on PATH) and re-registers `openwaggle:` links. The metadata sets `isAdminRightsRequired: false`. On failure it leaves the Electron install alone, restarts it and shows a message with the download link. Once Windows builds are signed, the wrapper must be signed with the same publisher. |
| Linux | Needs `$APPIMAGE`; deletes the running AppImage, moves the new file to the same path (a version-less name such as install.sh's `OpenWaggle.AppImage` is kept), `chmod 755`, and starts it. | `openwaggle-<version>-x86_64.AppImage`: an AppImage whose `AppRun` (`build/electrobun-transition/AppRun.sh`, built by `linux-transition-appimage.ts`) carries Electrobun's `installer`. | On its first start it installs the Electrobun app into `~/.local/share/com.openwaggle.app/<channel>/app`, points install.sh's `openwaggle.desktop` (and its `openwaggle:` link claim) at the new launcher, and later starts simply exec the installed app. The AppImage path, and so the `openwaggle` CLI shim, keep working. |

The `openwaggle update` CLI takes the same paths: on Windows and Linux it uses electron-updater;
on macOS it runs the bundled `install.sh` with a release tag, which downloads
`openwaggle-<version>-<arch>.dmg`. That DMG must therefore contain the same prepared
`OpenWaggle.app`, and the release must keep the `openwaggle-<version>-<arch>.*` asset names and
`SHA256SUMS.txt`.

## Bench evidence

A throwaway workflow on a `bench/` branch (now deleted; the harness is kept in the evidence folder
as `bench-harness/`) builds the Electron app from the base commit as an installed Beta
(`1.0.0-beta.37`, update feed pointed at a local stand-in for GitHub), builds an Electrobun 2.0.6 app
with the product's identity and the migrator, signs both with a throwaway self-signed identity, and
lets the old app's real updater install the transition artifact.

macOS (run 42911182237, macos-15 arm64): the old app found `v1.0.0-rc.1` through the real
`update-feed.ts`, downloaded `beta-mac.yml` and the full zip (no blockmap request), ShipIt replaced
`/Applications/OpenWaggle.app` and relaunched it through the relauncher (`ShipIt status 0`). The
first Electrobun launch reported the same userData, imported 6 `localStorage` entries (including
non-ASCII and emoji values), re-sealed the MCP vault secret as `ow1…` and opened it with the new
keychain key, and read the Electron keychain item without a prompt in 68 ms.

Windows (run 42917162530, windows-2022): the old per-user NSIS install found the release, tried
`openwaggle-1.0.0-rc.1-x64.exe.blockmap` (404) and downloaded the full wrapper, which logged
`--updated /S --force-run`, installed Electrobun, ran the old uninstaller (exit 0) and started the new
app. Afterwards only the Electrobun uninstall entry (`com.openwaggle.app.stable`) and shortcuts
remain, `%APPDATA%\openwaggle` is intact, `openwaggle.cmd` in the old directory (still on PATH) and
the `openwaggle:` handler point at the new launcher, and the first launch reported the same results
as macOS (DPAPI-wrapped `os_crypt` key from `Local State`). An earlier run (42913720524) waited on
Setup's "Installation complete" dialog forever; the wrapper no longer waits for it.

Linux (run 42913859694, ubuntu-24.04 with gnome-keyring): the AppImage at install.sh's path was
replaced in place, `AppRun` installed Electrobun into `~/.local/share/com.openwaggle.app/stable/app`
and rewrote `openwaggle.desktop` to the new launcher (hidden, because Electrobun's own
`OpenWaggle.desktop` is the visible entry). The first launch read the `v11` key from the Secret
Service item (`chrome_libsecret_os_crypt_password_v2`, `application=openwaggle`), re-sealed the
secret with a key it stored through `Bun.secrets`, and imported `localStorage`. WebKitGTK paints
black under a bare Xvfb, so the Linux screenshot is empty; the report and logs are the evidence.

## macOS keychain: is there a prompt?

Electron keeps the `safeStorage` password in the login keychain as `openwaggle Safe Storage`, account
`openwaggle Key`. Reading it from another executable passes two checks:

1. **Access control list.** The item trusts the app that created it by its designated requirement.
   On a real install that is `identifier "com.openwaggle.app" and anchor apple generic and … and
   certificate leaf[subject.OU] = <Team ID>`, so any executable with that identifier and Team ID
   matches, which is why Electron updates never prompt.
2. **Partition list** (macOS 10.12+). The real item lists `teamid:<Team ID>` (plus `cdhash:` entries
   for dev Electron builds that were granted access). Every executable signed by the team matches it.

Results from the bench, against the item the old app created, with copies of one Bun binary:

| Probe | Signature | Result |
| --- | --- | --- |
| A1 | Bun as shipped (another Developer ID team) | prompt |
| A2 | bench identity, identifier `bun` | prompt ("bun wants to use your confidential information…") |
| A3 | bench identity, identifier `com.openwaggle.app` | read silently |
| C2 | as A2, with its cdhash added to the partition list | prompt |
| C3 | as A3 | read silently |

So the ACL decides by identifier and signing identity, not by executable path or binary. The bench
keychain did not enforce partition lists (`security set-generic-password-partition-list` left no
partition entry, and B3, with only the creator's cdhash listed, still read silently), so the
partition half rests on the real install's item (`real-install-safe-storage-acl.txt` in the evidence
folder): its partition list holds `teamid:<Team ID>`, which a release-signed Electrobun process
matches.

**Answer.** With the release Developer ID there is no prompt, provided the process that calls the
keychain (`Contents/MacOS/bun`, where `Bun.secrets` runs) is signed with the identifier
`com.openwaggle.app`. Hutch signs nested binaries with codesign's default identifier (the file
name, `bun`), which fails the ACL and prompts. The release must sign the app itself, with Hutch's
`codesign` off: nested code first, `bun` with `--identifier com.openwaggle.app`, then the bundle;
the bench's `sign-macos-app.sh` does exactly that. With the self-signed bench identity it is
silent too, because the ACL pins the same certificate and the bench keychain applies no partition
check; on a real login keychain a self-signed or ad-hoc build gets `cdhash:` partitions and
prompts once for the keychain password.

**When a prompt cannot be avoided** (dev builds, a future change of signing identity, an item created
by a dev Electron build): the secrets step must not run on the startup path. The Host shows one
explained sheet first, "OpenWaggle needs the key your previous version kept in your keychain to move
your saved MCP secrets and sign-ins. macOS will ask once; choose Always Allow.", with Continue and
"Skip, I'll enter them again". Continue runs only the `secrets` step (`runElectronMigration({ steps:
['secrets'] })`) with a timeout; a denial or timeout marks it `blocked` and the Settings banner below
takes over. The keychain read never blocks the window.

## Fallback and recovery

- **The transition artifact fails to install.**
  - macOS: Squirrel.Mac reports the error to electron-updater; the installed app stays as it was and
    shows the existing "update failed" state, and the next check offers the update again. Manual
    path: the DMG from the release page or `install.sh`; both keep userData.
  - Windows: the order is install new, verify it, then remove old, so a failure before the
    uninstaller leaves Electron installed and restarted, with a message offering the download page
    and a log in `%LOCALAPPDATA%\openwaggle-updater\electrobun-transition.log`. A half-finished
    Electrobun install may remain beside it; the next attempt installs over it.
  - Linux: electron-updater has already replaced the Electron AppImage when `AppRun` runs, so there
    is nothing to roll back to. `AppRun` retries the install on every start, shows a zenity, kdialog or
    notify-send error with the download link, and logs to
    `~/.local/state/openwaggle/electrobun-transition.log`. Its only work is extracting a tarball into
    the user's data directory, so failures are limited to a full disk or a broken home directory.
- **The first launch migrates only part of the data.** `migration-state.json` records each step
  (`done`, `not-needed`, `failed` with attempts, `blocked`, `awaiting-renderer`); the app starts with
  whatever succeeded and retries failed steps on later launches up to the attempt cap.
  - `localStorage` only holds renderer preferences; if it fails, the renderer starts with defaults.
  - Each secret that cannot be opened is listed by name in the step detail. Settings shows "These
    saved secrets could not be moved from the previous version: … Enter them again." with Try again
    (after unlocking the keyring or answering the keychain prompt).
  - The original blobs are kept in `<userData>/electron-migration-backup/`, so a later fix or a
    reinstall of the Electron build can still recover them.
- **Going back to Electron.** The migrator never moves user data. Only re-sealed secret files change;
  restoring them from `electron-migration-backup/` makes the Electron build read them again.
- **Installs that update late.** The release keeps publishing transition artifacts (see below), so
  an Electron install that comes back after months goes straight to the newest Electrobun build.

## How `release.yml` changes

Wired in `.github/workflows/release.yml`; `scripts/electrobun/package.ts` does the per-platform work
(docs/release-and-versioning.md, "Electrobun packaging"). Every job packages against OpenWaggle's own
Electrobun native layer (the `native` job calls `electrobun-native.yml` and each build downloads its
target's devkit), with `OPENWAGGLE_RELEASE_CHANNEL` stamped as before.

1. **Build with Electrobun.** `hutch electrobun build --env=stable` for every channel, not `canary`
   for Beta and Alpha as first planned. Electrobun names the install root and the update files after
   the build environment (`~/Library/Application Support/com.openwaggle.app/stable`,
   `%LOCALAPPDATA%\com.openwaggle.app\stable`, `stable-<os>-<arch>-update-v2.json`), so a `canary`
   Beta would be a second install beside Stable, which Electron's one shared identity never was.
   OpenWaggle picks the release a channel follows itself (below), so Electrobun's channel has
   nothing left to decide. Cost: none found; the transition scripts already take `stable`.
2. **macOS (`build-macos`, one job per architecture on its own CPU).** Hutch signing is off. The
   `postBuild` hook runs `macos-transition-bundle.ts`, then signs inside out with hardened runtime and
   `build/entitlements.electrobun.mac.plist`, `bun` with `--identifier com.openwaggle.app`, using
   the Developer ID imported from `MACOS_CERTIFICATE_P12_BASE64` into a job keychain
   (`scripts/electrobun/ci/macos-import-identity.sh`; ad hoc without it), and keeps the unwrapped
   app in `out/electrobun/inner/`. Hutch rewrites `Contents/Resources/version.json` after
   `postBuild`, which broke the seal of the app in its update archive, so `package.ts` copies the
   final `version.json` in, re-seals the bundle, notarizes and staples it, repacks the `.tar.zst`
   and records its SHA-256 and size in `update-v2.json` (`scripts/electrobun/macos-reseal.ts`).
   From that one app it writes `openwaggle-<version>-<arch>.zip` (checked against
   `developerIdRequirement('com.openwaggle.app', $APPLE_TEAM_ID)`) and
   `openwaggle-<version>-<arch>.dmg` (signed, notarized, stapled). `macos-update-metadata` then
   writes one `*-mac.yml` for both zips (`package.ts metadata dist mac`, which runs
   `update-metadata.ts` and `prepare-update-channel-metadata.ts`).
3. **Windows (`build-windows`).** The `postBuild` hook Authenticode-signs every PE file before Hutch
   archives them and `postWrap` signs Setup, when `WINDOWS_CERTIFICATE_PFX_BASE64` is configured
   (Windows was unsigned under electron-builder too). `package.ts` runs
   `windows-transition-installer.ts` into `openwaggle-<version>-x64.exe` and copies Electrobun's Setup
   zip to `openwaggle-<version>-x64-setup.zip`, then the metadata.
4. **Linux (`build-linux`).** `appimagetool` 1.9.1, checksum-verified; `package.ts` runs
   `linux-transition-appimage.ts` into `openwaggle-<version>-x86_64.AppImage` and copies the Setup
   tarball to `openwaggle-<version>-linux-x64.tar.gz`. `check-native-platform-floor.ts` without
   arguments now reads the Electrobun output: the unwrapped app on macOS, Hutch's wrapper and its
   `.tar.zst` payload on Windows and Linux.
5. **Electrobun's own artifacts** are published unchanged next to the transition artifacts:
   `stable-<os>-<arch>-update.json`, `-update-v2.json`, the `.tar.zst` and, on Windows and Linux,
   the delta patch from the previous Electrobun release (`scripts/electrobun/patch-base-url.ts`
   finds it; `OPENWAGGLE_ELECTROBUN_PATCH_BASE_URL` turns on Hutch's `generatePatch`). macOS drops
   Hutch's patch, which targets the archive before re-sealing; macOS updates are full downloads
   until patches are generated against the repacked archive. Feed hosting: see below.
6. **`Collect release assets`** adds `*.tar.gz`, `*.tar.zst`, `*.patch` and `*update*.json` and
   drops `*.blockmap`. `verify-release-assets.ts` checks Electrobun's manifests byte for byte, as
   the `*.yml`.
7. **`verify-installers`** checks the macOS DMG, the transition zip and Electrobun's files per
   architecture, and installs the Windows transition installer silently
   (`scripts/electrobun/ci/smoke.ts install`). The full install-old-then-update flow runs in the
   bench workflow (`bench-electrobun-pkg-transition.yml` on a throwaway `bench/electrobun-pkg-*`
   branch) and is not yet a release gate: it rebuilds the previous Electron release from source
   with its feed pointed at a loopback server, and on macOS that rebuild must be signed with the
   release Developer ID to satisfy Squirrel.Mac. Making it the gate is open work.
8. **How long.** Keep publishing transition artifacts and their metadata on every release until a
   decided sunset (at least the 2.0 line or six months, whichever is later). Because
   `update-feed.ts` picks the newest release that has the metadata, stopping earlier only strands
   late installs on an older Electrobun build until its own updater catches up; never publishing
   them again would strand them on Electron.

### Where the Electrobun updater reads from

Decision: **each GitHub release's own download directory**, chosen per check. The Electrobun
UpdateEngine (`src/main/adapters/electrobun/electrobun-update-engine.ts`) is handed the release that
`src/main/update-feed.ts` already selects for the channel (newest eligible release that carries
the manifest the engine names, `UpdateEngine.metadataAssetName`, prereleases included for Beta and
Alpha) and, through `UpdateEngine.setFeed({ releaseUrl })`, points Electrobun's updater at
`https://github.com/OpenWaggle/OpenWaggle/releases/download/<tag>/`, where it reads
`stable-<os>-<arch>-update-v2.json`, the archive and the patch. The baked `release.baseUrl`
(`releases/latest/download`) is only a fallback.

| Option | Cost | Risk |
| --- | --- | --- |
| Per-release directory, chosen by update-feed.ts (taken) | None: no new host or job | The updater depends on GitHub's release list API (unauthenticated limit 60/h per IP, as today); GitHub's download redirect to its asset host stays HTTPS within Electrobun's five redirects |
| Rolling per-channel release (`channel-beta`) | One job re-uploading every asset per release | Mutable assets: an install can read a manifest while its archive is being replaced; GitHub caches release downloads |
| `releases/latest/download` only | None | Skips prereleases, so Beta and Alpha never update |
| Static host (R2, Pages) | A second publish target, credentials, retention | A second source of truth beside the release that `SHA256SUMS.txt` covers |

## Running a checkout

`bun run dev` builds main, preload and renderer (`bun run build`), stages them as a package does
(`scripts/electrobun/stage.ts`), and runs `electrobun dev` through Hutch
(`scripts/electrobun/dev.ts`): Hutch builds a `dev` app into `out/electrobun/build/dev-<os>-<arch>`
and starts it. The other way in, running the checkout's `out/main` from a dev build with
`OPENWAGGLE_ELECTROBUN_MAIN` (`scripts/electrobun/hutch-entry.ts`), was not taken: the staged build
already carries `out/main`, so a dev app runs the same bundle and layout a package ships, and the
variable stays a fallback for a build without one. There is no renderer hot reload; rerun the
command after an edit, or pass `--skip-build` to reuse the last build.

`bun run dev:debug` builds the same `dev` app and starts it the way automation does
(`scripts/support/electrobun-app-launch.ts`): hidden (`OPENWAGGLE_AUTOMATION=1`), on a scratch
profile, with the main window rendered by CEF (`OPENWAGGLE_QA_MAIN_WINDOW_RENDERER=cef`) and CEF's
DevTools endpoint on port 9223 (`ELECTROBUN_CEF_REMOTE_DEBUGGING_PORT`). A system webview has no
CDP endpoint, so hidden QA, website screenshots, the perf harnesses and live Session QA all see
the CEF renderer.

## Risks

- **Signing identity drift** is the one unrecoverable failure on macOS: a transition zip signed by a
  different Team ID, or with a different bundle identifier, is rejected by every installed app. The
  pre-zip requirement check guards it; keep it.
- **Hutch signing is not used.** OpenWaggle signs and notarizes the Electrobun app itself, and must
  keep doing so as Electrobun changes its bundle layout (2.0.6 wraps the app in a self-extracting
  bundle; the transition zips the unwrapped app, which the bench ran directly).
- **`bun` signed as `com.openwaggle.app`.** Two executables share the identifier. macOS allows it and
  notarization accepts it, but anything that keys on the identifier (TCC prompts are attributed to
  the bundle, so they are unaffected) sees both.
- **Squirrel.Mac internals.** The rename-by-executable and relaunch-through-ShipIt behaviors come from
  Electron 43's Squirrel.Mac. Installed Electron builds never change, so this cannot drift for them,
  but the bench must run against the oldest Electron build still in use before the release.
- **Linux has no rollback** once the AppImage is replaced (see Fallback).
- **Windows wrapper relies on Electrobun Setup's behavior** (install path, uninstall key
  `<identifier>.<channel>`, the completion dialog it closes, no arguments, since any argument
  switches Setup into its manager commands) and on the old uninstaller's flags (`/S /currentuser`, no
  `--delete-app-data`). Both are pinned in the bench.
- **`APPIMAGE_EXIT_AFTER_INSTALL` is ignored on Linux.** `AppRun` always starts the new app. The
  Windows wrapper honors `--force-run`. OpenWaggle always installs with relaunch
  (`quitAndInstall(true, true)`), so only a manual quit-to-install on Linux would start the app
  unasked.
- **The Electrobun build must keep the CLI entry points** existing installs use:
  `/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle <args>` (macOS shim), the AppImage path with
  `OPENWAGGLE_CLI_OUTPUT_FD=3` (Linux shim, now forwarded by `AppRun`), and `openwaggle.cmd` (Windows,
  rewritten by the wrapper, which drops Electron's `--` separator).
- **Secrets the old app could not read either** (a keyring that changed, a dev build's key) stay
  unrecoverable; they are reported by name, never dropped silently.

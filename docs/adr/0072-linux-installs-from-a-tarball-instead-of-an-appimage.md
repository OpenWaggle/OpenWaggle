---
status: proposed
---

# Linux installs from a tarball instead of an AppImage

The Linux artifact is a `.tar.gz` extracted into a versioned directory under `~/.local/lib/openwaggle/<version>` with a `current` symlink, and `install.sh` owns installing, updating and migrating it. The AppImage is a type-2 image whose runtime mounts its payload through the FUSE 2 kernel API, and Ubuntu 22.04 or later and Debian 12 or later no longer install `libfuse.so.2` by default, so a current Ubuntu cannot run the AppImage at all until the user installs a legacy library that the installation docs never mentioned. Linux therefore takes the bundled-installer update mode, which macOS uses today for `openwaggle update` alone: on Linux both that command and the in-app **Restart to update** run `install.sh` with the resolved release tag, which downloads, verifies, extracts the new version beside the old one, flips `current`, and relaunches. Update detection moves off electron-updater, whose Linux updater is AppImage-shaped and reports itself inactive without `APPIMAGE`, to a Linux `UpdateEngine` adapter that reads the GitHub release listing the app already fetches.

Nothing above is implemented yet: `electron-builder.ts` still targets the AppImage, `install.sh` still installs one, the platform-floor guard still looks for one, and the user docs still describe that install. This record therefore stays `proposed` until the change that implements it lands here, in this pull request.

## Considered Options

- **Keep the AppImage and document the FUSE 2 prerequisite.** Rejected: it keeps a legacy library as a user-side prerequisite, which is the friction being removed.
- **Keep the AppImage and launch it with `APPIMAGE_EXTRACT_AND_RUN`.** Rejected: the runtime then re-extracts the whole ~174 MB payload on every launch, trading an install-time prerequisite for a per-launch cost.
- **`.deb` with `.rpm`.** Rejected: one artifact per package family, `rpmbuild` on the release runner, and in-app updates move behind an elevated package-manager prompt instead of the silent swap the AppImage gave.
- **Flatpak.** Rejected: a coding agent needs broad filesystem access, PTY and device access, and the ability to spawn host tools, so the manifest needs `--filesystem=host`-style holes that mostly negate the sandbox while adding a runtime and a separate update path.
- **Snap.** Rejected: it needs classic confinement to spawn host tools, which removes the confinement benefit.
- **`tar.xz`.** Rejected: roughly 30% smaller download, but single-threaded, CPU-heavy unpacking on every install and every update, and extraction is the cost paid most often.
- **A native TypeScript installer behind the `UpdateEngine` port, keeping electron-updater for detection and background download.** Rejected: it reimplements the layout and atomic-swap rules that `install.sh` already implements and tests, and the two copies would drift.
- **A transition release publishing both artifacts.** Rejected: it keeps the FUSE dependency and a second install path alive for a release cycle, for a beta install base that is small.

## Consequences

- Every Linux update is a full download. electron-updater applied a blockmap, so an update downloaded only changed blocks (8.0 MB measured for a one-line change); a tarball install has no updater to apply a diff.
- An existing AppImage install cannot be migrated by its own code, because it runs the old updater and looks for an AppImage-extension asset. It stops seeing updates until the user re-runs the install command once, and `install.sh` then replaces that layout in place.
- Linux gains V8's compile cache, which `main-compile-cache-location.ts` disables for the AppImage precisely because its mount path changed on every launch.
- The release pipeline stops publishing `*-linux.yml`, because nothing reads it on Linux any more and electron-builder does not generate update metadata for archive targets.
- The native platform-floor guard must read the tarball, or the `linux-unpacked` directory it is built from, instead of an AppImage file.

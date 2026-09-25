---
title: "Installation"
description: "How to install OpenWaggle on macOS, Windows, or Linux."
order: 2
section: "Getting started"
---

Download an installer from [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases). Choose the version and platform you intend to use; prereleases are marked on GitHub. You do not need Node.js or a source checkout to run the installed app.

## Supported platforms

- macOS on Intel or Apple silicon
- Windows on x64
- Linux on x64

## Pre-built installers

| Platform | Format | Install |
|----------|--------|---------|
| macOS | `.dmg` | Choose Apple silicon or Intel, open the disk image, and copy OpenWaggle to Applications. |
| Windows | `.exe` | Run the installer and follow its prompts. |
| Linux | `.AppImage` | Make the downloaded file executable, then open it. |

After opening the app, follow [Get started](/docs/getting-started/first-run) to connect a model and open a project.

### macOS Gatekeeper note

The release workflow produces unsigned builds. macOS may block the first launch. Only allow the app after checking that you downloaded it from the official release page. Depending on your macOS version, use right-click **Open** or the blocked-app controls in **System Settings > Privacy & Security**.

## Quick install (macOS / Linux)

If you prefer a terminal, this command downloads and runs the repository's install script. Read [the script](https://github.com/OpenWaggle/OpenWaggle/blob/main/scripts/install.sh) first if you want to inspect what it changes.

```bash
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh | bash
```

The script installs the app and verifies its SHA-256 checksum when the release includes a
`SHA256SUMS` asset with an entry for the downloaded file. A mismatch stops installation; a missing
checksum asset or entry does not. It selects the **Stable** channel by default, or falls back to
Alpha when no Stable release is available in the release list.

- On macOS, it copies `OpenWaggle.app` to `/Applications` and removes its quarantine attribute.
- On Linux, it installs the AppImage under `~/.local/lib/openwaggle`, installs the `openwaggle`
  command in `~/.local/bin`, and creates a `.desktop` entry.

To opt into a prerelease channel, use the same installer:

```bash
# Alpha also receives Beta and Stable releases.
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh \
  | OPENWAGGLE_CHANNEL=alpha bash

# Beta also receives Stable releases.
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh \
  | OPENWAGGLE_CHANNEL=beta bash
```

The installer saves the selected policy channel, not merely the channel label on the artifact it
downloads. For example, an Alpha install remains on Alpha even when the newest eligible artifact
happens to be a Beta or Stable build.

For a one-time exact-version install, set `OPENWAGGLE_RELEASE_TAG` instead. This does not change
your saved channel. Replace the example tag below with an existing release tag:

```bash
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh \
  | OPENWAGGLE_RELEASE_TAG=v0.4.0 bash
```

## Command-line access

After installing the app, launching it installs or refreshes the managed `openwaggle` command on
macOS or Linux; make sure `~/.local/bin` is on your shell's `PATH`. An unrelated command at that
path is never replaced. Windows installers register the command automatically. The CLI lets
terminals and external coding agents discover and control the same live Sessions shown in the app;
see [Sessions CLI](/docs/developer-workflow/sessions-cli).

## Choose an update channel

The app and CLI share one saved update channel. Change it from **Settings → General → About &
Updates**, or from a terminal. Check availability first, then choose one channel or an exact version:

```bash
openwaggle update --check
openwaggle update --channel alpha
openwaggle update --channel beta
openwaggle update --channel stable
# Exact-version example; choose a version published on GitHub Releases.
openwaggle update --version 0.4.0
```

`--check` reports availability without downloading. Without `--check`, `openwaggle update`
downloads and installs the newest eligible release. Choosing `--channel` is persistent; choosing
`--version` is a one-time install and can target an exact Stable or prerelease version. RC builds
are available only through `--version` or `OPENWAGGLE_RELEASE_TAG`; they are not an automatic
update channel. On a first launch with no saved preference, an Alpha or Beta build starts on its
matching channel; Stable remains the default otherwise. The app confirms each switch into Alpha
and checks a newly selected channel immediately. OpenWaggle never downgrades automatically when
channels change, and **Restart to update** re-reads the shared channel before installing an
already-downloaded release.

## System requirements

- A modern operating system, such as macOS, Windows 10+, or a recent Linux distribution.
- Access to an AI provider through an API key, sign-in, or another supported configuration. See [Providers and models](/docs/providers/overview).
- An internet connection when using hosted models.

## Building from source

To run a development checkout rather than an installer, see [Building from source](/docs/developer-guide/building-from-source).

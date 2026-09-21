---
title: "Installation"
description: "How to install OpenWaggle on macOS, Windows, or Linux."
order: 1
section: "Getting Started"
---

## Supported Platforms

- **macOS** (x64 + Apple Silicon)
- **Windows** (x64)
- **Linux** (x64)

## Quick Install (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh | bash
```

The script follows the **Stable** channel, verifies the SHA-256 checksum, and installs the app. If
OpenWaggle has not published its first Stable release yet, the same command temporarily follows
Alpha so a documented install never resolves to an older release.

- **macOS** — copies `OpenWaggle.app` to `/Applications`
- **Linux** — installs the AppImage under `~/.local/lib/openwaggle`, installs the `openwaggle`
  command in `~/.local/bin`, and creates a `.desktop` entry

To opt into a prerelease channel, use the same installer:

```bash
# Alpha also receives Beta and Stable releases.
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh \
  | OPENWAGGLE_CHANNEL=alpha bash

# Beta also receives Stable releases.
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh \
  | OPENWAGGLE_CHANNEL=beta bash
```

For a one-time exact-version install, set `OPENWAGGLE_RELEASE_TAG` instead. This does not change
your saved channel:

```bash
curl -fsSL https://raw.githubusercontent.com/OpenWaggle/OpenWaggle/main/scripts/install.sh \
  | OPENWAGGLE_RELEASE_TAG=v0.4.0 bash
```

## Pre-Built Installers

Download the latest release directly from GitHub:

| Platform | Format | Link |
|----------|--------|------|
| macOS (Apple Silicon) | `.dmg` | [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases) |
| macOS (Intel) | `.dmg` | [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases) |
| Windows | `.exe` | [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases) |
| Linux | `.AppImage` | [GitHub Releases](https://github.com/OpenWaggle/OpenWaggle/releases) |

### macOS Gatekeeper Note

OpenWaggle is currently unsigned. On first launch, right-click the app and select **Open** to bypass Gatekeeper. If you used the install script, this step is not needed.

## Building from Source

See [Building from Source](/docs/developer-guide/building-from-source) for instructions.

## Command-line access

After installing the app, launching it installs or refreshes the managed `openwaggle` command on
macOS or Linux; make sure `~/.local/bin` is on your shell's `PATH`. An unrelated command at that
path is never replaced. Windows installers register the command automatically. The CLI lets
terminals and external coding agents discover and control the same live Sessions shown in the app;
see [Sessions CLI](/docs/developer-workflow/sessions-cli).

The app and CLI share one saved update channel. Change it from **Settings → General → About &
Updates**, or from a terminal:

```bash
openwaggle update --check
openwaggle update --channel alpha
openwaggle update --channel beta
openwaggle update --channel stable
openwaggle update --version 0.4.0
```

`--check` reports availability without downloading. Without `--check`, `openwaggle update`
downloads and installs the newest eligible release. Choosing `--channel` is persistent; choosing
`--version` is a one-time install. On a first launch with no saved preference, an Alpha or Beta
build starts on its matching channel; Stable remains the default otherwise. The app confirms each
switch into Alpha and checks a newly selected channel immediately. OpenWaggle never downgrades
automatically when channels change.

## System Requirements

- A modern operating system (macOS, Windows 10+, or a recent Linux distribution)
- A Pi-supported provider authenticated through API key, OAuth, environment, or project/custom provider configuration (see [Providers](/docs/providers/overview))
- Internet connection for hosted AI provider communication

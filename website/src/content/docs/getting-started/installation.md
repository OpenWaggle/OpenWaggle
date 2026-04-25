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

The script downloads the latest release, verifies the SHA-256 checksum, and installs the app:

- **macOS** — copies `OpenWaggle.app` to `/Applications`
- **Linux** — installs the AppImage to `~/.local/bin` and creates a `.desktop` entry

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

## System Requirements

- A modern operating system (macOS, Windows 10+, or a recent Linux distribution)
- A Pi-supported provider authenticated through API key, OAuth, environment, or project/custom provider configuration (see [Providers](/docs/providers/overview))
- Internet connection for hosted AI provider communication

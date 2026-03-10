---
title: "Installation"
description: "System requirements and how to install OpenWaggle on macOS, Windows, or Linux."
order: 1
section: "Getting Started"
---

## Prerequisites

- **Node.js** 24.x — [nodejs.org](https://nodejs.org/)
- **pnpm** 9 or later — [pnpm.io](https://pnpm.io/)
- **macOS**, **Windows**, or **Linux**

## Installation

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd openwaggle
pnpm install
```

## Running the App

Start OpenWaggle in development mode:

```bash
pnpm dev
```

This launches the Electron app with hot-reload for the renderer (UI). Changes to the main process (backend) require a full app restart.

To create a production build:

```bash
pnpm build
```

Platform-specific installers:

```bash
pnpm build:mac    # macOS .dmg (x64 + arm64)
pnpm build:win    # Windows NSIS installer (x64)
pnpm build:linux  # Linux AppImage (x64)
```

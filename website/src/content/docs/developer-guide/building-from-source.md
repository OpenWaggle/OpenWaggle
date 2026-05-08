---
title: "Building from Source"
description: "How to clone, build, and run OpenWaggle from source."
order: 3
section: "Developer Guide"
---

## Prerequisites

- **Node.js** 24.x — [nodejs.org](https://nodejs.org/)
- **pnpm** 10+ — [pnpm.io](https://pnpm.io/)

## Clone and Install

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd OpenWaggle
pnpm install
```

## Development Mode

```bash
pnpm dev
```

This launches the Electron app with hot-reload for the UI. Changes to the backend require restarting the app.

## Production Build

```bash
pnpm build
```

## Platform Installers

```bash
pnpm build:mac      # macOS .dmg for this Mac's native architecture
pnpm build:mac:all  # macOS .dmgs for arm64 + x64
pnpm build:win      # Windows NSIS installer (x64)
pnpm build:linux    # Linux AppImage (x64)
```

On Apple silicon, test the arm64 DMG or `dist/mac-arm64/OpenWaggle.app`. The x64 app under
`dist/mac/` runs through Rosetta and is useful only for Intel compatibility checks.

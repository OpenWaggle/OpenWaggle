---
title: "Building from source"
description: "How to clone, build, and run OpenWaggle from source."
order: 1
section: "Developer docs"
---

Use a source checkout to investigate a bug or work on a local build. If you only want to use the app, follow [Installation](/docs/getting-started/installation). Code pull requests are not currently accepted; see [Contributing](/docs/developer-guide/contributing) before preparing a proposal.

## Prerequisites

- Git.
- [Node.js](https://nodejs.org/) 24.x, as required by the root `package.json`.
- [pnpm](https://pnpm.io/) at the version declared in the root `package.json` `packageManager` field.

Use pnpm for this repository. Native dependencies need builds for the runtime that will load them; the development and build scripts prepare the Electron versions automatically.

## Clone and install

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd OpenWaggle
pnpm install
```

## Development mode

```bash
pnpm dev
```

This opens the Electron app with UI hot reload. Restart the app after backend changes when needed. Connect a provider and open a project as described in [Get started](/docs/getting-started/first-run).

For automated, non-disruptive Electron QA, the repository has `pnpm dev:debug`. It uses a hidden window, a temporary profile, and CDP port 9223. Follow `.agents/skills/electron-qa/SKILL.md`; agents must not use the headed debug command without approval for that exact run.

## Production build

```bash
pnpm build
```

This builds the application bundle. It does not create an installer; use a platform command below for that.

## Platform installers

```bash
pnpm build:mac      # macOS .dmg for this Mac's native architecture
pnpm build:mac:all  # macOS .dmgs for arm64 + x64
pnpm build:win      # Windows NSIS installer (x64)
pnpm build:linux    # Linux AppImage (x64)
```

On Apple silicon, test the arm64 DMG or `dist/mac-arm64/OpenWaggle.app`. The x64 app under
`dist/mac/` runs through Rosetta and is useful only for Intel compatibility checks.

## Check local changes

Start with the checks relevant to your change:

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
```

The full validation matrix is in `.agents/verification.md`. Use `pnpm test:integration` and `pnpm test:component` when the affected behavior crosses services or UI components. The test scripts prepare Node-compatible native dependencies; `pnpm dev` prepares them for Electron again.

For the code layout and runtime boundaries, see [Architecture](/docs/developer-guide/architecture).

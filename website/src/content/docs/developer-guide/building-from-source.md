---
title: "Building from source"
description: "How to clone, build, and run OpenWaggle from source."
order: 1
section: "Developer docs"
kind: "guide"
---

Build OpenWaggle from source when you want to investigate a bug or try a local change. If you only want to use the app, follow [Installation](/docs/getting-started/installation) instead. OpenWaggle does not accept code pull requests yet, so read [Contributing](/docs/developer-guide/contributing) before you prepare a proposal.

## Install the tools

You need:

- Git.
- [Node.js](https://nodejs.org/) 24. The root `package.json` accepts `>=24 <25`.
- [Bun](https://bun.sh/), at the version in the `packageManager` field of the root `package.json` (also in `.bun-version`).

Use Bun for every command in this repository. Bun installs the dependencies, runs the scripts and runs the tests (`bun --bun vitest`). Node.js runs the Electron build tools and the native module builds. Some dependencies are native modules that must be built for the runtime that loads them. The development and build scripts prepare the Electron builds for you.

## Clone and install

Run these together to get the source and its dependencies:

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd OpenWaggle
bun install
```

## Run the app in development mode

```bash
bun run dev
```

This opens the Electron app with hot reload for the UI. Changes to the main process or the Session Host may need a restart. Connect a provider and open a project as described in [Get started](/docs/getting-started/first-run).

A development build is a Dev build with its own app data folder, named after your Git branch. [Environment variables](/docs/reference/environment-variables#building-from-source) lists the variables that change this.

### Run the app hidden for automated QA

```bash
bun run dev:debug
```

`bun run dev:debug` runs the app in a hidden window for automated Electron QA. The window never appears or takes focus. It uses a temporary profile with its own home folder and Pi agent folder, a mock keychain, and the Chrome DevTools Protocol on port 9223. It starts none of the MCP servers in the project's MCP files, and it stops the app's Session Host when it stops. Follow `.agents/skills/electron-qa/SKILL.md` when you use it. Agents must not run the visible debug command, `bun run dev:debug:headed`, unless the maintainer approves that exact run.

## Build the app

```bash
bun run build
```

This builds the application bundle. It does not create an installer.

## Build an installer

Each platform has its own command. Run the one you need.

A macOS `.dmg` for the architecture of the Mac you build on:

```bash
bun run build:mac
```

macOS `.dmg` files for both arm64 and x64:

```bash
bun run build:mac:all
```

A Windows NSIS installer for x64:

```bash
bun run build:win
```

A Linux AppImage for x64:

```bash
bun run build:linux
```

On Apple silicon, test the arm64 DMG or `dist/mac-arm64/OpenWaggle.app`. The x64 app in `dist/mac/` runs through Rosetta, so it is only useful for checking Intel compatibility.

## Check your changes

Start with the checks that matter for most changes:

```bash
bun run typecheck
bun run lint
bun run test:unit
```

Add `bun run test:integration` when the change crosses services, and `bun run test:component` when it changes UI components. `.agents/verification.md` has the full list of checks and when to run each one.

The test scripts build the native dependencies for Node.js. `bun run dev` builds them for Electron again, so you can switch between the two without doing anything by hand.

For where code lives and which parts may import what, see [Architecture](/docs/developer-guide/architecture).

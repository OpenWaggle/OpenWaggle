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

OpenWaggle builds the native modules `better-sqlite3` and `node-pty` from source, so you also need a C++ toolchain and Python 3. On macOS, the Xcode Command Line Tools provide both. On Linux, install your distribution's compiler packages, such as `build-essential` and `python3` on Debian and Ubuntu.

### Windows

On Windows, install Build Tools for Visual Studio 2022 from the [Visual Studio older downloads page](https://visualstudio.microsoft.com/vs/older-downloads/), or download [the 2022 installer](https://aka.ms/vs/17/release/vs_BuildTools.exe) directly. The main downloads page offers Visual Studio 2026, which OpenWaggle hasn't been tested with. In the installer, select:

- The **Desktop development with C++** workload. Both native modules need it.
- On the **Individual components** tab, **MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)**. Its component ID is `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`. Without it, building `node-pty` fails with error `MSB8040`.

You also need Python 3. If neither `python --version` nor `py --version` prints a Python 3 version in a new terminal, install it from [python.org](https://www.python.org/downloads/windows/). The build finds Python through either command.

If you install pnpm with `npm install -g pnpm`, check that `pnpm --version` works in a new terminal. If Windows can't find `pnpm`, run `npm prefix -g` and add the folder it prints to your user `Path` environment variable, then open a new terminal.

## Clone and install

Run these together to get the source and its dependencies:

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd OpenWaggle
bun install
```

The first install downloads several large packages, and pnpm allows 10 minutes for each. If `pnpm install` still fails with a timeout on a slow connection, run it with fewer downloads at once and a longer timeout:

```bash
pnpm install --network-concurrency 3 --fetch-timeout 1200000
```

## Run the app in development mode

```bash
bun run dev
```

This opens the Electron app with hot reload for the UI, on macOS, Windows and Linux. Changes to the main process or the Session Host may need a restart. Connect a provider and open a project as described in [Get started](/docs/getting-started/first-run).

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

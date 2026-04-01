---
name: Electron Native Rebuild
description: Diagnose and repair Electron native-module ABI mismatches in OpenWaggle, especially when `better-sqlite3`, `node-pty`, or other native addons work in Node tests but fail in the Electron app or Playwright E2E runs.
---

# Electron Native Rebuild

## Overview

Diagnose native-addon failures in the OpenWaggle desktop app by separating the Node runtime path from the Electron runtime path. Prefer the repo scripts that already encode the correct rebuild behavior instead of hand-assembling one-off rebuild commands unless debugging requires it.

## When To Use

Activate this skill when any of the following show up:

- Electron boots fail before the first window appears.
- Playwright E2E runs cannot open the app after a successful `pnpm build`.
- A native addon error mentions ABI, `NODE_MODULE_VERSION`, missing symbols, or invalid architecture.
- `better-sqlite3`, `node-pty`, or `sharp` work in Vitest but fail in Electron.
- A recent Electron upgrade changed the embedded Node ABI.

## Workflow

1. Confirm whether the failure happens in Node-only commands, Electron app startup, or both.
2. Use the repo helpers first:
   - `pnpm prepare:native:node`
   - `pnpm prepare:native:electron`
3. If the Electron path still fails, inspect the installed Electron version from `node_modules/electron/package.json` instead of assuming it matches the system Node version.
4. Rebuild the failing native dependency against Electron headers, not plain Node headers.
5. Re-run the narrowest verification path that reproduces the problem:
   - `pnpm test`
   - `pnpm build`
   - `pnpm test:e2e:headless:quick`

## OpenWaggle Rules

- Prefer the repository script [`scripts/rebuild-native-deps.ts`](/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/scripts/rebuild-native-deps.ts) over ad hoc shell snippets.
- Keep separate rebuild paths for Node and Electron. Vitest and Electron do not share the same native ABI target.
- Do not remove `electron-builder install-app-deps`, but do not rely on it alone when Electron startup still loads a Node-ABI binary.
- When debugging E2E startup, also inspect [`e2e/support/openwaggle-app.ts`](/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/e2e/support/openwaggle-app.ts). Environment leakage from the Playwright runner can look like a native crash.

## Reference

Load [`references/rebuild-matrix.md`](/Users/diego.garciabrisa/Desktop/Projects/personal/OpenWaggle/.openwaggle/skills/electron-native-rebuild/references/rebuild-matrix.md) for the exact failure signatures, command paths, and validation checklist.

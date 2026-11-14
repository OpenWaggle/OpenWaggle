# Dependencies

Every dependency and catalog entry in the root, `packages/*`, `tools/*` and `website` manifests is an exact version (docs/dependency-updates.md). This file has one line for each pin that is not npm's `latest` release, and for each pin that something holds where it is: a patch, an override, a check, or a known break in a newer release. `docs/dependency-updates.md` says when and how to move them.

Each line reads ``- `name@version`. Held: why it stays. Unblocked by: what lets it move.`` One line covers every manifest that pins the package at that version.

- Add the line in the commit that pins a version behind `latest`, or that patches, overrides or checks a pinned package. `bun run check:dependency-pins` fails a new or changed pin behind `latest` that has no line.
- When a pin moves, change its version in the same commit, and delete the line once the pin is `latest` and nothing else holds it. The check fails a line whose version no manifest pins, and a line for a package no manifest pins.

## Held by a check, a patch, an override or a migration

- `@earendil-works/pi-agent-core@1.4.0`. Held: the matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Unblocked by: the next Pi release (docs/pi-runtime-upgrades.md).
- `@earendil-works/pi-ai@1.4.0`. Held: the matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Unblocked by: the next Pi release (docs/pi-runtime-upgrades.md), re-porting `patches/@earendil-works__pi-ai@1.4.0.patch` first.
- `@earendil-works/pi-codemode@1.4.0`. Held: the matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Unblocked by: the next Pi release (docs/pi-runtime-upgrades.md).
- `@earendil-works/pi-coding-agent@1.4.0`. Held: the matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Unblocked by: the next Pi release (docs/pi-runtime-upgrades.md), re-porting `patches/@earendil-works__pi-coding-agent@1.4.0.patch` first.
- `@earendil-works/pi-mcp@1.4.0`. Held: the matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Unblocked by: the next Pi release (docs/pi-runtime-upgrades.md).
- `@earendil-works/pi-telemetry@1.4.0`. Held: the matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Unblocked by: the next Pi release (docs/pi-runtime-upgrades.md).
- `@earendil-works/pi-tui@1.4.0`. Held: the matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Unblocked by: the next Pi release (docs/pi-runtime-upgrades.md).
- `@effect/platform-node@0.108.2`. Held: `latest` is Effect 4, a major migration; this is the Effect 3 line. Unblocked by: the Effect 4 migration, moving every `@effect/*` package with `effect`.
- `@effect/sql-sqlite-node@0.53.0`. Held: `latest` is Effect 4, a major migration; this is the Effect 3 line. Its `better-sqlite3` is overridden to the root pin. Unblocked by: the Effect 4 migration, moving every `@effect/*` package with `effect`.
- `@huggingface/transformers@4.3.0`. Held: nothing; the root override pins its `onnxruntime-node` to `1.23.2`. Unblocked by: the next monthly batch (docs/dependency-updates.md), checking the `onnxruntime-node` override.
- `@img/sharp-darwin-arm64@0.35.4`. Held: the prebuilt binary for `sharp` `0.35.4`. Unblocked by: moving `sharp`.
- `@img/sharp-darwin-x64@0.35.4`. Held: the prebuilt binary for `sharp` `0.35.4`. Unblocked by: moving `sharp`.
- `@img/sharp-libvips-darwin-arm64@1.3.3`. Held: the libvips build for `sharp` `0.35.4`. Unblocked by: moving `sharp`.
- `@img/sharp-libvips-darwin-x64@1.3.3`. Held: the libvips build for `sharp` `0.35.4`. Unblocked by: moving `sharp`.
- `@img/sharp-libvips-linux-x64@1.3.3`. Held: the libvips build for `sharp` `0.35.4`. Unblocked by: moving `sharp`.
- `@img/sharp-linux-x64@0.35.4`. Held: the prebuilt binary for `sharp` `0.35.4`. Unblocked by: moving `sharp`.
- `@img/sharp-win32-x64@0.35.4`. Held: the prebuilt binary for `sharp` `0.35.4`. Unblocked by: moving `sharp`.
- `@modelcontextprotocol/conformance@0.2.0-alpha.11`. Held: a prerelease newer than the `latest` tag (`0.1.16`); moving to `latest` would be a downgrade. Unblocked by: a stable release newer than this prerelease.
- `@oven/bun-darwin-aarch64@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@oven/bun-darwin-x64@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@oven/bun-linux-aarch64@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@oven/bun-linux-aarch64-musl@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@oven/bun-linux-x64@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@oven/bun-linux-x64-musl@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@oven/bun-windows-aarch64@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@oven/bun-windows-x64@1.4.4-canary.20261103.1`. Held: `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Unblocked by: a newer canary at least 7 days old, moving every `tools/bun-lint` pin together.
- `@silvia-odwyer/photon-node@0.3.4`. Held: the version Pi depends on; Pi reads its wasm from the installed package, and `check:pi-runtime` fails on drift. Unblocked by: the Pi release that moves it (docs/pi-runtime-upgrades.md).
- `@tanstack/react-hotkeys@0.10.0`. Held: the root `overrides` pin the same version. Unblocked by: the next monthly batch, changing the override with it.
- `@tanstack/react-query@5.102.8`. Held: the root `overrides` pin it and `@tanstack/query-core` to this version. From 5.102 `queryClient.query()` applies `select` (.agents/memory/tooling.md). Unblocked by: the next monthly batch, moving all three together.
- `@tanstack/react-router@1.170.36`. Held: the root `overrides` pin `router-core`, `history`, `router-generator` and `router-utils` to match; an older `router-core` fails at runtime (.agents/memory/tooling.md). Unblocked by: the next monthly batch, moving them in lockstep.
- `@tanstack/router-plugin@1.168.38`. Held: the root `overrides` pin the same version. Unblocked by: moving `@tanstack/react-router`.
- `@types/node@24.13.3`. Held: types for Node 24, the `engines` range; `latest` is Node 26. Unblocked by: moving the `engines` range to a newer Node.
- `@xterm/xterm@6.1.0-beta.303`. Held: xterm 6.0 stable lacks Kitty keyboard-protocol negotiation (ADR 0030). Unblocked by: a stable release with the protocol, after the protocol tests and Electron performance and IME QA pass.
- `babel-plugin-react-compiler@1.0.0`. Held: patched for Babel 8 `AssignmentPattern` bailouts (`patches/babel-plugin-react-compiler@1.0.0.patch`); `react-compiler-coverage.unit.test.ts` catches a regression. Unblocked by: re-porting the patch.
- `better-sqlite3@13.0.3`. Held: a native module; the `@effect/sql-sqlite-node>better-sqlite3` override keeps one SQLite build in the Host process (docs/system-architecture.md#one-sqlite-library). Unblocked by: the next monthly batch, changing the override with it.
- `effect@3.22.2`. Held: `latest` is Effect 4, a major migration; this is the Effect 3 line. Unblocked by: the Effect 4 migration, moving every `@effect/*` package with it.
- `electron@43.2.0`. Held: it sets the ABI of the native modules: an update needs `prepare:native:node`, `prepare:native:electron` and a packaged smoke (docs/dependency-updates.md). Unblocked by: the next monthly batch, with those three runs.
- `electron-builder@26.17.0`. Held: `dmg-builder` `26.17.0` is patched (`patches/dmg-builder@26.17.0.patch`). Unblocked by: re-creating the patch.
- `node-pty@1.1.0`. Held: a native module, patched (`patches/node-pty@1.1.0.patch`). Unblocked by: re-porting the patch.
- `oxc-parser@0.148.0`. Held: the version `react-doctor` `0.9.22` already installs, so the lint rule tests add no package. Unblocked by: moving `react-doctor`.
- `quickjs-wasi@3.6.2`. Held: the version Pi depends on; Pi reads its wasm from the installed package, and `check:pi-runtime` fails on drift. Unblocked by: the Pi release that moves it (docs/pi-runtime-upgrades.md).
- `react-doctor@0.9.22`. Held: `0.9.23` came out on 2026-11-13, and the seven-day `minimumReleaseAge` in `bunfig.toml` refuses it until 2026-11-20. Unblocked by: that date, moving `oxc-parser` to the version the new release installs.
- `sharp@0.35.4`. Held: a native module; the root `overrides` pin the same version. Unblocked by: the next monthly batch, with the `@img/sharp-*` binaries.
- `shiki@4.4.3`. Held: the root `overrides` pin `@pierre/diffs>shiki` and `@pierre/theming>shiki` to this version. Unblocked by: the next monthly batch, moving all three together.
- `typebox@1.3.27`. Held: the `typebox` `pi-coding-agent` depends on, the copy Pi gives extensions; `check:pi-runtime` checks it. Unblocked by: the Pi release that moves it (docs/pi-runtime-upgrades.md).
- `vite@8.3.0`. Held: the root override pins `electron-vite>vite` to this version. Unblocked by: the next monthly batch, changing the override with it.

## Waiting for the monthly batch

- `@astrojs/markdown-remark@7.3.1`. Held: nothing. Unblocked by: the next monthly batch.
- `@astrojs/mdx@8.0.1`. Held: nothing. Unblocked by: the next monthly batch.
- `@babel/core@8.0.5`. Held: nothing. Unblocked by: the next monthly batch.
- `@headless-tree/core@1.7.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@headless-tree/react@1.7.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@lexical/react@0.50.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@lobehub/icons-static-svg@1.95.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@modelcontextprotocol/client@2.0.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@modelcontextprotocol/ext-apps@2.0.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@modelcontextprotocol/node@2.0.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@modelcontextprotocol/sdk@1.30.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@modelcontextprotocol/server@2.0.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@napi-rs/keyring@2.1.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@oxlint/plugins@1.91.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@pierre/diffs@1.4.2`. Held: nothing. Unblocked by: the next monthly batch.
- `@playwright/test@1.63.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@rolldown/plugin-babel@0.2.4`. Held: nothing. Unblocked by: the next monthly batch.
- `@sentry/core@10.75.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@sentry/electron@7.20.0`. Held: nothing. Unblocked by: the next monthly batch.
- `@tailwindcss/vite@4.3.3`. Held: nothing. Unblocked by: the next monthly batch.
- `@tanstack/eslint-plugin-query@5.102.8`. Held: nothing. Unblocked by: the next monthly batch.
- `@tanstack/react-router-ssr-query@1.167.2`. Held: nothing. Unblocked by: the next monthly batch.
- `@testing-library/user-event@14.6.8`. Held: nothing. Unblocked by: the next monthly batch.
- `@types/ws@8.18.1`. Held: nothing. Unblocked by: the next monthly batch.
- `@vitejs/plugin-react@6.1.1`. Held: nothing. Unblocked by: the next monthly batch.
- `@vitest/coverage-v8@4.1.11`. Held: nothing. Unblocked by: the next monthly batch.
- `astro@7.3.2`. Held: nothing. Unblocked by: the next monthly batch.
- `chokidar@5.0.0`. Held: nothing. Unblocked by: the next monthly batch.
- `editorconfig@3.0.2`. Held: nothing. Unblocked by: the next monthly batch.
- `electron-updater@6.8.10`. Held: nothing. Unblocked by: the next monthly batch.
- `electron-vite@5.0.0`. Held: nothing. Unblocked by: the next monthly batch.
- `fallow@3.33.1`. Held: nothing. Unblocked by: the next monthly batch.
- `hast-util-to-jsx-runtime@2.3.6`. Held: nothing. Unblocked by: the next monthly batch.
- `ignore@7.0.9`. Held: nothing. Unblocked by: the next monthly batch.
- `jsdom@29.1.1`. Held: nothing. Unblocked by: the next monthly batch.
- `lexical@0.50.0`. Held: nothing. Unblocked by: the next monthly batch.
- `lucide@1.46.0`. Held: nothing. Unblocked by: the next monthly batch.
- `lucide-react@1.46.0`. Held: nothing. Unblocked by: the next monthly batch.
- `mammoth@1.12.3`. Held: nothing. Unblocked by: the next monthly batch.
- `node-gyp@12.4.0`. Held: nothing. Unblocked by: the next monthly batch.
- `oxfmt@0.76.0`. Held: nothing. Unblocked by: the next monthly batch.
- `oxlint@1.91.0`. Held: nothing. Unblocked by: the next monthly batch.
- `oxlint-tsgolint@7.0.2005`. Held: nothing. Unblocked by: the next monthly batch.
- `playwright-core@1.63.0`. Held: nothing. Unblocked by: the next monthly batch.
- `plist@5.0.0`. Held: nothing. Unblocked by: the next monthly batch.
- `react@19.3.0`. Held: nothing. Unblocked by: the next monthly batch.
- `react-dom@19.3.0`. Held: nothing. Unblocked by: the next monthly batch.
- `release-please@17.6.1`. Held: nothing. Unblocked by: the next monthly batch.
- `smol-toml@1.8.0`. Held: nothing. Unblocked by: the next monthly batch.
- `tailwindcss@4.3.3`. Held: nothing. Unblocked by: the next monthly batch.
- `tsx@4.23.13`. Held: nothing. Unblocked by: the next monthly batch.
- `undici@8.10.2`. Held: nothing. Unblocked by: the next monthly batch.
- `unpdf@1.8.1`. Held: nothing. Unblocked by: the next monthly batch.
- `vitest@4.1.11`. Held: nothing. Unblocked by: the next monthly batch.
- `ws@8.21.3`. Held: nothing. Unblocked by: the next monthly batch.
- `zustand@5.0.15`. Held: nothing. Unblocked by: the next monthly batch.

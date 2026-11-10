# Dependencies

Every dependency and catalog entry in the root, `packages/*`, `tools/*` and `website` manifests is an exact version [DEP-01]. This table has one row for each pin that is not npm's `latest` release, and for each pin that has a reason to stay where it is: a patch, an override, a check that holds it, or a known break in a newer release [DEP-03]. `docs/dependency-updates.md` says when and how to move them.

- Add a row in the commit that pins a version behind `latest`, or that patches, overrides or checks a pinned package. `bun run check:dependency-pins` fails a new or changed pin behind `latest` that has no row.
- When a pin moves, change its Pin cell in the same commit. Delete the row once the pin is `latest` and nothing else holds it. The check fails a row whose Pin no manifest uses, and a row for a package no manifest pins.
- `Behind latest; next monthly batch` means nothing holds the package back.
- `Last known good` is the newest version known to work. It is the Pin unless a different version was tried.

One row covers every manifest that pins the package at that version.

| Package | Pin | Reason | Last known good |
| --- | --- | --- | --- |
| `@astrojs/markdown-remark` | `7.3.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `7.3.1` |
| `@astrojs/mdx` | `8.0.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `8.0.1` |
| `@babel/core` | `8.0.5` | Behind latest; next monthly batch (docs/dependency-updates.md) | `8.0.5` |
| `@earendil-works/pi-agent-core` | `1.4.0` | Matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Move with the next Pi release (docs/pi-runtime-upgrades.md) | `1.4.0` |
| `@earendil-works/pi-ai` | `1.4.0` | Matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Move with the next Pi release (docs/pi-runtime-upgrades.md); re-port `patches/@earendil-works__pi-ai@1.4.0.patch` first | `1.4.0` |
| `@earendil-works/pi-codemode` | `1.4.0` | Matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Move with the next Pi release (docs/pi-runtime-upgrades.md) | `1.4.0` |
| `@earendil-works/pi-coding-agent` | `1.4.0` | Matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Move with the next Pi release (docs/pi-runtime-upgrades.md); re-port `patches/@earendil-works__pi-coding-agent@1.4.0.patch` first | `1.4.0` |
| `@earendil-works/pi-mcp` | `1.4.0` | Matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Move with the next Pi release (docs/pi-runtime-upgrades.md) | `1.4.0` |
| `@earendil-works/pi-telemetry` | `1.4.0` | Matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Move with the next Pi release (docs/pi-runtime-upgrades.md) | `1.4.0` |
| `@earendil-works/pi-tui` | `1.4.0` | Matched Pi release in the `pi-runtime` catalog, checked by `check:pi-runtime`. Move with the next Pi release (docs/pi-runtime-upgrades.md) | `1.4.0` |
| `@effect/platform-node` | `0.108.2` | `latest` is Effect 4, a major migration; this is the Effect 3 line. Move all `@effect/*` with `effect` | `0.108.2` |
| `@effect/sql-sqlite-node` | `0.53.0` | `latest` is Effect 4, a major migration; this is the Effect 3 line. Move all `@effect/*` with `effect`. Its `better-sqlite3` is overridden to the root pin | `0.53.0` |
| `@headless-tree/core` | `1.7.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.7.0` |
| `@headless-tree/react` | `1.7.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.7.0` |
| `@huggingface/transformers` | `4.3.0` | Behind latest; next monthly batch (docs/dependency-updates.md). The root override pins its `onnxruntime-node` to `1.23.2` | `4.3.0` |
| `@img/sharp-darwin-arm64` | `0.35.4` | Prebuilt binary for `sharp` `0.35.4`; moves with `sharp` | `0.35.4` |
| `@img/sharp-darwin-x64` | `0.35.4` | Prebuilt binary for `sharp` `0.35.4`; moves with `sharp` | `0.35.4` |
| `@img/sharp-libvips-darwin-arm64` | `1.3.3` | libvips build for `sharp` `0.35.4`; moves with `sharp` | `1.3.3` |
| `@img/sharp-libvips-darwin-x64` | `1.3.3` | libvips build for `sharp` `0.35.4`; moves with `sharp` | `1.3.3` |
| `@img/sharp-libvips-linux-x64` | `1.3.3` | libvips build for `sharp` `0.35.4`; moves with `sharp` | `1.3.3` |
| `@img/sharp-linux-x64` | `0.35.4` | Prebuilt binary for `sharp` `0.35.4`; moves with `sharp` | `0.35.4` |
| `@img/sharp-win32-x64` | `0.35.4` | Prebuilt binary for `sharp` `0.35.4`; moves with `sharp` | `0.35.4` |
| `@lexical/react` | `0.50.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `0.50.0` |
| `@lobehub/icons-static-svg` | `1.95.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.95.0` |
| `@modelcontextprotocol/client` | `2.0.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `2.0.0` |
| `@modelcontextprotocol/conformance` | `0.2.0-alpha.11` | Prerelease newer than the `latest` tag (`0.1.16`); moving to `latest` would be a downgrade | `0.2.0-alpha.11` |
| `@modelcontextprotocol/ext-apps` | `2.0.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `2.0.0` |
| `@modelcontextprotocol/node` | `2.0.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `2.0.0` |
| `@modelcontextprotocol/sdk` | `1.30.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.30.0` |
| `@modelcontextprotocol/server` | `2.0.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `2.0.0` |
| `@napi-rs/keyring` | `2.1.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `2.1.0` |
| `@oven/bun-darwin-aarch64` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oven/bun-darwin-x64` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oven/bun-linux-aarch64` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oven/bun-linux-aarch64-musl` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oven/bun-linux-x64` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oven/bun-linux-x64-musl` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oven/bun-windows-aarch64` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oven/bun-windows-x64` | `1.4.4-canary.20261103.1` | `bun lint` exists only in Bun canaries, so `scripts/lint.ts` runs this one. Bump every `tools/bun-lint` pin together, to a canary at least 7 days old | `1.4.4-canary.20261103.1` |
| `@oxlint/plugins` | `1.91.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.91.0` |
| `@pierre/diffs` | `1.4.2` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.4.2` |
| `@playwright/test` | `1.63.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.63.0` |
| `@rolldown/plugin-babel` | `0.2.4` | Behind latest; next monthly batch (docs/dependency-updates.md) | `0.2.4` |
| `@sentry/core` | `10.75.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `10.75.0` |
| `@sentry/electron` | `7.20.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `7.20.0` |
| `@silvia-odwyer/photon-node` | `0.3.4` | The version Pi depends on; Pi reads its wasm from the installed package. `check:pi-runtime` fails on drift | `0.3.4` |
| `@tailwindcss/vite` | `4.3.3` | Behind latest; next monthly batch (docs/dependency-updates.md) | `4.3.3` |
| `@tanstack/eslint-plugin-query` | `5.102.8` | Behind latest; next monthly batch (docs/dependency-updates.md) | `5.102.8` |
| `@tanstack/react-hotkeys` | `0.10.0` | The root `overrides` pin the same version; change both | `0.10.0` |
| `@tanstack/react-query` | `5.102.8` | The root `overrides` pin it and `@tanstack/query-core` to this version; change all three. From 5.102 `queryClient.query()` applies `select` (.agents/memory/tooling.md) | `5.102.8` |
| `@tanstack/react-router` | `1.170.36` | The root `overrides` pin `router-core`, `history`, `router-generator` and `router-utils` to match; move them in lockstep, an older `router-core` fails at runtime (.agents/memory/tooling.md) | `1.170.36` |
| `@tanstack/react-router-ssr-query` | `1.167.2` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.167.2` |
| `@tanstack/router-plugin` | `1.168.38` | The root `overrides` pin the same version; moves with `@tanstack/react-router` | `1.168.38` |
| `@testing-library/user-event` | `14.6.8` | Behind latest; next monthly batch (docs/dependency-updates.md) | `14.6.8` |
| `@types/node` | `24.13.3` | Types for Node 24, the `engines` range; `latest` is Node 26 | `24.13.3` |
| `@types/ws` | `8.18.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `8.18.1` |
| `@vitejs/plugin-react` | `6.1.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `6.1.1` |
| `@vitest/coverage-v8` | `4.1.11` | Behind latest; next monthly batch (docs/dependency-updates.md) | `4.1.11` |
| `@xterm/xterm` | `6.1.0-beta.303` | xterm 6.0 stable lacks Kitty keyboard-protocol negotiation (ADR 0030). Go back to stable only after the protocol tests and Electron performance and IME QA pass | `6.1.0-beta.303` |
| `astro` | `7.3.2` | Behind latest; next monthly batch (docs/dependency-updates.md) | `7.3.2` |
| `babel-plugin-react-compiler` | `1.0.0` | Patched for Babel 8 `AssignmentPattern` bailouts (`patches/babel-plugin-react-compiler@1.0.0.patch`); re-port it before moving. `react-compiler-coverage.unit.test.ts` catches a regression | `1.0.0` |
| `better-sqlite3` | `13.0.3` | Native module. The `@effect/sql-sqlite-node>better-sqlite3` override keeps one SQLite build in the Host process (docs/system-architecture.md#one-sqlite-library); change both | `13.0.3` |
| `chokidar` | `5.0.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `5.0.0` |
| `editorconfig` | `3.0.2` | Behind latest; next monthly batch (docs/dependency-updates.md) | `3.0.2` |
| `effect` | `3.22.2` | `latest` is Effect 4, a major migration; this is the Effect 3 line. Move all `@effect/*` with `effect` | `3.22.2` |
| `electron` | `43.2.0` | Sets the ABI of the native modules: an update needs `prepare:native:node`, `prepare:native:electron` and a packaged smoke (docs/dependency-updates.md). Behind latest; next monthly batch | `43.2.0` |
| `electron-builder` | `26.17.0` | `dmg-builder` `26.17.0` is patched (`patches/dmg-builder@26.17.0.patch`); re-create the patch before moving | `26.17.0` |
| `electron-updater` | `6.8.10` | Behind latest; next monthly batch (docs/dependency-updates.md) | `6.8.10` |
| `electron-vite` | `5.0.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `5.0.0` |
| `fallow` | `3.33.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `3.33.1` |
| `hast-util-to-jsx-runtime` | `2.3.6` | Behind latest; next monthly batch (docs/dependency-updates.md) | `2.3.6` |
| `ignore` | `7.0.9` | Behind latest; next monthly batch (docs/dependency-updates.md) | `7.0.9` |
| `jsdom` | `29.1.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `29.1.1` |
| `lexical` | `0.50.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `0.50.0` |
| `lucide` | `1.46.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.46.0` |
| `lucide-react` | `1.46.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.46.0` |
| `mammoth` | `1.12.3` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.12.3` |
| `node-gyp` | `12.4.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `12.4.0` |
| `node-pty` | `1.1.0` | Native module, patched (`patches/node-pty@1.1.0.patch`); re-port the patch before moving | `1.1.0` |
| `oxc-parser` | `0.148.0` | The version `react-doctor` `0.9.22` already installs, so the lint rule tests add no package; move with `react-doctor` | `0.148.0` |
| `oxfmt` | `0.76.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `0.76.0` |
| `oxlint` | `1.91.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.91.0` |
| `oxlint-tsgolint` | `7.0.2005` | Behind latest; next monthly batch (docs/dependency-updates.md) | `7.0.2005` |
| `playwright-core` | `1.63.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.63.0` |
| `plist` | `5.0.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `5.0.0` |
| `quickjs-wasi` | `3.6.2` | The version Pi depends on; Pi reads its wasm from the installed package. `check:pi-runtime` fails on drift | `3.6.2` |
| `react` | `19.3.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `19.3.0` |
| `react-dom` | `19.3.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `19.3.0` |
| `release-please` | `17.6.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `17.6.1` |
| `sharp` | `0.35.4` | Native module. The root `overrides` pin the same version; move with the `@img/sharp-*` binaries | `0.35.4` |
| `shiki` | `4.4.3` | The root `overrides` pin `@pierre/diffs>shiki` and `@pierre/theming>shiki` to this version; change all three | `4.4.3` |
| `smol-toml` | `1.8.0` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.8.0` |
| `tailwindcss` | `4.3.3` | Behind latest; next monthly batch (docs/dependency-updates.md) | `4.3.3` |
| `tsx` | `4.23.13` | Behind latest; next monthly batch (docs/dependency-updates.md) | `4.23.13` |
| `typebox` | `1.3.27` | The `typebox` `pi-coding-agent` depends on, the copy Pi gives extensions; `check:pi-runtime` checks it | `1.3.27` |
| `undici` | `8.10.2` | Behind latest; next monthly batch (docs/dependency-updates.md) | `8.10.2` |
| `unpdf` | `1.8.1` | Behind latest; next monthly batch (docs/dependency-updates.md) | `1.8.1` |
| `vite` | `8.3.0` | The root override pins `electron-vite>vite` to this version; change both | `8.3.0` |
| `vitest` | `4.1.11` | Behind latest; next monthly batch (docs/dependency-updates.md) | `4.1.11` |
| `ws` | `8.21.3` | Behind latest; next monthly batch (docs/dependency-updates.md) | `8.21.3` |
| `zod` | `4.6.5` | Behind latest; next monthly batch (docs/dependency-updates.md) | `4.6.5` |
| `zustand` | `5.0.15` | Behind latest; next monthly batch (docs/dependency-updates.md) | `5.0.15` |

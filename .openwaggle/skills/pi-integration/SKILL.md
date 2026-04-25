---
name: pi-integration
description: This skill should be used when implementing, debugging, or refactoring OpenWaggle's Pi SDK integration, especially around settings/resource loading, runtime wiring, session ownership boundaries, and Electron bundling constraints.
---

# Pi Integration

Understand the architectural boundary before changing anything.

## Read these Pi docs first

When Pi behavior is unclear, read the official docs and examples before guessing.

### Primary docs
- SDK overview: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/sdk.md`
- Session/runtime model: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/session.md`
- Settings model: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/settings.md`
- Skills: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/skills.md`
- Extensions: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/extensions.md`
- Models/provider registration: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/models.md`
- Custom providers: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md`
- Packages/resources: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/packages.md`
- Compaction: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/compaction.md`
- TUI behavior reference: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/docs/tui.md`

### Most useful examples
- Sessions: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/sdk/11-sessions.ts`
- Full-control SDK usage: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/sdk/12-full-control.ts`
- Session runtime replacement: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/sdk/13-session-runtime.ts`
- Extensions from SDK: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/sdk/06-extensions.ts`
- Extension example: `/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/examples/extensions/permission-gate.ts`

## How to use Pi in this repository

- Treat Pi as an adapter dependency used only from OpenWaggle main-process adapter code.
- Reach for `createAgentSession`, `createAgentSessionRuntime`, `SessionManager`, `SettingsManager`, `DefaultPackageManager`, and `DefaultResourceLoader` from the public package root first.
- Prefer exported APIs from `@mariozechner/pi-coding-agent` over deep internal imports.
- Use Pi docs/examples to confirm lifecycle behavior before designing OpenWaggle wrappers.
- When uncertain whether something belongs in Pi runtime truth versus OpenWaggle product truth, default to:
  - Pi owns runtime/session/tool/provider/auth/resource semantics
  - OpenWaggle owns IPC, product UX, renderer state, and SQLite projection

## Treat Pi as a runtime kernel, not as product state

- Keep OpenWaggle as the product shell.
- Keep OpenWaggle SQLite as canonical product truth.
- Treat Pi session persistence as an internal runtime detail for now.
- Project Pi-native runtime/session state into OpenWaggle-owned persistence instead of trying to make Pi the product database.

## Respect hexagonal boundaries

- Isolate Pi SDK usage inside adapter-layer code under `src/main/adapters/pi/` or other adapter modules.
- Do not import Pi SDK types or runtime objects directly into `src/main/application/`, `src/main/ipc/`, or shared IPC/domain types.
- Expose OpenWaggle-owned ports/interfaces upward.
- Keep renderer-facing contracts OpenWaggle-owned.

## Use the OpenWaggle-owned project namespace

- Prefer `.openwaggle/` as the primary user-facing project namespace.
- Support legacy `.pi/` and `.agents/` only as fallback/discovery sources.
- Apply project-local precedence as `.openwaggle > .pi > .agents`.
- Keep project settings in `.openwaggle/settings.json`.
- Use OpenWaggle-owned top-level settings with nested `pi` settings when shaping product config.

## Know the key Pi SDK integration facts

### Settings
- Use `SettingsManager.fromStorage(...)` for custom settings backends.
- Keep writes going to `.openwaggle/settings.json`.
- Allow reads to fall back to legacy `.pi/settings.json` and `.agents/settings.json` where needed.

### Sessions
- Pi session storage is not currently pluggable in the same way settings storage is.
- `SessionManager` is concrete and JSONL-backed by default.
- Keep Pi JSONL as an implementation detail during the migration.
- Build OpenWaggle-owned projection/reconciliation around it instead of trying to replace it immediately.

### Resource loading
- Do not assume `DefaultResourceLoader` overrides are enough to enforce `.openwaggle > .pi > .agents`.
- Pi's first-wins collision model means late-added paths can lose to earlier `.pi` discoveries.
- Use exported-only composition:
  1. resolve resources with `DefaultPackageManager.resolve()`
  2. augment/re-rank project-local resources with OpenWaggle precedence
  3. create a fresh `DefaultResourceLoader` with `noExtensions/noSkills/noPromptTemplates/noThemes`
  4. pass the ordered file lists back through `additional*Paths`
- Preserve truthful `sourceInfo` on loaded resources after reordering.

### Package exports
- Prefer Pi public exports from `@mariozechner/pi-coding-agent`.
- Avoid relying on non-exported `dist/...` internal paths in production code.
- If an approach depends on non-exported internals, redesign around public exports first.

## Respect Electron bundling constraints

- Pi SDK is ESM-only.
- Ensure Pi packages are bundled into the Electron main build via `electron.vite.config.ts` exclusions where needed.
- Validate any newly introduced Pi packages or transitive ESM-only dependencies against Electron main bundling constraints.

## Preserve OpenWaggle product semantics during migration

- Optimize for Pi-native runtime behavior, but keep OpenWaggle-owned UX/product rules intact unless the migration explicitly changes them.
- Keep renderer state OpenWaggle-owned.
- Do not reintroduce TanStack chat hooks or AG-UI-shaped contracts once replacing them.
- Keep typed IPC as the bridge from renderer to main.

## Recommended implementation workflow

1. Read the current migration specs under `docs/specs/pi-sdk-*` before major changes.
2. Validate architecture placement before importing Pi into any file.
3. Implement in adapters first.
4. Add targeted tests for precedence, fallback, and wiring behavior.
5. Run `pnpm typecheck:node` and `pnpm check:architecture` after adapter changes.
6. If renderer/preload/main IPC behavior changes, complete Electron QA before handoff.

## Common gotchas

- Pi package root does not expose every internal helper; design around public exports.
- Pi resource precedence cannot be “fixed later” by sorting already-collided skill results.
- Settings are flexible; sessions are not. Do not assume both are equally extensible.
- Do not leak Pi SDK types into shared OpenWaggle contracts.
- Do not preserve a docs/planning branch name once real implementation begins.

## Files to inspect first

- `src/main/adapters/pi/openwaggle-pi-paths.ts`
- `src/main/adapters/pi/openwaggle-pi-settings-storage.ts`
- `src/main/adapters/pi/openwaggle-pi-settings-manager.ts`
- `src/main/adapters/pi/openwaggle-pi-resource-loader.ts`
- `electron.vite.config.ts`
- `docs/specs/pi-sdk-migration-blueprint.md`
- `docs/specs/pi-sdk-migration-execution-plan.md`
- `docs/specs/pi-sdk-session-projection-spec.md`
- `docs/specs/pi-sdk-migration-sequencing.md`

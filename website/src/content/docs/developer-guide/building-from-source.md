---
title: "Building from Source"
description: "How to clone, build, and run OpenWaggle from source — development mode, production builds, and platform installers."
order: 3
section: "Developer Guide"
---

## Prerequisites

- **Node.js** 24.x — [nodejs.org](https://nodejs.org/)
- **pnpm** 9+ — [pnpm.io](https://pnpm.io/)

## Clone and Install

```bash
git clone https://github.com/OpenWaggle/OpenWaggle.git
cd openwaggle
pnpm install
```

## Development Mode

```bash
pnpm dev
```

This launches the Electron app with:
- **Hot-reload** for the renderer (React UI updates live).
- **No hot-reload** for the main process — restart the app for backend changes.
- **Electron-native rebuild prep** for native dependencies such as `better-sqlite3`.

## Production Build

```bash
pnpm build
```

## Platform Installers

```bash
pnpm build:mac    # macOS .dmg (x64 + arm64)
pnpm build:win    # Windows NSIS installer (x64)
pnpm build:linux  # Linux AppImage (x64)
```

## Scripts Reference

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start in development mode |
| `pnpm build` | Production build |
| `pnpm prepare:native:node` | Rebuild native dependencies for Node-based test runs |
| `pnpm prepare:native:electron` | Rebuild native dependencies for Electron dev/build/e2e runs |
| `pnpm typecheck` | Full type check (main + renderer) |
| `pnpm typecheck:node` | Type check main + preload + shared |
| `pnpm typecheck:web` | Type check renderer + shared |
| `pnpm lint` | Biome lint check |
| `pnpm lint:fix` | Biome lint + auto-fix |
| `pnpm format` | Biome format |
| `pnpm check:fast` | Typecheck + lint only |
| `pnpm check` | typecheck + lint combined |
| `pnpm test` | All tests (unit + integration + component) |
| `pnpm test:all` | All tests including headless E2E |
| `pnpm test:unit` | Unit tests only (`*.unit.test.ts`) |
| `pnpm test:integration` | Integration tests only (`*.integration.test.ts`) |
| `pnpm test:component` | Component tests only (`*.component.test.tsx`) |
| `pnpm test:e2e` | Playwright E2E tests (headless, requires `pnpm build` first) |
| `pnpm test:coverage` | Coverage report (v8 provider) |
| `pnpm prepush:main` | Quality gate used by the pre-push hook when pushing `main` |

## Git Hooks

Husky manages a `pre-push` hook that runs only when the push includes `refs/heads/main`.

The hook runs:

- `pnpm check`
- `pnpm format`
- `pnpm test:all`

## Testing

### Test File Naming

- `*.unit.test.ts` — Unit tests (isolated, no external dependencies).
- `*.integration.test.ts` — Integration tests (may touch file system, IPC).
- `*.component.test.tsx` — React component tests (JSDOM + Testing Library).

### Running Tests

```bash
pnpm test             # All tests
pnpm test:all         # All tests including headless E2E
pnpm test:unit        # Unit tests only
pnpm test:integration # Integration tests only
pnpm test:component   # Component tests only
pnpm test:e2e         # Playwright E2E (headless, requires build)
pnpm test:coverage    # Coverage report
```

### E2E Testing

E2E tests use Playwright and require a production build first:

```bash
pnpm build
pnpm test:e2e
```

The `OPENWAGGLE_USER_DATA_DIR` env var can override the data directory for test isolation.

## Configuration Files

| File | Purpose |
|------|---------|
| `electron.vite.config.ts` | Build config (main/preload/renderer). ESM package bundling, React Compiler. |
| `electron-builder.yml` | Platform build config (dmg, NSIS, AppImage). |
| `tsconfig.json` | Root TypeScript config (references node + web). |
| `tsconfig.node.json` | Main + preload + shared TypeScript config. |
| `tsconfig.web.json` | Renderer + shared TypeScript config. |
| `biome.json` | Linter and formatter config. |
| `vitest.config.ts` | Test runner config. |

## Key Conventions

- **Always use `pnpm`** — Never `npm` or `yarn`.
- **No `any`** — Use `unknown` plus narrowing or Effect Schema.
- **No `React.FC`** — Plain functions with explicit props interfaces.
- **No `forwardRef`** — React 19 supports direct ref props.
- **No `React.memo()` / `useMemo()` / `useCallback()`** for render optimization — React Compiler handles it.
- **No `process.env`** — Import from `./env` modules.
- **No raw `console.*` in main process** — Use the structured logger from `src/main/logger.ts`.
- **Zustand selectors** — Always use `useStore((s) => s.field)`, never call stores without a selector.
- **`cn()`** — Use the utility from `src/lib/utils` for conditional Tailwind classes.

## Path Aliases

| Alias | Maps To | Available In |
|-------|---------|-------------|
| `@shared/*` | `src/shared/*` | All targets |
| `@/*` | `src/renderer/src/*` | Renderer only |

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { EAGER_MAIN_EXTERNALS } from './lazy-external-requires'

export const ALWAYS_EXTERNAL = ['electron', 'bufferutil', 'utf-8-validate', 'node-pty']
export const BUNDLED_DEPS = [
  'effect',
  '@effect/platform',
  '@effect/platform-node',
  '@effect/sql',
  '@effect/sql-sqlite-node',
  '@diegogbrisa/ts-match',
  '@openwaggle/extension-sdk',
  '@openwaggle/pi-waggle',
  '@openwaggle/waggle-core',
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-mcp',
  '@earendil-works/pi-tui',
  'jiti',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/node',
  '@modelcontextprotocol/server',
  'typebox',
  '@electron-toolkit/utils',
  'fast-glob',
  'diff',
  'smol-toml',
  'jszip',
  'mammoth',
  'unpdf',
  // plist 5 is ESM-only (no require/default export condition), so it cannot
  // be externalized into the CJS main bundle; bundle it like the other
  // ESM-only dependencies above.
  'plist',
  // Pure-JS packages made of many small files. As externals, every process resolved, read and
  // compiled each of their files at startup (≈150 ms: startup-main.md, A-F4); bundled, they are
  // part of the main bundle's compile cache and evaluate only when their importer does. Natives,
  // WASM readers and packages that locate files beside themselves stay external.
  'zod',
  'undici',
  'ws',
  'proper-lockfile',
  'ignore',
  'jsonc-parser',
  'remark-parse',
  'unified',
  'yauzl',
  'chokidar',
]

interface UnknownObject {
  readonly [key: string]: unknown
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null
}

function dependencyNamesFromPackageJson(value: unknown) {
  if (!isObject(value) || !isObject(value.dependencies)) {
    return []
  }

  return Object.keys(value.dependencies)
}

/**
 * Vite 8 (Rolldown) only accepts `string[]` for `external`, not RegExp.
 * electron-vite's `externalizeDepsPlugin` and preset plugin both add RegExp
 * patterns to `rolldownOptions.external`, which Rolldown silently ignores in
 * SSR mode (`ssr.noExternal: true`). This plugin runs last and replaces the
 * external array with a pure-string list derived from package.json deps.
 */
function mainExternalPackages() {
  const packageJson: unknown = JSON.parse(readFileSync(resolve('package.json'), 'utf-8'))
  const allDeps = dependencyNamesFromPackageJson(packageJson)
  const externalDeps = allDeps.filter((dependency) =>
    !BUNDLED_DEPS.some(
      (bundledDependency) =>
        dependency === bundledDependency || dependency.startsWith(`${bundledDependency}/`),
    ),
  )
  return new Set([...ALWAYS_EXTERNAL, ...externalDeps])
}

const MAIN_EXTERNAL_PACKAGES = mainExternalPackages()

/**
 * Externals other than Electron are required where their importer first runs instead of at the
 * top of the main bundle (scripts/vite/lazy-external-requires.ts). They are resolved by that
 * plugin, so they are kept out of Rolldown's own `external` list.
 */
export function isLazyMainExternal(packageName: string) {
  return MAIN_EXTERNAL_PACKAGES.has(packageName) && !EAGER_MAIN_EXTERNALS.includes(packageName)
}

export function rolldownExternalFixPlugin(): Plugin {
  return {
    name: 'vite:rolldown-external-fix',
    enforce: 'post',
    configResolved(config) {
      const external = [...MAIN_EXTERNAL_PACKAGES].filter(
        (dependency) => !isLazyMainExternal(dependency),
      )

      // Strip RegExp entries from the resolved external array and ensure all
      // deps are present as plain strings (Rolldown only accepts string[]).
      const resolved = config.build.rolldownOptions.external
      const existing = Array.isArray(resolved)
        ? resolved.filter(
            (entry): entry is string => typeof entry === 'string' && !isLazyMainExternal(entry),
          )
        : []
      const merged = [...new Set([...existing, ...external])]

      config.build.rolldownOptions.external = merged
    },
  }
}

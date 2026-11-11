import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import { isRebuildMode, type RebuildMode } from './native-rebuild-cache'

const MODE_ARG_INDEX = 2
const MODULE_ROOT_ARG_INDEX = 3
const localRequire = createRequire(import.meta.url)

type DatabaseConstructor = new (filename: string) => unknown
type NativeModuleLoader = (moduleName: string) => unknown

function isDatabaseConstructor(value: unknown): value is DatabaseConstructor {
  return typeof value === 'function'
}

function isFunction(value: unknown): value is (...args: readonly unknown[]) => unknown {
  return typeof value === 'function'
}

function moduleLoader(moduleRoot: string | undefined) {
  if (!moduleRoot) return localRequire
  const rootRequire = createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
  return ((moduleName) => {
    const loaded: unknown = rootRequire(moduleName)
    return loaded
  }) satisfies NativeModuleLoader
}

/**
 * Loads every native module the app ships under the runtime that will load it. Terminals have
 * no native module: they run on Bun's own PTY and ConPTY through `bun:ffi`.
 */
export function assertNativeModulesLoad(
  mode: RebuildMode,
  loadModule: NativeModuleLoader = localRequire,
) {
  const databaseConstructor = loadModule('better-sqlite3')
  assertMatching(P.when(isDatabaseConstructor), databaseConstructor)

  const database = new databaseConstructor(':memory:')
  assertMatching({ close: P.when(isFunction) }, database)
  database.close()

  if (mode === 'electron') void loadModule('sharp')
}

function main() {
  const mode = process.argv[MODE_ARG_INDEX]
  if (!isRebuildMode(mode)) {
    throw new Error('Usage: native-load-probe.ts <node|electron> [module-root]')
  }
  assertNativeModulesLoad(mode, moduleLoader(process.argv[MODULE_ROOT_ARG_INDEX]))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

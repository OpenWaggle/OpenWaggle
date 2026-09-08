import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import { probeNodePtyLifecycle } from './native-pty-contract-probe'
import { probeWindowsTerminalTelemetry } from './native-windows-telemetry-probe'
import { isRebuildMode, type RebuildMode } from './native-rebuild-cache'

const MODE_ARG_INDEX = 2
const MODULE_ROOT_ARG_INDEX = 3
const localRequire = createRequire(import.meta.url)

type DatabaseConstructor = new (filename: string) => unknown
type NativeModuleLoader = (moduleName: string) => unknown

interface NodePtyModule {
  readonly spawn: (
    file: string,
    args: readonly string[],
    options: Readonly<Record<string, unknown>>,
  ) => unknown
  readonly fork: (...args: readonly unknown[]) => unknown
  readonly createTerminal: (...args: readonly unknown[]) => unknown
  readonly open: (...args: readonly unknown[]) => unknown
  readonly native: unknown
}

function isDatabaseConstructor(value: unknown): value is DatabaseConstructor {
  return typeof value === 'function'
}

function isFunction(value: unknown): value is (...args: readonly unknown[]) => unknown {
  return typeof value === 'function'
}

function isNodePtyModule(value: unknown): value is NodePtyModule {
  if (typeof value !== 'object' || value === null) return false
  return (
    ['spawn', 'fork', 'createTerminal', 'open'].every(
      (key) => key in value && typeof Reflect.get(value, key) === 'function',
    ) && 'native' in value
  )
}

function moduleLoader(moduleRoot: string | undefined): NativeModuleLoader {
  if (!moduleRoot) return localRequire
  const rootRequire = createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
  return (moduleName) => {
    const loaded: unknown = rootRequire(moduleName)
    return loaded
  }
}

function assertUnixNativeContract(native: unknown) {
  assertMatching(
    {
      fork: P.when(isFunction),
      open: P.when(isFunction),
      resize: P.when(isFunction),
      process: P.when(isFunction),
      processInfos: P.when(isFunction),
      signalProcess: P.when(isFunction),
      signalByTty: P.when(isFunction),
    },
    native,
  )
}

export async function assertNativeModulesLoad(
  mode: RebuildMode,
  loadModule: NativeModuleLoader = localRequire,
  platform: NodeJS.Platform = process.platform,
  executablePath: string = process.execPath,
) {
  const databaseConstructor = loadModule('better-sqlite3')
  assertMatching(P.when(isDatabaseConstructor), databaseConstructor)

  const database = new databaseConstructor(':memory:')
  assertMatching({ close: P.when(isFunction) }, database)
  database.close()

  const nodePtyValue = loadModule('node-pty')
  if (!isNodePtyModule(nodePtyValue)) {
    throw new Error('node-pty did not expose its documented module surface.')
  }
  if (platform === 'win32') {
    if (nodePtyValue.native !== null) throw new Error('node-pty native must be null on Windows.')
    await probeWindowsTerminalTelemetry(nodePtyValue)
  } else {
    assertUnixNativeContract(nodePtyValue.native)
  }

  await probeNodePtyLifecycle(nodePtyValue, platform, executablePath)

  if (mode === 'electron') void loadModule('sharp')
}

async function main() {
  const mode = process.argv[MODE_ARG_INDEX]
  if (!isRebuildMode(mode)) {
    throw new Error('Usage: native-load-probe.ts <node|electron> [module-root]')
  }
  await assertNativeModulesLoad(mode, moduleLoader(process.argv[MODULE_ROOT_ARG_INDEX]))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

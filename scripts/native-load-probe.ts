import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertMatching, P } from '@diegogbrisa/ts-match'
import { parseJsonUnknown, Schema } from '@shared/schema'
import { probeNodePtyLifecycle } from './native-pty-contract-probe'
import { parsePtyProbeProfile, type PtyProbeProfile } from './native-pty-probe-support'
import { probeWindowsTerminalTelemetry } from './native-windows-telemetry-probe'
import { isRebuildMode, type RebuildMode } from './native-rebuild-cache'
import { objectEntries, objectFields, objectMap, unknownField } from './support/object-fields'

const MODE_ARG_INDEX = 2
const MODULE_ROOT_ARG_INDEX = 3
const CONSOLE_EXECUTABLE_ARG_INDEX = 4
const PTY_PROFILE_ARG_INDEX = 5
const localRequire = createRequire(import.meta.url)

type DatabaseConstructor = new (filename: string) => unknown
type NativeModuleLoader = (moduleName: string) => unknown
/** `import()` of a bare module name, resolved from the module root. */
type ModuleImporter = (moduleName: string) => Promise<unknown>

/** The conditions Node's ESM resolver matches for `import()`, in its order of preference. */
const IMPORT_CONDITIONS: ReadonlySet<string> = new Set(['node', 'import', 'module-sync', 'default'])

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

function moduleLoader(moduleRoot: string | undefined) {
  if (!moduleRoot) return localRequire
  const rootRequire = createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
  return ((moduleName) => {
    const loaded: unknown = rootRequire(moduleName)
    return loaded
  }) satisfies NativeModuleLoader
}

const packageManifestSchema = Schema.Struct({ name: unknownField, exports: unknownField })

/** The target of a conditional `exports` value for `import()`, as Node picks it. */
function conditionalTarget(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = conditionalTarget(entry)
      if (target !== undefined) return target
    }
    return undefined
  }
  for (const [condition, entry] of objectEntries(value) ?? []) {
    if (!IMPORT_CONDITIONS.has(condition)) continue
    const target = conditionalTarget(entry)
    if (target !== undefined) return target
  }
  return undefined
}

/** The directory and manifest of the installed package `moduleName`, from the file `require` loads. */
function installedPackage(loaderRequire: NodeJS.Require, moduleName: string) {
  let directory = path.dirname(loaderRequire.resolve(moduleName))
  while (path.dirname(directory) !== directory) {
    const file = path.join(directory, 'package.json')
    const manifest = fs.existsSync(file)
      ? objectFields(packageManifestSchema, parseJsonUnknown(fs.readFileSync(file, 'utf8')))
      : undefined
    if (manifest?.name === moduleName) return { directory, manifest }
    directory = path.dirname(directory)
  }
  throw new Error(`${moduleName} has no package.json of its own.`)
}

/**
 * The file `import()` of a bare package name loads, which differs from `require`'s when the
 * package's `exports` has an `import` condition: transformers.js resolves `transformers.node.mjs`.
 */
export function packageImportEntry(loaderRequire: NodeJS.Require, moduleName: string) {
  const { directory, manifest } = installedPackage(loaderRequire, moduleName)
  if (manifest.exports === undefined) return loaderRequire.resolve(moduleName)
  const subpaths = objectMap(manifest.exports)
  const hasSubpaths = [...(subpaths?.keys() ?? [])].some((key) => key.startsWith('.'))
  const target = conditionalTarget(hasSubpaths ? subpaths?.get('.') : manifest.exports)
  if (target === undefined) throw new Error(`${moduleName} exports nothing for import().`)
  return path.join(directory, target)
}

function moduleImporter(moduleRoot: string | undefined) {
  const loaderRequire = moduleRoot
    ? createRequire(path.join(path.resolve(moduleRoot), 'package.json'))
    : localRequire
  return (async (moduleName) => {
    const loaded: unknown = await import(
      pathToFileURL(packageImportEntry(loaderRequire, moduleName)).href
    )
    return loaded
  }) satisfies ModuleImporter
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

/**
 * Packages the packaged app ships only part of (scripts/packaged-runtime-packages.ts
 * `PACKAGE_UNLOADED_FILES`): each loads from what is left, transformers.js through onnxruntime-node.
 */
export const TRIMMED_RUNTIME_MODULES = [
  'lucide',
  'mammoth',
  'jszip',
  'playwright-core',
  '@huggingface/transformers',
  'tesseract.js',
] as const

/** tesseract.js's Node core loader: it picks the `-lstm` core this runtime's WASM features allow. */
export const TESSERACT_CORE_LOADER = 'tesseract.js/src/worker-script/node/getCore.js'
const TESSERACT_LSTM_ONLY = 1

async function assertTesseractCoreLoads(loadModule: NativeModuleLoader) {
  const getCore = loadModule(TESSERACT_CORE_LOADER)
  if (!isFunction(getCore)) throw new Error('tesseract.js has no Node core loader.')
  const core = await getCore(TESSERACT_LSTM_ONLY, undefined, { progress: () => undefined })
  if (!isFunction(core)) throw new Error('tesseract.js loaded no Tesseract core.')
}

export async function assertNativeModulesLoad(
  mode: RebuildMode,
  loadModule: NativeModuleLoader = localRequire,
  platform: NodeJS.Platform = process.platform,
  executablePath: string = process.execPath,
  profile: PtyProbeProfile = 'runtime',
  importModule: ModuleImporter = moduleImporter(undefined),
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

  await probeNodePtyLifecycle(nodePtyValue, platform, executablePath, profile)

  if (mode !== 'electron') return
  void loadModule('sharp')
  // Both ways the app loads them: the voice handler import()s transformers.js (its ESM build), the
  // embedding process requires it (its CommonJS build).
  for (const moduleName of TRIMMED_RUNTIME_MODULES) {
    void loadModule(moduleName)
    await importModule(moduleName)
  }
  await assertTesseractCoreLoads(loadModule)
}

async function main() {
  const mode = process.argv[MODE_ARG_INDEX]
  if (!isRebuildMode(mode)) {
    throw new Error(
      'Usage: native-load-probe.ts <node|electron> [module-root] [console-executable] [runtime|all-backends]',
    )
  }
  await assertNativeModulesLoad(
    mode,
    moduleLoader(process.argv[MODULE_ROOT_ARG_INDEX]),
    process.platform,
    process.argv[CONSOLE_EXECUTABLE_ARG_INDEX] ?? process.execPath,
    parsePtyProbeProfile(process.argv[PTY_PROFILE_ARG_INDEX]),
    moduleImporter(process.argv[MODULE_ROOT_ARG_INDEX]),
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

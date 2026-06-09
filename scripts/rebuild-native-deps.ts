import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  canUseNativeRebuildCache,
  createNativeRebuildCacheKey,
  createNativeRebuildPlan,
  isNativeRebuildForceEnabled,
  isNativeRebuildMarkerFresh,
  isRebuildMode,
  nativeArtifactPackagesForMode,
  parseNativeRebuildMarker,
  type RebuildMode,
  writeNativeRebuildMarker,
} from './native-rebuild-cache'

export {
  createNativeRebuildCacheKey,
  isNativeRebuildForceEnabled,
  isNativeRebuildMarkerFresh,
  nativeArtifactPackagesForMode,
  parseNativeRebuildMarker,
}

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const PROJECT_ROOT = join(dirname(SCRIPT_PATH), '..')
const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'
const MODE_ARG_INDEX = 2
const FORCE_FLAG_START_INDEX = 3
const FORCE_REBUILD_FLAG = '--force'
const SUPPRESS_DEPENDENCY_DEPRECATIONS_OPTION = '--no-deprecation'
const SUPPRESS_CAST_FUNCTION_TYPE_MISMATCH_FLAG = '-Wno-cast-function-type-mismatch'
const SUPPRESS_MISSING_FIELD_INITIALIZERS_FLAG = '-Wno-missing-field-initializers'
const NATIVE_REBUILD_CACHE_PATHS = {
  projectRoot: PROJECT_ROOT,
  electronPackageJsonPath: join(PROJECT_ROOT, 'node_modules', 'electron', 'package.json'),
  cacheDirectory: join(PROJECT_ROOT, 'node_modules', '.cache', 'openwaggle', 'native-rebuild'),
  patchesDirectory: join(PROJECT_ROOT, 'patches'),
  pnpmPackageDirectory: join(PROJECT_ROOT, 'node_modules', '.pnpm'),
}

type RebuildOptions = {
  readonly mode: RebuildMode
  readonly force: boolean
}

function runCommand(command: string, args: readonly string[], extraEnvironment: NodeJS.ProcessEnv = {}) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...extraEnvironment },
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}`))
    })
  })
}

function appendWhitespaceDelimitedOption(existingOptions: string | undefined, option: string) {
  if (existingOptions === undefined || existingOptions.trim().length === 0) {
    return option
  }

  return existingOptions.split(/\s+/u).includes(option) ? existingOptions : `${existingOptions} ${option}`
}

function appendWhitespaceDelimitedOptions(
  existingOptions: string | undefined,
  options: readonly string[],
) {
  return options.reduce(appendWhitespaceDelimitedOption, existingOptions ?? '')
}

function suppressDependencyDeprecationWarnings(extraEnvironment: NodeJS.ProcessEnv = {}) {
  return {
    ...extraEnvironment,
    NODE_OPTIONS: appendWhitespaceDelimitedOption(
      extraEnvironment.NODE_OPTIONS ?? process.env.NODE_OPTIONS,
      SUPPRESS_DEPENDENCY_DEPRECATIONS_OPTION,
    ),
  }
}

function electronRebuildEnvironment(electronVersion: string, extraEnvironment: NodeJS.ProcessEnv = {}) {
  return suppressDependencyDeprecationWarnings({
    ...extraEnvironment,
    CXXFLAGS: appendWhitespaceDelimitedOptions(process.env.CXXFLAGS, [
      SUPPRESS_CAST_FUNCTION_TYPE_MISMATCH_FLAG,
      SUPPRESS_MISSING_FIELD_INITIALIZERS_FLAG,
    ]),
    npm_config_disturl: ELECTRON_HEADERS_URL,
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
  })
}

export function parseRebuildOptions(
  argv: readonly string[] = process.argv,
  environment: NodeJS.ProcessEnv = process.env,
): RebuildOptions {
  const mode = argv[MODE_ARG_INDEX]
  const flags = argv.slice(FORCE_FLAG_START_INDEX)
  const unsupportedFlags = flags.filter((flag) => flag !== FORCE_REBUILD_FLAG)
  if (unsupportedFlags.length > 0) {
    throw new Error(`Unsupported native rebuild flags: ${unsupportedFlags.join(', ')}`)
  }
  if (!isRebuildMode(mode)) {
    throw new Error(
      `Usage: pnpm tsx scripts/rebuild-native-deps.ts <node|electron> [${FORCE_REBUILD_FLAG}]`,
    )
  }

  return { mode, force: isNativeRebuildForceEnabled(flags, environment) }
}

async function rebuildForNode() {
  await runCommand('pnpm', ['rebuild', 'better-sqlite3'], suppressDependencyDeprecationWarnings())
}

async function rebuildForElectron(electronVersion: string) {
  await runCommand('pnpm', ['rebuild', 'sharp', 'node-pty'], electronRebuildEnvironment(electronVersion))
  await runCommand(
    'pnpm',
    ['rebuild', 'better-sqlite3'],
    electronRebuildEnvironment(electronVersion, { npm_config_build_from_source: 'true' }),
  )
}

async function rebuildNativeDependencies(options: RebuildOptions) {
  const plan = await createNativeRebuildPlan(NATIVE_REBUILD_CACHE_PATHS, options.mode)
  if (!options.force && (await canUseNativeRebuildCache(NATIVE_REBUILD_CACHE_PATHS, plan))) {
    console.log(`Native dependencies cache hit for ${options.mode}.`)
    return
  }
  if (options.force) {
    console.log(`Native dependency cache bypass requested for ${options.mode}.`)
  }
  if (options.mode === 'node') {
    await rebuildForNode()
  } else {
    await rebuildForElectron(plan.runtimeVersion)
  }
  await writeNativeRebuildMarker(NATIVE_REBUILD_CACHE_PATHS, plan)
}

async function main() {
  await rebuildNativeDependencies(parseRebuildOptions())
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exitCode = 1
  })
}

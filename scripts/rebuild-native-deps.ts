import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join, posix, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  removeElectronRebuildMetadata,
  removeNativeBuildDirectories,
} from './native-rebuild-artifacts'
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
const MODE_ARG_INDEX = 2
const FORCE_FLAG_START_INDEX = 3
const FORCE_REBUILD_FLAG = '--force'
const SUPPRESS_DEPENDENCY_DEPRECATIONS_OPTION = '--no-deprecation'
const WINDOWS_COMMAND_PROCESSOR = 'cmd.exe'
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

type CommandInvocation = {
  readonly command: string
  readonly args: readonly string[]
}

type NativeProbeRuntimeOptions = {
  readonly projectRoot?: string
  readonly platform?: NodeJS.Platform
  readonly nodeExecutable?: string
  readonly accessPath?: (filePath: string) => Promise<void>
  readonly runInstall?: (
    command: string,
    args: readonly string[],
    extraEnvironment?: NodeJS.ProcessEnv,
  ) => Promise<void>
}

export function commandInvocationForPlatform(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  windowsCommandProcessor: string | undefined = process.env['ComSpec'],
): CommandInvocation {
  if (platform !== 'win32' || command !== 'pnpm') {
    return { command, args }
  }

  return {
    command: windowsCommandProcessor ?? WINDOWS_COMMAND_PROCESSOR,
    args: ['/d', '/c', command, ...args],
  }
}

function runCommand(command: string, args: readonly string[], extraEnvironment: NodeJS.ProcessEnv = {}) {
  return new Promise<void>((resolve, reject) => {
    const invocation = commandInvocationForPlatform(command, args)
    const child = spawn(invocation.command, invocation.args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
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

function commandSucceeds(
  command: string,
  args: readonly string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  return new Promise<boolean>((resolve) => {
    const invocation = commandInvocationForPlatform(command, args)
    const child = spawn(invocation.command, invocation.args, {
      cwd: PROJECT_ROOT,
      stdio: 'ignore',
      env: { ...process.env, ...extraEnvironment },
    })

    child.once('error', () => resolve(false))
    child.once('exit', (code) => {
      resolve(code === 0)
    })
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function appendWhitespaceDelimitedOption(existingOptions: string | undefined, option: string) {
  if (existingOptions === undefined || existingOptions.trim().length === 0) {
    return option
  }

  return existingOptions.split(/\s+/u).includes(option) ? existingOptions : `${existingOptions} ${option}`
}

function suppressDependencyDeprecationWarnings(
  extraEnvironment: NodeJS.ProcessEnv = {},
  baseEnvironment: NodeJS.ProcessEnv = process.env,
) {
  return {
    ...extraEnvironment,
    NODE_OPTIONS: appendWhitespaceDelimitedOption(
      extraEnvironment.NODE_OPTIONS ?? baseEnvironment['NODE_OPTIONS'],
      SUPPRESS_DEPENDENCY_DEPRECATIONS_OPTION,
    ),
  }
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

function electronExecutablePath(projectRoot: string, platform: NodeJS.Platform) {
  const path = platform === 'win32' ? win32 : posix
  if (platform === 'darwin') {
    return path.join(
      projectRoot,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )
  }

  return path.join(
    projectRoot,
    'node_modules',
    'electron',
    'dist',
    platform === 'win32' ? 'electron.exe' : 'electron',
  )
}

export function electronRuntimeInstallCommandForPlatform(
  projectRoot: string = PROJECT_ROOT,
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = process.execPath,
): CommandInvocation {
  const path = platform === 'win32' ? win32 : posix
  return {
    command: nodeExecutable,
    args: [path.join(projectRoot, 'node_modules', 'electron', 'install.js')],
  }
}

export async function ensureNativeProbeRuntime(
  mode: RebuildMode,
  options: NativeProbeRuntimeOptions = {},
) {
  if (mode === 'node') return
  const projectRoot = options.projectRoot ?? PROJECT_ROOT
  const platform = options.platform ?? process.platform
  const accessPath = options.accessPath ?? access
  const runInstall = options.runInstall ?? runCommand
  try {
    await accessPath(electronExecutablePath(projectRoot, platform))
  } catch {
    const install = electronRuntimeInstallCommandForPlatform(
      projectRoot,
      platform,
      options.nodeExecutable ?? process.execPath,
    )
    await runInstall(
      install.command,
      install.args,
      suppressDependencyDeprecationWarnings(),
    )
  }
}

export function nativeLoadProbeCommandForMode(
  mode: RebuildMode,
  projectRoot: string = PROJECT_ROOT,
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = process.execPath,
) {
  const path = platform === 'win32' ? win32 : posix
  const probeScriptPath = path.join(projectRoot, 'scripts', 'native-load-probe.ts')
  return mode === 'node'
    ? {
        command: nodeExecutable,
        args: ['--import', 'tsx', probeScriptPath, mode],
        environment: suppressDependencyDeprecationWarnings(),
      }
    : {
        command: electronExecutablePath(projectRoot, platform),
        args: ['--import', 'tsx', probeScriptPath, mode],
        environment: suppressDependencyDeprecationWarnings({ ELECTRON_RUN_AS_NODE: '1' }),
      }
}

async function nativeLoadProbeSucceeds(mode: RebuildMode) {
  await ensureNativeProbeRuntime(mode)
  const probe = nativeLoadProbeCommandForMode(mode)
  return commandSucceeds(probe.command, probe.args, probe.environment)
}

async function assertNativeLoadProbe(mode: RebuildMode) {
  await ensureNativeProbeRuntime(mode)
  const probe = nativeLoadProbeCommandForMode(mode)
  await runCommand(probe.command, probe.args, probe.environment)
}

async function rebuildForNode() {
  await runCommand('pnpm', ['rebuild', 'better-sqlite3'], suppressDependencyDeprecationWarnings())
  await removeElectronRebuildMetadata(
    NATIVE_REBUILD_CACHE_PATHS,
    nativeArtifactPackagesForMode('node'),
  )
}

async function rebuildForElectron() {
  await removeNativeBuildDirectories(
    NATIVE_REBUILD_CACHE_PATHS,
    nativeArtifactPackagesForMode('node'),
  )
  await removeElectronRebuildMetadata(
    NATIVE_REBUILD_CACHE_PATHS,
    nativeArtifactPackagesForMode('electron'),
  )
  try {
    await runCommand(
      'pnpm',
      ['exec', 'electron-builder', 'install-app-deps'],
      suppressDependencyDeprecationWarnings(),
    )
  } catch (error) {
    await assertNativeLoadProbe('electron')
    console.warn(
      `Electron native rebuild command failed after producing loadable artifacts; continuing. ${errorMessage(error)}`,
    )
  }
}

async function rebuildNativeDependencies(options: RebuildOptions) {
  const plan = await createNativeRebuildPlan(NATIVE_REBUILD_CACHE_PATHS, options.mode)
  if (!options.force && (await canUseNativeRebuildCache(NATIVE_REBUILD_CACHE_PATHS, plan))) {
    if (await nativeLoadProbeSucceeds(options.mode)) {
      console.log(`Native dependencies cache hit for ${options.mode}.`)
      return
    }
    console.log(`Native dependencies cache stale for ${options.mode}; rebuilding.`)
  }
  if (options.force) {
    console.log(`Native dependency cache bypass requested for ${options.mode}.`)
  }
  if (options.mode === 'node') {
    await rebuildForNode()
  } else {
    await rebuildForElectron()
  }
  await assertNativeLoadProbe(options.mode)
  await writeNativeRebuildMarker(NATIVE_REBUILD_CACHE_PATHS, plan)
}

async function main() {
  await rebuildNativeDependencies(parseRebuildOptions())
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}

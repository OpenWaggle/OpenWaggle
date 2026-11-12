import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join, posix, win32 } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildNativeLoadProbe, nativeLoadProbeBundlePath } from './native-load-probe-bundle'
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
import {
  type CommandInvocation,
  electronNativeRebuildInvocation,
  nodeNativeRebuildInvocations,
  shellInvocationForPlatform,
  suppressDependencyDeprecationWarnings,
} from './native-rebuild-invocations'
import { nodeRuntime } from './support/node-runtime'

export {
  packageRebuildCommandLine,
  packageRebuildEnvironment,
  shellInvocationForPlatform,
} from './native-rebuild-invocations'
export {
  createNativeRebuildCacheKey,
  createNativeRebuildPlan,
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
const NATIVE_REBUILD_CACHE_PATHS = {
  projectRoot: PROJECT_ROOT,
  electronPackageJsonPath: join(PROJECT_ROOT, 'node_modules', 'electron', 'package.json'),
  cacheDirectory: join(PROJECT_ROOT, 'node_modules', '.cache', 'openwaggle', 'native-rebuild'),
  patchesDirectory: join(PROJECT_ROOT, 'patches'),
  storeDirectory: join(PROJECT_ROOT, 'node_modules', '.bun'),
}

interface RebuildOptions {
  readonly mode: RebuildMode
  readonly force: boolean
}

interface NativeProbeRuntimeOptions {
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

function runCommand(
  command: string,
  args: readonly string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
  cwd: string = PROJECT_ROOT,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
    const child = spawn(command, args, {
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

export function parseRebuildOptions(
  argv: readonly string[] = process.argv,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const mode = argv[MODE_ARG_INDEX]
  const flags = argv.slice(FORCE_FLAG_START_INDEX)
  const unsupportedFlags = flags.filter((flag) => flag !== FORCE_REBUILD_FLAG)
  if (unsupportedFlags.length > 0) {
    throw new Error(`Unsupported native rebuild flags: ${unsupportedFlags.join(', ')}`)
  }
  if (!isRebuildMode(mode)) {
    throw new Error(
      `Usage: bun scripts/rebuild-native-deps.ts <node|electron> [${FORCE_REBUILD_FLAG}]`,
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
  nodeExecutable: string = nodeRuntime().execPath,
) {
  const path = platform === 'win32' ? win32 : posix
  return {
    command: nodeExecutable,
    args: [path.join(projectRoot, 'node_modules', 'electron', 'install.js')],
  } satisfies CommandInvocation
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
    const nodeExecutable = options.nodeExecutable ?? nodeRuntime().execPath
    const install = electronRuntimeInstallCommandForPlatform(projectRoot, platform, nodeExecutable)
    const environment = suppressDependencyDeprecationWarnings()
    await runInstall(install.command, install.args, environment)
  }
}

export function nativeLoadProbeCommandForMode(
  mode: RebuildMode,
  projectRoot: string = PROJECT_ROOT,
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = nodeRuntime().execPath,
) {
  // The bundle of scripts/native-load-probe.ts (native-load-probe-bundle.ts); Node and Electron
  // cannot load the TypeScript source.
  const probePath = nativeLoadProbeBundlePath(projectRoot, platform)
  return mode === 'node'
    ? {
        command: nodeExecutable,
        args: [probePath, mode, projectRoot],
        environment: suppressDependencyDeprecationWarnings(),
      }
    : {
        command: electronExecutablePath(projectRoot, platform),
        // Load the addon in Electron, but exercise a console executable inside
        // the PTY. Windows Electron is a GUI binary, even in RunAsNode mode.
        args: [probePath, mode, projectRoot, nodeExecutable],
        environment: suppressDependencyDeprecationWarnings({ ELECTRON_RUN_AS_NODE: '1' }),
      }
}

async function nativeLoadProbeSucceeds(mode: RebuildMode) {
  await ensureNativeProbeRuntime(mode)
  await buildNativeLoadProbe(PROJECT_ROOT)
  const probe = nativeLoadProbeCommandForMode(mode)
  return commandSucceeds(probe.command, probe.args, probe.environment)
}

async function assertNativeLoadProbe(mode: RebuildMode) {
  await ensureNativeProbeRuntime(mode)
  await buildNativeLoadProbe(PROJECT_ROOT)
  const probe = nativeLoadProbeCommandForMode(mode)
  await runCommand(probe.command, probe.args, probe.environment)
}

async function rebuildForNode() {
  for (const invocation of await nodeNativeRebuildInvocations(PROJECT_ROOT)) {
    console.log(
      `Rebuilding ${invocation.packageName} from source for Node: ${invocation.commandLine}`,
    )
    const shell = shellInvocationForPlatform(invocation.commandLine)
    await runCommand(shell.command, shell.args, invocation.environment, invocation.cwd)
  }
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
  const invocation = electronNativeRebuildInvocation()
  await runCommand(invocation.command, invocation.args, invocation.environment)
}

async function rebuildNativeDependencies(options: RebuildOptions) {
  const plan = await createNativeRebuildPlan(
    NATIVE_REBUILD_CACHE_PATHS,
    options.mode,
    nodeRuntime().version,
  )
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void rebuildNativeDependencies(parseRebuildOptions()).catch((error: unknown) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}

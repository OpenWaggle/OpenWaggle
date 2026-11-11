import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildNativeLoadProbe, nativeLoadProbeBundlePath } from './native-load-probe-bundle'
import {
  canUseNativeRebuildCache,
  createNativeRebuildCacheKey,
  createNativeRebuildPlan,
  isNativeRebuildForceEnabled,
  isNativeRebuildMarkerFresh,
  NATIVE_ARTIFACT_PACKAGES,
  parseNativeRebuildMarker,
  writeNativeRebuildMarker,
} from './native-rebuild-cache'
import {
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
  NATIVE_ARTIFACT_PACKAGES,
  parseNativeRebuildMarker,
}

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const PROJECT_ROOT = join(dirname(SCRIPT_PATH), '..')
const FLAG_START_INDEX = 2
const FORCE_REBUILD_FLAG = '--force'
const NATIVE_REBUILD_CACHE_PATHS = {
  projectRoot: PROJECT_ROOT,
  cacheDirectory: join(PROJECT_ROOT, 'node_modules', '.cache', 'openwaggle', 'native-rebuild'),
  patchesDirectory: join(PROJECT_ROOT, 'patches'),
  storeDirectory: join(PROJECT_ROOT, 'node_modules', '.bun'),
}

interface RebuildOptions {
  readonly force: boolean
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
  const flags = argv.slice(FLAG_START_INDEX)
  const unsupportedFlags = flags.filter((flag) => flag !== FORCE_REBUILD_FLAG)
  if (unsupportedFlags.length > 0) {
    throw new Error(
      `Unsupported native rebuild flags: ${unsupportedFlags.join(', ')}. Usage: bun scripts/rebuild-native-deps.ts [${FORCE_REBUILD_FLAG}]`,
    )
  }
  return { force: isNativeRebuildForceEnabled(flags, environment) }
}

export function nativeLoadProbeCommand(
  projectRoot: string = PROJECT_ROOT,
  platform: NodeJS.Platform = process.platform,
  nodeExecutable: string = nodeRuntime().execPath,
) {
  // The bundle of scripts/native-load-probe.ts (native-load-probe-bundle.ts); Node cannot load
  // the TypeScript source.
  return {
    command: nodeExecutable,
    args: [nativeLoadProbeBundlePath(projectRoot, platform), projectRoot],
    environment: suppressDependencyDeprecationWarnings(),
  }
}

async function nativeLoadProbeSucceeds() {
  await buildNativeLoadProbe(PROJECT_ROOT)
  const probe = nativeLoadProbeCommand()
  return commandSucceeds(probe.command, probe.args, probe.environment)
}

async function assertNativeLoadProbe() {
  await buildNativeLoadProbe(PROJECT_ROOT)
  const probe = nativeLoadProbeCommand()
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
}

/**
 * Builds the native modules for the Node.js ABI (the Node on PATH), which Bun, the app's only
 * runtime, loads too. A cache marker skips the build while the inputs and artifacts are unchanged.
 */
async function rebuildNativeDependencies(options: RebuildOptions) {
  const plan = await createNativeRebuildPlan(NATIVE_REBUILD_CACHE_PATHS, nodeRuntime().version)
  if (!options.force && (await canUseNativeRebuildCache(NATIVE_REBUILD_CACHE_PATHS, plan))) {
    if (await nativeLoadProbeSucceeds()) {
      console.log('Native dependencies cache hit.')
      return
    }
    console.log('Native dependencies cache stale; rebuilding.')
  }
  if (options.force) console.log('Native dependency cache bypass requested.')
  await rebuildForNode()
  await assertNativeLoadProbe()
  await writeNativeRebuildMarker(NATIVE_REBUILD_CACHE_PATHS, plan)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void rebuildNativeDependencies(parseRebuildOptions()).catch((error: unknown) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}

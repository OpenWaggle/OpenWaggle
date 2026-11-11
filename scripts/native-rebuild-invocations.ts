import { access, readFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import { findActivePackageRoots } from './native-rebuild-artifacts'
import { NATIVE_ARTIFACT_PACKAGES } from './native-rebuild-cache'
import { nodeRuntime } from './support/node-runtime'
import { scriptEnv } from './support/env'

/**
 * The commands `prepare:native:node` runs to build native modules. Bun has no `npm rebuild`, so
 * the build runs each package's own install step against the Node.js on PATH.
 */

const SUPPRESS_DEPENDENCY_DEPRECATIONS_OPTION = '--no-deprecation'
const WINDOWS_COMMAND_PROCESSOR = 'cmd.exe'

export interface CommandInvocation {
  readonly command: string
  readonly args: readonly string[]
}

/** One package's own install step, run from its directory the way `npm rebuild` runs it. */
export interface PackageRebuildInvocation {
  readonly packageName: string
  readonly cwd: string
  /** A command line for the platform shell: the package's `install` script or `node-gyp rebuild`. */
  readonly commandLine: string
  readonly environment: NodeJS.ProcessEnv
}

/** Destructured: Windows spells it `ComSpec`, and only process.env matches names case-insensitively. */
function windowsComSpec() {
  const { ComSpec: commandProcessor } = process.env
  return commandProcessor
}

/** A package script runs in the platform shell, as package managers run lifecycle scripts. */
export function shellInvocationForPlatform(
  commandLine: string,
  platform: NodeJS.Platform = process.platform,
  windowsCommandProcessor: string | undefined = windowsComSpec(),
) {
  const invocation: CommandInvocation =
    platform === 'win32'
      ? {
          command: windowsCommandProcessor ?? WINDOWS_COMMAND_PROCESSOR,
          args: ['/d', '/s', '/c', commandLine],
        }
      : { command: '/bin/sh', args: ['-c', commandLine] }
  return invocation
}

function appendWhitespaceDelimitedOption(existingOptions: string | undefined, option: string) {
  if (existingOptions === undefined || existingOptions.trim().length === 0) {
    return option
  }

  return existingOptions.split(/\s+/u).includes(option)
    ? existingOptions
    : `${existingOptions} ${option}`
}

export function suppressDependencyDeprecationWarnings(
  extraEnvironment: NodeJS.ProcessEnv = {},
  baseEnvironment: NodeJS.ProcessEnv = process.env,
) {
  return {
    ...extraEnvironment,
    NODE_OPTIONS: appendWhitespaceDelimitedOption(
      scriptEnv(extraEnvironment).NODE_OPTIONS ?? scriptEnv(baseEnvironment).NODE_OPTIONS,
      SUPPRESS_DEPENDENCY_DEPRECATIONS_OPTION,
    ),
  }
}

/**
 * What `npm rebuild` runs for a package: its `install` script, or `node-gyp rebuild` for a
 * package with a `binding.gyp` and no install script. Bun has no rebuild command.
 */
export function packageRebuildCommandLine(manifest: unknown, hasBindingGyp: boolean) {
  const scripts =
    typeof manifest === 'object' && manifest !== null && 'scripts' in manifest
      ? manifest.scripts
      : undefined
  const install =
    typeof scripts === 'object' && scripts !== null && 'install' in scripts
      ? scripts.install
      : undefined
  if (typeof install === 'string' && install.trim().length > 0) return install
  return hasBindingGyp ? 'node-gyp rebuild' : null
}

/**
 * The environment of a package's install step: forced source builds, and Node then the
 * project's `node_modules/.bin` (for node-gyp) first on `PATH`, so `node` in the script is the
 * Node.js whose ABI the build targets, not Bun.
 */
export function packageRebuildEnvironment(
  projectRoot: string,
  nodeExecutable: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const path = platform === 'win32' ? win32 : posix
  const pathKey = Object.keys(baseEnvironment).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
  const pathDelimiter = platform === 'win32' ? ';' : ':'
  const searchPath = [
    path.dirname(nodeExecutable),
    path.join(projectRoot, 'node_modules', '.bin'),
    baseEnvironment[pathKey],
  ]
    .filter((entry): entry is string => entry !== undefined && entry.length > 0)
    .join(pathDelimiter)
  return { ...nativeSourceBuildEnvironment(baseEnvironment), [pathKey]: searchPath }
}

export async function nodeNativeRebuildInvocations(
  projectRoot: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
  nodeExecutable: string = nodeRuntime().execPath,
) {
  const invocations: PackageRebuildInvocation[] = []
  const paths = { projectRoot, storeDirectory: join(projectRoot, 'node_modules', '.bun') }
  for (const packageName of NATIVE_ARTIFACT_PACKAGES) {
    const [packageRoot] = await findActivePackageRoots(paths, packageName)
    if (packageRoot === undefined) {
      throw new Error(`${packageName} is not installed; run bun install.`)
    }
    const manifest: unknown = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    const hasBindingGyp = await access(join(packageRoot, 'binding.gyp')).then(
      () => true,
      () => false,
    )
    const commandLine = packageRebuildCommandLine(manifest, hasBindingGyp)
    if (commandLine === null) {
      throw new Error(`${packageName} has no install script or binding.gyp to rebuild.`)
    }
    invocations.push({
      packageName,
      cwd: packageRoot,
      commandLine,
      environment: packageRebuildEnvironment(projectRoot, nodeExecutable, baseEnvironment),
    })
  }
  return invocations
}

function nativeSourceBuildEnvironment(baseEnvironment: NodeJS.ProcessEnv) {
  return suppressDependencyDeprecationWarnings(
    { npm_config_build_from_source: 'true' },
    baseEnvironment,
  )
}

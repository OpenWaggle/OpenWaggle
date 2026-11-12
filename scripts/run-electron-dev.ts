import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Starts the development app (`electron-vite dev`) or Electron itself the same way on every OS.
 * The scripts used `env -u ELECTRON_RUN_AS_NODE …`, which fails on Windows, where pnpm runs
 * scripts with cmd.exe and there is no `env`. ELECTRON_RUN_AS_NODE is removed because an agent
 * shell can inherit it, and it would make Electron run the app as plain Node.
 */

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RUN_AS_NODE_VARIABLE = 'ELECTRON_RUN_AS_NODE'
const FIRST_USER_ARGUMENT_INDEX = 2
// libuv cannot send SIGHUP to a child on Windows, where Node raises it when the console closes.
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] =
  process.platform === 'win32' ? ['SIGINT', 'SIGTERM'] : ['SIGINT', 'SIGTERM', 'SIGHUP']
const SIGNAL_EXIT_CODE = 1

export type ElectronDevTarget = 'vite' | 'electron'

interface Invocation {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: NodeJS.ProcessEnv
}

export function isElectronDevTarget(value: string | undefined): value is ElectronDevTarget {
  return value === 'vite' || value === 'electron'
}

/** Windows treats variable names without regard to case, so `Electron_Run_As_Node` counts too. */
export function withoutRunAsNode(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const matches = (key: string) =>
    platform === 'win32' ? key.toUpperCase() === RUN_AS_NODE_VARIABLE : key === RUN_AS_NODE_VARIABLE
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !matches(key)))
}

/** electron-vite's own entry script, run with this Node, so no `.cmd` shim has to be spawned. */
export function electronViteEntryPath(projectRoot: string = PROJECT_ROOT) {
  return path.join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
}

export function electronExecutablePath(projectRoot: string = PROJECT_ROOT) {
  // The `electron` package's main export is the path of the Electron binary it installed.
  const resolved: unknown = createRequire(path.join(projectRoot, 'package.json'))('electron')
  if (typeof resolved !== 'string') throw new Error('The electron package did not return a path.')
  return resolved
}

export function electronDevInvocation(
  target: ElectronDevTarget,
  args: readonly string[],
  options: {
    readonly environment?: NodeJS.ProcessEnv
    readonly platform?: NodeJS.Platform
    readonly projectRoot?: string
    readonly nodeExecutable?: string
    readonly electronExecutable?: (projectRoot: string) => string
  } = {},
): Invocation {
  const projectRoot = options.projectRoot ?? PROJECT_ROOT
  const environment = withoutRunAsNode(options.environment ?? process.env, options.platform)
  if (target === 'vite') {
    return {
      command: options.nodeExecutable ?? process.execPath,
      args: [electronViteEntryPath(projectRoot), 'dev', ...args],
      environment: { ...environment, ELECTRON_ENABLE_LOGGING: '1' },
    }
  }
  return {
    command: (options.electronExecutable ?? electronExecutablePath)(projectRoot),
    args: [projectRoot, ...args],
    environment,
  }
}

function run(target: ElectronDevTarget, args: readonly string[]) {
  const invocation = electronDevInvocation(target, args)
  const child = spawn(invocation.command, [...invocation.args], {
    env: invocation.environment,
    stdio: 'inherit',
  })
  // A terminal's Ctrl-C reaches the child too; a signal sent only to this process is passed on,
  // and this process waits for the child either way so the app is not left running.
  const forward = (signal: NodeJS.Signals) => {
    try {
      child.kill(signal)
    } catch (error) {
      console.error(`Could not pass ${signal} to the development app:`, error)
    }
  }
  for (const signal of FORWARDED_SIGNALS) process.on(signal, forward)
  child.once('error', (error) => {
    console.error(`Could not start ${invocation.command}:`, error.message)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    for (const forwarded of FORWARDED_SIGNALS) process.off(forwarded, forward)
    process.exitCode = code ?? (signal === 'SIGINT' ? 0 : SIGNAL_EXIT_CODE)
  })
}

const entryPath = process.argv[1]
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const [target, ...args] = process.argv.slice(FIRST_USER_ARGUMENT_INDEX)
  if (isElectronDevTarget(target)) {
    run(target, args)
  } else {
    console.error('Usage: run-electron-dev.ts <vite|electron> [arguments...]')
    process.exitCode = 1
  }
}

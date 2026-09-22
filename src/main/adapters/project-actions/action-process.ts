import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { basename, delimiter, isAbsolute, resolve } from 'node:path'
import type { ResolvedActionInvocation } from '@shared/types/action-definitions'
import { isEnoent } from '@shared/utils/node-error'
import { quotePowerShellArgument as quotePowerShell } from '@shared/utils/shell-argument'
import type { PreparedEnvironment } from '../../domain/prepared-environment'
import { getInteractiveTerminalEnv } from '../../env'
import {
  type OwnedTerminalProcessTree,
  shutdownDetachedTerminal,
} from '../terminal/terminal-detached-process-shutdown'
import { makePtyRunner } from '../terminal/terminal-pty-runner'
import { existingShells } from '../terminal/terminal-shell'

const ACTION_TERMINAL_COLS = 120
const ACTION_TERMINAL_ROWS = 30

export interface ActionProcess {
  readonly pid: number
  readonly closed: Promise<{ readonly exitCode: number | null }>
  readonly stop: () => Promise<void>
}

export interface ActionProcessLaunch {
  readonly invocation: ResolvedActionInvocation
  readonly environment: PreparedEnvironment
  readonly onOutput: (chunk: string) => void
}

export interface ActionProcessRunner {
  readonly validate: (
    invocation: ResolvedActionInvocation,
    environment: PreparedEnvironment,
  ) => Promise<void>
  readonly start: (input: ActionProcessLaunch) => Promise<ActionProcess>
}

function environmentValue(environment: Readonly<Record<string, string>>, key: string) {
  return Object.entries(environment).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1]
}

function unavailableExecutable(error: unknown) {
  return (
    isEnoent(error) ||
    (error instanceof Error &&
      'code' in error &&
      (error.code === 'EACCES' || error.code === 'ENOTDIR'))
  )
}

async function executablePath(
  command: string,
  environment: Readonly<Record<string, string>>,
  cwd: string,
) {
  const extensions =
    process.platform === 'win32'
      ? (environmentValue(environment, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';')
      : ['']
  const explicitPath =
    isAbsolute(command) ||
    command.includes('/') ||
    (process.platform === 'win32' && command.includes('\\'))
  const directories = explicitPath
    ? ['']
    : (environmentValue(environment, 'PATH')?.split(delimiter) ?? [])
  for (const directory of directories) {
    for (const extension of ['', ...extensions]) {
      // Empty PATH entries also name cwd. Resolve before probing or handing the path to the PTY.
      const path = resolve(cwd, directory, `${command}${extension}`)
      try {
        await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        if ((await stat(path)).isFile()) return path
      } catch (error) {
        if (!unavailableExecutable(error)) throw error
      }
    }
  }
  throw new Error(
    `Runner unavailable: ${command} was not found on PATH. Install it or choose another action.`,
  )
}

export async function resolveActionShell(environment: Readonly<Record<string, string>>, cwd = '.') {
  for (const candidate of existingShells({ environment })) {
    try {
      return await executablePath(candidate.command, environment, cwd)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Runner unavailable:')) continue
      throw error
    }
  }
  throw new Error('No supported shell is available for this action.')
}

async function processCommand(
  invocation: ResolvedActionInvocation,
  environment: Readonly<Record<string, string>>,
) {
  if (invocation.type === 'executable') {
    const command = await executablePath(invocation.executable, environment, invocation.cwd)
    if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command))
      return { command, args: invocation.args }
    // PowerShell literals preserve arguments, including %, &, and spaces, for Windows script shims.
    const shell = await executablePath('powershell.exe', environment, invocation.cwd)
    return {
      command: shell,
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `& ${[command, ...invocation.args].map(quotePowerShell).join(' ')}; exit $LASTEXITCODE`,
      ],
    }
  }
  const command = await resolveActionShell(environment, invocation.cwd)
  const name = basename(command).toLowerCase()
  if (name === 'cmd.exe') return { command, args: ['/d', '/s', '/c', invocation.command] }
  if (name.includes('powershell') || name === 'pwsh' || name === 'pwsh.exe')
    return {
      command,
      args: [
        '-NoLogo',
        '-NonInteractive',
        '-Command',
        `${invocation.command}\nif (-not $?) { exit 1 }; exit $LASTEXITCODE`,
      ],
    }
  return { command, args: ['-c', invocation.command] }
}

export function createActionProcessRunner(appVersion: string): ActionProcessRunner {
  const ptyRunner = makePtyRunner({ appVersion })
  return {
    validate: async (invocation, overrides) => {
      if (!(await stat(invocation.cwd)).isDirectory())
        throw new Error('The action working directory no longer exists.')
      await processCommand(invocation, getInteractiveTerminalEnv(appVersion, overrides))
    },
    start: async ({ invocation, environment, onOutput }) => {
      const execution = await processCommand(
        invocation,
        getInteractiveTerminalEnv(appVersion, environment),
      )
      const outcome = await ptyRunner.spawn({
        cwd: invocation.cwd,
        env: environment,
        cols: ACTION_TERMINAL_COLS,
        rows: ACTION_TERMINAL_ROWS,
        readinessNonce: 'action',
        execution,
      })
      if (!outcome.ok) throw outcome.error
      const owned: OwnedTerminalProcessTree = {
        live: { ...outcome, outputPaused: true },
        processPids: [outcome.pid],
        processIdentities: outcome.processIdentity ? [outcome.processIdentity] : [],
      }
      const listener = outcome.pty.onData(onOutput)
      let stopPromise: Promise<void> | null = null
      const stop = () => {
        stopPromise ??= shutdownDetachedTerminal(owned).then((stopped) => {
          if (!stopped) {
            stopPromise = null
            throw new Error(
              'The action process tree has not confirmed termination. Retry Stop before starting a replacement.',
            )
          }
        })
        return stopPromise
      }
      const closed = outcome.exit.whenExited.then(async () => {
        if (!(await outcome.resourceDrain.whenDrained))
          throw new Error('The action PTY did not release its native resources.')
        listener.dispose()
        return { exitCode: outcome.exit.exitCode }
      })
      outcome.resumeOutput()
      owned.live.outputPaused = false
      return { pid: outcome.pid, closed, stop }
    },
  }
}

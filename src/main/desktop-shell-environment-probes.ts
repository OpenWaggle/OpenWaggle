import { type ChildProcess, spawn } from 'node:child_process'
import { basename } from 'node:path'
import { createLogger } from './logger'

export type ShellEnvironmentPatch = Record<string, string>

export interface ShellEnvironmentCommand {
  readonly probe: 'launchctl-path' | 'login-shell' | 'powershell-no-profile' | 'powershell-profile'
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}

export type ShellEnvironmentCommandRunner = (input: ShellEnvironmentCommand) => Promise<string>

export const LOGIN_SHELL_ENV_NAMES = [
  'PATH',
  'DBUS_SESSION_BUS_ADDRESS',
  'DISPLAY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSH_AUTH_SOCK',
  'HOMEBREW_PREFIX',
  'HOMEBREW_CELLAR',
  'HOMEBREW_REPOSITORY',
  'XDG_CONFIG_HOME',
  'XDG_CURRENT_DESKTOP',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_DESKTOP',
  'XDG_SESSION_TYPE',
  'WAYLAND_DISPLAY',
] as const

const WINDOWS_PROFILE_ENV_NAMES = ['PATH', 'FNM_DIR', 'FNM_MULTISHELL_PATH'] as const
const WINDOWS_SHELL_CANDIDATES = ['pwsh.exe', 'powershell.exe'] as const
const LOGIN_SHELL_TIMEOUT_MS = 5_000
const LAUNCHCTL_TIMEOUT_MS = 2_000
const WINDOWS_TREE_KILL_TIMEOUT_MS = 1_000
const MAX_CAPTURE_BYTES = 1024 * 1024
const logger = createLogger('desktop-shell-environment')

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function killDirectChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    child.kill('SIGKILL')
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') {
      logger.warn('Desktop shell environment probe process kill failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}

function killWindowsProcessTree(child: ChildProcess) {
  const pid = child.pid
  // taskkill identifies the tree through the root PID. Once that PID has exited,
  // reusing it could target an unrelated process, so only invoke taskkill while
  // Node still observes the original root as live.
  if (!pid || child.exitCode !== null || child.signalCode !== null) return

  try {
    const treeKill = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    const timeout = setTimeout(() => killDirectChild(treeKill), WINDOWS_TREE_KILL_TIMEOUT_MS)
    timeout.unref?.()
    const clearTreeKillTimeout = () => clearTimeout(timeout)
    treeKill.once('error', (error) => {
      clearTreeKillTimeout()
      logger.warn('Desktop shell environment probe tree kill failed', {
        error: error.message,
      })
      killDirectChild(child)
    })
    treeKill.once('close', (code) => {
      clearTreeKillTimeout()
      if (code !== 0) killDirectChild(child)
    })
    treeKill.unref()
  } catch (error) {
    logger.warn('Desktop shell environment probe tree kill failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    killDirectChild(child)
  }
}

function killPosixProcessGroup(child: ChildProcess) {
  const pid = child.pid
  if (!pid) {
    killDirectChild(child)
    return
  }

  try {
    // POSIX probes are detached process-group leaders. The group remains
    // addressable when the shell exits but a descendant retains stdout.
    process.kill(-pid, 'SIGKILL')
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return
    logger.warn('Desktop shell environment probe process-group kill failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    killDirectChild(child)
  }
}

function killProbeProcessTree(child: ChildProcess) {
  if (process.platform === 'win32') killWindowsProcessTree(child)
  else killPosixProcessGroup(child)
}

function startMarker(name: string) {
  return `__OPENWAGGLE_ENV_${name}_START__`
}

function endMarker(name: string) {
  return `__OPENWAGGLE_ENV_${name}_END__`
}

function capturePosixEnvironmentCommand(names: readonly string[], shell: string) {
  // Keep the login-shell command short. Some macOS shell launch environments
  // terminate long -c arguments before startup files or the command can run.
  const fish = basename(shell) === 'fish'
  return [
    `for openwaggle_env_name in ${names.join(' ')}`,
    ...(fish ? [] : ['do']),
    `printf '__OPENWAGGLE_ENV_%s_START__\\n' "$openwaggle_env_name"`,
    'printenv "$openwaggle_env_name" || true',
    `printf '__OPENWAGGLE_ENV_%s_END__\\n' "$openwaggle_env_name"`,
    fish ? 'end' : 'done',
  ].join('\n')
}

function captureWindowsEnvironmentCommand(names: readonly string[]) {
  return [
    "$ErrorActionPreference = 'Stop'",
    ...names.flatMap((name) => [
      `Write-Output '${startMarker(name)}'`,
      `$value = [Environment]::GetEnvironmentVariable('${name}')`,
      'if ($null -ne $value -and $value.Length -gt 0) { Write-Output $value }',
      `Write-Output '${endMarker(name)}'`,
    ]),
  ].join('; ')
}

export function extractShellEnvironment(
  output: string,
  names: readonly string[],
): ShellEnvironmentPatch {
  const environment: ShellEnvironmentPatch = {}
  for (const name of names) {
    const marker = startMarker(name)
    const start = output.indexOf(marker)
    if (start === -1) continue
    const valueStart = start + marker.length
    const end = output.indexOf(endMarker(name), valueStart)
    if (end === -1) continue
    const value = output
      .slice(valueStart, end)
      .replace(/^\r?\n/u, '')
      .replace(/\r?\n$/u, '')
    if (value.length > 0) environment[name] = value
  }
  return environment
}

export function runBoundedShellEnvironmentCommand(input: ShellEnvironmentCommand): Promise<string> {
  return new Promise((resolve) => {
    let output = ''
    let outputBytes = 0
    let failed = false
    let settled = false
    const child = spawn(input.command, [...input.args], {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    const finish = (value: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(value)
    }
    const fail = (reason: string) => {
      if (failed) return
      failed = true
      logger.warn('Desktop shell environment probe failed', {
        probe: input.probe,
        executable: basename(input.command),
        reason,
      })
    }
    const abort = (reason: string) => {
      fail(reason)
      child.stdout.destroy()
      killProbeProcessTree(child)
      child.unref()
      finish('')
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      outputBytes += Buffer.byteLength(chunk)
      if (outputBytes > MAX_CAPTURE_BYTES) {
        abort('output-limit')
        return
      }
      output += chunk
    })
    child.once('error', (error) => {
      fail(error.message)
      finish('')
    })
    child.once('close', (code) => {
      if (code !== 0) fail(`exit-${code ?? 'signal'}`)
      finish(failed ? '' : output)
    })
    const timeout = setTimeout(() => {
      abort('timeout')
    }, input.timeoutMs)
    timeout.unref?.()
  })
}

async function safeRun(
  runner: ShellEnvironmentCommandRunner,
  input: ShellEnvironmentCommand,
): Promise<string> {
  try {
    return await runner(input)
  } catch (error) {
    logger.warn('Desktop shell environment probe rejected', {
      probe: input.probe,
      executable: basename(input.command),
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

export async function readLoginShellEnvironment(
  shell: string,
  runner: ShellEnvironmentCommandRunner,
): Promise<ShellEnvironmentPatch> {
  const output = await safeRun(runner, {
    probe: 'login-shell',
    command: shell,
    args: ['-ilc', capturePosixEnvironmentCommand(LOGIN_SHELL_ENV_NAMES, shell)],
    timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
  })
  return extractShellEnvironment(output, LOGIN_SHELL_ENV_NAMES)
}

export async function readLaunchctlPath(
  runner: ShellEnvironmentCommandRunner,
): Promise<string | undefined> {
  const output = await safeRun(runner, {
    probe: 'launchctl-path',
    command: '/bin/launchctl',
    args: ['getenv', 'PATH'],
    timeoutMs: LAUNCHCTL_TIMEOUT_MS,
  })
  return output.trim() || undefined
}

export async function readWindowsShellEnvironment(
  runner: ShellEnvironmentCommandRunner,
  loadProfile: boolean,
): Promise<ShellEnvironmentPatch> {
  const args = [
    '-NoLogo',
    ...(loadProfile ? [] : ['-NoProfile']),
    '-NonInteractive',
    '-Command',
    captureWindowsEnvironmentCommand(loadProfile ? WINDOWS_PROFILE_ENV_NAMES : ['PATH']),
  ]
  for (const command of WINDOWS_SHELL_CANDIDATES) {
    const output = await safeRun(runner, {
      probe: loadProfile ? 'powershell-profile' : 'powershell-no-profile',
      command,
      args,
      timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
    })
    const environment = extractShellEnvironment(
      output,
      loadProfile ? WINDOWS_PROFILE_ENV_NAMES : ['PATH'],
    )
    if (Object.keys(environment).length > 0) return environment
  }
  return {}
}

/**
 * The user's login-shell environment, for MCP `${NAME}` values and MCP server processes only
 * (ADR 0050, Pi MCP parity). A Pi user's `${GITHUB_TOKEN}` resolves from the terminal Pi runs in;
 * an app opened from the Dock or Start menu has none of those variables, so OpenWaggle reads the
 * whole environment of the user's login shell once, the same bounded way it reads `PATH` for the
 * desktop (`desktop-shell-environment-probes.ts`). It never widens the environment other child
 * processes get.
 */
import { userInfo } from 'node:os'
import {
  runBoundedShellEnvironmentCommand,
  type ShellEnvironmentCommandRunner,
} from './desktop-shell-environment-probes'
import { getEnvWithOverrides } from './env'

const START = '__OPENWAGGLE_ENV_ALL_START__'
const END = '__OPENWAGGLE_ENV_ALL_END__'
const SHELL_TIMEOUT_MS = 5_000
const WINDOWS_SHELLS = ['pwsh.exe', 'powershell.exe'] as const

export interface McpShellEnvironmentOptions {
  readonly platform?: NodeJS.Platform
  /** Login shells to try, first that answers wins. Default: `$SHELL`, the user's shell, a fallback. */
  readonly shells?: readonly string[]
  readonly runner?: ShellEnvironmentCommandRunner
}

let captured: Readonly<Record<string, string>> = {}
let loading: Promise<Readonly<Record<string, string>>> | undefined

function posixCommand() {
  // `env -0` keeps values with newlines intact; startup files may print around the markers.
  return [`printf '${START}\\n'`, 'env -0', `printf '\\n${END}\\n'`].join('; ')
}

function windowsCommand() {
  return [
    `Write-Output '${START}'`,
    '[Environment]::GetEnvironmentVariables().GetEnumerator() | ForEach-Object { [Console]::Out.Write("$($_.Key)=$($_.Value)" + [char]0) }',
    `Write-Output ''`,
    `Write-Output '${END}'`,
  ].join('; ')
}

/** `NAME=value` records separated by NUL, between the markers. */
export function parseMcpShellEnvironment(output: string): Record<string, string> {
  const start = output.indexOf(START)
  const end = output.indexOf(END, start + START.length)
  if (start === -1 || end === -1) return {}
  const environment: Record<string, string> = {}
  for (const record of output.slice(start + START.length, end).split('\0')) {
    const trimmed = record.replace(/^\r?\n/u, '')
    const equals = trimmed.indexOf('=')
    if (equals <= 0) continue
    const name = trimmed.slice(0, equals)
    if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) environment[name] = trimmed.slice(equals + 1)
  }
  return environment
}

function defaultShells(platform: NodeJS.Platform) {
  if (platform === 'win32') return [...WINDOWS_SHELLS]
  const fallback = platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  let userShell: string | undefined
  try {
    userShell = userInfo().shell ?? undefined
  } catch {
    userShell = undefined
  }
  return [...new Set([getEnvWithOverrides({}).SHELL, userShell, fallback])].filter(
    (shell): shell is string => typeof shell === 'string' && shell.trim().length > 0,
  )
}

async function capture(options: McpShellEnvironmentOptions) {
  const platform = options.platform ?? process.platform
  const runner = options.runner ?? runBoundedShellEnvironmentCommand
  for (const shell of options.shells ?? defaultShells(platform)) {
    const windows = platform === 'win32'
    const output = await runner({
      probe: windows ? 'powershell-full' : 'login-shell-full',
      command: shell,
      args: windows
        ? ['-NoLogo', '-NonInteractive', '-Command', windowsCommand()]
        : ['-ilc', posixCommand()],
      timeoutMs: SHELL_TIMEOUT_MS,
    }).catch(() => '')
    const environment = parseMcpShellEnvironment(output)
    if (Object.keys(environment).length > 0) return environment
  }
  return {}
}

/** Reads the login-shell environment once per process; later calls share the first read. */
export function loadMcpShellEnvironment(options: McpShellEnvironmentOptions = {}) {
  loading ??= capture(options).then((environment) => {
    captured = environment
    return environment
  })
  return loading
}

/**
 * Waits for the read the Host started, if any; never starts one (tests and the CLI's own process
 * use the app's environment only).
 */
export function mcpShellEnvironmentReady() {
  return loading ?? Promise.resolve(captured)
}

/** What the read found so far: empty until `loadMcpShellEnvironment` has finished. */
export function currentMcpShellEnvironment(): Readonly<Record<string, string>> {
  return captured
}

/**
 * The environment MCP values resolve against and MCP server processes start with: the login
 * shell's variables, with the app's own environment winning where both have one.
 */
export function mcpValueEnvironment(): Record<string, string> {
  const environment: Record<string, string> = { ...captured }
  for (const [name, value] of Object.entries(getEnvWithOverrides({}))) {
    if (value !== undefined) environment[name] = value
  }
  return environment
}

export function resetMcpShellEnvironmentForTests() {
  captured = {}
  loading = undefined
}

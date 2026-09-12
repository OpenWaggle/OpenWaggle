import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TerminalShellCandidate {
  readonly command: string
  readonly args: readonly string[]
  readonly label: string
}

export interface TerminalShellResolutionOptions {
  readonly environment: Readonly<Record<string, string>>
  readonly platform?: NodeJS.Platform
  /** `null` deliberately omits the account shell; `undefined` reads it from the OS. */
  readonly accountShell?: string | null
}

/**
 * Shell resolution with a fresh fallback chain (ADR 0030): the current SHELL,
 * the OS account shell, then platform defaults. Known shells get explicit
 * login and interactive flags; unknown shells get no speculative arguments.
 */
export function posixShellCandidates(
  environment: Readonly<Record<string, string>>,
  options: Pick<TerminalShellResolutionOptions, 'accountShell' | 'platform'> = {},
): readonly TerminalShellCandidate[] {
  const platform = options.platform ?? os.platform()
  const accountShell =
    options.accountShell === undefined ? readAccountShell() : (options.accountShell ?? undefined)
  const defaults =
    platform === 'darwin'
      ? ['/bin/zsh', '/bin/bash', '/bin/sh', 'zsh', 'bash', 'sh']
      : ['/bin/bash', '/bin/zsh', '/bin/sh', 'bash', 'zsh', 'sh']
  return uniqueCandidates(
    [readEnvironmentValue(environment, 'SHELL'), accountShell, ...defaults],
    platform,
  )
}

export function windowsShellCandidates(
  environment: Readonly<Record<string, string>>,
): readonly TerminalShellCandidate[] {
  const programFiles = [
    readEnvironmentValue(environment, 'ProgramW6432'),
    readEnvironmentValue(environment, 'ProgramFiles'),
    'C:\\Program Files',
  ]
  const systemRoot =
    readEnvironmentValue(environment, 'SystemRoot') ??
    readEnvironmentValue(environment, 'windir') ??
    'C:\\Windows'
  const commandProcessor = readEnvironmentValue(environment, 'ComSpec')
  const candidates = [
    'pwsh.exe',
    ...programFiles.map((root) =>
      root === undefined ? undefined : path.win32.join(root, 'PowerShell', '7', 'pwsh.exe'),
    ),
    'powershell.exe',
    path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    commandProcessor,
    'cmd.exe',
    path.win32.join(systemRoot, 'System32', 'cmd.exe'),
  ]
  return uniqueCandidates(candidates, 'win32')
}

export function shellCandidates(
  options: TerminalShellResolutionOptions,
): readonly TerminalShellCandidate[] {
  const platform = options.platform ?? os.platform()
  return platform === 'win32'
    ? windowsShellCandidates(options.environment)
    : posixShellCandidates(options.environment, {
        platform,
        accountShell: options.accountShell,
      })
}

/**
 * Resolve candidates immediately before spawn. Absolute paths must exist;
 * PATH-resolved names stay eligible because statting a bare command checks the
 * working directory rather than PATH (the previous Windows failure mode).
 */
export function existingShells(
  options: TerminalShellResolutionOptions,
): readonly TerminalShellCandidate[] {
  const platform = options.platform ?? os.platform()
  return shellCandidates({ ...options, platform }).filter((candidate) => {
    if (!isAbsolutePath(candidate.command, platform)) return true
    try {
      return fs.statSync(candidate.command).isFile()
    } catch (error) {
      if (isMissingPathError(error)) return false
      throw error
    }
  })
}

/** Absolute, existing-directory validation for a terminal Working path. */
export function validateTerminalCwd(cwd: string): string | null {
  const candidate = cwd.trim()
  if (candidate.length === 0 || !path.isAbsolute(candidate)) return null
  try {
    if (!fs.statSync(candidate).isDirectory()) return null
  } catch {
    return null
  }
  return candidate
}

function uniqueCandidates(commands: readonly (string | undefined)[], platform: NodeJS.Platform) {
  const seen = new Set<string>()
  const candidates: TerminalShellCandidate[] = []
  for (const value of commands) {
    const command = value?.trim()
    if (!command) continue
    const key = platform === 'win32' ? command.toLowerCase() : command
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({
      command,
      args: shellStartupArgs(command, platform),
      label: shellExecutableName(command),
    })
  }
  return candidates
}

function shellStartupArgs(command: string, platform: NodeJS.Platform): readonly string[] {
  const executable = shellExecutableName(command).toLowerCase()
  if (platform === 'win32') {
    if (executable === 'pwsh.exe' || executable === 'powershell.exe') return ['-NoLogo']
    return []
  }

  if (executable === 'pwsh' || executable === 'powershell') return ['-Login', '-NoLogo']
  if (executable === 'bash') return ['--login', '-i']
  if (executable === 'fish') return ['--login', '--interactive']
  if (executable === 'csh' || executable === 'tcsh') return ['-l']
  if (
    executable === 'sh' ||
    executable === 'dash' ||
    executable === 'ksh' ||
    executable === 'mksh'
  ) {
    return ['-l', '-i']
  }
  if (executable === 'zsh') return ['-l', '-i', '-o', 'nopromptsp']
  return []
}

function shellExecutableName(command: string) {
  const normalized = command.replaceAll('\\', '/')
  return normalized.split('/').pop() ?? command
}

function readAccountShell() {
  try {
    const shell = os.userInfo().shell?.trim()
    return shell && shell.length > 0 ? shell : undefined
  } catch {
    return undefined
  }
}

function readEnvironmentValue(environment: Readonly<Record<string, string>>, name: string) {
  const normalizedName = name.toUpperCase()
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === normalizedName) return value
  }
  return undefined
}

function isAbsolutePath(candidate: string, platform: NodeJS.Platform) {
  return platform === 'win32' ? path.win32.isAbsolute(candidate) : path.posix.isAbsolute(candidate)
}

function isMissingPathError(error: unknown) {
  if (error === null || typeof error !== 'object') return false
  const code: unknown = Reflect.get(error, 'code')
  return code === 'ENOENT' || code === 'ENOTDIR'
}

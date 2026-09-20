import { spawn } from 'node:child_process'
import { getWindowsSecurityChildEnv } from '../env'
import { WINDOWS_PIPE_SECURITY_SOURCE } from './windows-pipe-security-source'

const WINDOWS_SECURITY_TIMEOUT_MS = 20_000
const MAX_HELPER_OUTPUT_BYTES = 64 * 1024
const TIMEOUT_STDERR_TAIL_LENGTH = 4_096
const WINDOWS_SID_PATTERN = /^S-1-(?:\d+-)+\d+$/

export type WindowsUserOnlySecurityTarget =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'pipe'; readonly path: string }

export type WindowsUserOnlySecurity = (
  targets: readonly WindowsUserOnlySecurityTarget[],
) => Promise<{ readonly userSid: string }>

export class WindowsUserOnlySecurityTimeoutError extends Error {
  constructor(
    readonly stage: string,
    readonly exitCode: number | null,
    readonly signalCode: NodeJS.Signals | null,
    stderr: string,
  ) {
    super(
      `Timed out applying Windows user-only security. Last stage: ${stage}. ` +
        `Exit code: ${String(exitCode)}; signal: ${String(signalCode)}. ` +
        `Stderr tail: ${JSON.stringify(stderr.slice(-TIMEOUT_STDERR_TAIL_LENGTH))}`,
    )
    this.name = 'WindowsUserOnlySecurityTimeoutError'
  }
}

const WINDOWS_SECURITY_SCRIPT = `
$ErrorActionPreference = 'Stop'

$source = @'
${WINDOWS_PIPE_SECURITY_SOURCE}
'@

function Write-SecurityStage([string]$stage) {
  [Console]::Error.WriteLine('OW_SECURITY_STAGE:' + $stage)
  [Console]::Error.Flush()
}
Write-SecurityStage 'resolve-compiler-command'
$compiler = Get-Command -Name 'Microsoft.PowerShell.Utility\\Add-Type' -CommandType Cmdlet
Write-SecurityStage 'compile'
& $compiler -TypeDefinition $source -Language CSharp
Write-SecurityStage 'read-input'
$targets = [Console]::In.ReadToEnd() | ConvertFrom-Json
Write-SecurityStage 'identity'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$owner = $identity.User

foreach ($target in $targets) {
  if ($target.kind -eq 'pipe') {
    [void][OpenWagglePipeSecurity]::ProtectAndVerify([string]$target.path)
    continue
  }
  if ($target.kind -eq 'directory') {
    Write-SecurityStage 'directory-set'
    $security = New-Object System.Security.AccessControl.DirectorySecurity
    $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
  } elseif ($target.kind -eq 'file') {
    Write-SecurityStage 'file-set'
    $security = New-Object System.Security.AccessControl.FileSecurity
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  } else {
    throw 'Unsupported user-only security target.'
  }
  $security.SetOwner($owner)
  $security.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $owner,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow)
  [void]$security.AddAccessRule($rule)
  if ($target.kind -eq 'directory') {
    [System.IO.Directory]::SetAccessControl([string]$target.path, $security)
    $verified = [System.IO.Directory]::GetAccessControl([string]$target.path)
  } else {
    [System.IO.File]::SetAccessControl([string]$target.path, $security)
    $verified = [System.IO.File]::GetAccessControl([string]$target.path)
  }
  $rules = @($verified.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]))
  if (!$verified.AreAccessRulesProtected -or $rules.Count -ne 1 -or
      !$rules[0].IdentityReference.Equals($owner) -or
      $rules[0].AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      (($rules[0].FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne
       [System.Security.AccessControl.FileSystemRights]::FullControl)) {
    throw 'Filesystem user-only DACL verification failed.'
  }
}

Write-SecurityStage 'complete'
[Console]::Out.Write($owner.Value)
`

function encodedPowerShellCommand() {
  return Buffer.from(WINDOWS_SECURITY_SCRIPT, 'utf16le').toString('base64')
}

function appendBounded(output: string, chunk: Buffer) {
  if (Buffer.byteLength(output, 'utf8') + chunk.byteLength > MAX_HELPER_OUTPUT_BYTES) {
    throw new Error('The Windows user-only security helper exceeded its output limit.')
  }
  return output + chunk.toString('utf8')
}

function lastSecurityStage(stderr: string) {
  const stages = stderr.matchAll(/OW_SECURITY_STAGE:(?<stage>[a-z-]+)/g)
  const { stage = 'startup' } = [...stages].at(-1)?.groups ?? {}
  return stage
}

export const secureWindowsUserOnly: WindowsUserOnlySecurity = (targets) =>
  new Promise((resolve, reject) => {
    if (targets.length === 0) {
      reject(new Error('At least one Windows user-only security target is required.'))
      return
    }
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-EncodedCommand',
        encodedPowerShellCommand(),
      ],
      {
        env: getWindowsSecurityChildEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    let stdout = ''
    let stderr = ''
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(
        new WindowsUserOnlySecurityTimeoutError(
          lastSecurityStage(stderr),
          child.exitCode,
          child.signalCode,
          stderr,
        ),
      )
    }, WINDOWS_SECURITY_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        stdout = appendBounded(stdout, chunk)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      try {
        stderr = appendBounded(stderr, chunk)
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stdin.once('error', (error) => fail(error))
    child.once('error', (error) => fail(error))
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const userSid = stdout.trim()
      if (code !== 0 || !WINDOWS_SID_PATTERN.test(userSid)) {
        reject(
          new Error(
            `Windows user-only security verification failed${stderr.trim() ? `: ${stderr.trim()}` : '.'}`,
          ),
        )
        return
      }
      resolve({ userSid })
    })
    child.stdin.end(JSON.stringify(targets))
  })

export const windowsUserOnlySecurityCommandForTests = () => ({
  command: 'powershell.exe',
  arguments: [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodedPowerShellCommand(),
  ],
})

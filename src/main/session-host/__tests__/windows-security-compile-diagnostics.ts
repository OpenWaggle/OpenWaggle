import { spawn } from 'node:child_process'
import { stopProcessTree } from '../../../../scripts/qa/child-process-lifecycle'
import { getWindowsSecurityChildEnv } from '../../env'
import { WINDOWS_PIPE_SECURITY_SOURCE } from '../windows-pipe-security-source'
import { WindowsUserOnlySecurityTimeoutError } from '../windows-user-only-security'

const COMPILE_PROBE_TIMEOUT_MS = 5_000
const PROBE_OUTPUT_LIMIT = 4_096

export function windowsCompileProbeScript(source: string) {
  return `
$ErrorActionPreference = 'Stop'
$source = @'
${source}
'@
[Console]::Error.WriteLine('OW_SECURITY_STAGE:resolve-compiler-command')
[Console]::Error.Flush()
$compiler = Get-Command -Name 'Microsoft.PowerShell.Utility\\Add-Type' -CommandType Cmdlet
[Console]::Error.WriteLine('OW_SECURITY_STAGE:compile')
[Console]::Error.Flush()
& $compiler -TypeDefinition $source -Language CSharp
[Console]::Error.WriteLine('OW_SECURITY_STAGE:complete')
[Console]::Error.Flush()
[Console]::Out.Write('compiled')
`
}

async function runCompileProbe(name: string, source: string) {
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(windowsCompileProbeScript(source), 'utf16le').toString('base64'),
    ],
    {
      env: getWindowsSecurityChildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let stdout = ''
  let stderr = ''
  let timedOut = false
  const startedAt = performance.now()
  let cleanup: Promise<void> | undefined
  let cleanupError: string | undefined
  const result = await new Promise<{ readonly failure?: string }>((resolve) => {
    let settled = false
    const finish = (failure?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(failure === undefined ? {} : { failure })
    }
    const fail = (message: string) => {
      if (settled) return
      // Stop only this probe's child tree, using the existing Windows PID/creation-time checks.
      cleanup = stopProcessTree(child).catch((error: unknown) => {
        child.kill()
        cleanupError = String(error).slice(0, PROBE_OUTPUT_LIMIT)
      })
      finish(message)
    }
    const timer = setTimeout(() => {
      timedOut = true
      fail('compile probe timed out')
    }, COMPILE_PROBE_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString('utf8')}`.slice(-PROBE_OUTPUT_LIMIT)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-PROBE_OUTPUT_LIMIT)
    })
    child.stdin.once('error', (error) => fail(error.message.slice(0, PROBE_OUTPUT_LIMIT)))
    child.once('error', (error) => fail(error.message.slice(0, PROBE_OUTPUT_LIMIT)))
    child.once('close', () => finish())
    child.stdin.end('[]')
  })
  await cleanup
  return {
    name,
    elapsedMs: Math.round(performance.now() - startedAt),
    timedOut,
    exitCode: child.exitCode,
    signalCode: child.signalCode,
    stdout,
    stderr,
    ...result,
    ...(cleanupError === undefined ? {} : { cleanupError }),
  }
}

async function collectCompileDiagnostics() {
  return Promise.all([
    runCompileProbe('tiny-csharp', 'public static class OpenWaggleCompileProbe { }'),
    runCompileProbe('pipe-helper-csharp', WINDOWS_PIPE_SECURITY_SOURCE),
  ])
}

export async function withWindowsCompileDiagnostics<T>(
  operation: () => Promise<T>,
  collect: () => Promise<unknown> = collectCompileDiagnostics,
) {
  try {
    return await operation()
  } catch (error) {
    if (
      error instanceof WindowsUserOnlySecurityTimeoutError &&
      (error.stage === 'compile' || error.stage === 'resolve-compiler-command')
    ) {
      console.error('[windows-security] original security timeout', error.message)
      try {
        console.error('[windows-security] compile-only diagnostics', await collect())
      } catch (diagnosticError) {
        console.error(
          '[windows-security] compile diagnostics failed',
          String(diagnosticError).slice(0, PROBE_OUTPUT_LIMIT),
        )
      }
    }
    throw error
  }
}

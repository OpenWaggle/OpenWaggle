import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { BROWSER_IMPORT_LIMITS } from '@shared/types/browser-import'
import { getBrowserCredentialChildEnv } from '../env'
import { BrowserImportError, browserImportError } from './browser-import-errors'

export interface CredentialHelperResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface CredentialHelperOptions {
  readonly timeoutMs?: number
}

const CREDENTIAL_HELPER_FORCE_KILL_MS = 1_000

function collectBounded(chunks: Buffer[], chunk: Buffer, total: number) {
  const next = total + chunk.byteLength
  if (next > BROWSER_IMPORT_LIMITS.CREDENTIAL_OUTPUT_BYTES) {
    throw new BrowserImportError(
      'resource-limit',
      'The browser credential helper returned too much data.',
    )
  }
  chunks.push(chunk)
  return next
}

export function runCredentialHelper(
  command: string,
  args: readonly string[],
  input?: string,
  options: CredentialHelperOptions = {},
): Promise<CredentialHelperResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(command, [...args], {
        env: getBrowserCredentialChildEnv(),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (cause) {
      reject(browserImportError(cause, 'keychain-unavailable', 'The OS credential helper failed.'))
      return
    }
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    const timeoutMs = options.timeoutMs ?? BROWSER_IMPORT_LIMITS.CREDENTIAL_HELPER_TIMEOUT_MS
    const terminate = () => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, CREDENTIAL_HELPER_FORCE_KILL_MS)
      forceKillTimer.unref()
    }
    const fail = (cause: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      terminate()
      reject(browserImportError(cause, 'keychain-unavailable', 'The OS credential helper failed.'))
    }
    const timeout = setTimeout(
      () =>
        fail(new BrowserImportError('keychain-unavailable', 'The OS credential helper timed out.')),
      timeoutMs,
    )
    timeout.unref()
    child.stdout.on('data', (chunk: Buffer) => {
      try {
        stdoutBytes = collectBounded(stdout, chunk, stdoutBytes)
      } catch (cause) {
        fail(cause)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      try {
        stderrBytes = collectBounded(stderr, chunk, stderrBytes)
      } catch (cause) {
        fail(cause)
      }
    })
    child.once('error', fail)
    child.once('close', (exitCode) => {
      clearTimeout(timeout)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      if (settled) return
      settled = true
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    child.stdin.on('error', fail)
    child.stdin.end(input)
  })
}

export function windowsPowerShellExecutable() {
  const environment = getBrowserCredentialChildEnv()
  const windowsRoot = environment.SystemRoot ?? environment.WINDIR
  return windowsRoot
    ? path.win32.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe'
}

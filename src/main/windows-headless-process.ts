import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { env } from './env'
import { WINDOWS_HEADLESS_PROCESS_SCRIPT } from './windows-headless-process-source'

const HELPER_TIMEOUT_MS = 20_000
const MAX_HELPER_OUTPUT_BYTES = 64 * 1024
const MAX_COMMAND_LINE_LENGTH = 32_766
const HELPER_SUCCESS = 'OW_HEADLESS_LAUNCHED'

interface WindowsHeadlessLaunchInput {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: Readonly<Record<string, string | undefined>>
}

function quoteArgument(argument: string) {
  // Windows CRT parsing doubles backslashes before a quote and the closing quote.
  return `"${argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`
}

export function windowsHeadlessCommandLine(command: string, args: readonly string[]) {
  if (!command || !win32.isAbsolute(command) || !/\.exe$/iu.test(command)) {
    throw new Error('The Windows headless executable must be an absolute .exe path.')
  }
  const values = [command, ...args]
  if (values.some((value) => value.includes('\0'))) {
    throw new Error('Windows headless process arguments must not contain NUL.')
  }
  const commandLine = values.map(quoteArgument).join(' ')
  if (commandLine.length > MAX_COMMAND_LINE_LENGTH) {
    throw new Error('Windows headless process arguments exceed the Windows command-line limit.')
  }
  return commandLine
}

function helperFailure(stderr: string) {
  const match = /OW_HEADLESS_ERROR:(compile|read-input|create-process):(-?\d+)/u.exec(stderr)
  const [, stage, code] = match ?? []
  return new Error(
    match
      ? `Windows headless process launch failed at ${stage} (Win32 code ${code}).`
      : 'Windows headless process helper did not confirm a successful launch.',
  )
}

export async function launchWindowsHeadlessProcess(
  input: WindowsHeadlessLaunchInput,
): Promise<void> {
  const commandLine = windowsHeadlessCommandLine(input.command, input.args)
  if (
    Object.entries(input.environment).some(
      ([key, value]) => key.includes('\0') || value?.includes('\0'),
    )
  ) {
    throw new Error('Windows headless process environment must not contain NUL.')
  }
  const powershell = win32.join(
    env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      powershell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(WINDOWS_HEADLESS_PROCESS_SCRIPT, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...input.environment },
      },
    )
    let settled = false
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new Error('Timed out starting the Windows headless process.'))
    }, HELPER_TIMEOUT_MS)
    const collect = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      if (settled) return
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_HELPER_OUTPUT_BYTES) {
        fail(new Error('Windows headless process helper exceeded its output limit.'))
        return
      }
      if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }
    child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk))
    for (const stream of [child.stdout, child.stderr]) {
      stream.once('error', (error) =>
        fail(new Error('Windows launch output could not be read.', { cause: error })),
      )
    }
    child.stdin.once('error', (error) =>
      fail(new Error('Windows launch input could not be delivered.', { cause: error })),
    )
    child.once('error', (error) =>
      fail(new Error('Windows headless process helper could not start.', { cause: error })),
    )
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 || stdout !== HELPER_SUCCESS) {
        reject(helperFailure(stderr))
        return
      }
      resolve()
    })
    try {
      child.stdin.end(JSON.stringify({ command: input.command, commandLine }))
    } catch (error) {
      fail(new Error('Windows launch input could not be delivered.', { cause: error }))
    }
  })
}

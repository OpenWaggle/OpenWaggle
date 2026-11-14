import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { env } from './env'
import { WINDOWS_HEADLESS_PROCESS_SCRIPT } from './windows-headless-process-source'
import {
  WINDOWS_POWERSHELL_HELPER_ARGUMENTS,
  windowsPowerShellExecutable,
  windowsPowerShellHelperInput,
  windowsPowerShellHelperOutput,
} from './windows-powershell-helper'

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

/**
 * The launcher helper did not confirm the launch. `stage` and `win32Code` come only from its own
 * controlled diagnostic line, never from unrestricted stderr.
 */
export class WindowsHeadlessLaunchError extends Error {
  readonly stage: string
  readonly win32Code: number | null
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null

  constructor(
    message: string,
    stage: string,
    win32Code: number | null,
    exitCode: number | null = null,
    signalCode: NodeJS.Signals | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.stage = stage
    this.win32Code = win32Code
    this.exitCode = exitCode
    this.signalCode = signalCode
    this.name = 'WindowsHeadlessLaunchError'
  }
}

function helperFailure(stderr: string, exitCode: number | null, signalCode: NodeJS.Signals | null) {
  const match = /OW_HEADLESS_ERROR:(compile|read-input|create-process):(-?\d+)/u.exec(stderr)
  const [, stage, code] = match ?? []
  return new WindowsHeadlessLaunchError(
    match
      ? `Windows headless process launch failed at ${stage} (Win32 code ${code}).`
      : 'Windows headless process helper did not confirm a successful launch.',
    stage ?? 'unconfirmed',
    code === undefined ? null : Number(code),
    exitCode,
    signalCode,
  )
}

export async function launchWindowsHeadlessProcess(input: WindowsHeadlessLaunchInput) {
  const commandLine = windowsHeadlessCommandLine(input.command, input.args)
  if (
    Object.entries(input.environment).some(
      ([key, value]) => key.includes('\0') || value?.includes('\0'),
    )
  ) {
    throw new Error('Windows headless process environment must not contain NUL.')
  }
  const helperInput = windowsPowerShellHelperInput(WINDOWS_HEADLESS_PROCESS_SCRIPT, {
    command: input.command,
    commandLine,
  })
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      windowsPowerShellExecutable(env.SystemRoot),
      [...WINDOWS_POWERSHELL_HELPER_ARGUMENTS],
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
      fail(
        new WindowsHeadlessLaunchError(
          'Timed out starting the Windows headless process.',
          'timeout',
          null,
        ),
      )
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
      fail(
        new WindowsHeadlessLaunchError(
          'Windows headless process helper could not start.',
          'spawn',
          null,
          null,
          null,
          { cause: error },
        ),
      ),
    )
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 || windowsPowerShellHelperOutput(stdout) !== HELPER_SUCCESS) {
        reject(helperFailure(stderr, code, signal))
        return
      }
      resolve()
    })
    try {
      child.stdin.end(helperInput)
    } catch (error) {
      fail(new Error('Windows launch input could not be delivered.', { cause: error }))
    }
  })
}

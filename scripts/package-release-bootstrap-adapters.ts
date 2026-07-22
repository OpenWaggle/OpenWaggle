import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn as spawnPseudoterminal } from 'node-pty'
import { isCredentialEnvironmentKey } from './package-release-bootstrap-commands'
import type {
  BootstrapCommandRequest,
  BootstrapCommandResult,
  BootstrapCommandRunner,
  BootstrapDependencies,
  BootstrapInterruptions,
} from './package-release-bootstrap-types'

const COMMAND_FAILURE_EXIT_CODE = 1
const DEFAULT_TERMINAL_COLUMNS = 80
const DEFAULT_TERMINAL_ROWS = 24
const PRIVATE_FILE_MODE = 0o600
export const BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS = 120_000
const BOOTSTRAP_SIGNALS = ['SIGINT', 'SIGTERM'] as const

type BootstrapSignal = (typeof BOOTSTRAP_SIGNALS)[number]

export interface BootstrapSignalChild {
  kill(signal: BootstrapSignal): boolean
}

export interface BootstrapSignalProcess {
  readonly pid: number
  off(signal: BootstrapSignal, listener: () => void): void
  on(signal: BootstrapSignal, listener: () => void): void
  scheduleFallback(listener: () => void): () => void
  sendSignal(pid: number, signal: BootstrapSignal): void
}

export interface BootstrapInterruptionCoordinator extends BootstrapInterruptions {
  trackChild(child: BootstrapSignalChild): () => void
}

export function createBootstrapInterruptionCoordinator(
  signalProcess: BootstrapSignalProcess,
): BootstrapInterruptionCoordinator {
  const activeOperations = new Set<Promise<unknown>>()
  const activeChildren = new Set<BootstrapSignalChild>()
  let cancelFallback: (() => void) | undefined
  let handlingSignal: BootstrapSignal | undefined
  let signalForwarded = false

  const listeners = {
    SIGINT: () => handleSignal('SIGINT'),
    SIGTERM: () => handleSignal('SIGTERM'),
  } satisfies Record<BootstrapSignal, () => void>

  function installSignalHandlers() {
    if (activeOperations.size !== 1) return
    for (const signal of BOOTSTRAP_SIGNALS) {
      signalProcess.on(signal, listeners[signal])
    }
  }

  function uninstallSignalHandlers() {
    for (const signal of BOOTSTRAP_SIGNALS) {
      signalProcess.off(signal, listeners[signal])
    }
  }

  function forwardSignal(signal: BootstrapSignal) {
    if (signalForwarded) return
    signalForwarded = true
    cancelFallback?.()
    cancelFallback = undefined
    uninstallSignalHandlers()
    signalProcess.sendSignal(signalProcess.pid, signal)
  }

  function startRecoveryFallback() {
    if (
      handlingSignal === undefined ||
      cancelFallback !== undefined ||
      signalForwarded
    ) {
      return
    }
    const signal = handlingSignal
    cancelFallback = signalProcess.scheduleFallback(() => forwardSignal(signal))
  }

  function handleSignal(signal: BootstrapSignal) {
    if (handlingSignal !== undefined) {
      forwardSignal(signal)
      return
    }
    handlingSignal = signal
    for (const child of activeChildren) child.kill(signal)
    if (activeOperations.size === 0) {
      forwardSignal(signal)
      return
    }
    if (activeChildren.size === 0) startRecoveryFallback()
  }

  return {
    protect: async <T>(operation: () => Promise<T>) => {
      const operationPromise = Promise.resolve().then(operation)
      activeOperations.add(operationPromise)
      installSignalHandlers()
      try {
        return await operationPromise
      } finally {
        activeOperations.delete(operationPromise)
        if (activeOperations.size === 0) {
          if (handlingSignal === undefined) uninstallSignalHandlers()
          else forwardSignal(handlingSignal)
        }
      }
    },
    trackChild: (child) => {
      activeChildren.add(child)
      return () => {
        activeChildren.delete(child)
        if (activeChildren.size === 0) startRecoveryFallback()
      }
    },
  }
}

function childEnvironment(source: NodeJS.ProcessEnv) {
  const environment: NodeJS.ProcessEnv = { ...source }
  for (const key of Object.keys(environment)) {
    if (isCredentialEnvironmentKey(key)) delete environment[key]
  }
  return environment
}

function pseudoterminalEnvironment(source: NodeJS.ProcessEnv) {
  return {
    ...Object.fromEntries(
      Object.entries(childEnvironment(source)).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    NPM_CONFIG_PROGRESS: 'false',
  }
}

function executePseudoterminalCommand(
  request: BootstrapCommandRequest,
  interruptions: BootstrapInterruptionCoordinator,
): Promise<BootstrapCommandResult> {
  return new Promise((resolve) => {
    const child = spawnPseudoterminal(request.command, [...request.args], {
      cols: process.stdout.columns ?? DEFAULT_TERMINAL_COLUMNS,
      cwd: request.cwd,
      env: pseudoterminalEnvironment(process.env),
      name: 'xterm-color',
      rows: process.stdout.rows ?? DEFAULT_TERMINAL_ROWS,
    })
    const untrackChild = interruptions.trackChild({
      kill: (signal) => {
        child.kill(signal)
        return true
      },
    })
    const stdinWasFlowing = process.stdin.readableFlowing === true
    let output = ''

    const forwardInput = (chunk: Buffer | string) => child.write(String(chunk))
    process.stdin.on('data', forwardInput)
    process.stdin.resume()

    child.onData((chunk) => {
      output += chunk
      process.stdout.write(chunk)
    })
    child.onExit(({ exitCode }) => {
      process.stdin.off('data', forwardInput)
      if (!stdinWasFlowing) process.stdin.pause()
      untrackChild()
      resolve({ exitCode, stderr: '', stdout: output })
    })
  })
}

function executeCommand(
  request: BootstrapCommandRequest,
  interruptions: BootstrapInterruptionCoordinator,
): Promise<BootstrapCommandResult> {
  if (request.interactive === true && request.captureOutput === true) {
    return executePseudoterminalCommand(request, interruptions)
  }
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: childEnvironment(process.env),
      shell: false,
      stdio:
        request.interactive === true
          ? 'inherit'
          : [request.input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
    })
    const untrackChild = interruptions.trackChild(child)
    let settled = false
    let stdout = ''
    let stderr = ''

    function finish(result: BootstrapCommandResult) {
      if (settled) return
      settled = true
      untrackChild()
      resolve(result)
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      finish({ exitCode: COMMAND_FAILURE_EXIT_CODE, stderr: String(error), stdout })
    })
    child.on('close', (exitCode) => {
      finish({
        exitCode: exitCode ?? COMMAND_FAILURE_EXIT_CODE,
        stderr,
        stdout,
      })
    })

    if (request.input !== undefined) child.stdin?.end(request.input)
  })
}

function createCommandRunner(
  interruptions: BootstrapInterruptionCoordinator,
): BootstrapCommandRunner {
  return { run: (request) => executeCommand(request, interruptions) }
}

function processSignalAdapter(): BootstrapSignalProcess {
  return {
    off: (signal, listener) => process.off(signal, listener),
    on: (signal, listener) => process.on(signal, listener),
    pid: process.pid,
    scheduleFallback: (listener) => {
      const timeout = setTimeout(listener, BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS)
      return () => clearTimeout(timeout)
    },
    sendSignal: (pid, signal) => process.kill(pid, signal),
  }
}

export function createDefaultBootstrapDependencies(): BootstrapDependencies {
  const interruptions = createBootstrapInterruptionCoordinator(processSignalAdapter())
  return {
    commands: createCommandRunner(interruptions),
    environment: process.env,
    files: {
      makeTempDirectory: (prefix) => mkdtemp(path.join(os.tmpdir(), prefix)),
      removeDirectory: (directory) => rm(directory, { force: true, recursive: true }),
      writeFile: (filePath, contents) =>
        writeFile(filePath, contents, { encoding: 'utf8', mode: PRIVATE_FILE_MODE }),
    },
    interruptions,
    writeLine: (line) => console.log(line),
  }
}

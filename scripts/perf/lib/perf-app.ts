import { type ChildProcessByStdio, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { interruptCleanup } from './interrupt-cleanup'

/** An OpenWaggle build to launch: a packaged `.app`, or a repository whose `out/` was built. */
export interface PerfApp {
  readonly label: string
  readonly executable: string
  /** Arguments that precede the app's own: the app directory for a development Electron. */
  readonly leadingArguments: readonly string[]
}

const PACKAGED_EXECUTABLE = path.join('Contents', 'MacOS', 'OpenWaggle')
const DEVELOPMENT_ELECTRON = path.join(
  'node_modules',
  'electron',
  'dist',
  'Electron.app',
  'Contents',
  'MacOS',
  'Electron',
)
const PROCESS_EXIT_WAIT_MS = 5_000
const PROCESS_EXIT_POLL_MS = 100
const EPHEMERAL_PORT = 0
const LOCALHOST = '127.0.0.1'
const STARTUP_TIMING_PATTERN = /Startup timing.*label: '([^']+)'.*elapsedMs: ([0-9.]+)/
const LABEL_GROUP = 1
const ELAPSED_GROUP = 2

/** Resolves `--app <path>`: an `OpenWaggle.app` bundle or a repository checkout with `out/`. */
export function resolvePerfApp(appPath: string, label = path.basename(appPath)): PerfApp {
  const resolved = path.resolve(appPath)
  if (resolved.endsWith('.app')) {
    return { label, executable: path.join(resolved, PACKAGED_EXECUTABLE), leadingArguments: [] }
  }
  if (existsSync(path.join(resolved, 'out', 'main', 'index.js'))) {
    return {
      label,
      executable: path.join(resolved, DEVELOPMENT_ELECTRON),
      leadingArguments: [resolved],
    }
  }
  throw new Error(`${appPath} is neither an OpenWaggle.app bundle nor a built checkout.`)
}

export type AppProcess = ChildProcessByStdio<null, Readable, Readable>

export interface StartupMark {
  readonly label: string
  readonly elapsedMs: number
  /** Milliseconds after the harness spawned the process that the line arrived. */
  readonly arrivedMs: number
}

export interface LaunchedApp {
  readonly child: AppProcess
  readonly spawnedAt: number
  readonly marks: StartupMark[]
  readonly logLines: string[]
}

function forwardLines(stream: Readable, onLine: (line: string) => void) {
  let buffered = ''
  stream.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    let newline = buffered.indexOf('\n')
    while (newline >= 0) {
      onLine(buffered.slice(0, newline))
      buffered = buffered.slice(newline + 1)
      newline = buffered.indexOf('\n')
    }
  })
}

/**
 * Starts the app in its own process group, recording the main process's startup timing marks.
 * Until it exits, an interrupted harness stops the group (interrupt-cleanup.ts): Ctrl-C reaches
 * only the harness's own group.
 */
export function launchApp(
  app: PerfApp,
  environment: Readonly<Record<string, string>>,
  appArguments: readonly string[],
): LaunchedApp {
  const spawnedAt = Date.now()
  const child = spawn(app.executable, [...app.leadingArguments, ...appArguments], {
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const marks: StartupMark[] = []
  const logLines: string[] = []
  const onLine = (line: string) => {
    logLines.push(line)
    const match = STARTUP_TIMING_PATTERN.exec(line)
    const label = match?.[LABEL_GROUP]
    const elapsed = match?.[ELAPSED_GROUP]
    if (label && elapsed) {
      marks.push({
        label,
        elapsedMs: Number(elapsed),
        arrivedMs: Date.now() - spawnedAt,
      })
    }
  }
  forwardLines(child.stdout, onLine)
  forwardLines(child.stderr, onLine)
  const unregister = interruptCleanup.register('process', () => stopProcessGroup(child))
  child.once('exit', unregister)
  child.once('error', unregister)
  return { child, spawnedAt, marks, logLines }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function hasExited(child: AppProcess) {
  return child.exitCode !== null || child.signalCode !== null
}

function signalGroup(child: AppProcess, signal: NodeJS.Signals) {
  if (child.pid === undefined || hasExited(child)) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    // The group is already gone.
  }
}

/** Stops a process group this harness started: SIGTERM, then SIGKILL after a grace period. */
export async function stopProcessGroup(child: AppProcess) {
  signalGroup(child, 'SIGTERM')
  const deadline = Date.now() + PROCESS_EXIT_WAIT_MS
  while (!hasExited(child) && Date.now() < deadline) await delay(PROCESS_EXIT_POLL_MS)
  signalGroup(child, 'SIGKILL')
}

export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(EPHEMERAL_PORT, LOCALHOST, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : EPHEMERAL_PORT
      server.close(() => resolve(port))
    })
  })
}

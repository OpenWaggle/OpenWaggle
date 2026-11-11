import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { interruptCleanup } from './interrupt-cleanup'
import { forwardLines, type PipedChildProcess } from '../../support/child-output-lines'

/**
 * An OpenWaggle build to launch: a packaged `.app`, or a checkout where `bun run package:app` left
 * one (`out/electrobun/inner`, scripts/electrobun/package.ts).
 */
export interface PerfApp {
  readonly label: string
  /** The bundle's executable: Electrobun's launcher, which forwards its arguments to main. */
  readonly executable: string
  /** Arguments that precede the app's own. */
  readonly leadingArguments: readonly string[]
}

const PACKAGED_EXECUTABLE = path.join('Contents', 'MacOS', 'OpenWaggle')
const CHECKOUT_APPS = path.join('out', 'electrobun', 'inner')
const STABLE_MACOS_TARGET = 'stable-macos-'
const PROCESS_EXIT_WAIT_MS = 5_000
const PROCESS_EXIT_POLL_MS = 100
const EPHEMERAL_PORT = 0
const LOCALHOST = '127.0.0.1'
const STARTUP_TIMING_PATTERN = /Startup timing.*label: '([^']+)'.*elapsedMs: ([0-9.]+)/
const LABEL_GROUP = 1
const ELAPSED_GROUP = 2

/** The `.app` a checkout's Electrobun build left for this machine's architecture. */
function checkoutApp(checkout: string) {
  const targets = path.join(checkout, CHECKOUT_APPS)
  if (!existsSync(targets)) return null
  const target = readdirSync(targets).find(
    (name) => name === `${STABLE_MACOS_TARGET}${process.arch}`,
  )
  if (target === undefined) return null
  const app = readdirSync(path.join(targets, target)).find((name) => name.endsWith('.app'))
  return app === undefined ? null : path.join(targets, target, app)
}

/**
 * Resolves `--app <path>`: an `OpenWaggle.app` bundle or a checkout with a packaged build.
 * Every harness that launches the app comes through here, so this is where it refuses to run off
 * macOS: elsewhere `profileHostPids` (BSD `ps -E`) finds nothing, so a Host that did not drain
 * could not be stopped, and the profile clones (`cp -c`) and `.app` paths fail.
 */
export function resolvePerfApp(
  appPath: string,
  label = path.basename(appPath),
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'darwin') {
    throw new Error(
      `The OpenWaggle perf harnesses run on macOS only (this is ${platform}): they read process environments with BSD ps -E, clone profiles with cp -c and launch .app bundles.`,
    )
  }
  const resolved = path.resolve(appPath)
  const bundle = resolved.endsWith('.app') ? resolved : checkoutApp(resolved)
  if (bundle !== null) {
    const app: PerfApp = {
      label,
      executable: path.join(bundle, PACKAGED_EXECUTABLE),
      leadingArguments: [],
    }
    return app
  }
  throw new Error(
    `${appPath} is neither an OpenWaggle.app bundle nor a checkout with a packaged build (bun run package:app).`,
  )
}

export type AppProcess = PipedChildProcess

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

/**
 * Starts the app in its own process group, recording the main process's startup timing marks.
 * Until it exits, an interrupted harness stops the group (interrupt-cleanup.ts): Ctrl-C reaches
 * only the harness's own group.
 */
export function launchApp(
  app: PerfApp,
  environment: Readonly<Record<string, string>>,
  appArguments: readonly string[],
) {
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

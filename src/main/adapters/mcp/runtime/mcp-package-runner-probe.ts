/** How the package-runner probe is spawned (D1.2, review R5 P1-2). */
import { type ChildProcess, spawn } from 'node:child_process'
import { windowsCommandLine } from './mcp-package-runner-launch'

const PROBE_TIMEOUT_MS = 180_000
const PROBE_OUTPUT_BYTES = 1_000_000
/** How long `taskkill` may take before only the probe's root process is killed. */
const TREE_KILL_TIMEOUT_MS = 1_000

export type PackageRunnerProbe = (input: {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}) => Promise<string>

/** How a probe is spawned: never through Node's `shell`, which leaves arguments unquoted. */
export function probeSpawnOf(
  input: Parameters<PackageRunnerProbe>[0],
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'win32') {
    return { file: input.command, args: [...input.args], windowsVerbatimArguments: false }
  }
  // `npx.cmd` needs `cmd.exe` (Node refuses to spawn a `.cmd` without it), which gets one line
  // escaped for it.
  return {
    file: input.env.ComSpec ?? input.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', windowsCommandLine(input.command, input.args)],
    windowsVerbatimArguments: true,
  }
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

/** Kills the process itself; one that already exited (ESRCH) or cannot be signalled is left. */
function killRoot(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  // `kill` reports failure through its result, not by throwing, for a process Node started.
  child.kill('SIGKILL')
}

/**
 * Stops the probe and everything it started: `npx`, its `node`, and an install it began. Killing
 * the root alone (what `execFile`'s timeout does) left the rest running for the Host's life
 * (review V1 P3-1). On POSIX the probe leads its own process group; on Windows `taskkill /T`
 * walks the tree from the root, so it runs only while the root still lives (its PID could be
 * reused after).
 */
function killProbeTree(child: ChildProcess, platform: NodeJS.Platform) {
  const pid = child.pid
  if (!pid) return
  if (platform !== 'win32') {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch (error) {
      if (errorCode(error) !== 'ESRCH') killRoot(child)
    }
    return
  }
  if (child.exitCode !== null || child.signalCode !== null) return
  const treeKill = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
    stdio: 'ignore',
    windowsHide: true,
  })
  const timeout = setTimeout(() => killRoot(treeKill), TREE_KILL_TIMEOUT_MS)
  timeout.unref?.()
  treeKill.once('error', () => {
    clearTimeout(timeout)
    killRoot(child)
  })
  treeKill.once('close', (code) => {
    clearTimeout(timeout)
    if (code !== 0) killRoot(child)
  })
  treeKill.unref()
}

/** A probe with its bound: tests pass a short one. */
export function createExecProbe(
  options: { readonly timeoutMs?: number; readonly platform?: NodeJS.Platform } = {},
): PackageRunnerProbe {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS
  const platform = options.platform ?? process.platform
  return (input) =>
    new Promise((resolve, reject) => {
      const spawned = probeSpawnOf(input, platform)
      const child = spawn(spawned.file, spawned.args, {
        cwd: input.cwd,
        env: { ...input.env },
        stdio: ['ignore', 'pipe', 'ignore'],
        // Its own process group on POSIX, so a timeout stops the whole tree.
        detached: platform !== 'win32',
        windowsHide: true,
        windowsVerbatimArguments: spawned.windowsVerbatimArguments,
        shell: false,
      })
      let stdout = ''
      let settled = false
      const finish = (error: Error | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) {
          killProbeTree(child, platform)
          reject(error)
        } else resolve(stdout)
      }
      const timer = setTimeout(
        () =>
          finish(new Error(`The package runner probe timed out after ${String(timeoutMs)} ms.`)),
        timeoutMs,
      )
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
        if (stdout.length > PROBE_OUTPUT_BYTES) {
          finish(new Error('The package runner probe printed more than it may.'))
        }
      })
      child.once('error', (error) => finish(error))
      child.once('close', (code, signal) => {
        if (code === 0) finish(null)
        else {
          finish(
            new Error(`The package runner probe exited with ${signal ?? `code ${String(code)}`}.`),
          )
        }
      })
    })
}

export const execProbe: PackageRunnerProbe = createExecProbe()

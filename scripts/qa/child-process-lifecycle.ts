import { execFile } from 'node:child_process'

const STOP_TIMEOUT_MS = 3_000

export interface StoppableChild {
  readonly pid?: number
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this
  off(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this
}

interface StopChildDependencies {
  readonly platform?: NodeJS.Platform
  readonly waitForExit?: (child: StoppableChild, timeoutMs: number) => Promise<boolean>
  readonly terminateWindowsTree?: (pid: number) => Promise<void>
}

function childExited(child: StoppableChild) {
  return child.exitCode !== null || child.signalCode !== null
}

async function waitForChildExit(child: StoppableChild, timeoutMs: number) {
  if (childExited(child)) return true
  return await new Promise<boolean>((resolve) => {
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(childExited(child))
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

async function terminateWindowsProcessTree(pid: number) {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'taskkill.exe',
      ['/PID', String(pid), '/T', '/F'],
      { timeout: STOP_TIMEOUT_MS, windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

async function forceStopWindowsChild(
  child: StoppableChild,
  waitForExit: (child: StoppableChild, timeoutMs: number) => Promise<boolean>,
  terminateTree: (pid: number) => Promise<void>,
) {
  if (child.pid === undefined) throw new Error('Cannot terminate Windows GUI process tree without a PID.')
  let terminationFailure: unknown
  try {
    await terminateTree(child.pid)
  } catch (error) {
    terminationFailure = error
  }
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return
  const proofFailure = new Error(`Could not prove GUI process ${String(child.pid)} exited.`)
  if (terminationFailure === undefined) throw proofFailure
  throw new AggregateError(
    [terminationFailure, proofFailure],
    'Windows GUI process-tree termination failed without proof of exit.',
  )
}

export async function stopChild(
  child: StoppableChild,
  dependencies: StopChildDependencies = {},
) {
  if (childExited(child)) return
  const waitForExit = dependencies.waitForExit ?? waitForChildExit
  child.kill('SIGTERM')
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return

  if ((dependencies.platform ?? process.platform) === 'win32') {
    await forceStopWindowsChild(
      child,
      waitForExit,
      dependencies.terminateWindowsTree ?? terminateWindowsProcessTree,
    )
    return
  }

  child.kill('SIGKILL')
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return
  throw new Error(`Could not prove GUI process ${String(child.pid ?? 'unknown')} exited.`)
}

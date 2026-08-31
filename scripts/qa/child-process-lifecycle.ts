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
  readonly terminateWindowsTree?: (pid: number, force: boolean) => Promise<void>
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

async function terminateWindowsProcessTree(pid: number, force: boolean) {
  const arguments_ = ['/PID', String(pid), '/T']
  if (force) arguments_.push('/F')
  await new Promise<void>((resolve, reject) => {
    execFile(
      'taskkill.exe',
      arguments_,
      { timeout: STOP_TIMEOUT_MS, windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

async function stopWindowsChild(
  child: StoppableChild,
  waitForExit: (child: StoppableChild, timeoutMs: number) => Promise<boolean>,
  terminateTree: (pid: number, force: boolean) => Promise<void>,
) {
  if (child.pid === undefined) {
    throw new Error('Cannot terminate Windows GUI process tree without a PID.')
  }
  let gracefulTerminationFailure: unknown
  try {
    await terminateTree(child.pid, false)
  } catch (error) {
    gracefulTerminationFailure = error
  }
  const gracefullyExited = await waitForExit(child, STOP_TIMEOUT_MS)
  if (gracefulTerminationFailure === undefined && gracefullyExited) return

  let forcedTerminationFailure: unknown
  try {
    await terminateTree(child.pid, true)
  } catch (error) {
    forcedTerminationFailure = error
  }
  const forciblyExited = await waitForExit(child, STOP_TIMEOUT_MS)
  if (forcedTerminationFailure === undefined && forciblyExited) return

  const proofFailure = new Error(`Could not prove GUI process ${String(child.pid)} exited.`)
  const failures = [gracefulTerminationFailure, forcedTerminationFailure, proofFailure].filter(
    (failure) => failure !== undefined,
  )
  if (failures.length === 1) throw proofFailure
  throw new AggregateError(
    failures,
    'Windows GUI process-tree termination failed without proof of exit.',
  )
}

export async function stopChild(
  child: StoppableChild,
  dependencies: StopChildDependencies = {},
) {
  if (childExited(child)) return
  const waitForExit = dependencies.waitForExit ?? waitForChildExit
  const platform = dependencies.platform ?? process.platform

  if (platform === 'win32') {
    await stopWindowsChild(
      child,
      waitForExit,
      dependencies.terminateWindowsTree ?? terminateWindowsProcessTree,
    )
    return
  }

  child.kill('SIGTERM')
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return
  child.kill('SIGKILL')
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return
  throw new Error(`Could not prove GUI process ${String(child.pid ?? 'unknown')} exited.`)
}

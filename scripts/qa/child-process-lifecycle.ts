import {
  snapshotWindowsProcessTree,
  terminateWindowsProcessTree,
  type WindowsProcessIdentity,
  verifyWindowsProcessTreeExit,
} from './windows-process-tree'

const STOP_TIMEOUT_MS = 3_000
const PROCESS_TREE_POLL_INTERVAL_MS = 50

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
  readonly windowsProcessTreeSnapshot?: readonly WindowsProcessIdentity[]
  readonly snapshotWindowsTree?: (pid: number) => Promise<readonly WindowsProcessIdentity[]>
  readonly terminateWindowsTree?: (
    pid: number,
    snapshot: readonly WindowsProcessIdentity[],
    force: boolean,
  ) => Promise<void>
  readonly verifyWindowsTreeExit?: (
    snapshot: readonly WindowsProcessIdentity[],
  ) => Promise<boolean>
  readonly signalPosixTree?: (pid: number, signal: NodeJS.Signals) => void
  readonly waitForPosixTreeExit?: (pid: number, timeoutMs: number) => Promise<boolean>
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
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

function signalPosixProcessTree(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error
  }
}

function isPosixProcessTreeAlive(pid: number) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false
    if (errorCode(error) === 'EPERM') return true
    throw error
  }
}

async function waitForPosixProcessTreeExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isPosixProcessTreeAlive(pid)) return true
    await delay(PROCESS_TREE_POLL_INTERVAL_MS)
  }
  return !isPosixProcessTreeAlive(pid)
}

async function stopWindowsChild(
  child: StoppableChild,
  waitForExit: (child: StoppableChild, timeoutMs: number) => Promise<boolean>,
  snapshotTree: (pid: number) => Promise<readonly WindowsProcessIdentity[]>,
  terminateTree: (
    pid: number,
    snapshot: readonly WindowsProcessIdentity[],
    force: boolean,
  ) => Promise<void>,
  verifyTreeExit: (snapshot: readonly WindowsProcessIdentity[]) => Promise<boolean>,
  retainedSnapshot?: readonly WindowsProcessIdentity[],
) {
  if (child.pid === undefined) {
    throw new Error('Cannot terminate Windows GUI process tree without a PID.')
  }
  const snapshot = retainedSnapshot ?? (await snapshotTree(child.pid))
  if (snapshot.length === 0) {
    throw new Error(
      `Could not snapshot Windows GUI process ${String(child.pid)}; descendant absence is unproven.`,
    )
  }
  let gracefulTerminationFailure: unknown
  try {
    await terminateTree(child.pid, snapshot, false)
  } catch (error) {
    gracefulTerminationFailure = error
  }
  const gracefullyExited = await waitForExit(child, STOP_TIMEOUT_MS)
  let gracefulProofFailure: unknown
  if (gracefullyExited) {
    try {
      if (await verifyTreeExit(snapshot)) return
    } catch (error) {
      gracefulProofFailure = error
    }
  }

  let forcedTerminationFailure: unknown
  try {
    await terminateTree(child.pid, snapshot, true)
  } catch (error) {
    forcedTerminationFailure = error
  }
  const forciblyExited = await waitForExit(child, STOP_TIMEOUT_MS)
  let forcedProofFailure: unknown
  if (forciblyExited) {
    try {
      if (await verifyTreeExit(snapshot)) return
    } catch (error) {
      forcedProofFailure = error
    }
  }

  const proofFailure = new Error(`Could not prove GUI process ${String(child.pid)} exited.`)
  const failures = [
    gracefulTerminationFailure,
    gracefulProofFailure,
    forcedTerminationFailure,
    forcedProofFailure,
    proofFailure,
  ].filter((failure) => failure !== undefined)
  if (failures.length === 1) throw proofFailure
  throw new AggregateError(
    failures,
    'Windows GUI process-tree termination failed without proof of exit.',
  )
}

async function stopPosixProcessTree(
  child: StoppableChild,
  signalTree: (pid: number, signal: NodeJS.Signals) => void,
  waitForTreeExit: (pid: number, timeoutMs: number) => Promise<boolean>,
) {
  if (child.pid === undefined) {
    throw new Error('Cannot terminate POSIX process tree without a PID.')
  }
  signalTree(child.pid, 'SIGTERM')
  if (await waitForTreeExit(child.pid, STOP_TIMEOUT_MS)) return
  signalTree(child.pid, 'SIGKILL')
  if (await waitForTreeExit(child.pid, STOP_TIMEOUT_MS)) return
  throw new Error(`Could not prove process tree ${String(child.pid)} exited.`)
}

export async function stopChild(
  child: StoppableChild,
  dependencies: StopChildDependencies = {},
) {
  const platform = dependencies.platform ?? process.platform

  if (platform === 'win32') {
    await stopWindowsChild(
      child,
      dependencies.waitForExit ?? waitForChildExit,
      dependencies.snapshotWindowsTree ?? snapshotWindowsProcessTree,
      dependencies.terminateWindowsTree ?? terminateWindowsProcessTree,
      dependencies.verifyWindowsTreeExit ?? verifyWindowsProcessTreeExit,
      dependencies.windowsProcessTreeSnapshot,
    )
    return
  }
  await stopPosixProcessTree(
    child,
    dependencies.signalPosixTree ?? signalPosixProcessTree,
    dependencies.waitForPosixTreeExit ?? waitForPosixProcessTreeExit,
  )
}

export async function stopProcessTree(
  child: StoppableChild,
  dependencies: StopChildDependencies = {},
) {
  const platform = dependencies.platform ?? process.platform
  if (platform === 'win32') {
    await stopWindowsChild(
      child,
      dependencies.waitForExit ?? waitForChildExit,
      dependencies.snapshotWindowsTree ?? snapshotWindowsProcessTree,
      dependencies.terminateWindowsTree ?? terminateWindowsProcessTree,
      dependencies.verifyWindowsTreeExit ?? verifyWindowsProcessTreeExit,
      dependencies.windowsProcessTreeSnapshot,
    )
    return
  }
  await stopPosixProcessTree(
    child,
    dependencies.signalPosixTree ?? signalPosixProcessTree,
    dependencies.waitForPosixTreeExit ?? waitForPosixProcessTreeExit,
  )
}

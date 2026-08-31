import { execFile } from 'node:child_process'

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
  readonly terminateWindowsTree?: (pid: number, force: boolean) => Promise<void>
  readonly verifyWindowsTreeExit?: (pid: number) => Promise<boolean>
}

interface StopProcessTreeDependencies extends StopChildDependencies {
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

async function verifyWindowsProcessTreeExit(pid: number) {
  const script = [
    `$rootPid = [uint32]${String(pid)}`,
    '$processes = @(Get-CimInstance Win32_Process)',
    '$descendants = [Collections.Generic.HashSet[uint32]]::new()',
    '$frontier = @($rootPid)',
    'while ($frontier.Count -gt 0) {',
    '  $children = @($processes | Where-Object { $frontier -contains [uint32]$_.ParentProcessId -and -not $descendants.Contains([uint32]$_.ProcessId) })',
    '  foreach ($child in $children) { [void]$descendants.Add([uint32]$child.ProcessId) }',
    '  $frontier = @($children | ForEach-Object { [uint32]$_.ProcessId })',
    '}',
    '$rootCount = @($processes | Where-Object { [uint32]$_.ProcessId -eq $rootPid }).Count',
    '[Console]::Out.Write("$rootCount,$($descendants.Count)")',
  ].join(';')
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: STOP_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
  const result = output.trim()
  if (!/^\d+,\d+$/u.test(result)) {
    throw new Error(`Windows process-tree proof returned an invalid result: ${result || 'empty'}.`)
  }
  return result === '0,0'
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
  terminateTree: (pid: number, force: boolean) => Promise<void>,
  verifyTreeExit: (pid: number) => Promise<boolean>,
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
  let gracefulProofFailure: unknown
  if (gracefullyExited) {
    try {
      if (await verifyTreeExit(child.pid)) return
    } catch (error) {
      gracefulProofFailure = error
    }
  }

  let forcedTerminationFailure: unknown
  try {
    await terminateTree(child.pid, true)
  } catch (error) {
    forcedTerminationFailure = error
  }
  const forciblyExited = await waitForExit(child, STOP_TIMEOUT_MS)
  if (forcedTerminationFailure === undefined && forciblyExited) return
  let forcedProofFailure: unknown
  if (forciblyExited) {
    try {
      if (await verifyTreeExit(child.pid)) return
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

export async function stopChild(
  child: StoppableChild,
  dependencies: StopChildDependencies = {},
) {
  const waitForExit = dependencies.waitForExit ?? waitForChildExit
  const platform = dependencies.platform ?? process.platform

  if (platform === 'win32') {
    await stopWindowsChild(
      child,
      waitForExit,
      dependencies.terminateWindowsTree ?? terminateWindowsProcessTree,
      dependencies.verifyWindowsTreeExit ?? verifyWindowsProcessTreeExit,
    )
    return
  }
  if (childExited(child)) return

  child.kill('SIGTERM')
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return
  child.kill('SIGKILL')
  if (await waitForExit(child, STOP_TIMEOUT_MS)) return
  throw new Error(`Could not prove GUI process ${String(child.pid ?? 'unknown')} exited.`)
}

export async function stopProcessTree(
  child: StoppableChild,
  dependencies: StopProcessTreeDependencies = {},
) {
  const platform = dependencies.platform ?? process.platform
  if (platform === 'win32') {
    await stopWindowsChild(
      child,
      dependencies.waitForExit ?? waitForChildExit,
      dependencies.terminateWindowsTree ?? terminateWindowsProcessTree,
      dependencies.verifyWindowsTreeExit ?? verifyWindowsProcessTreeExit,
    )
    return
  }
  if (child.pid === undefined) {
    throw new Error('Cannot terminate POSIX process tree without a PID.')
  }
  const signalTree = dependencies.signalPosixTree ?? signalPosixProcessTree
  const waitForTreeExit = dependencies.waitForPosixTreeExit ?? waitForPosixProcessTreeExit
  signalTree(child.pid, 'SIGTERM')
  if (await waitForTreeExit(child.pid, STOP_TIMEOUT_MS)) return
  signalTree(child.pid, 'SIGKILL')
  if (await waitForTreeExit(child.pid, STOP_TIMEOUT_MS)) return
  throw new Error(`Could not prove process tree ${String(child.pid)} exited.`)
}

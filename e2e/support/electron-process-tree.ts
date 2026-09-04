import { execFile, type ChildProcess } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'

const execFileAsync = promisify(execFile)

const ELECTRON_CLOSE_TIMEOUT_MS = 10_000
const POST_KILL_EXIT_WAIT_MS = 5_000
const POST_KILL_POLL_MS = 250
const PLAYWRIGHT_CLOSE_SETTLE_WAIT_MS = 5_000
const PROCESS_COMMAND_TIMEOUT_MS = 5_000
const PROCESS_LIST_MAX_BUFFER_BYTES = 10_000_000
const PROCESS_ENTRY_FIELD_COUNT = 3

interface ProcessEntry {
  readonly command: string
  readonly parentPid: number
  readonly pid: number
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readNumericField(record: Record<string, unknown>, field: string) {
  const value = record[field]
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && /^\d+$/u.test(value)) {
    return Number.parseInt(value, 10)
  }
  return undefined
}

function readTextField(record: Record<string, unknown>, field: string) {
  const value = record[field]
  return typeof value === 'string' ? value : ''
}

function parseProcessEntries(rawEntries: unknown): readonly ProcessEntry[] {
  if (!isObjectRecord(rawEntries)) {
    return []
  }
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries]
  const parsed: ProcessEntry[] = []
  for (const entry of entries) {
    if (!isObjectRecord(entry)) {
      continue
    }
    const pid = readNumericField(entry, 'ProcessId')
    const parentPid = readNumericField(entry, 'ParentProcessId')
    const command = readTextField(entry, 'Name')
    if (pid === undefined || parentPid === undefined) {
      continue
    }
    parsed.push({ command, parentPid, pid })
  }
  return parsed
}

async function listWindowsProcessEntries() {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress',
    ],
    {
      maxBuffer: PROCESS_LIST_MAX_BUFFER_BYTES,
      timeout: PROCESS_COMMAND_TIMEOUT_MS,
      windowsHide: true,
    },
  )
  return parseProcessEntries(JSON.parse(stdout))
}

async function listUnixProcessEntries() {
  const { stdout } = await execFileAsync(
    'ps',
    ['-ax', '-o', 'pid=,ppid=,comm='],
    {
      maxBuffer: PROCESS_LIST_MAX_BUFFER_BYTES,
      timeout: PROCESS_COMMAND_TIMEOUT_MS,
    },
  )
  const entries: ProcessEntry[] = []
  for (const line of stdout.split('\n')) {
    const fields = line.trim().split(/\s+/u)
    if (fields.length < PROCESS_ENTRY_FIELD_COUNT) {
      continue
    }
    const pid = Number.parseInt(fields[0] ?? '', 10)
    const parentPid = Number.parseInt(fields[1] ?? '', 10)
    if (Number.isNaN(pid) || Number.isNaN(parentPid)) {
      continue
    }
    entries.push({ command: fields.slice(2).join(' '), parentPid, pid })
  }
  return entries
}

/**
 * Enumerates the descendants of `rootPid` breadth-first so teardown forensics can name
 * exactly which child processes survived a shutdown attempt.
 */
async function listDescendantEntries(rootPid: number) {
  const entries =
    process.platform === 'win32' ? await listWindowsProcessEntries() : await listUnixProcessEntries()
  const childrenByParent = new Map<number, ProcessEntry[]>()
  for (const entry of entries) {
    const siblings = childrenByParent.get(entry.parentPid) ?? []
    siblings.push(entry)
    childrenByParent.set(entry.parentPid, siblings)
  }
  const descendants: ProcessEntry[] = []
  const queue = [...(childrenByParent.get(rootPid) ?? [])]
  while (queue.length > 0) {
    const entry = queue.shift()
    if (entry === undefined) {
      continue
    }
    descendants.push(entry)
    queue.push(...(childrenByParent.get(entry.pid) ?? []))
  }
  return descendants
}

function describeDescendants(descendants: readonly ProcessEntry[]) {
  return descendants
    .map((entry) => `pid=${entry.pid} ppid=${entry.parentPid} cmd=${entry.command}`)
    .join('\n')
}

async function reportSurvivorTree(
  rootPid: number,
  descendants: readonly ProcessEntry[],
  enumerationError?: unknown,
) {
  const detail =
    enumerationError !== undefined
      ? `process tree enumeration failed (${String(enumerationError)}); forensics unavailable`
      : descendants.length === 0
        ? `no descendant processes; the Electron root itself (pid=${rootPid}) did not exit`
        : describeDescendants(descendants)
  console.error(`[electron-qa] Electron shutdown forensics for pid=${rootPid}:\n${detail}`)

  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (summaryPath === undefined) {
    return
  }
  const survivors =
    enumerationError !== undefined
      ? 'process tree enumeration failed'
      : descendants.map((entry) => `${entry.command} (pid ${entry.pid})`).join(', ') ||
        'Electron root itself'
  await appendFile(
    summaryPath,
    `Electron shutdown forensics: pid ${rootPid} kept alive: ${survivors}\n`,
  ).catch((error: unknown) => {
    console.error('[electron-qa] failed to append shutdown forensics to the step summary', error)
  })
}

async function killProcessTree(rootPid: number, descendants: readonly ProcessEntry[]) {
  if (process.platform === 'win32') {
    // /T walks the tree from the root; /F forces termination.
    await execFileAsync('taskkill', ['/PID', String(rootPid), '/T', '/F'], {
      timeout: PROCESS_COMMAND_TIMEOUT_MS,
      windowsHide: true,
    }).catch((error: unknown) => {
      console.error(`[electron-qa] taskkill for pid=${rootPid} failed`, error)
    })
    return
  }
  // Playwright launches Electron detached on POSIX, making the wrapper a process-group leader.
  // Kill the group first so a child spawned or reparented after enumeration cannot escape the
  // descendant snapshot; explicit PID kills below remain the fallback for non-detached fixtures.
  try {
    process.kill(-rootPid, 'SIGKILL')
  } catch {
    // A non-detached process has no group keyed by its PID.
  }
  for (const entry of [...descendants].reverse()) {
    try {
      process.kill(entry.pid, 'SIGKILL')
    } catch {
      // The descendant already exited; nothing left to clean up.
    }
  }
  try {
    process.kill(rootPid, 'SIGKILL')
  } catch {
    // The Electron root already exited; nothing left to clean up.
  }
}

function observePlaywrightProcessClose(childProcess: ChildProcess) {
  return new Promise<void>((resolve) => {
    childProcess.once('close', () => resolve())
  })
}

async function settlePlaywrightProcessClose(
  childProcess: ChildProcess,
  processClose: Promise<void>,
) {
  try {
    childProcess.kill('SIGKILL')
  } catch {
    // The bounded tree kill already removed the wrapper.
  }
  // Playwright launches Electron with inherited pipes. A surviving Windows child can keep those
  // pipes open after the shell wrapper exits, preventing ChildProcess "close" and leaving
  // Playwright's synchronous exit-handler kill registered. Releasing our pipe ends lets the real
  // wrapper close event settle that bookkeeping without waiting for an orphaned descendant.
  for (const stream of childProcess.stdio) stream?.destroy()

  let timeoutHandle: NodeJS.Timeout | undefined
  const outcome = await Promise.race([
    processClose.then(() => 'closed' as const),
    new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), PLAYWRIGHT_CLOSE_SETTLE_WAIT_MS)
    }),
  ])
  clearTimeout(timeoutHandle)
  if (outcome === 'closed') return

  // This is a last-resort runner-safety release after both the OS tree kill and wrapper kill were
  // bounded. Playwright registers its cleanup removal on this ChildProcess event. Emitting it here
  // prevents its unbounded synchronous taskkill exit handler from recreating the teardown hang;
  // callers still fail the test because no native close was observed.
  childProcess.emit('close', childProcess.exitCode, childProcess.signalCode)
  await processClose
  throw new Error(
    `[electron-qa] pid=${String(childProcess.pid)} did not emit close after bounded teardown.`,
  )
}

async function terminateTreeAndSettlePlaywright(
  childProcess: ChildProcess,
  rootPid: number,
  descendants: readonly ProcessEntry[],
  processClose: Promise<void>,
) {
  await killProcessTree(rootPid, descendants)
  let treeExitError: unknown
  try {
    await waitForTreeExit(rootPid, descendants)
  } catch (error) {
    treeExitError = error
  }
  let playwrightCloseError: unknown
  try {
    await settlePlaywrightProcessClose(childProcess, processClose)
  } catch (error) {
    playwrightCloseError = error
  }
  if (treeExitError !== undefined) throw treeExitError
  if (playwrightCloseError !== undefined) throw playwrightCloseError
}

/**
 * Closes a Playwright-launched Electron application with a bounded wait. When the app
 * refuses to exit, the surviving process tree is reported (CI step summary included) and
 * force-killed so one hanging shutdown cannot burn a 90s worker teardown and red a whole
 * platform job. This is a safety net, not a cure: the forensics feed the hunt for the
 * root cause of non-clean exits.
 */
export async function closeElectronApplication(app: ElectronApplication): Promise<void> {
  const childProcess = app.process()
  const rootPid = childProcess.pid
  if (rootPid === undefined) throw new Error('Electron process has no pid.')
  const processClose = observePlaywrightProcessClose(childProcess)
  let closeRejection: unknown
  const closePromise = app.close().catch((error: unknown) => {
    closeRejection = error
  })
  let timeoutHandle: NodeJS.Timeout | undefined
  const outcome = await Promise.race([
    closePromise.then(() => 'closed' as const),
    new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), ELECTRON_CLOSE_TIMEOUT_MS)
    }),
  ])
  clearTimeout(timeoutHandle)
  if (outcome === 'closed') {
    // A rejected close on a clean exit is a real failure the test must report.
    if (closeRejection !== undefined) {
      throw closeRejection
    }
    return
  }
  console.error(
    `[electron-qa] Electron did not exit within ${ELECTRON_CLOSE_TIMEOUT_MS}ms; killing its process tree.`,
  )
  let descendants: readonly ProcessEntry[] = []
  let enumerationError: unknown
  try {
    descendants = await listDescendantEntries(rootPid)
  } catch (error) {
    enumerationError = error
    console.error('[electron-qa] failed to enumerate the Electron process tree', error)
  }
  await reportSurvivorTree(rootPid, descendants, enumerationError)
  await terminateTreeAndSettlePlaywright(childProcess, rootPid, descendants, processClose)
}

/**
 * Terminates an automation-only Electron application without asking Playwright to close it.
 * On Windows, `ElectronApplication.close()` can remain pending after the underlying process has
 * already exited, which keeps the Playwright worker alive through its teardown timeout. Tests
 * that intentionally skip app quit handlers use this bounded process-tree path instead.
 */
export async function forceCloseElectronApplication(app: ElectronApplication): Promise<void> {
  const childProcess = app.process()
  const rootPid = childProcess.pid
  if (rootPid === undefined) throw new Error('Electron process has no pid.')
  const processClose = observePlaywrightProcessClose(childProcess)
  let descendants: readonly ProcessEntry[] = []
  // Capture lineage while the wrapper is still alive. If taskkill only partially succeeds, the
  // descendants can be reparented and become impossible to prove dead from the root afterwards.
  try {
    descendants = await listDescendantEntries(rootPid)
  } catch (error) {
    console.error('[electron-qa] failed to enumerate the Electron process tree', error)
  }
  await terminateTreeAndSettlePlaywright(childProcess, rootPid, descendants, processClose)
}

/*
 * Signals are delivered asynchronously: SIGKILL returning does not mean the processes are
 * gone, and `cleanup()` immediately removes the user-data dir the tree may still hold
 * open. Poll until the root is gone so the removal cannot race live handles. Pids are
 * re-checked by liveness only, not identity: the snapshot-to-kill window is milliseconds
 * and pid reuse into it is accepted residual risk on Unix (Windows walks the live tree).
 */
async function waitForTreeExit(rootPid: number, descendants: readonly ProcessEntry[]) {
  const trackedPids = [...new Set([rootPid, ...descendants.map((entry) => entry.pid)])]
  const deadline = Date.now() + POST_KILL_EXIT_WAIT_MS
  while (Date.now() < deadline) {
    const survivors = trackedPids.filter((pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    })
    if (survivors.length === 0) {
      return
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POST_KILL_POLL_MS)
    })
  }
  const survivors = trackedPids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  })
  throw new Error(
    `[electron-qa] process tree still alive after the post-kill wait: ${survivors.join(', ')}.`,
  )
}

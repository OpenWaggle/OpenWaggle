import { execFile } from 'node:child_process'
import { appendFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'

const execFileAsync = promisify(execFile)

const ELECTRON_CLOSE_TIMEOUT_MS = 10_000
const POST_KILL_EXIT_WAIT_MS = 5_000
const POST_KILL_POLL_MS = 250
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
    { maxBuffer: PROCESS_LIST_MAX_BUFFER_BYTES, timeout: PROCESS_COMMAND_TIMEOUT_MS },
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
    }).catch((error: unknown) => {
      console.error(`[electron-qa] taskkill for pid=${rootPid} failed`, error)
    })
    return
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

/**
 * Closes a Playwright-launched Electron application with a bounded wait. When the app
 * refuses to exit, the surviving process tree is reported (CI step summary included) and
 * force-killed so one hanging shutdown cannot burn a 90s worker teardown and red a whole
 * platform job. This is a safety net, not a cure: the forensics feed the hunt for the
 * root cause of non-clean exits.
 */
export async function closeElectronApplication(app: ElectronApplication): Promise<void> {
  const rootPid = app.process().pid
  if (rootPid === undefined) throw new Error('Electron process has no pid.')
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
  await killProcessTree(rootPid, descendants)
  await waitForTreeExit(rootPid)
  // Playwright's close promise can remain pending after an externally terminated Windows
  // process has already disappeared. The rejection handler above keeps it observed; process-tree
  // exit is the authoritative teardown boundary after the bounded graceful-close attempt.
}

/**
 * Terminates an automation-only Electron application without asking Playwright to close it.
 * On Windows, `ElectronApplication.close()` can remain pending after the underlying process has
 * already exited, which keeps the Playwright worker alive through its teardown timeout. Tests
 * that intentionally skip app quit handlers use this bounded process-tree path instead.
 */
export async function forceCloseElectronApplication(app: ElectronApplication): Promise<void> {
  const rootPid = app.process().pid
  if (rootPid === undefined) throw new Error('Electron process has no pid.')
  let descendants: readonly ProcessEntry[] = []
  // Windows taskkill /T walks descendants itself. Skipping the CIM query removes an unnecessary
  // failure point from the force-only path while Unix still needs an explicit child snapshot.
  if (process.platform !== 'win32') {
    try {
      descendants = await listDescendantEntries(rootPid)
    } catch (error) {
      console.error('[electron-qa] failed to enumerate the Electron process tree', error)
    }
  }
  await killProcessTree(rootPid, descendants)
  await waitForTreeExit(rootPid)
}

/*
 * Signals are delivered asynchronously: SIGKILL returning does not mean the processes are
 * gone, and `cleanup()` immediately removes the user-data dir the tree may still hold
 * open. Poll until the root is gone so the removal cannot race live handles. Pids are
 * re-checked by liveness only, not identity: the snapshot-to-kill window is milliseconds
 * and pid reuse into it is accepted residual risk on Unix (Windows walks the live tree).
 */
async function waitForTreeExit(rootPid: number) {
  const deadline = Date.now() + POST_KILL_EXIT_WAIT_MS
  while (Date.now() < deadline) {
    try {
      process.kill(rootPid, 0)
    } catch {
      return
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, POST_KILL_POLL_MS)
    })
  }
  throw new Error(`[electron-qa] pid=${rootPid} still alive after the post-kill wait.`)
}

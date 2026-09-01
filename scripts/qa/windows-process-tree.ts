import { execFile } from 'node:child_process'

const WINDOWS_PROCESS_COMMAND_TIMEOUT_MS = 3_000

export interface WindowsProcessIdentity {
  readonly processId: number
  readonly creationDate: string
}

export interface WindowsProcessRecord extends WindowsProcessIdentity {
  readonly parentProcessId: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseWindowsProcessRecord(value: unknown): WindowsProcessRecord | null {
  if (
    !isRecord(value) ||
    typeof value.processId !== 'number' ||
    !Number.isSafeInteger(value.processId) ||
    typeof value.parentProcessId !== 'number' ||
    !Number.isSafeInteger(value.parentProcessId) ||
    typeof value.creationDate !== 'string' ||
    value.creationDate.length === 0
  ) {
    return null
  }
  return {
    processId: value.processId,
    parentProcessId: value.parentProcessId,
    creationDate: value.creationDate,
  }
}

async function readWindowsProcessRecords() {
  const script = [
    '$records = @(Get-CimInstance Win32_Process | ForEach-Object {',
    '  [pscustomobject]@{',
    '    processId = [uint32]$_.ProcessId;',
    '    parentProcessId = [uint32]$_.ParentProcessId;',
    '    creationDate = $_.CreationDate.ToUniversalTime().ToString("O")',
    '  }',
    '})',
    '[Console]::Out.Write((ConvertTo-Json -InputObject $records -Compress))',
  ].join('\n')
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
  const parsed: unknown = JSON.parse(output)
  if (!Array.isArray(parsed)) {
    throw new Error('Windows process snapshot was not an array.')
  }
  const records: WindowsProcessRecord[] = []
  for (const value of parsed) {
    const record = parseWindowsProcessRecord(value)
    if (record === null) throw new Error('Windows process snapshot contained an invalid record.')
    records.push(record)
  }
  return records
}

export function snapshotWindowsTreeFromRecords(
  rootPid: number,
  records: readonly WindowsProcessRecord[],
) {
  const treePids = new Set([rootPid])
  let previousSize = -1
  while (treePids.size !== previousSize) {
    previousSize = treePids.size
    for (const record of records) {
      if (treePids.has(record.parentProcessId)) treePids.add(record.processId)
    }
  }
  return records
    .filter((record) => treePids.has(record.processId))
    .map(({ processId, creationDate }) => ({ processId, creationDate }))
}

function sameWindowsProcess(
  identity: WindowsProcessIdentity,
  record: WindowsProcessRecord,
) {
  return (
    identity.processId === record.processId && identity.creationDate === record.creationDate
  )
}

export function windowsTreeSnapshotExited(
  snapshot: readonly WindowsProcessIdentity[],
  current: readonly WindowsProcessRecord[],
) {
  return snapshot.every(
    (identity) => !current.some((record) => sameWindowsProcess(identity, record)),
  )
}

export async function snapshotWindowsProcessTree(rootPid: number) {
  return snapshotWindowsTreeFromRecords(rootPid, await readWindowsProcessRecords())
}

export async function verifyWindowsProcessTreeExit(
  snapshot: readonly WindowsProcessIdentity[],
) {
  return windowsTreeSnapshotExited(snapshot, await readWindowsProcessRecords())
}

function taskkill(pid: number, force: boolean) {
  const arguments_ = ['/PID', String(pid), '/T']
  if (force) arguments_.push('/F')
  return new Promise<void>((resolve, reject) => {
    execFile(
      'taskkill.exe',
      arguments_,
      { timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS, windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    )
  })
}

export async function terminateWindowsProcessTree(
  rootPid: number,
  snapshot: readonly WindowsProcessIdentity[],
  force: boolean,
) {
  const root = snapshot.find((identity) => identity.processId === rootPid)
  const ordered = [
    ...(root ? [root] : []),
    ...snapshot.filter((identity) => identity !== root),
  ]
  const failures: unknown[] = []
  for (const identity of ordered) {
    const current = await readWindowsProcessRecords()
    if (!current.some((record) => sameWindowsProcess(identity, record))) continue
    try {
      await taskkill(identity.processId, force)
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Windows process-tree termination commands failed.')
  }
}

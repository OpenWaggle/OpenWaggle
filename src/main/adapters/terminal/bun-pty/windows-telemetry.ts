import { fileTimeValue, LAYOUT, readWideString, WIN32, type Win32 } from './windows-ffi'

/**
 * Read-only Windows process and listener metadata for the terminal inspector, as the patched
 * node-pty addon reported it: Toolhelp rows with each process's creation time (protected and
 * system processes omitted), and the IPv4 and IPv6 TCP listener tables. These snapshots never
 * authorize termination; the Job Object owns that.
 */
const MAX_ROWS = 16_384
const MAX_TABLE_BYTES = 4 * 1024 * 1024
const QUERY_DEADLINE_MS = 1_000
const TABLE_ATTEMPTS = 3
const BYTE_BITS = 8
const PORT_BYTES_MASK = 0xff
const IPV6_GROUP_BYTES = 2
const NO_ERROR = 0
const HEX = 16
const PROCESS_TIMES = 4

export interface WindowsProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly startedAt: string
  readonly name: string
}

export interface WindowsListenerRow {
  readonly pid: number
  readonly port: number
  readonly host: string
}

function budget() {
  const deadline = Date.now() + QUERY_DEADLINE_MS
  return (count: number) => {
    if (count >= MAX_ROWS || Date.now() >= deadline) {
      throw new Error('Terminal metadata query exceeded its bounded budget.')
    }
  }
}

function creationTime(win32: Win32, pid: number) {
  const { kernel32, ffi } = win32
  const handle = kernel32.OpenProcess(WIN32.processQueryLimitedInformation, 0, pid)
  if (handle === null) return null
  try {
    // Creation, exit, kernel and user time; only the first is read.
    const [created, exited, kernel, user] = Array.from(
      { length: PROCESS_TIMES },
      () => new Uint8Array(LAYOUT.fileTimeBytes),
    )
    if (!created || !exited || !kernel || !user) return null
    const ok = kernel32.GetProcessTimes(
      handle,
      ffi.ptr(created),
      ffi.ptr(exited),
      ffi.ptr(kernel),
      ffi.ptr(user),
    )
    return ok === 0 ? null : fileTimeValue(created)
  } finally {
    kernel32.CloseHandle(handle)
  }
}

export function readWindowsProcessTable(win32: Win32) {
  const { kernel32, ffi } = win32
  const within = budget()
  const now = new Uint8Array(LAYOUT.fileTimeBytes)
  kernel32.GetSystemTimeAsFileTime(ffi.ptr(now))
  const latestCreation = fileTimeValue(now)
  const snapshot = kernel32.CreateToolhelp32Snapshot(WIN32.th32csSnapProcess, 0)
  if (snapshot === null || !Number.isSafeInteger(snapshot)) {
    throw new Error('Unable to snapshot Windows terminal process metadata.')
  }
  try {
    const entry = new Uint8Array(LAYOUT.processEntry.bytes)
    const view = new DataView(entry.buffer)
    view.setUint32(LAYOUT.processEntry.size, LAYOUT.processEntry.bytes, true)
    const rows: WindowsProcessRow[] = []
    let found = kernel32.Process32FirstW(snapshot, ffi.ptr(entry)) !== 0
    let visited = 0
    while (found) {
      within(visited)
      visited += 1
      const pid = view.getUint32(LAYOUT.processEntry.processId, true)
      const birth = creationTime(win32, pid)
      // A PID born after the snapshot may have replaced the snapshotted row.
      if (birth !== null && birth > 0n && birth <= latestCreation) {
        rows.push({
          pid,
          ppid: view.getUint32(LAYOUT.processEntry.parentProcessId, true),
          startedAt: String(birth),
          name: readWideString(entry, LAYOUT.processEntry.exeFile, LAYOUT.processEntryNameChars),
        })
      }
      found = kernel32.Process32NextW(snapshot, ffi.ptr(entry)) !== 0
    }
    if (kernel32.GetLastError() !== WIN32.errorNoMoreFiles) {
      throw new Error('Incomplete Windows process snapshot.')
    }
    return rows
  } finally {
    kernel32.CloseHandle(snapshot)
  }
}

function listenerTable(win32: Win32, family: number, within: (count: number) => void) {
  const { ipHelper, ffi } = win32
  const size = new Uint32Array(1)
  let status = ipHelper.GetExtendedTcpTable(
    null,
    ffi.ptr(size),
    0,
    family,
    WIN32.tcpTableOwnerPidListener,
    0,
  )
  let buffer = new Uint8Array(0)
  for (
    let attempt = 0;
    status === WIN32.errorInsufficientBuffer && attempt < TABLE_ATTEMPTS;
    attempt += 1
  ) {
    within(0)
    const bytes = size[0] ?? 0
    if (bytes === 0 || bytes > MAX_TABLE_BYTES) {
      throw new Error('TCP listener table exceeds its byte limit.')
    }
    buffer = new Uint8Array(bytes)
    status = ipHelper.GetExtendedTcpTable(
      ffi.ptr(buffer),
      ffi.ptr(size),
      0,
      family,
      WIN32.tcpTableOwnerPidListener,
      0,
    )
  }
  if (status !== NO_ERROR || buffer.length === 0) {
    throw new Error('Unable to snapshot Windows TCP listeners.')
  }
  return buffer
}

/** The port, stored in network byte order in the low two bytes of a DWORD. */
function networkPort(view: DataView, offset: number) {
  const value = view.getUint32(offset, true)
  return ((value & PORT_BYTES_MASK) << BYTE_BITS) | ((value >> BYTE_BITS) & PORT_BYTES_MASK)
}

function ipv6Host(bytes: Uint8Array) {
  const groups: string[] = []
  for (let index = 0; index < bytes.length; index += IPV6_GROUP_BYTES) {
    const high = bytes[index] ?? 0
    const low = bytes[index + 1] ?? 0
    groups.push(((high << BYTE_BITS) | low).toString(HEX))
  }
  // The longest run of zero groups collapses to `::`, as inet_ntop writes it.
  const text = groups.join(':')
  const runs = [...text.matchAll(/(?:^|:)0(?::0)+(?::|$)/gu)]
  const longest = runs.reduce<RegExpMatchArray | null>(
    (best, run) => (best === null || run[0].length > best[0].length ? run : best),
    null,
  )
  if (longest?.index === undefined) return text
  return `${text.slice(0, longest.index)}::${text.slice(longest.index + longest[0].length)}`
}

function readListeners(win32: Win32, family: number, within: (count: number) => void) {
  const buffer = listenerTable(win32, family, within)
  const view = new DataView(buffer.buffer)
  const entries = view.getUint32(0, true)
  const ipv4 = family === WIN32.afInet
  const rowBytes = ipv4 ? LAYOUT.tcpRow.bytes : LAYOUT.tcp6Row.bytes
  const rowsOffset = ipv4 ? LAYOUT.tcpTable.rows : LAYOUT.tcp6Table.rows
  if (entries > (buffer.length - rowsOffset) / rowBytes) {
    throw new Error('Invalid TCP listener table.')
  }
  const rows: WindowsListenerRow[] = []
  for (let index = 0; index < entries; index += 1) {
    within(rows.length)
    const row = rowsOffset + index * rowBytes
    if (ipv4) {
      const address = buffer.subarray(
        row + LAYOUT.tcpRow.localAddress,
        row + LAYOUT.tcpRow.localAddress + Uint32Array.BYTES_PER_ELEMENT,
      )
      rows.push({
        pid: view.getUint32(row + LAYOUT.tcpRow.owningPid, true),
        port: networkPort(view, row + LAYOUT.tcpRow.localPort),
        host: [...address].join('.'),
      })
      continue
    }
    const address = buffer.subarray(row, row + LAYOUT.tcp6Row.localAddressBytes)
    const scope = view.getUint32(row + LAYOUT.tcp6Row.scopeId, true)
    const host = ipv6Host(address)
    rows.push({
      pid: view.getUint32(row + LAYOUT.tcp6RowOwningPid, true),
      port: networkPort(view, row + LAYOUT.tcp6Row.localPort),
      host: scope === 0 ? host : `${host}%${String(scope)}`,
    })
  }
  return rows
}

export function readWindowsListeningPorts(win32: Win32) {
  const within = budget()
  return [
    ...readListeners(win32, WIN32.afInet, within),
    ...readListeners(win32, WIN32.afInet6, within),
  ]
}

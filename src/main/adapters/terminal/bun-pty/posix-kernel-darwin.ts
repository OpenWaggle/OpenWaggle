import {
  type Ffi,
  MAX_LISTED_PIDS,
  type PlatformKernel,
  type ProcessRead,
  SIGNAL_RESULT,
} from './posix-kernel-types'

/**
 * macOS process identity through libSystem (ADR 0030): `proc_pidinfo` gives the never-reused
 * `p_uniqueid` (the birth identity) and the BSD info (parent, group, controlling tty, state);
 * signals go through `proc_signal_with_audittoken`, so a recycled pid is never signaled.
 */
const DARWIN_LIBSYSTEM = '/usr/lib/libSystem.B.dylib'
const DARWIN_PIDTBSDINFO = 3
const DARWIN_PIDUNIQIDENTIFIERINFO = 17
const DARWIN_BSD_INFO_BYTES = 136
const DARWIN_UNIQUE_INFO_BYTES = 56
const DARWIN_AUDIT_TOKEN_WORDS = 8
const DARWIN_AUDIT_TOKEN_PID = 5
const DARWIN_AUDIT_TOKEN_VERSION = 7
const DARWIN_ZOMBIE = 5
const DARWIN_CHARACTER_DEVICE = 0o020000
const DARWIN_NO_DEVICE = 0xffff_ffff
const DARWIN_SIGNAL_ATTEMPTS = 4
const DARWIN_DEVICE_MAJOR_SHIFT = 24n
const DARWIN_DEVICE_MINOR_MASK = 0xff_ffffn
const DARWIN_DEVICE_MAJOR_MASK = 0xffn
const BSD = {
  status: 4,
  ppid: 16,
  realUid: 28,
  comm: 48,
  commBytes: 16,
  pgid: 100,
  tdev: 108,
  tpgid: 112,
} as const
const UNIQUE = { id: 16, version: 32 } as const

function cleanName(bytes: Uint8Array) {
  const end = bytes.indexOf(0)
  const name = new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end))
  return name.length > 0 ? name : '?'
}

function darwinTtyIdentity(device: number) {
  if (device === 0 || device === DARWIN_NO_DEVICE) return null
  const value = BigInt(device)
  const major = (value >> DARWIN_DEVICE_MAJOR_SHIFT) & DARWIN_DEVICE_MAJOR_MASK
  return `darwin:${String(major)}:${String(value & DARWIN_DEVICE_MINOR_MASK)}`
}

export function darwinKernel(ffi: Ffi) {
  const library = ffi.dlopen(DARWIN_LIBSYSTEM, {
    proc_pidinfo: { args: ['i32', 'i32', 'u64', 'ptr', 'i32'], returns: 'i32' },
    proc_listallpids: { args: ['ptr', 'i32'], returns: 'i32' },
    proc_signal_with_audittoken: { args: ['ptr', 'i32'], returns: 'i32' },
    devname: { args: ['u32', 'u16'], returns: 'cstring' },
  })
  const { proc_pidinfo: pidInfo } = library.symbols
  const unique = (pid: number) => {
    const buffer = new Uint8Array(DARWIN_UNIQUE_INFO_BYTES)
    const size = pidInfo(pid, DARWIN_PIDUNIQIDENTIFIERINFO, 0n, ffi.ptr(buffer), buffer.length)
    if (size !== buffer.length) return null
    const view = new DataView(buffer.buffer)
    return {
      id: view.getBigUint64(UNIQUE.id, true),
      version: view.getInt32(UNIQUE.version, true),
    }
  }
  const read = (pid: number) => {
    const before = unique(pid)
    if (!before) return { status: 'absent' } satisfies ProcessRead
    const buffer = new Uint8Array(DARWIN_BSD_INFO_BYTES)
    const size = pidInfo(pid, DARWIN_PIDTBSDINFO, 0n, ffi.ptr(buffer), buffer.length)
    const after = unique(pid)
    if (!after || after.id !== before.id) return { status: 'absent' } satisfies ProcessRead
    if (size !== buffer.length) {
      // A zombie keeps its unique id but no longer answers the BSD flavor.
      return {
        status: 'found',
        uid: process.getuid?.() ?? -1,
        info: {
          pid,
          startedAt: `darwin:${String(after.id)}`,
          ppid: 0,
          pgid: 0,
          tpgid: -1,
          ttyIdentity: null,
          zombie: true,
          name: '?',
        },
      } satisfies ProcessRead
    }
    const view = new DataView(buffer.buffer)
    return {
      status: 'found',
      uid: view.getUint32(BSD.realUid, true),
      info: {
        pid,
        startedAt: `darwin:${String(after.id)}`,
        ppid: view.getUint32(BSD.ppid, true),
        pgid: view.getUint32(BSD.pgid, true),
        tpgid: view.getInt32(BSD.tpgid, true),
        ttyIdentity: darwinTtyIdentity(view.getUint32(BSD.tdev, true)),
        zombie: view.getUint32(BSD.status, true) === DARWIN_ZOMBIE,
        name: cleanName(buffer.subarray(BSD.comm, BSD.comm + BSD.commBytes)),
      },
    } satisfies ProcessRead
  }
  const signal = (pid: number, identity: string, signalNumber: number) => {
    for (let attempt = 0; attempt < DARWIN_SIGNAL_ATTEMPTS; attempt += 1) {
      const current = unique(pid)
      if (!current) return SIGNAL_RESULT.absent
      if (`darwin:${String(current.id)}` !== identity) return SIGNAL_RESULT.mismatch
      const token = new Uint32Array(DARWIN_AUDIT_TOKEN_WORDS)
      token[DARWIN_AUDIT_TOKEN_PID] = pid
      token[DARWIN_AUDIT_TOKEN_VERSION] = current.version
      if (library.symbols.proc_signal_with_audittoken(ffi.ptr(token), signalNumber) === 0) {
        return SIGNAL_RESULT.signaled
      }
      const after = unique(pid)
      if (!after) return SIGNAL_RESULT.absent
      if (after.id !== current.id) return SIGNAL_RESULT.mismatch
      if (after.version === current.version) return SIGNAL_RESULT.absent
      // exec(2) changed the audit token's version but not the unique id: try again.
    }
    return SIGNAL_RESULT.failed
  }
  const listPids = () => {
    const buffer = new Int32Array(MAX_LISTED_PIDS)
    const count = library.symbols.proc_listallpids(ffi.ptr(buffer), buffer.byteLength)
    if (count <= 0) return null
    return [...buffer.subarray(0, Math.min(count, MAX_LISTED_PIDS))].filter((pid) => pid > 0)
  }
  const ttyPath = (pid: number) => {
    const buffer = new Uint8Array(DARWIN_BSD_INFO_BYTES)
    if (pidInfo(pid, DARWIN_PIDTBSDINFO, 0n, ffi.ptr(buffer), buffer.length) !== buffer.length) {
      return null
    }
    const device = new DataView(buffer.buffer).getUint32(BSD.tdev, true)
    if (device === 0 || device === DARWIN_NO_DEVICE) return null
    const name = library.symbols.devname(device, DARWIN_CHARACTER_DEVICE)
    const text = String(name)
    return text.length > 0 ? `/dev/${text}` : null
  }
  return { read, signal, listPids, ttyPath } satisfies PlatformKernel
}

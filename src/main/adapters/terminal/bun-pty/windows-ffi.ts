import type * as BunFfi from 'bun:ffi'
import type { Pointer } from 'bun:ffi'

/**
 * The Win32 calls the Windows terminal backend makes through `bun:ffi` (ADR 0064): ConPTY, Job
 * Objects, process creation, Toolhelp and the TCP listener table. Layouts are the 64-bit ones,
 * which every Windows build OpenWaggle ships (x64, arm64) uses.
 */
type Ffi = typeof BunFfi

const KERNEL32 = {
  CreatePipe: { args: ['ptr', 'ptr', 'ptr', 'u32'], returns: 'i32' },
  CloseHandle: { args: ['ptr'], returns: 'i32' },
  CreatePseudoConsole: { args: ['u32', 'ptr', 'ptr', 'u32', 'ptr'], returns: 'i32' },
  ResizePseudoConsole: { args: ['ptr', 'u32'], returns: 'i32' },
  ClosePseudoConsole: { args: ['ptr'], returns: 'void' },
  InitializeProcThreadAttributeList: { args: ['ptr', 'u32', 'u32', 'ptr'], returns: 'i32' },
  UpdateProcThreadAttribute: {
    args: ['ptr', 'u32', 'u64', 'ptr', 'u64', 'ptr', 'ptr'],
    returns: 'i32',
  },
  DeleteProcThreadAttributeList: { args: ['ptr'], returns: 'void' },
  CreateProcessW: {
    args: ['ptr', 'ptr', 'ptr', 'ptr', 'i32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'],
    returns: 'i32',
  },
  ResumeThread: { args: ['ptr'], returns: 'u32' },
  TerminateProcess: { args: ['ptr', 'u32'], returns: 'i32' },
  CreateJobObjectW: { args: ['ptr', 'ptr'], returns: 'ptr' },
  SetInformationJobObject: { args: ['ptr', 'u32', 'ptr', 'u32'], returns: 'i32' },
  AssignProcessToJobObject: { args: ['ptr', 'ptr'], returns: 'i32' },
  QueryInformationJobObject: { args: ['ptr', 'u32', 'ptr', 'u32', 'ptr'], returns: 'i32' },
  TerminateJobObject: { args: ['ptr', 'u32'], returns: 'i32' },
  WaitForSingleObject: { args: ['ptr', 'u32'], returns: 'u32' },
  GetExitCodeProcess: { args: ['ptr', 'ptr'], returns: 'i32' },
  WriteFile: { args: ['ptr', 'ptr', 'u32', 'ptr', 'ptr'], returns: 'i32' },
  CreateToolhelp32Snapshot: { args: ['u32', 'u32'], returns: 'ptr' },
  Process32FirstW: { args: ['ptr', 'ptr'], returns: 'i32' },
  Process32NextW: { args: ['ptr', 'ptr'], returns: 'i32' },
  OpenProcess: { args: ['u32', 'i32', 'u32'], returns: 'ptr' },
  GetProcessTimes: { args: ['ptr', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'i32' },
  GetSystemTimeAsFileTime: { args: ['ptr'], returns: 'void' },
  GetLastError: { args: [], returns: 'u32' },
} as const

const IPHLPAPI = {
  GetExtendedTcpTable: { args: ['ptr', 'ptr', 'i32', 'u32', 'u32', 'u32'], returns: 'u32' },
} as const

export type Kernel32 = BunFfi.Library<typeof KERNEL32>['symbols']
export type IpHelper = BunFfi.Library<typeof IPHLPAPI>['symbols']

export interface Win32 {
  readonly ffi: Ffi
  readonly kernel32: Kernel32
  readonly ipHelper: IpHelper
}

let loaded: Win32 | null = null

export async function loadWin32() {
  if (loaded) return loaded
  const ffi = await import('bun:ffi')
  loaded = {
    ffi,
    kernel32: ffi.dlopen('kernel32.dll', KERNEL32).symbols,
    ipHelper: ffi.dlopen('iphlpapi.dll', IPHLPAPI).symbols,
  }
  return loaded
}

export const WIN32 = {
  infinite: 0xffff_ffff,
  waitObject0: 0,
  stillActive: 259,
  invalidHandle: -1,
  errorNoMoreFiles: 18,
  errorInsufficientBuffer: 122,
  extendedStartupInfoPresent: 0x0008_0000,
  createUnicodeEnvironment: 0x0000_0400,
  createSuspended: 0x0000_0004,
  startfUseStdHandles: 0x0000_0100,
  procThreadAttributePseudoConsole: 0x0002_0016n,
  jobObjectBasicAccountingInformation: 1,
  jobObjectExtendedLimitInformation: 9,
  jobObjectLimitKillOnJobClose: 0x2000,
  th32csSnapProcess: 0x2,
  processQueryLimitedInformation: 0x1000,
  afInet: 2,
  afInet6: 23,
  tcpTableOwnerPidListener: 3,
} as const

/** Struct sizes and offsets for 64-bit Windows. */
export const LAYOUT = {
  handleBytes: 8,
  securityAttributes: { bytes: 24, length: 0, inheritHandle: 16 },
  startupInfoEx: { bytes: 112, cb: 0, flags: 60, attributeList: 104 },
  processInformation: { bytes: 24, process: 0, thread: 8, processId: 16 },
  extendedLimitInformation: { bytes: 144, limitFlags: 16 },
  basicAccounting: { bytes: 48, activeProcesses: 40 },
  processEntry: { bytes: 568, size: 0, processId: 8, parentProcessId: 32, exeFile: 44 },
  processEntryNameChars: 260,
  fileTimeBytes: 8,
  tcpTable: { entries: 0, rows: 4 },
  tcpRow: { bytes: 24, localAddress: 4, localPort: 8, owningPid: 20 },
  tcp6Table: { entries: 0, rows: 4 },
  tcp6Row: { bytes: 56, localAddress: 0, localAddressBytes: 16, scopeId: 16, localPort: 20 },
  tcp6RowOwningPid: 52,
} as const

/** A handle or address read out of memory; Bun's pointers are plain numbers. */
export function pointerFromAddress(address: bigint) {
  const value = Number(address)
  return isPointer(value) ? value : null
}

/** The handle in an 8-byte slot, or null when the slot holds none. */
export function readHandle(slot: BigUint64Array, index = 0) {
  return pointerFromAddress(slot[index] ?? 0n)
}

function isPointer(value: number): value is Pointer {
  return Number.isSafeInteger(value) && value !== 0
}

/** UTF-16LE, NUL-terminated. */
export function wideString(text: string) {
  const units = new Uint16Array(text.length + 1)
  for (let index = 0; index < text.length; index += 1) units[index] = text.charCodeAt(index)
  return units
}

export function readWideString(bytes: Uint8Array, offset: number, maxChars: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  let text = ''
  for (let index = 0; index < maxChars; index += 1) {
    const unit = view.getUint16(offset + index * Uint16Array.BYTES_PER_ELEMENT, true)
    if (unit === 0) break
    text += String.fromCharCode(unit)
  }
  return text
}

export function fileTimeValue(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(0, true)
}

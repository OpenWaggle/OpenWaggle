import type * as BunFfi from 'bun:ffi'
import { createRequire } from 'node:module'
import {
  sidAt,
  sidString,
  userOnlyAcl,
  verifyUserOnlyDescriptor,
  type WindowsUserOnlyKind,
} from './windows-security-descriptor'

/**
 * Makes the Session Host's state directory, endpoint capability file and named pipe user-only on
 * Windows, through `bun:ffi` calls to advapi32: the current user becomes the owner, and the DACL
 * becomes protected (nothing inherited) with one full-control ACE for that user. Each object's
 * descriptor is then read back and checked (`verifyUserOnlyDescriptor`); any difference, or any
 * failed call, rejects, so the caller never treats an object as private that is not.
 *
 * Files and directories are set by name (`SetNamedSecurityInfoW`). A named pipe needs its own
 * handle (`SetSecurityInfo`), opened with only the security metadata rights (`READ_CONTROL |
 * WRITE_DAC | WRITE_OWNER`), never read or write access, so the server's pre-admission rejection
 * of connections stays in force.
 */
export type WindowsUserOnlySecurityTarget =
  | { readonly kind: 'directory'; readonly path: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'pipe'; readonly path: string }

export type WindowsUserOnlySecurity = (
  targets: readonly WindowsUserOnlySecurityTarget[],
) => Promise<{ readonly userSid: string }>

const TOKEN_QUERY = 0x0008
const TOKEN_USER_CLASS = 1
const TOKEN_USER_BYTES = 256
const SE_FILE_OBJECT = 1
const SE_KERNEL_OBJECT = 6
const OWNER_SECURITY_INFORMATION = 0x0000_0001
const DACL_SECURITY_INFORMATION = 0x0000_0004
const PROTECTED_DACL_SECURITY_INFORMATION = 0x8000_0000
const SET_INFORMATION =
  OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION
const READ_INFORMATION = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION
export const READ_CONTROL = 0x0002_0000
const WRITE_DAC = 0x0004_0000
const WRITE_OWNER = 0x0008_0000
/** Security metadata only: never read or write access to the pipe's protocol. */
const PIPE_METADATA_RIGHTS = READ_CONTROL | WRITE_DAC | WRITE_OWNER
const OPEN_EXISTING = 3
const FILE_FLAG_OVERLAPPED = 0x4000_0000
const NO_SHARING = 0
const INVALID_HANDLE_VALUE = 0xffff_ffff_ffff_ffffn
const ERROR_SUCCESS = 0

/** The advapi32 and kernel32 calls this module makes. Addresses and handles cross as bigint. */
export interface WindowsSecurityKernel {
  /** The current process token's `TOKEN_USER`, as `GetTokenInformation` writes it. */
  readonly tokenUser: () => { readonly bytes: Uint8Array; readonly sidOffset: number }
  readonly setNamed: (path: string, owner: Uint8Array, dacl: Uint8Array) => number
  /** `GetNamedSecurityInfoW` for the owner and DACL: the descriptor's address, or the error. */
  readonly getNamed: (path: string) => { readonly error: number; readonly descriptor: bigint }
  /** A handle to an instance of the pipe with `access`, or null with the error. */
  readonly openPipe: (
    path: string,
    access: number,
  ) => { readonly handle: bigint | null; readonly error: number }
  readonly setHandle: (handle: bigint, owner: Uint8Array, dacl: Uint8Array) => number
  readonly getHandle: (handle: bigint) => { readonly error: number; readonly descriptor: bigint }
  /** Copies a self-relative descriptor out of system memory, then frees it (`LocalFree`). */
  readonly takeDescriptor: (descriptor: bigint) => Uint8Array
  readonly closeHandle: (handle: bigint) => void
}

function wideString(text: string) {
  return Buffer.from(`${text}\0`, 'utf16le')
}

function securityFailure(kind: WindowsUserOnlyKind | 'user', operation: string, code: number) {
  return new Error(
    `Windows user-only ${kind} security failed at ${operation} (Win32 code ${String(code)}).`,
  )
}

/** The current user's SID, from the process token. */
export function currentUser(kernel: WindowsSecurityKernel) {
  const { bytes, sidOffset } = kernel.tokenUser()
  return sidAt(bytes, sidOffset)
}

function secureNamed(
  kernel: WindowsSecurityKernel,
  target: { readonly kind: 'directory' | 'file'; readonly path: string },
  user: Uint8Array,
) {
  const set = kernel.setNamed(target.path, user, userOnlyAcl(user, target.kind))
  if (set !== ERROR_SUCCESS) throw securityFailure(target.kind, 'set', set)
  const read = kernel.getNamed(target.path)
  if (read.error !== ERROR_SUCCESS) throw securityFailure(target.kind, 'read-back', read.error)
  verifyUserOnlyDescriptor(kernel.takeDescriptor(read.descriptor), user, target.kind)
}

function securePipe(kernel: WindowsSecurityKernel, path: string, user: Uint8Array) {
  const opened = kernel.openPipe(path, PIPE_METADATA_RIGHTS)
  if (opened.handle === null) throw securityFailure('pipe', 'open', opened.error)
  try {
    const set = kernel.setHandle(opened.handle, user, userOnlyAcl(user, 'pipe'))
    if (set !== ERROR_SUCCESS) throw securityFailure('pipe', 'set', set)
    const read = kernel.getHandle(opened.handle)
    if (read.error !== ERROR_SUCCESS) throw securityFailure('pipe', 'read-back', read.error)
    verifyUserOnlyDescriptor(kernel.takeDescriptor(read.descriptor), user, 'pipe')
  } finally {
    kernel.closeHandle(opened.handle)
  }
}

/** Makes each target user-only, in order, and returns the user's SID; throws at the first failure. */
export function secureWindowsUserOnlyWith(
  kernel: WindowsSecurityKernel,
  targets: readonly WindowsUserOnlySecurityTarget[],
) {
  if (targets.length === 0) {
    throw new Error('At least one Windows user-only security target is required.')
  }
  const user = currentUser(kernel)
  for (const target of targets) {
    if (target.kind === 'pipe') securePipe(kernel, target.path, user)
    else secureNamed(kernel, target, user)
  }
  return { userSid: sidString(user) }
}

function isBunFfi(value: unknown): value is typeof BunFfi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'dlopen' in value &&
    typeof value.dlopen === 'function' &&
    'ptr' in value &&
    typeof value.ptr === 'function'
  )
}

function openLibraries(ffi: typeof BunFfi) {
  const advapi32 = ffi.dlopen('advapi32.dll', {
    OpenProcessToken: { args: ['u64', 'u32', 'ptr'], returns: 'i32' },
    GetTokenInformation: { args: ['u64', 'u32', 'ptr', 'u32', 'ptr'], returns: 'i32' },
    SetNamedSecurityInfoW: {
      args: ['ptr', 'u32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'],
      returns: 'u32',
    },
    GetNamedSecurityInfoW: {
      args: ['ptr', 'u32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
      returns: 'u32',
    },
    SetSecurityInfo: { args: ['u64', 'u32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'], returns: 'u32' },
    GetSecurityInfo: {
      args: ['u64', 'u32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr', 'ptr'],
      returns: 'u32',
    },
    GetSecurityDescriptorLength: { args: ['u64'], returns: 'u32' },
  })
  const kernel32 = ffi.dlopen('kernel32.dll', {
    GetCurrentProcess: { args: [], returns: 'u64' },
    CloseHandle: { args: ['u64'], returns: 'i32' },
    CreateFileW: { args: ['ptr', 'u32', 'u32', 'ptr', 'u32', 'u32', 'u64'], returns: 'u64' },
    GetLastError: { args: [], returns: 'u32' },
    LocalFree: { args: ['u64'], returns: 'u64' },
    RtlMoveMemory: { args: ['ptr', 'u64', 'u64'], returns: 'void' },
  })
  return { security: advapi32.symbols, system: kernel32.symbols }
}

type Libraries = ReturnType<typeof openLibraries>

/** The current process token's `TOKEN_USER`, and where in it its SID starts. */
function tokenUser(ffi: typeof BunFfi, { security, system }: Libraries) {
  const token = new BigUint64Array(1)
  if (security.OpenProcessToken(system.GetCurrentProcess(), TOKEN_QUERY, ffi.ptr(token)) === 0) {
    throw securityFailure('user', 'open-process-token', system.GetLastError())
  }
  const handle = token[0] ?? 0n
  try {
    const bytes = new Uint8Array(TOKEN_USER_BYTES)
    const written = new Uint32Array(1)
    const base = ffi.ptr(bytes)
    const read = security.GetTokenInformation(
      handle,
      TOKEN_USER_CLASS,
      base,
      bytes.byteLength,
      ffi.ptr(written),
    )
    if (read === 0) throw securityFailure('user', 'token-user', system.GetLastError())
    // TOKEN_USER starts with the address of its SID, which lies inside the same buffer.
    const sid = new BigUint64Array(bytes.buffer, 0, 1)[0] ?? 0n
    return { bytes, sidOffset: Number(sid - BigInt(base)) }
  } finally {
    system.CloseHandle(handle)
  }
}

function bindKernel(ffi: typeof BunFfi) {
  const libraries = openLibraries(ffi)
  const { security, system } = libraries
  const out = () => new BigUint64Array(1)
  return {
    tokenUser: () => tokenUser(ffi, libraries),
    setNamed: (path, owner, dacl) =>
      security.SetNamedSecurityInfoW(
        ffi.ptr(wideString(path)),
        SE_FILE_OBJECT,
        SET_INFORMATION,
        ffi.ptr(owner),
        null,
        ffi.ptr(dacl),
        null,
      ),
    getNamed: (path) => {
      const descriptor = out()
      const error = security.GetNamedSecurityInfoW(
        ffi.ptr(wideString(path)),
        SE_FILE_OBJECT,
        READ_INFORMATION,
        null,
        null,
        null,
        null,
        ffi.ptr(descriptor),
      )
      return { error, descriptor: descriptor[0] ?? 0n }
    },
    openPipe: (path, access) => {
      const handle = system.CreateFileW(
        ffi.ptr(wideString(path)),
        access,
        NO_SHARING,
        null,
        OPEN_EXISTING,
        FILE_FLAG_OVERLAPPED,
        0n,
      )
      if (handle === INVALID_HANDLE_VALUE) return { handle: null, error: system.GetLastError() }
      return { handle, error: ERROR_SUCCESS }
    },
    setHandle: (handle, owner, dacl) =>
      security.SetSecurityInfo(
        handle,
        SE_KERNEL_OBJECT,
        SET_INFORMATION,
        ffi.ptr(owner),
        null,
        ffi.ptr(dacl),
        null,
      ),
    getHandle: (handle) => {
      const descriptor = out()
      const error = security.GetSecurityInfo(
        handle,
        SE_KERNEL_OBJECT,
        READ_INFORMATION,
        null,
        null,
        null,
        null,
        ffi.ptr(descriptor),
      )
      return { error, descriptor: descriptor[0] ?? 0n }
    },
    takeDescriptor: (descriptor) => {
      try {
        const bytes = new Uint8Array(security.GetSecurityDescriptorLength(descriptor))
        system.RtlMoveMemory(ffi.ptr(bytes), descriptor, BigInt(bytes.byteLength))
        return bytes
      } finally {
        system.LocalFree(descriptor)
      }
    },
    closeHandle: (handle) => {
      system.CloseHandle(handle)
    },
  } satisfies WindowsSecurityKernel
}

let boundKernel: WindowsSecurityKernel | null = null

/** The calls, bound on first use. */
export function windowsSecurityKernel() {
  if (boundKernel) return boundKernel
  const ffi: unknown = createRequire(import.meta.url)('bun:ffi')
  if (!isBunFfi(ffi)) throw new Error('bun:ffi is not available in this runtime.')
  boundKernel = bindKernel(ffi)
  return boundKernel
}

export const secureWindowsUserOnly: WindowsUserOnlySecurity = async (targets) =>
  secureWindowsUserOnlyWith(windowsSecurityKernel(), targets)

import type * as BunFfi from 'bun:ffi'
import { win32 } from 'node:path'

/**
 * Starts a detached, windowless Windows process with `CreateProcessW`, through `bun:ffi`: the
 * Session Host the GUI or a CLI call launches. libuv, which Bun's `spawn` uses on Windows, lets a
 * child inherit handles outside its stdio mapping, so the Host would keep the launcher's pipes and
 * files open for its whole life. `CreateProcessW` with `bInheritHandles = FALSE` passes none.
 *
 * The child gets `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` (no console, no Ctrl+C from the
 * launcher's group), a hidden window (`STARTF_USESHOWWINDOW`, `SW_HIDE`) and exactly the given
 * environment as a Unicode block, plus the variables libuv adds to every child it starts.
 */
const MAX_COMMAND_LINE_LENGTH = 32_766
const DETACHED_PROCESS = 0x0000_0008
const CREATE_NEW_PROCESS_GROUP = 0x0000_0200
const CREATE_UNICODE_ENVIRONMENT = 0x0000_0400
const STARTF_USESHOWWINDOW = 0x0000_0001
const SW_HIDE = 0
const NO_INHERITED_HANDLES = 0
export const WINDOWS_HEADLESS_CREATION_FLAGS =
  DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT

/** `STARTUPINFOW` and `PROCESS_INFORMATION` on 64-bit Windows (x64 and arm64). */
const STARTUP_INFO_BYTES = 104
const STARTUP_FLAGS_OFFSET = 60
const STARTUP_SHOW_WINDOW_OFFSET = 64
const PROCESS_INFORMATION_BYTES = 24
const PROCESS_HANDLE_OFFSET = 0
const THREAD_HANDLE_OFFSET = 8

/** What libuv copies from the parent into every child environment that lacks them. */
export const WINDOWS_CHILD_REQUIRED_VARIABLES = [
  'HOMEDRIVE',
  'HOMEPATH',
  'LOGONSERVER',
  'PATH',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TEMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
] as const

type Environment = Readonly<Record<string, string | undefined>>

export interface WindowsHeadlessLaunchInput {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: Environment
  /** The launcher's own values of `WINDOWS_CHILD_REQUIRED_VARIABLES`. */
  readonly inherited: Environment
}

/** The kernel32 calls a launch makes; buffers are passed as pointers. */
export interface WindowsProcessKernel {
  readonly createProcess: (call: {
    readonly application: Uint8Array
    readonly commandLine: Uint8Array
    readonly inheritHandles: number
    readonly creationFlags: number
    readonly environment: Uint8Array
    readonly startupInfo: Uint8Array
    readonly processInformation: Uint8Array
  }) => boolean
  readonly lastError: () => number
  readonly closeHandle: (handle: bigint) => boolean
}

function quoteArgument(argument: string) {
  // Windows CRT parsing doubles backslashes before a quote and the closing quote.
  return `"${argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`
}

export function windowsHeadlessCommandLine(command: string, args: readonly string[]) {
  if (!command || !win32.isAbsolute(command) || !/\.exe$/iu.test(command)) {
    throw new Error('The Windows headless executable must be an absolute .exe path.')
  }
  const values = [command, ...args]
  if (values.some((value) => value.includes('\0'))) {
    throw new Error('Windows headless process arguments must not contain NUL.')
  }
  const commandLine = values.map(quoteArgument).join(' ')
  if (commandLine.length > MAX_COMMAND_LINE_LENGTH) {
    throw new Error('Windows headless process arguments exceed the Windows command-line limit.')
  }
  return commandLine
}

function wideString(text: string) {
  return Buffer.from(`${text}\0`, 'utf16le')
}

/**
 * The environment as `CreateProcessW` takes it with `CREATE_UNICODE_ENVIRONMENT`: `NAME=value`
 * strings in UTF-16, sorted by name without regard to case as Windows expects, ending in an empty
 * string. A variable libuv requires and `environment` lacks comes from `parent`.
 */
export function windowsEnvironmentBlock(environment: Environment, parent: Environment) {
  const entries = new Map<string, [string, string]>()
  for (const [name, value] of Object.entries(environment)) {
    if (name.includes('\0') || value?.includes('\0')) {
      throw new Error('Windows headless process environment must not contain NUL.')
    }
    if (value === undefined) continue
    // A leading `=` names a per-drive directory (`=C:`); any other `=` would split the name.
    if (name.length === 0 || name.slice(1).includes('=')) {
      throw new Error('Windows headless process environment has an invalid variable name.')
    }
    entries.set(name.toUpperCase(), [name, value])
  }
  const parentByName = new Map(
    Object.entries(parent).map(([name, value]) => [name.toUpperCase(), [name, value] as const]),
  )
  for (const required of WINDOWS_CHILD_REQUIRED_VARIABLES) {
    const inherited = parentByName.get(required)
    if (entries.has(required) || inherited?.[1] === undefined) continue
    if (inherited[1].includes('\0')) continue
    entries.set(required, [inherited[0], inherited[1]])
  }
  const sorted = [...entries.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
  return Buffer.from(
    `${sorted.map(([, [name, value]]) => `${name}=${value}\0`).join('')}\0`,
    'utf16le',
  )
}

function startupInfo() {
  const startup = Buffer.alloc(STARTUP_INFO_BYTES)
  startup.writeUInt32LE(STARTUP_INFO_BYTES, 0)
  startup.writeUInt32LE(STARTF_USESHOWWINDOW, STARTUP_FLAGS_OFFSET)
  startup.writeUInt16LE(SW_HIDE, STARTUP_SHOW_WINDOW_OFFSET)
  return startup
}

/** Starts the process and closes both of its handles; throws with the Win32 error code. */
export function createWindowsHeadlessProcess(
  kernel: WindowsProcessKernel,
  input: WindowsHeadlessLaunchInput,
) {
  const commandLine = windowsHeadlessCommandLine(input.command, input.args)
  const environment = windowsEnvironmentBlock(input.environment, input.inherited)
  const processInformation = Buffer.alloc(PROCESS_INFORMATION_BYTES)
  const created = kernel.createProcess({
    application: wideString(input.command),
    // CreateProcessW may write into its command line, so it gets a buffer of its own.
    commandLine: wideString(commandLine),
    inheritHandles: NO_INHERITED_HANDLES,
    creationFlags: WINDOWS_HEADLESS_CREATION_FLAGS,
    environment,
    startupInfo: startupInfo(),
    processInformation,
  })
  if (!created) {
    throw new Error(
      `Windows headless process launch failed at create-process (Win32 code ${String(kernel.lastError())}).`,
    )
  }
  const threadClosed = kernel.closeHandle(processInformation.readBigUInt64LE(THREAD_HANDLE_OFFSET))
  const processClosed = kernel.closeHandle(
    processInformation.readBigUInt64LE(PROCESS_HANDLE_OFFSET),
  )
  if (!threadClosed || !processClosed) {
    throw new Error(
      `Windows headless process launch failed at close-handle (Win32 code ${String(kernel.lastError())}).`,
    )
  }
}

function kernel32(ffi: typeof BunFfi): WindowsProcessKernel {
  if (process.arch !== 'x64' && process.arch !== 'arm64') {
    throw new Error(`Windows headless process launch does not support ${process.arch}.`)
  }
  const library = ffi.dlopen('kernel32.dll', {
    CreateProcessW: {
      args: ['ptr', 'ptr', 'ptr', 'ptr', 'i32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'],
      returns: 'i32',
    },
    CloseHandle: { args: ['u64'], returns: 'i32' },
    GetLastError: { args: [], returns: 'u32' },
  })
  const { CreateProcessW, CloseHandle, GetLastError } = library.symbols
  return {
    createProcess: (call) =>
      CreateProcessW(
        ffi.ptr(call.application),
        ffi.ptr(call.commandLine),
        null,
        null,
        call.inheritHandles,
        call.creationFlags,
        ffi.ptr(call.environment),
        null,
        ffi.ptr(call.startupInfo),
        ffi.ptr(call.processInformation),
      ) !== 0,
    lastError: () => GetLastError(),
    closeHandle: (handle) => CloseHandle(handle) !== 0,
  }
}

let loadedKernel: Promise<WindowsProcessKernel> | null = null

function loadKernel32() {
  loadedKernel ??= import('bun:ffi').then(kernel32)
  return loadedKernel
}

export async function launchWindowsHeadlessProcess(
  input: WindowsHeadlessLaunchInput,
  loadKernel: () => Promise<WindowsProcessKernel> = loadKernel32,
): Promise<void> {
  // Validated before the library loads, so bad input fails the same way everywhere.
  windowsHeadlessCommandLine(input.command, input.args)
  windowsEnvironmentBlock(input.environment, input.inherited)
  createWindowsHeadlessProcess(await loadKernel(), input)
}

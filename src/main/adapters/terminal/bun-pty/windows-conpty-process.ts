import type { Pointer } from 'bun:ffi'
import type { PtySpawnOptions } from '../terminal-pty-backend'
import { windowsCommandLine, windowsEnvironmentBlock } from './windows-command-line'
import { LAYOUT, readHandle, WIN32, wideString, type Win32 } from './windows-ffi'

/**
 * The Win32 objects behind one ConPTY terminal (ADR 0064): its pipes, pseudoconsole, Job Object
 * and suspended-then-resumed shell, plus the polls that read the root's exit and the Job's
 * process count.
 */
const PIPE_BUFFER_BYTES = 1024 * 1024
const COORD_Y_SHIFT = 16
const COORD_MASK = 0xffff
const TERMINATED_EXIT_CODE = 1
const PROCESS_INFORMATION_HANDLES = 2
const S_OK = 0
const PIPE_ENDS = 2

export function coord(cols: number, rows: number) {
  return ((rows & COORD_MASK) << COORD_Y_SHIFT) | (cols & COORD_MASK)
}

export interface Pipes {
  readonly inputRead: Pointer
  readonly inputWrite: Pointer
  readonly outputRead: Pointer
  readonly outputWrite: Pointer
}

/** One anonymous pipe: its read end and its write end. */
function createPipe(win32: Win32) {
  const { kernel32, ffi } = win32
  const ends = new BigUint64Array(PIPE_ENDS)
  const created = kernel32.CreatePipe(
    ffi.ptr(ends.subarray(0, 1)),
    ffi.ptr(ends.subarray(1)),
    null,
    PIPE_BUFFER_BYTES,
  )
  const read = readHandle(ends, 0)
  const write = readHandle(ends, 1)
  if (created === 0 || !read || !write) {
    if (read) kernel32.CloseHandle(read)
    if (write) kernel32.CloseHandle(write)
    throw new Error('Could not create the terminal pipes.')
  }
  return { read, write }
}

export function createPipes(win32: Win32) {
  const input = createPipe(win32)
  try {
    const output = createPipe(win32)
    return {
      inputRead: input.read,
      inputWrite: input.write,
      outputRead: output.read,
      outputWrite: output.write,
    }
  } catch (error) {
    win32.kernel32.CloseHandle(input.read)
    win32.kernel32.CloseHandle(input.write)
    throw error
  }
}

export function createJob(win32: Win32) {
  const { kernel32, ffi } = win32
  const job = kernel32.CreateJobObjectW(null, null)
  if (job === null) throw new Error('Could not create the terminal Job Object.')
  const limits = new Uint8Array(LAYOUT.extendedLimitInformation.bytes)
  new DataView(limits.buffer).setUint32(
    LAYOUT.extendedLimitInformation.limitFlags,
    WIN32.jobObjectLimitKillOnJobClose,
    true,
  )
  const configured = kernel32.SetInformationJobObject(
    job,
    WIN32.jobObjectExtendedLimitInformation,
    ffi.ptr(limits),
    limits.length,
  )
  if (configured === 0) {
    kernel32.CloseHandle(job)
    throw new Error('Could not configure the terminal Job Object.')
  }
  return job
}

function attributeList(win32: Win32, console: Pointer) {
  const { kernel32, ffi } = win32
  const size = new BigUint64Array(1)
  kernel32.InitializeProcThreadAttributeList(null, 1, 0, ffi.ptr(size))
  const list = new Uint8Array(Number(size[0] ?? 0n))
  if (
    list.length === 0 ||
    kernel32.InitializeProcThreadAttributeList(ffi.ptr(list), 1, 0, ffi.ptr(size)) === 0
  ) {
    throw new Error('Could not prepare the terminal process attributes.')
  }
  const updated = kernel32.UpdateProcThreadAttribute(
    ffi.ptr(list),
    0,
    WIN32.procThreadAttributePseudoConsole,
    console,
    BigInt(LAYOUT.handleBytes),
    null,
    null,
  )
  if (updated === 0) {
    kernel32.DeleteProcThreadAttributeList(ffi.ptr(list))
    throw new Error('Could not attach the pseudoconsole to the terminal process.')
  }
  return list
}

export interface Started {
  readonly pid: number
  readonly process: Pointer
}

export function startProcess(
  win32: Win32,
  console: Pointer,
  job: Pointer,
  file: string,
  args: readonly string[],
  options: PtySpawnOptions,
) {
  const { kernel32, ffi } = win32
  const list = attributeList(win32, console)
  try {
    const startup = new Uint8Array(LAYOUT.startupInfoEx.bytes)
    const view = new DataView(startup.buffer)
    view.setUint32(LAYOUT.startupInfoEx.cb, LAYOUT.startupInfoEx.bytes, true)
    // Null standard handles keep the shell off this process's own console and pipes.
    view.setUint32(LAYOUT.startupInfoEx.flags, WIN32.startfUseStdHandles, true)
    view.setBigUint64(LAYOUT.startupInfoEx.attributeList, BigInt(ffi.ptr(list)), true)
    const information = new Uint8Array(LAYOUT.processInformation.bytes)
    const commandLine = wideString(windowsCommandLine(file, args))
    const environment = windowsEnvironmentBlock({ ...options.env, TERM: options.name })
    const cwd = wideString(options.cwd)
    const created = kernel32.CreateProcessW(
      null,
      ffi.ptr(commandLine),
      null,
      null,
      0,
      WIN32.extendedStartupInfoPresent | WIN32.createUnicodeEnvironment | WIN32.createSuspended,
      ffi.ptr(environment),
      ffi.ptr(cwd),
      ffi.ptr(startup),
      ffi.ptr(information),
    )
    if (created === 0) {
      throw new Error(`Could not start ${file} (Windows error ${String(kernel32.GetLastError())}).`)
    }
    const slots = new BigUint64Array(information.buffer, 0, PROCESS_INFORMATION_HANDLES)
    const process = readHandle(slots, 0)
    const thread = readHandle(slots, 1)
    const pid = new DataView(information.buffer).getUint32(
      LAYOUT.processInformation.processId,
      true,
    )
    if (!process || !thread) throw new Error('Windows returned no handle for the terminal process.')
    try {
      if (kernel32.AssignProcessToJobObject(job, process) === 0) {
        kernel32.TerminateProcess(process, TERMINATED_EXIT_CODE)
        kernel32.CloseHandle(process)
        throw new Error('Could not place the terminal process in its Job Object.')
      }
      kernel32.ResumeThread(thread)
    } finally {
      kernel32.CloseHandle(thread)
    }
    return { pid, process } satisfies Started
  } finally {
    kernel32.DeleteProcThreadAttributeList(ffi.ptr(list))
  }
}

export function rootExitCode(win32: Win32, process: Pointer) {
  const { kernel32, ffi } = win32
  if (kernel32.WaitForSingleObject(process, 0) !== WIN32.waitObject0) return null
  const code = new Uint32Array(1)
  if (kernel32.GetExitCodeProcess(process, ffi.ptr(code)) === 0) return null
  const value = code[0] ?? 0
  return value === WIN32.stillActive ? null : value
}

export function activeJobProcesses(win32: Win32, job: Pointer) {
  const { kernel32, ffi } = win32
  const accounting = new Uint8Array(LAYOUT.basicAccounting.bytes)
  const ok = kernel32.QueryInformationJobObject(
    job,
    WIN32.jobObjectBasicAccountingInformation,
    ffi.ptr(accounting),
    accounting.length,
    null,
  )
  if (ok === 0) return null
  return new DataView(accounting.buffer).getUint32(LAYOUT.basicAccounting.activeProcesses, true)
}

export function createConsole(win32: Win32, pipes: Pipes, cols: number, rows: number) {
  const { kernel32, ffi } = win32
  const slot = new BigUint64Array(1)
  const result = kernel32.CreatePseudoConsole(
    coord(cols, rows),
    pipes.inputRead,
    pipes.outputWrite,
    0,
    ffi.ptr(slot),
  )
  const console = readHandle(slot)
  if (result !== S_OK || !console) throw new Error('Could not create the pseudoconsole.')
  return console
}

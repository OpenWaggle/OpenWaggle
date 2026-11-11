import type { Pointer } from 'bun:ffi'
import type {
  Pty,
  PtyDisposable,
  PtyExitEvent,
  PtyModule,
  PtySpawnOptions,
} from '../terminal-pty-backend'
import { ptyEvent, ptyOutput } from './pty-output'
import {
  activeJobProcesses,
  coord,
  createConsole,
  createJob,
  createPipes,
  type Pipes,
  rootExitCode,
  startProcess,
} from './windows-conpty-process'
import { startConptyReader } from './windows-conpty-reader'
import { loadWin32, type Win32 } from './windows-ffi'
import { readWindowsListeningPorts, readWindowsProcessTable } from './windows-telemetry'

/**
 * A Windows pseudo-terminal on ConPTY through `bun:ffi` (ADR 0030, ADR 0064), in place of the
 * patched node-pty addon. The shell starts suspended, joins a kill-on-close Job Object, then
 * resumes, so every descendant belongs to the Job before it can run. A reader Worker drains the
 * output pipe with blocking reads; the root's exit, the Job's process count and the reader's
 * end give `onExit`, `onProcessTreeExit` and `waitForResourceDrain`, in that order of proof:
 *
 * - the root exits: the pseudoconsole is closed, which ends the output pipe;
 * - the output pipe ends and the root's exit code is known: `onExit`;
 * - the Job has no process left: `onProcessTreeExit`, then the Job handle closes.
 *
 * `closeDescriptor` terminates the Job, which is what node-pty's patched close did by closing
 * its kill-on-close Job handle.
 */
const EXIT_POLL_MS = 25
const TERMINATED_EXIT_CODE = 1

export interface WindowsPty extends Pty {
  readonly closeDescriptor: () => void
  readonly waitForResourceDrain: () => Promise<void>
  readonly onProcessTreeExit: (listener: (event: PtyExitEvent) => void) => PtyDisposable
}

interface Handles {
  console: Pointer | null
  job: Pointer | null
  process: Pointer | null
  inputWrite: Pointer | null
}

class ConptyTerminal {
  readonly output = ptyOutput()
  readonly exit = ptyEvent<PtyExitEvent>()
  readonly treeExit = ptyEvent<PtyExitEvent>()
  readonly drained: Promise<void>
  private exitCode: number | null = null
  private outputEnded = false
  private exitEmitted = false
  private treeExited = false
  private resolveDrain: () => void = () => undefined
  private rejectDrain: (error: Error) => void = () => undefined
  private readonly poll: ReturnType<typeof setInterval>
  private readonly win32: Win32
  private readonly handles: Handles

  constructor(win32: Win32, handles: Handles, outputRead: Pointer) {
    this.win32 = win32
    this.handles = handles
    this.drained = new Promise<void>((resolve, reject) => {
      this.resolveDrain = resolve
      this.rejectDrain = reject
    })
    startConptyReader(outputRead, {
      data: (bytes) => this.output.push(bytes),
      end: (error) => {
        this.outputEnded = true
        win32.kernel32.CloseHandle(outputRead)
        if (error) this.rejectDrain(error)
        this.finish()
      },
    })
    this.poll = setInterval(() => this.check(), EXIT_POLL_MS)
  }

  write(text: string) {
    const input = this.handles.inputWrite
    if (input === null) return
    const { kernel32, ffi } = this.win32
    const bytes = new TextEncoder().encode(text)
    const written = new Uint32Array(1)
    kernel32.WriteFile(input, ffi.ptr(bytes), bytes.length, ffi.ptr(written), null)
  }

  resize(cols: number, rows: number) {
    if (this.handles.console) {
      this.win32.kernel32.ResizePseudoConsole(this.handles.console, coord(cols, rows))
    }
  }

  /** Terminates the Job; that and the closed pseudoconsole end the output pipe and the reader. */
  closeDescriptor() {
    if (this.handles.job) {
      this.win32.kernel32.TerminateJobObject(this.handles.job, TERMINATED_EXIT_CODE)
    }
    this.closeConsole()
    this.close('inputWrite')
  }

  private check() {
    if (this.exitCode === null && this.handles.process) {
      this.exitCode = rootExitCode(this.win32, this.handles.process)
      // Closing the pseudoconsole ends the output pipe once ConPTY flushed it.
      if (this.exitCode !== null) this.closeConsole()
    }
    if (!this.treeExited && this.exitCode !== null && this.handles.job) {
      if (activeJobProcesses(this.win32, this.handles.job) === 0) {
        this.treeExited = true
        clearInterval(this.poll)
        this.treeExit.emit({ exitCode: this.exitCode })
      }
    }
    this.finish()
  }

  private finish() {
    if (!this.exitEmitted && this.outputEnded && this.exitCode !== null) {
      this.exitEmitted = true
      this.output.flush()
      this.exit.emit({ exitCode: this.exitCode })
    }
    if (!this.exitEmitted || !this.treeExited) return
    this.close('inputWrite')
    this.close('process')
    this.close('job')
    this.resolveDrain()
  }

  private closeConsole() {
    const console = this.handles.console
    if (console === null) return
    this.handles.console = null
    this.win32.kernel32.ClosePseudoConsole(console)
  }

  private close(name: 'inputWrite' | 'process' | 'job') {
    const handle = this.handles[name]
    if (handle === null) return
    this.handles[name] = null
    this.win32.kernel32.CloseHandle(handle)
  }
}

function closeAll(win32: Win32, pipes: Pipes, job: Pointer | null, console: Pointer | null) {
  if (job) win32.kernel32.CloseHandle(job)
  if (console) win32.kernel32.ClosePseudoConsole(console)
  for (const handle of [pipes.inputRead, pipes.inputWrite, pipes.outputRead, pipes.outputWrite]) {
    win32.kernel32.CloseHandle(handle)
  }
}

export function spawnWindowsPty(
  win32: Win32,
  file: string,
  args: readonly string[],
  options: PtySpawnOptions,
): WindowsPty {
  const pipes = createPipes(win32)
  let console: Pointer | null = null
  let job: Pointer | null = null
  let started: ReturnType<typeof startProcess>
  try {
    console = createConsole(win32, pipes, options.cols, options.rows)
    job = createJob(win32)
    started = startProcess(win32, console, job, file, args, options)
  } catch (error) {
    closeAll(win32, pipes, job, console)
    throw error
  }
  // ConPTY holds its own duplicates; this process keeps only the input write and output read.
  win32.kernel32.CloseHandle(pipes.inputRead)
  win32.kernel32.CloseHandle(pipes.outputWrite)
  const terminal = new ConptyTerminal(
    win32,
    { console, job, process: started.process, inputWrite: pipes.inputWrite },
    pipes.outputRead,
  )
  const closeDescriptor = () => terminal.closeDescriptor()
  return {
    pid: started.pid,
    onData: terminal.output.onData,
    onExit: terminal.exit.add,
    onProcessTreeExit: terminal.treeExit.add,
    write: (text) => terminal.write(text),
    resize: (cols, rows) => terminal.resize(cols, rows),
    clear: () => undefined,
    // Windows has no signals: killing the terminal terminates its Job.
    kill: closeDescriptor,
    pause: terminal.output.pause,
    resume: terminal.output.resume,
    closeDescriptor,
    waitForResourceDrain: () => terminal.drained,
  }
}

export async function loadWindowsPtyModule(): Promise<PtyModule> {
  const win32 = await loadWin32()
  return {
    spawn: (file, args, options) => spawnWindowsPty(win32, file, args, options),
    processTable: async () => readWindowsProcessTable(win32),
    listeningPorts: async () => readWindowsListeningPorts(win32),
  }
}

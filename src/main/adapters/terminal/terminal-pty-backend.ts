/**
 * The shapes the terminal runtime needs from its PTY backend (ADR 0030, ADR 0064). They are the
 * parts of node-pty's API the runtime used, plus the process-identity extensions OpenWaggle used
 * to patch into it; `bun-pty/` implements them on `Bun.spawn({ terminal })` and ConPTY.
 */

export interface PtyDisposable {
  readonly dispose: () => void
}

export interface PtyExitEvent {
  readonly exitCode: number
  readonly signal?: number
}

export interface PtySpawnOptions {
  readonly name: string
  readonly cols: number
  readonly rows: number
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

/** One spawned pseudo-terminal and its root process. */
export interface Pty {
  readonly pid: number
  readonly onData: (listener: (data: string) => void) => PtyDisposable
  readonly onExit: (listener: (event: PtyExitEvent) => void) => PtyDisposable
  readonly write: (data: string) => void
  readonly resize: (cols: number, rows: number) => void
  readonly clear: () => void
  /** Signals the root process; the backend never signals a recycled pid. */
  readonly kill: (signal?: string) => void
  /** Stops and restarts delivering output (node-pty's flow control). */
  readonly pause: () => void
  readonly resume: () => void
}

/** A process as the kernel reports it; `startedAt` is its birth identity, never reused. */
export interface PtyKernelProcessInfo {
  readonly pid: number
  readonly startedAt: string
  readonly ppid: number
  readonly pgid: number
  readonly tpgid: number
  readonly ttyIdentity: string | null
  readonly zombie: boolean
  readonly name: string
}

/**
 * POSIX process identity primitives. `signalProcess` returns 1 when it signaled, 0 when the
 * process is gone, -1 when the pid now names another process, -2 on failure; `signalByTty`
 * returns how many processes it signaled, or -1 when it could not prove the terminal's identity.
 */
export interface PtyKernel {
  readonly processInfos: (pids: readonly number[]) => PtyKernelProcessInfo[]
  readonly signalProcess: (pid: number, processIdentity: string, signal: number) => number
  readonly signalByTty: (
    fd: number,
    ttyIdentity: string,
    rootPid: number,
    rootIdentity: string,
    signal: number,
  ) => number
}

export interface PtyModule {
  readonly spawn: (file: string, args: readonly string[], options: PtySpawnOptions) => Pty
  readonly native?: PtyKernel
  /** Windows: every process with its parent and start time (Toolhelp and process times). */
  readonly processTable?: () => unknown
  /** Windows: listening TCP sockets with their owning process. */
  readonly listeningPorts?: () => unknown
}

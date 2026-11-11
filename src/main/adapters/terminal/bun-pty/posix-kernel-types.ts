import type * as BunFfi from 'bun:ffi'
import type { PtyKernelProcessInfo } from '../terminal-pty-backend'

export type Ffi = typeof BunFfi

/** A read of one process: found, gone, or the kernel would not say. */
export type ProcessRead =
  | { readonly status: 'found'; readonly info: PtyKernelProcessInfo; readonly uid: number }
  | { readonly status: 'absent' }
  | { readonly status: 'error' }

/** What `signalProcess` answers, as the patched node-pty addon did. */
export const SIGNAL_RESULT = { signaled: 1, absent: 0, mismatch: -1, failed: -2 } as const
export type SignalResult = (typeof SIGNAL_RESULT)[keyof typeof SIGNAL_RESULT]

export interface PlatformKernel {
  readonly read: (pid: number) => ProcessRead
  readonly signal: (pid: number, identity: string, signal: number) => SignalResult
  readonly listPids: () => number[] | null
  /** The path of the process's controlling tty (`/dev/ttys004`, `/dev/pts/3`), if it has one. */
  readonly ttyPath: (pid: number) => string | null
}

export const MAX_LISTED_PIDS = 65_536

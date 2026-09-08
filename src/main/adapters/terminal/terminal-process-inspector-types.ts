import type { TerminalKey } from '@shared/types/terminal'
import type { TerminalProcessIdentity } from './terminal-process-identity'

export interface TerminalProcessActivitySnapshot {
  readonly processName: string | null
  /** Every descendant process, including background jobs, nearest first. */
  readonly processNames: readonly string[]
  /** Root shell plus every observed descendant, used for tree shutdown. */
  readonly processPids: readonly number[]
  /** PID plus process birth identity for safe detached-child shutdown. */
  readonly processIdentities: readonly TerminalProcessIdentity[]
  /** Controlling tty used for bounded process-tree shutdown probes. */
  readonly tty: string | null
  readonly ports: readonly number[]
  /** True when this exact process-table observation completed. */
  readonly processReliable: boolean
  /** False when a process or port probe failed and close safety is uncertain. */
  readonly reliable: boolean
}

export interface InspectorTarget {
  readonly key: TerminalKey
  readonly pid: number
  readonly tty: string | null
  readonly ttyIdentity: string | null
  readonly processIdentity: TerminalProcessIdentity | null
}

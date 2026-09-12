import type {
  TerminalId,
  TerminalInputIdentity,
  TerminalInputIntent,
  TerminalKey,
  TerminalOwnerKey,
  TerminalPortPreview,
  TerminalReadinessPhase,
  TerminalRuntimeEvent,
} from '@shared/types/terminal'
import type { IPty } from 'node-pty'
import type { TerminalHistorySanitizer } from './terminal-history-sanitizer'
import type { TerminalProcessIdentity, TerminalProcessMetadata } from './terminal-process-identity'
import type { TerminalPromptReadinessDetector } from './terminal-prompt-readiness'
import type { TerminalScrollback } from './terminal-scrollback'

/** Monotonic observation installed before a spawned PTY can leave the runner. */
export interface TerminalProcessExitObservation {
  readonly whenExited: Promise<void>
  exitCode: number | null
  readonly notifyExit: (exitCode: unknown) => void
  readonly dispose: () => void
}

/** Native backend resources are released independently from process-tree exit on Windows. */
export interface TerminalResourceDrainObservation {
  readonly whenDrained: Promise<boolean>
  readonly status: 'pending' | 'drained' | 'failed'
}

export interface LiveTerminalProcess {
  readonly pty: IPty
  readonly pid: number
  readonly pauseOutput: () => void
  readonly resumeOutput: () => void
  /** Native, descriptor-bound signal for every same-user member of this PTY. */
  readonly signalTtyMembers?: (force: boolean) => number | null
  /** Controlling tty captured after spawn for bounded shutdown checks. */
  tty: string | null
  /** Exact slave device captured from the owned PTY master. */
  readonly ttyIdentity: string | null
  /** Root birth identity captured by the targeted spawn-time process probe. */
  processIdentity: TerminalProcessIdentity | null
  /** The same bounded probe can still be running when an immediate close arrives. */
  readonly processMetadata: Promise<TerminalProcessMetadata | null>
  /** Spawn-time latch; remains valid after the process leaves its public record. */
  readonly exit: TerminalProcessExitObservation
  /** Job/child-tree proof; intentionally distinct from final buffered-output exit. */
  readonly processTreeExit: TerminalProcessExitObservation
  /** Worker, pseudoconsole, pipe, and native handle drain owned past tree exit. */
  readonly resourceDrain: TerminalResourceDrainObservation
  outputPaused: boolean
}

/**
 * Private ownership for a PTY that left its live record before every observed
 * process and native resource was proven gone.
 */
export interface RetainedTerminalProcess {
  readonly live: LiveTerminalProcess
  readonly owner: TerminalRecord
  /** The Job/tree termination gate passed; only native resource drain remains. */
  terminationCommitted: boolean
  /** Natural exits become eligible for bounded inactive-record pruning after proof. */
  readonly markOwnerInactiveOnRelease: boolean
  processPids: number[]
  processIdentities: TerminalProcessIdentity[]
}

export interface InFlightTerminalOutput {
  readonly event: Extract<TerminalRuntimeEvent, { type: 'output' }>
  readonly byteLength: number
}

export interface TerminalOwnerMigrationState {
  readonly targetOwnerKey: TerminalOwnerKey
  historyBuffer: string
}

export interface TerminalActivityState {
  /** Foreground child process selected by the shared process inspector. */
  readonly processName: string | null
  readonly processNames: readonly string[]
  readonly ports: readonly number[]
  readonly portPreviews?: readonly TerminalPortPreview[]
  /** Root shell plus its last observed descendant process ids. */
  readonly processPids: readonly number[]
  /** Stable identities prevent a recycled detached-child PID from being signaled. */
  readonly processIdentities: readonly TerminalProcessIdentity[]
  /** Controlling tty used for a bounded process-tree shutdown snapshot. */
  readonly tty: string | null
  /** The process table completed for this exact observation. */
  readonly processReliable: boolean
  /** Both process and listening-port probes completed successfully. */
  readonly reliable: boolean
}

export interface TerminalTerminationState {
  readonly pty: IPty
  readonly result: Promise<boolean>
  readonly whenExited: Promise<void>
  readonly exitCode: number | null
  readonly notifyExit: (exitCode: unknown) => void
}

export interface TerminalInputReceipt {
  readonly identity: TerminalInputIdentity
  readonly data: string
  readonly intent?: TerminalInputIntent
  readonly acceptedBytes: number
  readonly status: 'written' | 'queued'
}

export interface PendingTerminalInputPart {
  readonly data: string
  readonly intent?: TerminalInputIntent
}

export interface TerminalProjectActionState {
  readonly executionId: string
  /** Prompt epoch at which the whole command entered the PTY, null while queued. */
  deliveredAfterPromptEpoch: number | null
  /** Reliable inspector fallback: a real descendant was observed after delivery. */
  sawRunning: boolean
  /** Monotonic delivery time used when a short command falls between inspector polls. */
  deliveredAtMonotonicMs: number | null
  /** Consecutive reliable idle polls observed after delivery. */
  reliableIdleObservations: number
}

/**
 * Main-process registry record for one Session terminal (ADR 0030): the shell
 * process while live, plus the scrollback and launch context that survive it.
 */
export interface TerminalRecord {
  /** Immutable native record identity; shell restarts preserve it, record recreation does not. */
  readonly inputIncarnation: string
  key: TerminalKey
  ownerKey: string
  readonly terminalId: TerminalId
  /** Launch context Working path; changes only across respawn. */
  cwd: string
  /** Canonical explicit overrides layered over the inferred shell environment. */
  env: Readonly<Record<string, string>>
  readonly scrollback: TerminalScrollback
  sanitizer: TerminalHistorySanitizer
  pendingOutput: string
  /**
   * User input held until the shell produces its first output. Without this,
   * keys typed during shell startup are kernel-echoed straight into the
   * scrollback as garbage (the tty discipline echoes while the shell is still
   * sourcing its rc files).
   */
  pendingInput: PendingTerminalInputPart[]
  pendingInputBytes: number
  /** Active renderer input stream; older renderer generations are rejected. */
  inputGeneration: string | null
  /** Last accepted chunk, retained to make ambiguous retries idempotent. */
  lastInputReceipt: TerminalInputReceipt | null
  /** Stream offset before the first byte currently held in pendingOutput. */
  pendingStartOffset: number
  pendingOutputBytes: number
  inFlightOutput: InFlightTerminalOutput | null
  /** Cumulative raw output bytes seen for this terminal's current shell. */
  outputBytes: number
  outputGeneration: number
  spawnGeneration: number
  readinessPhase: TerminalReadinessPhase
  readinessGeneration: number
  promptDetector: TerminalPromptReadinessDetector | null
  /** Count of authenticated prompt-end markers observed for the current shell. */
  promptEpoch: number
  /** Deterministic reuse barrier for one accepted Project Action execution. */
  projectAction: TerminalProjectActionState | null
  exitCode: number | null
  /** Closed terminals drop further PTY output instead of resurrecting history. */
  closed: boolean
  live: LiveTerminalProcess | null
  /** Tree-dead PTYs still delivering their final lossless output stage. */
  readonly drainingProcesses: Set<LiveTerminalProcess>
  /** A close/restart waits on this exact PTY's exit before mutating UI state. */
  termination: TerminalTerminationState | null
  activity: TerminalActivityState | null
  ownerMigration: TerminalOwnerMigrationState | null
}

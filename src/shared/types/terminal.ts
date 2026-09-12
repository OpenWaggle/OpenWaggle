/**
 * Terminal domain types shared between main, preload, and renderer.
 *
 * Every terminal is a Session terminal (ADR 0030): it belongs to exactly one
 * terminal owner — a durable session or the pre-send draft — and its shell
 * starts in that owner's Working path.
 */

/**
 * Owner of a terminal group: a durable session id, or a draft key
 * (`draft:<projectPath>`) while the session has not been created by first send.
 */
export type TerminalOwnerKey = string

/** Client-chosen terminal id, unique within one Terminal owner key. */
export type TerminalId = string

export const TERMINAL_KEY_SEPARATOR = '::'

/** Stable identity of one terminal across restarts: `<ownerKey>::<terminalId>`. */
export type TerminalKey = string

/** Input that (re)opens a terminal. Idempotent: same launch context reuses the live shell. */
export interface TerminalOpenInput {
  readonly ownerKey: TerminalOwnerKey
  readonly terminalId: TerminalId
  /** Absolute working path the shell starts in — the owner's Working path. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  /**
   * Explicit launch environment layered over a fresh inferred user shell
   * environment. Omission preserves a terminal record's current overrides;
   * an object, including `{}`, is a new launch context.
   */
  readonly env?: Readonly<Record<string, string>>
  /**
   * Renderer-runtime nonce for the ordered input stream. Re-attaches with a
   * new nonce revoke late writes from an older renderer while restarts keep
   * the same nonce and therefore preserve accepted startup input.
   */
  readonly inputGeneration?: string
}

/** Idempotency identity for one ordered renderer-to-terminal input chunk. */
export interface TerminalInputIdentity {
  readonly generation: string
  readonly sequence: number
}

/** Semantic intent carried with an ordered input item when it needs main-process arbitration. */
export type TerminalInputIntent = {
  readonly kind: 'project-action'
  /** Unique logical execution id; retries must retain this exact value. */
  readonly executionId: string
}

export type TerminalReadinessPhase = 'spawning' | 'awaiting-prompt' | 'ready'

/** A listening socket that answered as a browser-loadable HTTP(S) document. */
export interface TerminalPortPreview {
  /** Concrete listener host, with wildcard listeners normalized to localhost. */
  readonly host: string
  readonly port: number
  /** Verified HTTP(S) URL, including IPv6 brackets when required. */
  readonly url: string
}

export interface TerminalReadinessSnapshot {
  readonly phase: TerminalReadinessPhase
  /** Spawn generation this readiness state describes. */
  readonly generation: number
}

export interface TerminalAttachResult {
  /**
   * Persisted scrollback replay for the terminal, already sanitized so replay
   * never re-triggers terminal query sequences. Empty for a brand-new terminal.
   */
  readonly history: string
  /**
   * Cumulative output-stream bytes covered by `history`. Live `output` events
   * carry start/end offsets into the same stream, so a pane drops the parts of
   * an event it already received via the replay instead of writing them twice.
   */
  readonly outputBytes: number
  /** Output delivery generation used to reject stale events and acknowledgements. */
  readonly outputGeneration: number
  /** Null when no shell exists for the requested Working path. */
  readonly readiness: TerminalReadinessSnapshot | null
  /** Bytes already accepted by main but still held behind prompt readiness. */
  readonly pendingInputBytes?: number
  /** Whether a live shell process is running or a spawn was just requested. */
  readonly running: boolean
  /** Present when no shell is running and the Working path no longer exists. */
  readonly cwdMissing?: boolean
  /** Exit code of the last dead shell, when `running` is false and cwd exists. */
  readonly exitCode?: number
  /** Current foreground child process, resynchronized on every attach. */
  readonly processName: string | null
  /** Current listening ports, resynchronized on every attach. */
  readonly ports: readonly number[]
  /** Browser-loadable endpoints verified from those listeners. */
  readonly portPreviews?: readonly TerminalPortPreview[]
  /** Main has accepted a Project Action that has not yet returned to idle. */
  readonly projectActionPending: boolean
}

export type TerminalRuntimeEvent =
  | {
      readonly type: 'output'
      readonly data: string
      /** Output generation this chunk belongs to. */
      readonly outputGeneration: number
      /** Stream offset of `data`'s first byte. */
      readonly startOffset: number
      /** Stream offset just past `data`'s last byte. */
      readonly endOffset: number
    }
  | { readonly type: 'exited'; readonly exitCode: number }
  | { readonly type: 'closed' }
  | { readonly type: 'cleared'; readonly outputGeneration: number }
  | { readonly type: 'readiness'; readonly readiness: TerminalReadinessSnapshot }
  | { readonly type: 'activity'; readonly processName: string | null }
  | { readonly type: 'ports'; readonly ports: readonly number[] }
  | { readonly type: 'port-previews'; readonly previews: readonly TerminalPortPreview[] }

export interface TerminalEventPayload {
  readonly ownerKey: TerminalOwnerKey
  readonly terminalId: TerminalId
  readonly event: TerminalRuntimeEvent
}

/** Conservative child-process state derived from the shared main-process inspector. */
export type TerminalActivityStatus = 'unknown' | 'idle' | 'running'

/** Global metadata for one unique main-process terminal record. */
export interface TerminalActivitySummary {
  readonly ownerKey: TerminalOwnerKey
  readonly terminalId: TerminalId
  /** Only `running` means a descendant process was actually observed. */
  readonly activityStatus: TerminalActivityStatus
  /** Exact foreground child label when the process inspector has one. */
  readonly processName: string | null
  /** Listening ports owned by the shell process tree. */
  readonly ports: readonly number[]
  /** Browser-loadable endpoints owned by the shell process tree. */
  readonly portPreviews?: readonly TerminalPortPreview[]
  /** Prevents stale-idle snapshots from reusing a terminal for another action. */
  readonly projectActionPending: boolean
}

/**
 * Bounded, race-safe view of all terminal activity records.
 *
 * Events carry the same full snapshot as the initial invoke. A renderer keeps
 * the greatest revision, so a slow invoke response cannot overwrite a newer
 * event received after subscription.
 */
export interface TerminalActivitySnapshot {
  readonly revision: number
  readonly summaries: readonly TerminalActivitySummary[]
  /** True when records beyond the transport bound were conservatively omitted. */
  readonly truncated: boolean
}

export type TerminalWriteResult =
  | {
      readonly status: 'written' | 'queued'
      readonly acceptedBytes: number
      /** Echoes the idempotency identity supplied with this write. */
      readonly identity?: TerminalInputIdentity
    }
  | {
      readonly status: 'rejected'
      readonly acceptedBytes: 0
      readonly reason:
        | 'empty'
        | 'input-too-large'
        | 'queue-full'
        | 'terminal-not-open'
        | 'stale-generation'
        | 'stale-sequence'
        | 'sequence-gap'
        | 'sequence-conflict'
        | 'project-action-pending'
      /** Echoes the idempotency identity supplied with this write. */
      readonly identity?: TerminalInputIdentity
    }

export type TerminalInputReleaseResult =
  | { readonly status: 'released'; readonly releasedBytes: number }
  | { readonly status: 'already-ready'; readonly releasedBytes: 0 }
  | { readonly status: 'terminal-not-open'; readonly releasedBytes: 0 }

export interface TerminalOwnerMigrationResult {
  readonly terminalIds: readonly TerminalId[]
}

export type TerminalCloseAssessment =
  | { readonly disposition: 'safe'; readonly reason: 'dead' | 'idle' }
  | {
      readonly disposition: 'confirm'
      readonly reason: 'active' | 'uncertain'
      readonly processNames: readonly string[]
      readonly ports: readonly number[]
    }

export function terminalKeyOf(ownerKey: TerminalOwnerKey, terminalId: TerminalId): TerminalKey {
  if (terminalId.includes(TERMINAL_KEY_SEPARATOR)) {
    throw new Error(`Terminal ids cannot contain "${TERMINAL_KEY_SEPARATOR}".`)
  }
  return `${ownerKey}${TERMINAL_KEY_SEPARATOR}${terminalId}`
}

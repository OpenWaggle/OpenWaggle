import type { AttachmentKind, AttachmentOrigin, InlineVisualizationContext } from './agent'
import type { WaggleInvocationInput } from './waggle'

export const MAX_FOLLOW_UP_QUEUE_ITEMS = 256

/**
 * The only caller that may edit a queued Follow-up: the desktop app's local user, without a
 * profile, editing a Follow-up it queued itself (ADR 0044).
 */
export const FOLLOW_UP_EDIT_CALLER_ID = 'gui:local-user'

/** Names one Follow-up edit hold (ADR 0044). */
export interface FollowUpEditHoldReference {
  readonly sessionId: string
  readonly followUpId: string
  readonly holdId: string
}

/**
 * Why a Follow-up queue stopped delivering. Recorded when the queue goes from running to paused and
 * cleared on resume, so the queue can say what paused it instead of only that it is paused.
 */
export const FOLLOW_UP_QUEUE_PAUSE_REASONS = [
  'requested',
  'run-failed',
  'run-interrupted',
  'run-timed-out',
  'parent-limit',
  'host-lost',
  'profile-revoked',
] as const

export type FollowUpQueuePauseReason = (typeof FOLLOW_UP_QUEUE_PAUSE_REASONS)[number]

export function isFollowUpQueuePauseReason(value: unknown): value is FollowUpQueuePauseReason {
  return FOLLOW_UP_QUEUE_PAUSE_REASONS.some((reason) => reason === value)
}

export interface SessionControlQueueWithdrawCommand {
  readonly operation: 'queue-withdraw'
  readonly sessionId: string
  readonly followUpIds: readonly string[]
}

export interface SessionControlQueueReorderCommand {
  readonly operation: 'queue-reorder'
  readonly sessionId: string
  readonly expectedQueueRevision: number
  readonly orderedFollowUpIds: readonly string[]
}

export interface SessionControlQueuePauseCommand {
  readonly operation: 'queue-pause'
  readonly sessionId: string
  readonly expectedQueueRevision: number
}

export interface SessionControlQueueResumeCommand {
  readonly operation: 'queue-resume'
  readonly sessionId: string
  readonly expectedQueueRevision: number
}

/**
 * Re-authors a needs-attention Follow-up (`profile_revoked`, `authority_changed`) as the calling
 * desktop user, so it can be delivered under the user's own authority. The Follow-up keeps its
 * content and position; its original author stays as `authorCallerId` for provenance. It carries
 * no Run authorization override. Desktop app only; revision-guarded like other queue changes.
 */
export interface SessionControlQueueAdoptCommand {
  readonly operation: 'queue-adopt'
  readonly sessionId: string
  readonly followUpId: string
  readonly expectedQueueRevision: number
}

export type SessionControlQueueMutationCommand =
  | SessionControlQueuePauseCommand
  | SessionControlQueueReorderCommand
  | SessionControlQueueResumeCommand
  | SessionControlQueueWithdrawCommand

/** The replaceable part of a queued Follow-up: the Follow-up edit input. */
export interface SessionControlFollowUpEditInput {
  readonly text: string
  readonly attachmentIds: readonly string[]
  /** Present to keep or add a Waggle invocation; omitted to remove it. */
  readonly waggle?: WaggleInvocationInput
  /** Present to keep or set a visualization context; omitted to remove it. */
  readonly visualizationContext?: InlineVisualizationContext
}

/** Asks the Host to hold one Follow-up for a Follow-up edit (desktop user only). */
export interface SessionControlQueueEditBeginCommand {
  readonly operation: 'queue-edit-begin'
  readonly sessionId: string
  readonly followUpId: string
}

/** Replaces a held Follow-up's intent snapshot in place and releases its hold. */
export interface SessionControlQueueEditSaveCommand {
  readonly operation: 'queue-edit-save'
  readonly sessionId: string
  readonly followUpId: string
  readonly holdId: string
  readonly expectedQueueRevision: number
  readonly input: SessionControlFollowUpEditInput
}

/** Releases a Follow-up edit hold without changing the Follow-up. Releasing a gone hold succeeds. */
export interface SessionControlQueueEditCancelCommand {
  readonly operation: 'queue-edit-cancel'
  readonly sessionId: string
  readonly followUpId: string
  readonly holdId: string
}

export type SessionControlQueueEditCommand =
  | SessionControlQueueEditBeginCommand
  | SessionControlQueueEditSaveCommand
  | SessionControlQueueEditCancelCommand

/** A Follow-up edit hold as one queue-list caller sees it. */
export interface SessionFollowUpEditHoldSummary {
  /** Only the caller holding the edit learns the hold id it saves or cancels with. */
  readonly holdId?: string
  /** For the holder: the queue revision the edit began at, which a save names. */
  readonly baseQueueRevision?: number
  readonly holderIsCaller: boolean
  readonly acquiredAt: number
  readonly leaseExpiresAt: number
}

/**
 * Who queued a Follow-up, from its Message provenance: its author, which stays the same when the
 * desktop user sends it as themselves.
 * `sessionId` is set for an agent Session caller (`session-agent:<session>:<run>`), and
 * `profileName` for a CLI profile caller (`profile:<id>`) when the desktop user lists the queue.
 */
export interface SessionFollowUpSource {
  readonly callerId: string
  readonly sessionId?: string
  readonly profileName?: string
}

/** What a queue-list tells its caller about one listed Follow-up beyond its queue fields. */
export interface SessionFollowUpListing {
  /** Who queued this Follow-up (its Message provenance), resolved for display. */
  readonly source?: SessionFollowUpSource
  /** The calling user queued this Follow-up and may begin a Follow-up edit on it. */
  readonly editable: boolean
  /** Present while a Follow-up edit holds this item (and stops delivery here). */
  readonly editHold?: SessionFollowUpEditHoldSummary
  /** With bodies: descriptors of the intent's attachments, in intent order. Never binary. */
  readonly attachments?: readonly SessionFollowUpAttachmentDescriptor[]
}

/** What a composer needs to show a queued attachment again: no path, text, or bytes. */
export interface SessionFollowUpAttachmentDescriptor {
  readonly id: string
  readonly kind: AttachmentKind
  readonly origin?: AttachmentOrigin
  readonly name: string
  readonly mimeType: string
  readonly sizeBytes: number
}

export type SessionControlQueueOutcome =
  | {
      readonly operation:
        | SessionControlQueueMutationCommand['operation']
        | 'queue-adopt'
        | 'queue-edit-save'
        | 'queue-edit-cancel'
      readonly effect: 'queue-updated'
      readonly sessionId: string
      readonly queueState: 'running' | 'paused'
      readonly queueRevision: number
      readonly followUpIds: readonly string[]
      readonly stateRevision: number
    }
  | {
      /**
       * A queue change that leaves an idle Session's queue able to deliver starts its next
       * Follow-up, the same way resumption does (for example withdrawing or saving a held head).
       */
      readonly operation:
        | 'queue-resume'
        | 'queue-withdraw'
        | 'queue-reorder'
        | 'queue-adopt'
        | 'queue-edit-save'
        | 'queue-edit-cancel'
      readonly effect: 'started-run'
      readonly sessionId: string
      readonly runId: string
      readonly followUpId: string
      readonly queueRevision: number
      readonly stateRevision: number
    }
  | SessionControlFollowUpEditHeldOutcome

/** The `queue-edit-begin` outcome: the Host holds the Follow-up for this caller's edit. */
export interface SessionControlFollowUpEditHeldOutcome {
  readonly operation: 'queue-edit-begin'
  readonly effect: 'follow-up-edit-held'
  readonly sessionId: string
  readonly followUpId: string
  /** Names the hold to save, cancel, or renew it. Only the holder learns it. */
  readonly holdId: string
  /** When the hold expires unless renewed (Host clock, epoch milliseconds). */
  readonly leaseExpiresAt: number
  readonly queueRevision: number
  readonly stateRevision: number
}

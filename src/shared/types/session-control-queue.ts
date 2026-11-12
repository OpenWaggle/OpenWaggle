import type { SchemaType } from '@shared/schema'
import type {
  followUpEditHoldReferenceSchema,
  queueAdoptCommandSchema,
  queueEditBeginCommandSchema,
  queueEditCancelCommandSchema,
  queueEditSaveCommandSchema,
  queuePauseCommandSchema,
  queueReorderCommandSchema,
  queueResumeCommandSchema,
  queueWithdrawCommandSchema,
} from '@shared/schemas/session-control-commands'
import type { AttachmentKind, AttachmentOrigin } from './agent'

export const MAX_FOLLOW_UP_QUEUE_ITEMS = 256

/**
 * The only caller that may edit a queued Follow-up: the desktop app's local user, without a
 * profile, editing a Follow-up it queued itself (ADR 0044).
 */
export const FOLLOW_UP_EDIT_CALLER_ID = 'gui:local-user'

/** Names one Follow-up edit hold (ADR 0044). */
export type FollowUpEditHoldReference = SchemaType<typeof followUpEditHoldReferenceSchema>

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

/**
 * The pause reasons that adopting the last Follow-up needing attention (**Send as me**) lifts: the
 * ones the needs-attention paths leave (a revoked profile records `profile-revoked`, a head whose
 * authority changed pauses with no reason). Any other reason, including `requested`, came from
 * somewhere else and outlives the adoption. A queue waiting on agents' capacity (`parent-limit`)
 * stays paused for theirs, but the adopted Follow-up, now the person's, starts ahead of them
 * (ADR 0030, amended 2026-11-10). The Host (`follow-up-adopt.ts`) and the composer
 * (`send-as-me.ts`) both read it.
 */
export const ADOPTION_LIFTED_PAUSE_REASONS: readonly (FollowUpQueuePauseReason | undefined)[] = [
  undefined,
  'profile-revoked',
]

export function isFollowUpQueuePauseReason(value: unknown): value is FollowUpQueuePauseReason {
  return FOLLOW_UP_QUEUE_PAUSE_REASONS.some((reason) => reason === value)
}

export type SessionControlQueueWithdrawCommand = SchemaType<typeof queueWithdrawCommandSchema>

export type SessionControlQueueReorderCommand = SchemaType<typeof queueReorderCommandSchema>

export type SessionControlQueuePauseCommand = SchemaType<typeof queuePauseCommandSchema>

export type SessionControlQueueResumeCommand = SchemaType<typeof queueResumeCommandSchema>

export type SessionControlQueueAdoptCommand = SchemaType<typeof queueAdoptCommandSchema>

export type SessionControlQueueMutationCommand =
  | SessionControlQueuePauseCommand
  | SessionControlQueueReorderCommand
  | SessionControlQueueResumeCommand
  | SessionControlQueueWithdrawCommand

export type SessionControlQueueEditBeginCommand = SchemaType<typeof queueEditBeginCommandSchema>

export type SessionControlQueueEditSaveCommand = SchemaType<typeof queueEditSaveCommandSchema>

export type SessionControlQueueEditCancelCommand = SchemaType<typeof queueEditCancelCommandSchema>

export type SessionControlQueueEditCommand =
  | SessionControlQueueEditBeginCommand
  | SessionControlQueueEditSaveCommand
  | SessionControlQueueEditCancelCommand

/** A Follow-up edit hold as one queue-list caller sees it. */
export interface SessionFollowUpEditHoldSummary {
  /** Only the caller holding the edit learns the hold id it saves or cancels with. */
  readonly holdId?: string | undefined
  /** For the holder: the queue revision the edit began at, which a save names. */
  readonly baseQueueRevision?: number | undefined
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
  readonly sessionId?: string | undefined
  /**
   * The title of the agent Session in `sessionId`, resolved by the Host when the listing caller
   * may see that Session, including an archived one or one in another project. Absent when the
   * Session is gone or out of the caller's reach.
   */
  readonly sessionTitle?: string | undefined
  readonly profileName?: string | undefined
}

/** What a queue-list tells its caller about one listed Follow-up beyond its queue fields. */
export interface SessionFollowUpListing {
  /** Who queued this Follow-up (its Message provenance), resolved for display. */
  readonly source?: SessionFollowUpSource | undefined
  /** The calling user queued this Follow-up and may begin a Follow-up edit on it. */
  readonly editable: boolean
  /** Present while a Follow-up edit holds this item (and stops delivery here). */
  readonly editHold?: SessionFollowUpEditHoldSummary | undefined
  /** With bodies: descriptors of the intent's attachments, in intent order. Never binary. */
  readonly attachments?: readonly SessionFollowUpAttachmentDescriptor[] | undefined
}

/** What a composer needs to show a queued attachment again: no path, text, or bytes. */
export interface SessionFollowUpAttachmentDescriptor {
  readonly id: string
  readonly kind: AttachmentKind
  readonly origin?: AttachmentOrigin | undefined
  readonly name: string
  readonly mimeType: string
  readonly sizeBytes: number
}

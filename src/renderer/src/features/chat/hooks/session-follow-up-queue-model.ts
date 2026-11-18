import { safeDecodeUnknown } from '@shared/schema'
import { inlineVisualizationContextSchema } from '@shared/schemas/validation'
import { toWaggleInvocation, waggleInvocationSchema } from '@shared/schemas/waggle'
import type { InlineVisualizationContext } from '@shared/types/agent'
import type {
  FollowUpQueuePauseReason,
  SessionFollowUpAttachmentDescriptor,
  SessionFollowUpSource,
} from '@shared/types/session-control-queue'
import type { SessionQueryOutcome } from '@shared/types/session-query'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import type { WaggleInvocation } from '@shared/types/waggle'
import { isObjectValue } from '@shared/utils/object-shape'

export interface SessionFollowUpQueueItem {
  readonly id: string
  readonly text: string
  readonly attachmentCount: number
  readonly createdAt: number
  readonly deliveryState: 'pending' | 'needs_attention'
  readonly attentionReason?: 'profile_revoked' | 'authority_changed'
  readonly wagglePresetName?: string
  readonly waggleSource?: 'user' | 'agent'
  readonly callerId?: string
  /** The full queued Waggle invocation, to load the message back into the composer. */
  readonly waggle?: WaggleInvocation
  readonly visualizationContext?: InlineVisualizationContext
  /** Chips for the queued attachments, in message order (no paths or bytes). */
  readonly attachments: readonly SessionFollowUpAttachmentDescriptor[]
  /** Who queued it (its Message provenance), as the Host resolved it. */
  readonly source?: SessionFollowUpSource
  /** This user queued the item and may begin a Follow-up edit on it. */
  readonly editable: boolean
  /** Present while a Follow-up edit holds the item; delivery waits here until it ends. */
  readonly editHold?: SessionFollowUpEditHold
}

/** A Follow-up edit hold as this desktop user sees it. */
export interface SessionFollowUpEditHold {
  /** Known only when this user holds the edit (in this window or another one). */
  readonly holdId?: string
  /** Known with `holdId`: the queue revision the edit began at, which a save names. */
  readonly baseQueueRevision?: number
  readonly heldByCurrentUser: boolean
  readonly acquiredAt: number
  /** Wall-clock estimate of when the Host lease runs out unless renewed. */
  readonly leaseExpiresAt: number
}

/**
 * An open Follow-up edit, returned by `beginEdit` or `resumeEdit`. Load `item` into the composer,
 * then call `saveEdit(edit, payload)` or `cancelEdit(edit)`. While it is open the queue does not
 * deliver this item or anything behind it. The desktop main process renews the Host lease for the
 * window that began the edit and releases it if that window closes or reloads; a remounted
 * composer in the same window re-adopts the edit with `resumeEdit(followUpId)`.
 */
export interface SessionFollowUpEdit {
  readonly followUpId: string
  readonly holdId: string
  /**
   * The queue revision the edit began at. A save names it: only a change to this Follow-up itself
   * (which also ends the hold) refuses the save, not reordering or changes to other items.
   */
  readonly queueRevision: number
  readonly leaseExpiresAt: number
  readonly item: SessionFollowUpQueueItem
}

/** What a saved Follow-up edit carries. Thinking level and authorization are not edited. */
export interface SessionFollowUpEditPayload {
  readonly text: string
  readonly attachments: readonly { readonly id: string }[]
  /** Keep or add the Waggle invocation; omit it to remove it. */
  readonly waggle?: WaggleInvocation
  /** Keep or set the visualization context; omit it to remove it. */
  readonly visualizationContext?: InlineVisualizationContext
}

/**
 * A Session Control rejection, with the Host's code. Follow-up edit codes: `follow_up_not_found`
 * (withdrawn or delivered), `follow_up_not_editable` (someone else queued it),
 * `follow_up_edit_held` (already being edited), `follow_up_edit_not_held` and
 * `follow_up_edit_hold_mismatch` (the hold is gone, e.g. its lease expired, or a replayed begin
 * after a Host restart), `queue_revision_changed` (the edit's base revision is stale),
 * `queue_byte_capacity_reached`, `follow_up_edit_requires_desktop_user`.
 */
export class SessionControlRejectedError extends Error {
  readonly operation: string
  readonly code: string

  constructor(operation: string, code: string) {
    super(`Session Control rejected ${operation}: ${code}`)
    this.name = 'SessionControlRejectedError'
    this.operation = operation
    this.code = code
  }
}

/** Codes after which an open Follow-up edit can no longer be saved: the hold or the item is gone. */
const LOST_EDIT_CODES: ReadonlySet<string> = new Set([
  'follow_up_not_found',
  'follow_up_not_editable',
  'follow_up_edit_not_held',
  'follow_up_edit_hold_mismatch',
])

/** The edit's hold or its Follow-up is gone; keep the draft and offer to queue it as new. */
export function isLostFollowUpEdit(error: unknown) {
  return error instanceof SessionControlRejectedError && LOST_EDIT_CODES.has(error.code)
}

export interface SessionFollowUpQueueSnapshot {
  readonly state: 'running' | 'paused'
  /** Why a paused queue paused, as the Host recorded it. */
  readonly pauseReason?: FollowUpQueuePauseReason
  readonly revision: number
  readonly activeRunId: string | null
  readonly items: readonly SessionFollowUpQueueItem[]
  /**
   * Some Follow-up is out for an edit, so the queue waits on it. Sends that should not overtake the
   * held message (an explicit Waggle) belong in the queue (`enqueue`) while this holds.
   */
  readonly waitingOnEdit: boolean
}

export const EMPTY_SNAPSHOT: SessionFollowUpQueueSnapshot = {
  state: 'running',
  revision: 0,
  activeRunId: null,
  items: [],
  waitingOnEdit: false,
}

/** The open edit of a Follow-up this user holds, from the latest snapshot (see `resumeEdit`). */
export function heldEdit(snapshot: SessionFollowUpQueueSnapshot, followUpId: string) {
  const item = snapshot.items.find((candidate) => candidate.id === followUpId)
  const hold = item?.editHold
  if (!item || !hold?.heldByCurrentUser || !hold.holdId || hold.baseQueueRevision === undefined) {
    return null
  }
  const edit: SessionFollowUpEdit | null = {
    followUpId,
    holdId: hold.holdId,
    queueRevision: hold.baseQueueRevision,
    leaseExpiresAt: hold.leaseExpiresAt,
    item,
  }
  return edit
}

type SessionFollowUpQueueIntent = Pick<
  SessionFollowUpQueueItem,
  | 'text'
  | 'attachmentCount'
  | 'wagglePresetName'
  | 'waggleSource'
  | 'callerId'
  | 'waggle'
  | 'visualizationContext'
>

function queuedWaggle(value: unknown) {
  if (value === undefined) return {}
  const decoded = safeDecodeUnknown(waggleInvocationSchema, value)
  return decoded.success ? { waggle: toWaggleInvocation(decoded.data) } : {}
}

function queuedVisualizationContext(value: unknown) {
  if (value === undefined) return {}
  const decoded = safeDecodeUnknown(inlineVisualizationContextSchema, value)
  return decoded.success ? { visualizationContext: decoded.data } : {}
}

/** A queued Follow-up's send intent, as far as the queue rows read it. */
interface QueuedIntentFields {
  readonly text: string
  readonly attachmentIds: readonly string[]
  readonly waggle: { readonly presetName: string; readonly source: 'user' | 'agent' }
  readonly callerId: string
  readonly visualizationContext: InlineVisualizationContext
}

function uncheckedFields<T>(value: unknown) {
  const fields: UncheckedFields<T> | null = isObjectValue(value) ? value : null
  return fields
}

function queueIntent(value: unknown) {
  const intent = uncheckedFields<QueuedIntentFields>(value)
  if (intent === null) {
    const result: SessionFollowUpQueueIntent = { text: '', attachmentCount: 0 }
    return result
  }
  const waggle = uncheckedFields<QueuedIntentFields['waggle']>(intent.waggle)
  const result: SessionFollowUpQueueIntent = {
    text: typeof intent.text === 'string' ? intent.text : '',
    attachmentCount: Array.isArray(intent.attachmentIds) ? intent.attachmentIds.length : 0,
    ...(typeof waggle?.presetName === 'string' ? { wagglePresetName: waggle.presetName } : {}),
    ...(waggle?.source === 'user' || waggle?.source === 'agent'
      ? { waggleSource: waggle.source }
      : {}),
    ...(typeof intent.callerId === 'string' ? { callerId: intent.callerId } : {}),
    ...queuedWaggle(intent.waggle),
    ...queuedVisualizationContext(intent.visualizationContext),
  }
  return result
}

export function queueSnapshot(outcome: SessionQueryOutcome) {
  if (outcome.operation !== 'queue-list') {
    throw new Error('Session Host returned the wrong response for a Follow-up queue query.')
  }
  if ('error' in outcome) throw new Error(outcome.error.message)
  const items = outcome.items.map(queueItem)
  const snapshot: SessionFollowUpQueueSnapshot = {
    state: outcome.queueState,
    ...(outcome.queuePauseReason ? { pauseReason: outcome.queuePauseReason } : {}),
    revision: outcome.queueRevision,
    activeRunId: outcome.activeRunId,
    items,
    waitingOnEdit: items.some((item) => item.editHold !== undefined),
  }
  return snapshot
}

type QueueListItem = Extract<
  SessionQueryOutcome,
  { operation: 'queue-list'; items: unknown }
>['items'][number]

function queueItem(item: QueueListItem) {
  const result: SessionFollowUpQueueItem = {
    id: item.followUpId,
    ...queueIntent(item.intent),
    createdAt: item.createdAt,
    deliveryState: item.deliveryState,
    ...(item.attentionReason ? { attentionReason: item.attentionReason } : {}),
    attachments: item.attachments ?? [],
    ...(item.source ? { source: item.source } : {}),
    editable: item.editable,
    ...(item.editHold
      ? {
          editHold: {
            ...(item.editHold.holdId ? { holdId: item.editHold.holdId } : {}),
            ...(item.editHold.baseQueueRevision !== undefined
              ? { baseQueueRevision: item.editHold.baseQueueRevision }
              : {}),
            heldByCurrentUser: item.editHold.holderIsCaller,
            acquiredAt: item.editHold.acquiredAt,
            leaseExpiresAt: item.editHold.leaseExpiresAt,
          },
        }
      : {}),
  }
  return result
}

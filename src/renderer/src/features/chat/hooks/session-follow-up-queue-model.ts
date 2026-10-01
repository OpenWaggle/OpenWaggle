import { safeDecodeUnknown } from '@shared/schema'
import { inlineVisualizationContextSchema } from '@shared/schemas/validation'
import { toWaggleInvocation, waggleInvocationSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload, InlineVisualizationContext } from '@shared/types/agent'
import type {
  FollowUpQueuePauseReason,
  SessionFollowUpAttachmentDescriptor,
} from '@shared/types/session-control-queue'
import type { SessionQueryOutcome } from '@shared/types/session-query'
import { THINKING_LEVELS } from '@shared/types/settings'
import type { WaggleInvocation } from '@shared/types/waggle'
import { isRecord } from '@shared/utils/validation'

export interface SessionFollowUpQueueItem {
  readonly id: string
  readonly text: string
  readonly attachmentCount: number
  readonly createdAt: number
  readonly deliveryState: 'pending' | 'needs_attention'
  readonly attentionReason?:
    | 'authorization_ceiling_changed'
    | 'profile_revoked'
    | 'authority_changed'
  readonly wagglePresetName?: string
  readonly waggleSource?: 'user' | 'agent'
  readonly authorizationMode?: 'yolo' | 'ask-for-approval'
  readonly thinkingLevel?: AgentSendPayload['thinkingLevel']
  readonly callerId?: string
  /** The full queued Waggle invocation, to load the message back into the composer. */
  readonly waggle?: WaggleInvocation
  readonly visualizationContext?: InlineVisualizationContext
  /** Chips for the queued attachments, in message order (no paths or bytes). */
  readonly attachments: readonly SessionFollowUpAttachmentDescriptor[]
  /** This user queued the item and may begin a Follow-up edit on it. */
  readonly editable: boolean
  /** Present while a Follow-up edit holds the item; delivery waits here until it ends. */
  readonly editHold?: SessionFollowUpEditHold
}

/** A Follow-up edit hold as this desktop user sees it. */
export interface SessionFollowUpEditHold {
  /** Known only when this user holds the edit (in this window or another one). */
  readonly holdId?: string
  readonly heldByCurrentUser: boolean
  readonly acquiredAt: number
  readonly leaseExpiresAt: number
}

/**
 * An open Follow-up edit, returned by `beginEdit`. Load `item` into the composer, then call
 * `saveEdit(edit, payload)` or `cancelEdit(edit)`. While it is open the queue does not deliver this
 * item or anything behind it. The Host lease is renewed by the desktop main process for the window
 * that began it and released if that window closes or reloads.
 */
export interface SessionFollowUpEdit {
  readonly followUpId: string
  readonly holdId: string
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
 * `follow_up_edit_hold_mismatch` (the hold is gone, e.g. its lease expired), `queue_revision_changed`,
 * `queue_byte_capacity_reached`, `follow_up_edit_requires_desktop_user`.
 */
export class SessionControlRejectedError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string,
  ) {
    super(`Session Control rejected ${operation}: ${code}`)
    this.name = 'SessionControlRejectedError'
  }
}

/** Codes after which an open Follow-up edit can no longer be saved: the hold or the item is gone. */
const LOST_EDIT_CODES: ReadonlySet<string> = new Set([
  'follow_up_not_found',
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
}

export const EMPTY_SNAPSHOT: SessionFollowUpQueueSnapshot = {
  state: 'running',
  revision: 0,
  activeRunId: null,
  items: [],
}

type SessionFollowUpQueueIntent = Pick<
  SessionFollowUpQueueItem,
  | 'text'
  | 'attachmentCount'
  | 'wagglePresetName'
  | 'waggleSource'
  | 'authorizationMode'
  | 'thinkingLevel'
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

function queueIntent(value: unknown): SessionFollowUpQueueIntent {
  if (!isRecord(value)) {
    return { text: '', attachmentCount: 0 }
  }
  const record = value
  const waggle = isRecord(record.waggle) ? record.waggle : undefined
  const thinkingLevel = THINKING_LEVELS.find((level) => level === record.thinkingLevel)
  return {
    text: typeof record.text === 'string' ? record.text : '',
    attachmentCount: Array.isArray(record.attachmentIds) ? record.attachmentIds.length : 0,
    ...(waggle && typeof waggle.presetName === 'string'
      ? { wagglePresetName: waggle.presetName }
      : {}),
    ...(waggle && (waggle.source === 'user' || waggle.source === 'agent')
      ? { waggleSource: waggle.source }
      : {}),
    ...(record.runAuthorizationOverride === 'yolo' ||
    record.runAuthorizationOverride === 'ask-for-approval'
      ? { authorizationMode: record.runAuthorizationOverride }
      : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(typeof record.callerId === 'string' ? { callerId: record.callerId } : {}),
    ...queuedWaggle(record.waggle),
    ...queuedVisualizationContext(record.visualizationContext),
  }
}

export function queueSnapshot(outcome: SessionQueryOutcome): SessionFollowUpQueueSnapshot {
  if (outcome.operation !== 'queue-list') {
    throw new Error('Session Host returned the wrong response for a Follow-up queue query.')
  }
  if ('error' in outcome) throw new Error(outcome.error.message)
  return {
    state: outcome.queueState,
    ...(outcome.queuePauseReason ? { pauseReason: outcome.queuePauseReason } : {}),
    revision: outcome.queueRevision,
    activeRunId: outcome.activeRunId,
    items: outcome.items.map((item) => ({
      id: item.followUpId,
      ...queueIntent(item.intent),
      createdAt: item.createdAt,
      deliveryState: item.deliveryState,
      ...(item.attentionReason ? { attentionReason: item.attentionReason } : {}),
      attachments: item.attachments ?? [],
      editable: item.editable === true,
      ...(item.editHold
        ? {
            editHold: {
              ...(item.editHold.holdId ? { holdId: item.editHold.holdId } : {}),
              heldByCurrentUser: item.editHold.holderIsCaller,
              acquiredAt: item.editHold.acquiredAt,
              leaseExpiresAt: item.editHold.leaseExpiresAt,
            },
          }
        : {}),
    })),
  }
}

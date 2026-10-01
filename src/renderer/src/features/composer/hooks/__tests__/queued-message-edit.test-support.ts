import type { PreparedAttachment } from '@shared/types/agent'
import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import type { WaggleInvocation, WagglePreset } from '@shared/types/waggle'
import type {
  SessionFollowUpEdit,
  SessionFollowUpQueueItem,
  SessionFollowUpQueueSnapshot,
} from '@/features/chat/hooks'

export const REVIEW_PRESET: WagglePreset = {
  id: WagglePresetId('review'),
  name: 'Review',
  description: 'Review changes',
  config: {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: SupportedModelId('openai/gpt-5.5'),
        roleDescription: 'Reviews architecture',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: SupportedModelId('anthropic/claude-sonnet-4'),
        roleDescription: 'Reviews implementation',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: 4 },
  },
  isBuiltIn: false,
  createdAt: 1,
  updatedAt: 1,
}

export const REVIEW_WAGGLE: WaggleInvocation = {
  presetId: 'review',
  presetName: 'Review',
  source: 'user',
  config: REVIEW_PRESET.config,
}

export function preparedAttachment(id: string): PreparedAttachment {
  return {
    id,
    kind: 'text',
    name: `${id}.txt`,
    path: `/tmp/${id}.txt`,
    mimeType: 'text/plain',
    sizeBytes: 100,
    extractedText: 'content',
  }
}

export function queueItem(
  overrides: Partial<SessionFollowUpQueueItem> & Pick<SessionFollowUpQueueItem, 'id'>,
): SessionFollowUpQueueItem {
  return {
    text: `queued ${overrides.id}`,
    attachmentCount: overrides.attachments?.length ?? 0,
    createdAt: 1,
    deliveryState: 'pending',
    attachments: [],
    editable: true,
    ...overrides,
  }
}

export function snapshotOf(
  items: readonly SessionFollowUpQueueItem[],
  revision = 1,
): SessionFollowUpQueueSnapshot {
  return {
    state: 'running',
    revision,
    activeRunId: 'run-1',
    items,
    waitingOnEdit: items.some((item) => item.editHold !== undefined),
  }
}

export const BASE_QUEUE_REVISION = 7

export function openedEdit(item: SessionFollowUpQueueItem, holdId = 'hold-1'): SessionFollowUpEdit {
  return {
    followUpId: item.id,
    holdId,
    queueRevision: BASE_QUEUE_REVISION,
    leaseExpiresAt: 30_000,
    item,
  }
}

/** The held form of an item, as the queue shows it to the user who holds it. */
export function heldItem(item: SessionFollowUpQueueItem, holdId = 'hold-1') {
  return {
    ...item,
    editHold: {
      holdId,
      baseQueueRevision: BASE_QUEUE_REVISION,
      heldByCurrentUser: true,
      acquiredAt: 1,
      leaseExpiresAt: 30_000,
    },
  }
}

/** What a test's `useSessionFollowUpQueue` mock needs to re-adopt held edits like the real hook. */
export function resumeFrom(
  snapshot: SessionFollowUpQueueSnapshot,
  heldEditOf: (
    snapshot: SessionFollowUpQueueSnapshot,
    followUpId: string,
  ) => SessionFollowUpEdit | null,
) {
  return {
    refresh: () => Promise.resolve(snapshot),
    resumeEdit: (followUpId: string) => heldEditOf(snapshot, followUpId),
  }
}

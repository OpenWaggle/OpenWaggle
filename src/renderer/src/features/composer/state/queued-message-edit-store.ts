import { create } from 'zustand'
import type { SessionFollowUpEdit } from '@/features/chat/hooks'

/**
 * This window's Follow-up edit for one Session, while the composer edits a queued message.
 *
 * Kept per Session, outside the composer's draft, because the Host hold outlives the composer:
 * leaving the Session keeps the hold, and coming back must reopen the composer in edit mode.
 * The edited content lives in one scoped draft, `contextKey` (drafts are per branch or node, so
 * the composer is in edit mode only while that draft is the visible one); the draft that was there
 * before the edit is set aside under `queuedMessageEditStashKey`.
 */
export type QueuedMessageEdit =
  | {
      readonly phase: 'beginning'
      readonly followUpId: string
      readonly contextKey: string
    }
  | {
      readonly phase: 'editing' | 'saving' | 'cancelling'
      readonly followUpId: string
      readonly contextKey: string
      /**
       * The open edit as `beginEdit` returned it (or as it was adopted), kept until save: the save
       * is guarded by the queue revision the edit was based on, and `item` carries the queued
       * Waggle invocation and visualization context the composer does not show.
       */
      readonly based: SessionFollowUpEdit
    }

export type OpenQueuedMessageEdit = Exclude<QueuedMessageEdit, { readonly phase: 'beginning' }>

interface QueuedMessageEditState {
  readonly edits: Readonly<Record<string, QueuedMessageEdit>>
  readonly setEdit: (sessionId: string, edit: QueuedMessageEdit | null) => void
}

export const useQueuedMessageEditStore = create<QueuedMessageEditState>((set) => ({
  edits: {},
  setEdit(sessionId, edit) {
    set((state) => {
      const edits = { ...state.edits }
      if (edit) edits[sessionId] = edit
      else delete edits[sessionId]
      return { edits }
    })
  },
}))

export function selectQueuedMessageEdit(sessionId: string | null) {
  return (state: QueuedMessageEditState) => (sessionId ? (state.edits[sessionId] ?? null) : null)
}

export function isOpenQueuedMessageEdit(
  edit: QueuedMessageEdit | null,
): edit is OpenQueuedMessageEdit {
  return edit !== null && edit.phase !== 'beginning'
}

/*
 * Holds this window gave up because their draft was cleared (Session deleted or archived, branch
 * archived). The release reaches the Host asynchronously, and until it does the queue still shows
 * the hold as this user's, which adoption would otherwise re-open. Hold ids are never reused.
 */
const abandonedHoldIds = new Set<string>()

export function markHoldAbandoned(holdId: string) {
  abandonedHoldIds.add(holdId)
}

/** A release that never reached the Host: adoption may take the hold up again instead of it staying stuck. */
export function forgetAbandonedHold(holdId: string) {
  abandonedHoldIds.delete(holdId)
}

export function isHoldAbandoned(holdId: string) {
  return abandonedHoldIds.has(holdId)
}

/**
 * Where the composer's own draft waits during a Follow-up edit. Inside the composer's scoped drafts
 * so its attachments stay owned (and are not discarded), and session-scoped so deleting the Session
 * clears it with the Session's other drafts.
 */
export function queuedMessageEditStashKey(sessionId: string) {
  return `follow-up-edit:session:${sessionId}:stash`
}

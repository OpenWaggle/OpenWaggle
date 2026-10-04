import { create } from 'zustand'
import { useComposerStore } from './composer-store'

/**
 * Composer work still in flight for one draft that a Follow-up edit must not interleave with:
 * attachments being prepared (they land in the draft that started them) and queued submissions
 * waiting for Host acknowledgement (acknowledgement clears the draft that submitted them).
 *
 * Keyed by draft context, so work in one Session or branch never blocks an edit in another.
 */
export interface ComposerDraftActivity {
  readonly preparingAttachments: number
  readonly pendingSubmissions: number
}

interface ComposerActivityState {
  readonly drafts: Readonly<Record<string, ComposerDraftActivity>>
}

const IDLE: ComposerDraftActivity = { preparingAttachments: 0, pendingSubmissions: 0 }

export const useComposerActivityStore = create<ComposerActivityState>(() => ({ drafts: {} }))

function adjust(contextKey: string, kind: keyof ComposerDraftActivity, delta: 1 | -1) {
  useComposerActivityStore.setState((state) => {
    const current = state.drafts[contextKey] ?? IDLE
    const next = { ...current, [kind]: Math.max(0, current[kind] + delta) }
    const drafts = { ...state.drafts }
    if (next.preparingAttachments === 0 && next.pendingSubmissions === 0) delete drafts[contextKey]
    else drafts[contextKey] = next
    return { drafts }
  })
}

function track<Result>(
  kind: keyof ComposerDraftActivity,
  contextKey: string | null,
  work: Promise<Result>,
) {
  if (!contextKey) return work
  adjust(contextKey, kind, 1)
  const settle = () => adjust(contextKey, kind, -1)
  work.then(settle, settle)
  return work
}

/** Counts an attachment preparation against the draft visible when it starts. */
export function trackAttachmentPreparation<Result>(work: Promise<Result>) {
  return track('preparingAttachments', useComposerStore.getState().activeDraftContextKey, work)
}

/** Counts a queued submission against the draft that submitted it. */
export function trackComposerSubmission<Result>(contextKey: string | null, work: Promise<Result>) {
  return track('pendingSubmissions', contextKey, work)
}

export function selectDraftActivity(contextKey: string | null) {
  return (state: ComposerActivityState) =>
    (contextKey ? state.drafts[contextKey] : undefined) ?? IDLE
}

export function draftActivity(contextKey: string | null) {
  return selectDraftActivity(contextKey)(useComposerActivityStore.getState())
}

/** Why work in flight blocks a Follow-up edit of this draft, or null. */
export function draftBusyReason(activity: ComposerDraftActivity) {
  if (activity.preparingAttachments > 0) return 'preparing' as const
  if (activity.pendingSubmissions > 0) return 'submitting' as const
  return null
}

/** Test helper: marks `contextKey` as having work in flight. */
export function setDraftActivityForTests(
  contextKey: string,
  activity: Partial<ComposerDraftActivity>,
) {
  useComposerActivityStore.setState((state) => ({
    drafts: { ...state.drafts, [contextKey]: { ...IDLE, ...activity } },
  }))
}

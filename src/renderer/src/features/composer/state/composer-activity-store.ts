import { create } from 'zustand'

/**
 * Composer work still in flight that a Follow-up edit must not interleave with: attachments being
 * prepared (they land in whichever draft is visible when they finish) and queued submissions
 * waiting for Host acknowledgement (they clear the draft that submitted them).
 */
interface ComposerActivityState {
  readonly preparingAttachments: number
  readonly pendingSubmissions: number
}

export const useComposerActivityStore = create<ComposerActivityState>(() => ({
  preparingAttachments: 0,
  pendingSubmissions: 0,
}))

function track<Result>(key: keyof ComposerActivityState, work: Promise<Result>) {
  useComposerActivityStore.setState((state) => ({ [key]: state[key] + 1 }))
  const settle = () => useComposerActivityStore.setState((state) => ({ [key]: state[key] - 1 }))
  work.then(settle, settle)
  return work
}

export function trackAttachmentPreparation<Result>(work: Promise<Result>) {
  return track('preparingAttachments', work)
}

export function trackComposerSubmission<Result>(work: Promise<Result>) {
  return track('pendingSubmissions', work)
}

export function selectComposerBusy(state: ComposerActivityState) {
  return state.preparingAttachments > 0 || state.pendingSubmissions > 0
}

export function isComposerBusy() {
  return selectComposerBusy(useComposerActivityStore.getState())
}

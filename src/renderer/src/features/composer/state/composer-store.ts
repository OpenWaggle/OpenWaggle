import { create } from 'zustand'
import { createComposerStoreState } from './composer-actions'
import { releaseAbandonedSessionResourceAttachments } from './composer-attachment-lifecycle'
import type { ComposerState } from './composer-store-types'

export const useComposerStore = create<ComposerState>((set, get) =>
  createComposerStoreState(set, get),
)

useComposerStore.subscribe((state, previous) =>
  releaseAbandonedSessionResourceAttachments(previous, state),
)

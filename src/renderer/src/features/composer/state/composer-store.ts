import { create } from 'zustand'
import { createComposerStoreState } from './composer-actions'
import type { ComposerState } from './composer-store-types'

export const useComposerStore = create<ComposerState>((set, get) =>
  createComposerStoreState(set, get),
)

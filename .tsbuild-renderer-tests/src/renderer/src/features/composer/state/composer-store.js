import { create } from 'zustand';
import { createComposerStoreState } from './composer-actions';
export const useComposerStore = create((set, get) => createComposerStoreState(set, get));

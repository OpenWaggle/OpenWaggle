import { create } from 'zustand';
export const useBranchSummaryStore = create((set) => ({
    prompt: null,
    openPrompt(input) {
        set({
            prompt: {
                ...input,
                mode: 'choice',
            },
        });
    },
    startCustomPrompt(draftComposerText) {
        set((state) => ({
            prompt: state.prompt
                ? {
                    ...state.prompt,
                    draftComposerText,
                    mode: 'custom',
                }
                : null,
        }));
    },
    startSummarizing() {
        set((state) => ({
            prompt: state.prompt
                ? {
                    ...state.prompt,
                    mode: 'summarizing',
                }
                : null,
        }));
    },
    restoreChoice() {
        set((state) => ({
            prompt: state.prompt
                ? {
                    ...state.prompt,
                    mode: 'choice',
                }
                : null,
        }));
    },
    clearPrompt() {
        set({ prompt: null });
    },
}));

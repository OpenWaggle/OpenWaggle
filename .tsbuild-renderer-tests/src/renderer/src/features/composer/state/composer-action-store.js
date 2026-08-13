import { create } from 'zustand';
import { useComposerStore } from './composer-store';
export const useComposerActionStore = create((set, get) => ({
    actionDialog: null,
    actionDialogInput: '',
    actionDialogError: null,
    actionDialogBusy: false,
    branchQuery: '',
    branchMessage: null,
    openActionDialog(kind, initialValue = '') {
        useComposerStore.getState().openMenu(null);
        set({
            actionDialog: kind,
            actionDialogInput: initialValue,
            actionDialogError: null,
        });
    },
    closeActionDialog() {
        if (get().actionDialogBusy)
            return;
        set({
            actionDialog: null,
            actionDialogInput: '',
            actionDialogError: null,
        });
    },
    setActionDialogInput(value) {
        set({ actionDialogInput: value });
    },
    setActionDialogError(error) {
        set({ actionDialogError: error });
    },
    setActionDialogBusy(busy) {
        set({ actionDialogBusy: busy });
    },
    setBranchQuery(query) {
        set({ branchQuery: query });
    },
    setBranchMessage(message) {
        set({ branchMessage: message });
    },
}));

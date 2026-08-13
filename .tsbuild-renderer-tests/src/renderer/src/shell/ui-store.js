import { create } from 'zustand';
const DELAY_MS = 3500;
const FEEDBACK_COOLDOWN_MS = 60_000;
export const DIFF_PANEL_MIN = 360;
export const DIFF_PANEL_MAX = 900;
export const CHAT_MIN_WIDTH = 420;
export const EXTENSION_SIDE_PANEL_ROUTE_PANEL = 'extension-side-panel';
export const SETTINGS_TABS = [
    'general',
    'appearance',
    'waggle',
    'extensions',
    'mcp',
    'worktrees',
    'archived',
    'connections',
];
let toastTimer = null;
let feedbackCooldownTimer = null;
export const useUIStore = create((set, get) => ({
    sidebarOpen: true,
    terminalOpen: false,
    activeView: 'chat',
    activeSettingsTab: 'general',
    diffRefreshKey: 0,
    toastMessage: null,
    toastData: null,
    commandPaletteOpen: false,
    feedbackModalOpen: false,
    feedbackErrorContext: null,
    feedbackCooldownActive: false,
    lastRightSidebarPanel: 'diff',
    toggleSidebar() {
        set({ sidebarOpen: !get().sidebarOpen });
    },
    toggleTerminal() {
        set({ terminalOpen: !get().terminalOpen });
    },
    setActiveView(view) {
        set({ activeView: view });
    },
    setActiveSettingsTab(tab) {
        set({ activeSettingsTab: tab });
    },
    bumpDiffRefreshKey() {
        set((state) => ({ diffRefreshKey: state.diffRefreshKey + 1 }));
    },
    closeTerminal() {
        set({ terminalOpen: false });
    },
    showToast(message, variant = 'neutral') {
        if (toastTimer)
            clearTimeout(toastTimer);
        set({ toastMessage: message, toastData: { message, variant } });
        toastTimer = setTimeout(() => {
            toastTimer = null;
            set({ toastMessage: null, toastData: null });
        }, DELAY_MS);
    },
    showPersistentToast(data) {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
        set({ toastMessage: data.message, toastData: data });
    },
    clearToast() {
        if (toastTimer) {
            clearTimeout(toastTimer);
            toastTimer = null;
        }
        set({ toastMessage: null, toastData: null });
    },
    openCommandPalette() {
        set({ commandPaletteOpen: true });
    },
    closeCommandPalette() {
        set({ commandPaletteOpen: false });
    },
    toggleCommandPalette() {
        set({ commandPaletteOpen: !get().commandPaletteOpen });
    },
    openFeedbackModal(errorContext) {
        set({ feedbackModalOpen: true, feedbackErrorContext: errorContext ?? null });
    },
    closeFeedbackModal() {
        set({ feedbackModalOpen: false, feedbackErrorContext: null });
    },
    startFeedbackCooldown() {
        if (feedbackCooldownTimer)
            clearTimeout(feedbackCooldownTimer);
        set({ feedbackCooldownActive: true });
        feedbackCooldownTimer = setTimeout(() => {
            feedbackCooldownTimer = null;
            set({ feedbackCooldownActive: false });
        }, FEEDBACK_COOLDOWN_MS);
    },
    setLastRightSidebarPanel(panel) {
        set({ lastRightSidebarPanel: panel });
    },
}));
// Sync timer cleanup when toastMessage is cleared externally (e.g. direct setState in tests)
useUIStore.subscribe((state, prev) => {
    if (prev.toastMessage !== null && state.toastMessage === null && toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }
});

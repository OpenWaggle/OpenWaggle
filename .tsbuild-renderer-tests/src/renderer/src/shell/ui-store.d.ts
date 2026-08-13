import type { AgentErrorInfo } from '@shared/types/errors';
export declare const DIFF_PANEL_MIN = 360;
export declare const DIFF_PANEL_MAX = 900;
export declare const CHAT_MIN_WIDTH = 420;
export declare const EXTENSION_SIDE_PANEL_ROUTE_PANEL = "extension-side-panel";
export interface ExtensionRightSidebarPanel {
    readonly kind: 'extension-side-panel';
    readonly extensionId: string;
    readonly sidePanelId: string;
    readonly packagePath?: string;
    readonly contentHash?: string;
}
export type RightSidebarPanel = 'diff' | 'session-tree' | ExtensionRightSidebarPanel;
export interface ToastData {
    message: string;
    /** Visual variant — defaults to 'neutral'. */
    variant?: 'neutral' | 'success' | 'error';
    /** When set, the toast persists until manually dismissed. */
    persistent?: boolean;
    /** Optional action shown as a clickable label. Supports a URL or an onClick callback. */
    action?: {
        label: string;
        url?: string;
        onClick?: () => void;
    };
}
export declare const SETTINGS_TABS: readonly ["general", "appearance", "waggle", "extensions", "mcp", "worktrees", "archived", "connections"];
export type SettingsTab = (typeof SETTINGS_TABS)[number];
interface UIState {
    sidebarOpen: boolean;
    terminalOpen: boolean;
    activeView: 'chat' | 'skills' | 'settings';
    activeSettingsTab: SettingsTab;
    diffRefreshKey: number;
    toastMessage: string | null;
    toastData: ToastData | null;
    commandPaletteOpen: boolean;
    feedbackModalOpen: boolean;
    feedbackErrorContext: AgentErrorInfo | null;
    feedbackCooldownActive: boolean;
    lastRightSidebarPanel: RightSidebarPanel;
    toggleSidebar: () => void;
    toggleTerminal: () => void;
    setActiveView: (view: 'chat' | 'skills' | 'settings') => void;
    setActiveSettingsTab: (tab: SettingsTab) => void;
    bumpDiffRefreshKey: () => void;
    closeTerminal: () => void;
    showToast: (message: string, variant?: ToastData['variant']) => void;
    showPersistentToast: (data: ToastData) => void;
    clearToast: () => void;
    openCommandPalette: () => void;
    closeCommandPalette: () => void;
    toggleCommandPalette: () => void;
    openFeedbackModal: (errorContext?: AgentErrorInfo) => void;
    closeFeedbackModal: () => void;
    startFeedbackCooldown: () => void;
    setLastRightSidebarPanel: (panel: RightSidebarPanel) => void;
}
export declare const useUIStore: import("node_modules/zustand/esm/react.mjs").UseBoundStore<import("node_modules/zustand/esm/vanilla.mjs").StoreApi<UIState>>;
export {};

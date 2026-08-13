import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, type SettingsTab } from '@/shell/ui-store';
export type ChatBuiltInRightPanel = 'diff' | 'session-tree';
export type ChatRightPanel = ChatBuiltInRightPanel | typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL;
export interface ChatExtensionSidePanelTarget {
    readonly extensionId: string;
    readonly sidePanelId: string;
    readonly packagePath?: string;
    readonly contentHash?: string;
}
export interface ChatRouteSearch {
    readonly branch?: string;
    readonly node?: string;
    readonly diff?: 1;
    readonly panel?: ChatRightPanel;
    readonly sidePanelExtensionId?: string;
    readonly sidePanelId?: string;
    readonly sidePanelPackagePath?: string;
    readonly sidePanelContentHash?: string;
}
export interface ChatBuiltInRouteSearch extends ChatRouteSearch {
    readonly panel?: ChatBuiltInRightPanel;
    readonly sidePanelExtensionId?: undefined;
    readonly sidePanelId?: undefined;
    readonly sidePanelPackagePath?: undefined;
    readonly sidePanelContentHash?: undefined;
}
export interface ChatExtensionSidePanelRouteSearch extends ChatRouteSearch {
    readonly panel: typeof EXTENSION_SIDE_PANEL_ROUTE_PANEL;
    readonly sidePanelExtensionId: string;
    readonly sidePanelId: string;
    readonly sidePanelPackagePath?: string;
    readonly sidePanelContentHash?: string;
}
export declare function parseChatRouteSearch(search: Record<string, unknown>): ChatRouteSearch;
export declare function extensionSidePanelTargetFromSearch(search: ChatRouteSearch): ChatExtensionSidePanelTarget | null;
export declare function isSettingsTab(value: string): value is SettingsTab;

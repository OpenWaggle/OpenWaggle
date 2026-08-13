import type { RightSidebarPanel } from '@/shell';
import type { ChatExtensionSidePanelTarget } from './-route-search';
interface ResolveRightSidebarPanelInput {
    readonly diffOpen: boolean;
    readonly extensionSidePanel: ChatExtensionSidePanelTarget | null;
    readonly lastPanel: RightSidebarPanel;
    readonly sessionTreeOpen: boolean;
}
export declare function resolveRightSidebarPanel(input: ResolveRightSidebarPanelInput): RightSidebarPanel;
export declare function isExtensionRightSidebarPanel(panel: RightSidebarPanel): panel is Extract<RightSidebarPanel, {
    readonly kind: 'extension-side-panel';
}>;
export {};

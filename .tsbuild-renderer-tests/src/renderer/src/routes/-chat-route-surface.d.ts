import type { ChatExtensionSidePanelTarget } from './-route-search';
interface ChatRouteWorkspaceState {
    readonly branchId: string | null;
    readonly nodeId: string | null;
    readonly sessionId: string | null;
}
interface ChatRightSidebarRouteState {
    readonly diffOpen: boolean;
    readonly extensionSidePanel: ChatExtensionSidePanelTarget | null;
    readonly sessionTreeOpen: boolean;
}
interface ChatRightSidebarRouteActions {
    readonly onDiffOpenChange: (open: boolean) => void;
    readonly onExtensionSidePanelOpenChange: (open: boolean, target: ChatExtensionSidePanelTarget) => void;
    readonly onSessionTreeOpenChange: (open: boolean) => void;
}
interface ChatRouteSurfaceProps {
    readonly workspace: ChatRouteWorkspaceState;
    readonly rightSidebar: ChatRightSidebarRouteState;
    readonly rightSidebarActions: ChatRightSidebarRouteActions;
}
export declare function ChatRouteSurface({ workspace, rightSidebar, rightSidebarActions, }: ChatRouteSurfaceProps): import("node_modules/@types/react").JSX.Element;
export {};

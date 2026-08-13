import type { ResizeRailActions, ResizeRailBounds, ResizeRailRefs, ResizeRailStateInput, WidthAcceptanceContext } from './right-sidebar-layout-types';
interface ResizeRailProps {
    readonly actions: ResizeRailActions;
    readonly bounds: ResizeRailBounds;
    readonly handles: ResizeRailRefs;
    readonly state: ResizeRailStateInput;
    readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean;
}
export declare function RightSidebarResizeRail({ actions, bounds, handles, state, shouldAcceptWidth, }: ResizeRailProps): import("node_modules/@types/react").JSX.Element;
export {};

import type { ResizeRailActions, ResizeRailBounds, ResizeRailRefs, ResizeRailStateInput, WidthAcceptanceContext } from '@/shared/ui/right-sidebar-layout-types';
interface ResizeRailControllerParams {
    readonly actions: ResizeRailActions;
    readonly bounds: ResizeRailBounds;
    readonly refs: ResizeRailRefs;
    readonly state: ResizeRailStateInput;
    readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean;
}
export declare function useRightSidebarResizeRail({ actions, bounds, refs, state, shouldAcceptWidth, }: ResizeRailControllerParams): {
    cleanupResizeState: (pointerId: number) => void;
    endResize: (event: React.PointerEvent<HTMLButtonElement>) => void;
    handleClick(event: React.MouseEvent<HTMLButtonElement>): void;
    handlePointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
    handlePointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
};
export {};

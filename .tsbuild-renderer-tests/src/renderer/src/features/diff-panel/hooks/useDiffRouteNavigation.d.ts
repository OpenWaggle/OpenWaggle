type RightPanelMode = 'diff' | 'session-tree' | null;
interface DiffRouteNavigation {
    readonly diffOpen: boolean;
    readonly isChatRoute: boolean;
    readonly rightPanel: RightPanelMode;
    readonly sessionTreeOpen: boolean;
    readonly toggleDiff: () => void;
    readonly closeDiff: () => void;
    readonly toggleSessionTree: () => void;
    readonly closeSessionTree: () => void;
}
export declare function useDiffRouteNavigation(): DiffRouteNavigation;
export {};

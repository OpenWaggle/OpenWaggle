import type { GitStackedAction, VcsStatus } from '@shared/types/git';
interface DiffBottomBarProps {
    onRevertAll: () => void;
    onStageAll: () => void;
    canRevertAll: boolean;
    canStageAll: boolean;
    isActionRunning: boolean;
    quickAction?: {
        status: VcsStatus | null;
        isBusy: boolean;
        onRunAction: (action: GitStackedAction) => void;
        onPull: () => void;
        onOpenChangeRequest: () => void;
        onPublish: () => void;
    };
}
export declare function DiffBottomBar({ onRevertAll, onStageAll, canRevertAll, canStageAll, isActionRunning, quickAction, }: DiffBottomBarProps): import("node_modules/@types/react").JSX.Element;
export {};

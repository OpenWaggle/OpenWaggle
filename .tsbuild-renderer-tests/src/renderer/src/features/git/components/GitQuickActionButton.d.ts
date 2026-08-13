import type { GitStackedAction, VcsStatus } from '@shared/types/git';
interface GitQuickActionButtonProps {
    readonly status: VcsStatus | null;
    readonly isBusy: boolean;
    readonly onRunAction: (action: GitStackedAction) => void;
    readonly onPull: () => void;
    readonly onOpenChangeRequest: () => void;
    readonly onPublish: () => void;
}
/**
 * Presentational smart quick-action button. All decision logic lives in the
 * pure resolveQuickAction; this component only renders the resolved action and
 * dispatches the matching callback.
 */
export declare function GitQuickActionButton({ status, isBusy, onRunAction, onPull, onOpenChangeRequest, onPublish, }: GitQuickActionButtonProps): import("node_modules/@types/react").JSX.Element;
export {};

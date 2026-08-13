import type { GitRunStackedActionOptions, GitStackedAction } from '@shared/types/git';
interface UseStackedGitActionsOptions {
    readonly projectPath: string | null;
    readonly onCompleted?: () => void;
}
/**
 * Dispatches a stacked git action through the main-process workflow service and
 * surfaces the outcome as a toast. Decision logic lives in resolveQuickAction;
 * this hook only runs the chosen action.
 */
export declare function useStackedGitActions({ projectPath, onCompleted }: UseStackedGitActionsOptions): {
    isRunning: boolean;
    run: (action: GitStackedAction, options?: Partial<GitRunStackedActionOptions>) => Promise<void>;
};
export {};

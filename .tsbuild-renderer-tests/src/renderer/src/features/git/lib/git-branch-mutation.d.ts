import type { GitBranchMutationResult } from '@shared/types/git';
/**
 * Runs a branch mutation, updating the composer store's branch message
 * and firing a toast on completion or error.
 */
export declare function runBranchMutation(run: () => Promise<GitBranchMutationResult>, onToast?: (message: string) => void): Promise<GitBranchMutationResult>;

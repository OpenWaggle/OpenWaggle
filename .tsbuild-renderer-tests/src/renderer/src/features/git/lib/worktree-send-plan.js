export const WORKTREE_BASE_REF_REQUIRED = 'Select a base branch before sending in worktree mode.';
export const WORKTREE_MISSING_REASON = "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout.";
/**
 * Decide whether a send proceeds directly, must first birth a Session worktree
 * off a chosen base ref, or is blocked because no base ref is resolvable.
 */
export function resolveWorktreeSendPlan(input) {
    /*
     * A worktree that vanished stops the send. Recreating it silently would hand the
     * agent an empty tree while the session's earlier work is gone, with nothing in the
     * UI saying so, so the user chooses: recreate, or run in the opened checkout.
     */
    if (input.envMode === 'worktree' && input.hasWorktree && input.worktreeExists === false) {
        return { kind: 'worktree-missing', reason: WORKTREE_MISSING_REASON };
    }
    const shouldCreateWorktree = input.isFirstMessage && input.envMode === 'worktree' && !input.hasWorktree;
    if (!shouldCreateWorktree)
        return { kind: 'proceed' };
    const baseRef = input.baseRef?.trim();
    if (!baseRef)
        return { kind: 'blocked', reason: WORKTREE_BASE_REF_REQUIRED };
    return { kind: 'create-worktree', baseRef };
}
/**
 * The default Worktree base ref for a fresh worktree-mode session: the current
 * branch when resolvable, otherwise null (which blocks send until chosen).
 */
export function resolveDefaultWorktreeBaseRef(branchList) {
    return branchList?.currentBranch?.trim() || null;
}

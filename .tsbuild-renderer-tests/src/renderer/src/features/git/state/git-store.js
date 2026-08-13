import { match } from '@diegogbrisa/ts-match';
import { create } from 'zustand';
import { api } from '@/shared/lib/ipc';
const EMPTY_WORKING_TREE_STATUS = {
    status: null,
    isLoading: false,
    error: null,
};
/** Per-path request ids, so a slow response for one tree cannot overwrite a newer one. */
const latestStatusRequestIdByPath = new Map();
function nextStatusRequestId(workingPath) {
    const next = (latestStatusRequestIdByPath.get(workingPath) ?? 0) + 1;
    latestStatusRequestIdByPath.set(workingPath, next);
    return next;
}
function isStaleStatusRequest(workingPath, requestId) {
    return latestStatusRequestIdByPath.get(workingPath) !== requestId;
}
/** Read one working tree's status slice, defaulting to empty rather than undefined. */
export function selectWorkingTreeStatus(state, workingPath) {
    if (workingPath === null)
        return EMPTY_WORKING_TREE_STATUS;
    return state.statusByWorkingPath[workingPath] ?? EMPTY_WORKING_TREE_STATUS;
}
function getErrorMessage(error, fallback) {
    return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
function gitCommitFailureFromError(error) {
    return { ok: false, code: 'unknown', message: getErrorMessage(error, 'Commit failed.') };
}
function gitBranchFailureFromError(error) {
    return {
        ok: false,
        code: 'unknown',
        message: getErrorMessage(error, 'Branch operation failed.'),
    };
}
async function resolveGitCommitResult(resultPromise, onSuccess) {
    const result = await match
        .promise(resultPromise)
        .with({ ok: true }, async (commitResult) => {
        await onSuccess();
        return commitResult;
    })
        .with({ ok: false }, (commitResult) => commitResult)
        .safeExhaustive();
    return match(result)
        .with({ ok: true }, ({ value }) => value)
        .with({ ok: false }, ({ error }) => gitCommitFailureFromError(error))
        .exhaustive();
}
async function resolveGitBranchMutationResult(resultPromise, onSuccess) {
    const result = await match
        .promise(resultPromise)
        .with({ ok: true }, async (branchResult) => {
        await onSuccess();
        return branchResult;
    })
        .with({ ok: false }, (branchResult) => branchResult)
        .safeExhaustive();
    return match(result)
        .with({ ok: true }, ({ value }) => value)
        .with({ ok: false }, ({ error }) => gitBranchFailureFromError(error))
        .exhaustive();
}
export const useGitStore = create((set, get) => ({
    statusByWorkingPath: {},
    branches: null,
    branchesError: null,
    isCommitting: false,
    isBranchActionRunning: false,
    async refreshStatus(workingPath) {
        if (workingPath === null)
            return;
        const requestId = nextStatusRequestId(workingPath);
        patchWorkingTree(set, workingPath, { isLoading: true, error: null });
        try {
            const status = await api.getGitStatus(workingPath);
            if (isStaleStatusRequest(workingPath, requestId))
                return;
            patchWorkingTree(set, workingPath, { status, isLoading: false, error: null });
        }
        catch (err) {
            if (isStaleStatusRequest(workingPath, requestId))
                return;
            patchWorkingTree(set, workingPath, {
                status: null,
                isLoading: false,
                error: getErrorMessage(err, 'Failed to load Git status.'),
            });
        }
    },
    async refreshBranches(repositoryPath) {
        if (repositoryPath === null) {
            set({ branches: null, branchesError: null });
            return;
        }
        try {
            const branches = await api.listGitBranches(repositoryPath);
            set({ branches, branchesError: null });
        }
        catch (err) {
            set({
                branches: null,
                branchesError: getErrorMessage(err, 'Failed to load Git branches.'),
            });
        }
    },
    async commit(workingPath, payload) {
        set({ isCommitting: true });
        try {
            return await resolveGitCommitResult(api.commitGit(workingPath, payload), () => get().refreshStatus(workingPath));
        }
        finally {
            set({ isCommitting: false });
        }
    },
    async checkoutBranch(workingPath, payload) {
        return runBranchMutation(set, () => resolveGitBranchMutationResult(api.checkoutGitBranch(workingPath, payload), () => refreshAfterBranchMutation(get, workingPath)));
    },
    async createBranch(workingPath, payload) {
        return runBranchMutation(set, () => resolveGitBranchMutationResult(api.createGitBranch(workingPath, payload), () => refreshAfterBranchMutation(get, workingPath)));
    },
}));
function patchWorkingTree(set, workingPath, patch) {
    set((state) => ({
        statusByWorkingPath: {
            ...state.statusByWorkingPath,
            [workingPath]: {
                ...(state.statusByWorkingPath[workingPath] ?? EMPTY_WORKING_TREE_STATUS),
                ...patch,
            },
        },
    }));
}
/**
 * A checkout or branch creation changes both the working tree's HEAD and the
 * repository's refs, so both slices are refreshed. Branches are listed from the
 * working path deliberately: a linked worktree shares `refs/` with the primary
 * checkout, so the list is identical and the working path is the one guaranteed to
 * exist for this session.
 */
async function refreshAfterBranchMutation(get, workingPath) {
    await Promise.all([get().refreshStatus(workingPath), get().refreshBranches(workingPath)]);
}
async function runBranchMutation(set, run) {
    set({ isBranchActionRunning: true });
    try {
        return await run();
    }
    finally {
        set({ isBranchActionRunning: false });
    }
}

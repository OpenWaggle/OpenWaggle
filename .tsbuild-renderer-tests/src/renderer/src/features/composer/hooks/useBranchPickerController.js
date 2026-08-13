import { match } from '@diegogbrisa/ts-match';
import { useComposerActionStore } from '@/features/composer/state/composer-action-store';
import { useComposerStore } from '@/features/composer/state/composer-store';
import { useGit } from '@/features/git/hooks';
import { runBranchMutation } from '@/features/git/lib';
import { useProject } from '@/features/sessions/hooks';
const NO_PROJECT_RESULT = {
    ok: false,
    code: 'unknown',
    message: 'No project selected.',
};
export function useBranchPickerController({ onToast }) {
    const { projectPath } = useProject();
    const git = useGit();
    const branchMenuOpen = useComposerStore((s) => s.branchMenuOpen);
    const openMenu = useComposerStore((s) => s.openMenu);
    const branchQuery = useComposerActionStore((s) => s.branchQuery);
    const setBranchQuery = useComposerActionStore((s) => s.setBranchQuery);
    const openActionDialog = useComposerActionStore((s) => s.openActionDialog);
    const currentBranch = git.status?.branch ?? null;
    const branches = filterBranches(git.branches?.branches ?? [], branchQuery);
    async function checkoutBranch(name) {
        // Checkout runs in the tree this session uses, not the opened checkout.
        const workingPath = git.workingPath;
        await match
            .promise(runBranchMutation(() => workingPath
            ? git.checkoutBranch(workingPath, { name })
            : Promise.resolve(NO_PROJECT_RESULT), onToast))
            .with({ ok: true }, () => openMenu(null))
            .with({ ok: false }, () => undefined)
            .exhaustive();
    }
    return {
        projectPath,
        branchMenuOpen,
        branchQuery,
        currentBranch,
        isBranchActionRunning: git.isBranchActionRunning,
        filteredBranches: branches.filteredBranches,
        localBranches: branches.localBranches,
        remoteBranches: branches.remoteBranches,
        openMenu,
        setBranchQuery,
        openActionDialog,
        checkoutBranch,
    };
}
function filterBranches(branches, query) {
    const normalizedQuery = query.trim().toLowerCase();
    const filteredBranches = normalizedQuery
        ? branches.filter((branch) => branch.name.toLowerCase().includes(normalizedQuery))
        : branches;
    return {
        filteredBranches,
        localBranches: filteredBranches.filter((branch) => !branch.isRemote),
        remoteBranches: filteredBranches.filter((branch) => branch.isRemote),
    };
}

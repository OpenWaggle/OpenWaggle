import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git';
import { formatWorktreePathForDisplay } from '@shared/utils/worktree';
import { useCallback, useEffect, useState } from 'react';
import { usePreferencesStore } from '@/features/settings/state/preferences-store';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
import { Button } from '@/shared/ui/Button';
const logger = createRendererLogger('settings');
const MODE_LABELS = {
    local: 'Current checkout',
    worktree: 'New worktree',
};
const MODE_DESCRIPTIONS = {
    local: 'Sessions edit files directly in the opened checkout.',
    worktree: 'Each session runs in a dedicated Session worktree isolated from the checkout.',
};
function useProjectWorktrees(projectPath) {
    const [worktrees, setWorktrees] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const refresh = useCallback(async () => {
        if (!projectPath) {
            setWorktrees([]);
            return;
        }
        setIsLoading(true);
        try {
            const result = await api.listGitWorktrees(projectPath);
            setWorktrees(result.worktrees);
        }
        catch (error) {
            logger.warn('Failed to list worktrees', { error: String(error) });
            setWorktrees([]);
        }
        finally {
            setIsLoading(false);
        }
    }, [projectPath]);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    return { worktrees, isLoading, refresh };
}
export function WorktreesSection() {
    const settings = usePreferencesStore((state) => state.settings);
    const setDefaultSessionEnvironmentMode = usePreferencesStore((state) => state.setDefaultSessionEnvironmentMode);
    const projectPath = settings.projectPath;
    const { worktrees, isLoading, refresh } = useProjectWorktrees(projectPath);
    const [removingPath, setRemovingPath] = useState(null);
    async function handleRemove(worktreePath) {
        if (!projectPath)
            return;
        setRemovingPath(worktreePath);
        try {
            const result = await api.removeGitWorktree(projectPath, { path: worktreePath });
            if (!result.ok) {
                logger.warn('Failed to remove worktree', { code: result.code, message: result.message });
            }
            await refresh();
        }
        catch (error) {
            logger.warn('Failed to remove worktree', { error: String(error) });
        }
        finally {
            setRemovingPath(null);
        }
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "space-y-3", children: [_jsx("h3", { className: "text-[16px] font-semibold text-[#e7e9ee]", children: "Session environment mode" }), _jsx("div", { className: "overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]", children: SESSION_ENVIRONMENT_MODES.map((mode) => {
                            const isActive = settings.defaultSessionEnvironmentMode === mode;
                            return (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => {
                                    void setDefaultSessionEnvironmentMode(mode);
                                }, className: "flex w-full items-center justify-between border-b border-[#1e2229] px-5 py-3 text-left last:border-b-0 hover:bg-[#161a20]", children: [_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsx("span", { className: "text-[13px] font-medium text-[#e7e9ee]", children: MODE_LABELS[mode] }), _jsx("span", { className: "text-[12px] text-[#9098a8]", children: MODE_DESCRIPTIONS[mode] })] }), _jsx("div", { className: `size-3 shrink-0 rounded-full border ${isActive ? 'border-accent bg-accent' : 'border-[#3a3f4a]'}` })] }, mode));
                        }) })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "text-[16px] font-semibold text-[#e7e9ee]", children: "Worktrees" }), _jsx(Button, { variant: "secondary", size: "xs", disabled: isLoading, onClick: () => void refresh(), children: "Refresh" })] }), !projectPath ? (_jsx("p", { className: "text-[12px] text-[#9098a8]", children: "Open a project to manage its worktrees." })) : worktrees.length === 0 ? (_jsx("p", { className: "text-[12px] text-[#9098a8]", children: isLoading ? 'Loading worktrees…' : 'No worktrees for this repository.' })) : (_jsx("div", { className: "overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]", children: worktrees.map((worktree) => (_jsxs("div", { className: "flex items-center justify-between border-b border-[#1e2229] px-5 py-3 last:border-b-0", children: [_jsxs("div", { className: "flex flex-col gap-0.5", children: [_jsxs("span", { className: "text-[13px] font-medium text-[#e7e9ee]", children: [formatWorktreePathForDisplay(worktree.path), worktree.isMain ? ' (main)' : ''] }), _jsxs("span", { className: "text-[12px] text-[#9098a8]", children: [worktree.branch ?? 'detached', " \u00B7 ", worktree.path] })] }), !worktree.isMain && (_jsx(Button, { variant: "secondary", size: "xs", disabled: removingPath === worktree.path, onClick: () => void handleRemove(worktree.path), children: "Remove" }))] }, worktree.path))) }))] })] }));
}

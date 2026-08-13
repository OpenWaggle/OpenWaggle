import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSessionStatusStore } from '@/features/sessions/state';
import { cn } from '@/shared/lib/cn';
import { SIDEBAR_LAYOUT } from '../constants/sidebar-layout';
import { useSessionGitIndicators } from '../hooks/useSessionGitIndicators';
import { useSidebarController } from '../hooks/useSidebarController';
import { SidebarBrandArea, SidebarPrimaryActions, SidebarProjectsHeader, SidebarSettingsButton, } from './SidebarNavigation';
import { SidebarProjectList } from './SidebarProjectList';
export function Sidebar() {
    const controller = useSidebarController();
    // Each row shows its own working tree, so load status for every listed session's
    // working path (de-duplicated: local-mode sessions in one project share a tree).
    useSessionGitIndicators(controller.sessionGroups.projects.flatMap((group) => group.sessions));
    const markUnread = useSessionStatusStore((state) => state.markUnread);
    const sidebarHidden = !controller.sidebarOpen || controller.activeView === 'settings';
    const renderState = {
        activeBranchId: controller.activeBranchId,
        activeSessionId: controller.activeSessionId,
        activeSessionTree: controller.matchingActiveSessionTree,
        collapsedProjectPaths: controller.collapsedProjectPaths,
        draftBranch: controller.draftBranch,
        draftSessionProjectPath: controller.draftSessionProjectPath,
        projectPath: controller.projectPath,
    };
    const projectActions = {
        newSession(nextProjectPath) {
            void controller.handleSelectProjectPath(nextProjectPath);
        },
        openInFinder: controller.handleOpenProjectInFinder,
        rename: controller.handleRenameProject,
        archiveSessions: controller.handleArchiveProjectSessions,
        remove: controller.handleRemoveProject,
        toggleCollapsed: controller.handleToggleProjectCollapsed,
    };
    const sessionActions = {
        select: controller.handleSelectSession,
        delete: controller.handleDeleteSession,
        archive: controller.handleArchiveSession,
        clone: controller.handleCloneSession,
        markUnread,
    };
    const branchActions = {
        select: controller.handleSelectBranch,
        rename: controller.handleRenameBranch,
        archive: controller.handleArchiveBranch,
        toggle: controller.handleToggleBranches,
    };
    return (_jsx("div", { "aria-hidden": sidebarHidden ? true : undefined, inert: sidebarHidden ? true : undefined, className: cn('shrink-0 overflow-hidden transition-[width] duration-200 ease-out', sidebarHidden ? 'w-0' : SIDEBAR_LAYOUT.WIDTH_CLASS, sidebarHidden && 'pointer-events-none'), children: _jsxs("nav", { "aria-label": "Sidebar", className: `flex h-full ${SIDEBAR_LAYOUT.WIDTH_CLASS} shrink-0 flex-col justify-between border-r border-border bg-bg-secondary`, children: [_jsxs("div", { className: "flex flex-1 flex-col overflow-hidden", children: [_jsx(SidebarBrandArea, { isFullscreen: controller.isFullscreen }), _jsx(SidebarPrimaryActions, { activeView: controller.activeView, onNewSession: controller.handleNewSession, onOpenSkills: controller.handleOpenSkills }), _jsx("div", { className: "h-20 shrink-0" }), _jsx(SidebarProjectsHeader, { sortMenuOpen: controller.sortMenuOpen, sortMode: controller.sortMode, onOpenProject: () => {
                                void controller.handleOpenProject();
                            }, onSetSortMenuOpen: controller.setSortMenuOpen, onSetSortMode: controller.setSortMode }), _jsx("div", { className: "no-drag flex-1 overflow-y-auto pb-3", children: _jsx(SidebarProjectList, { sessionGroups: controller.sessionGroups, renderState: renderState, displayProjectName: controller.displayProjectName, projectActions: projectActions, sessionActions: sessionActions, branchActions: branchActions }) })] }), _jsx(SidebarSettingsButton, { onOpenSettings: controller.handleOpenSettings })] }) }));
}

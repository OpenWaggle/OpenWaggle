import { useSessionStatusStore } from '@/features/sessions/state'
import { cn } from '@/shared/lib/cn'
import { SIDEBAR_LAYOUT } from '../constants/sidebar-layout'
import { useSessionGitIndicators } from '../hooks/useSessionGitIndicators'
import { useSidebarController } from '../hooks/useSidebarController'
import {
  SidebarBrandArea,
  SidebarPrimaryActions,
  SidebarProjectsHeader,
  SidebarSettingsButton,
} from './SidebarNavigation'
import { SidebarPinnedSection } from './SidebarPinnedSection'
import { SidebarProjectList } from './SidebarProjectList'

export function Sidebar() {
  const controller = useSidebarController()
  // Each row shows its own working tree, so load status for every listed session's
  // working path (de-duplicated: local-mode sessions in one project share a tree).
  useSessionGitIndicators([
    ...controller.sessionGroups.projects.flatMap((group) => group.sessions),
    ...controller.pinnedRows.map((row) => row.session),
  ])
  const markUnread = useSessionStatusStore((state) => state.markUnread)
  const sidebarHidden = !controller.sidebarOpen || controller.activeView === 'settings'
  const renderState = {
    activeBranchId: controller.activeBranchId,
    activeSessionId: controller.activeSessionId,
    activeSessionTree: controller.matchingActiveSessionTree,
    collapsedProjectPaths: controller.collapsedProjectPaths,
    draftBranch: controller.draftBranch,
    draftSessionProjectPath: controller.draftSessionProjectPath,
    projectPath: controller.projectPath,
  }
  const projectActions = {
    newSession(nextProjectPath: string) {
      void controller.handleSelectProjectPath(nextProjectPath)
    },
    openInFinder: controller.handleOpenProjectInFinder,
    rename: controller.handleRenameProject,
    archiveSessions: controller.handleArchiveProjectSessions,
    remove: controller.handleRemoveProject,
    toggleCollapsed: controller.handleToggleProjectCollapsed,
  }
  const sessionActions = {
    select: controller.handleSelectSession,
    delete: controller.handleDeleteSession,
    archive: controller.handleArchiveSession,
    clone: controller.handleCloneSession,
    markUnread,
    togglePin: controller.handleTogglePinnedSession,
  }
  const branchActions = {
    select: controller.handleSelectBranch,
    rename: controller.handleRenameBranch,
    archive: controller.handleArchiveBranch,
    toggle: controller.handleToggleBranches,
  }

  return (
    <div
      aria-hidden={sidebarHidden ? true : undefined}
      inert={sidebarHidden ? true : undefined}
      className={cn(
        'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
        sidebarHidden ? 'w-0' : SIDEBAR_LAYOUT.WIDTH_CLASS,
        sidebarHidden && 'pointer-events-none',
      )}
    >
      <nav
        aria-label="Sidebar"
        className={`flex h-full ${SIDEBAR_LAYOUT.WIDTH_CLASS} shrink-0 flex-col justify-between border-r border-border bg-bg-secondary`}
      >
        <div className="flex flex-1 flex-col overflow-hidden">
          <SidebarBrandArea isFullscreen={controller.isFullscreen} />
          <SidebarPrimaryActions
            activeView={controller.activeView}
            onNewSession={controller.handleNewSession}
            onOpenSkills={controller.handleOpenSkills}
          />
          <div className="h-3 shrink-0" />
          {/*
           * Pinned and Projects share one scroll area. They were separate, with only the
           * project list scrolling, so nine Pinned rows pushed the projects out of reach in
           * a windowed sidebar: the list below could not be scrolled to.
           */}
          <div className="no-drag flex-1 overflow-y-auto pb-3">
            <SidebarPinnedSection
              rows={controller.pinnedRows}
              activeSessionId={
                controller.activeSessionId ? String(controller.activeSessionId) : null
              }
              sort={{
                mode: controller.pinnedSortMode,
                menuOpen: controller.pinnedSortMenuOpen,
                onSetMenuOpen: controller.setPinnedSortMenuOpen,
                onSetMode: controller.setPinnedSortMode,
              }}
              displayProjectName={controller.displayProjectName}
              sessionActions={sessionActions}
              onReorder={controller.handleReorderPinnedSession}
            />
            <SidebarProjectsHeader
              sortMenuOpen={controller.sortMenuOpen}
              sortMode={controller.sortMode}
              onOpenProject={() => {
                void controller.handleOpenProject()
              }}
              onSetSortMenuOpen={controller.setSortMenuOpen}
              onSetSortMode={controller.setSortMode}
            />
            <SidebarProjectList
              sessionGroups={controller.sessionGroups}
              renderState={renderState}
              displayProjectName={controller.displayProjectName}
              projectActions={projectActions}
              sessionActions={sessionActions}
              branchActions={branchActions}
            />
          </div>
        </div>
        <SidebarSettingsButton onOpenSettings={controller.handleOpenSettings} />
      </nav>
    </div>
  )
}

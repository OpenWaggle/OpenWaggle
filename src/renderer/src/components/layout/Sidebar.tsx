import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionBranch, SessionTree } from '@shared/types/session'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  AlertTriangle,
  Archive,
  ArrowDownAZ,
  Calendar,
  Check,
  Clock,
  Edit3,
  Folder,
  FolderPlus,
  GitBranch,
  LayoutList,
  MoreHorizontal,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import openwaggleLockup from '@/assets/openwaggle-lockup.png'
import { buildComposerDraftContextKey } from '@/components/composer/composer-draft-context'
import { setEditorText } from '@/components/composer/lexical-utils'
import { Popover } from '@/components/shared/Popover'
import { useChat } from '@/hooks/useChat'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { useSessions } from '@/hooks/useSessions'
import { cn } from '@/lib/cn'
import { projectName } from '@/lib/format'
import { api } from '@/lib/ipc'
import { useBranchSummaryStore } from '@/stores/branch-summary-store'
import { useChatStore } from '@/stores/chat-store'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStatusStore } from '@/stores/session-status-store'
import { useUIStore } from '@/stores/ui-store'
import { SessionListItem } from './SessionListItem'
import { buildSidebarBranchRows, type SidebarBranchRow } from './sidebar-branches'
import {
  buildSidebarProjectGroups,
  type SidebarProjectGroup,
  type SidebarSessionSortMode,
} from './sidebar-project-groups'

const BITS_PER_UINT32 = 32
const SIDEBAR_VALUE_104 = 104
const SIDEBAR_VALUE_80 = 80

const SORT_OPTIONS: { value: SidebarSessionSortMode; label: string; icon: typeof Clock }[] = [
  { value: 'recent', label: 'Recent', icon: Clock },
  { value: 'oldest', label: 'Oldest', icon: Calendar },
  { value: 'name', label: 'Name (A→Z)', icon: ArrowDownAZ },
]

interface DraftBranchRowProps {
  readonly sourceNodeId: string
}

function DraftBranchRow({ sourceNodeId }: DraftBranchRowProps) {
  return (
    <div className="mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md border border-dashed border-border pl-11 pr-3 text-left text-text-tertiary">
      <GitBranch className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-[12px]">Draft branch from {sourceNodeId}</span>
    </div>
  )
}

interface BranchRowsProps {
  readonly sessionId: string
  readonly rows: readonly SidebarBranchRow[]
  readonly onSelectBranch: (sessionId: string, branch: SessionBranch) => void
  readonly onRenameBranch: (sessionId: string, branch: SessionBranch, name: string) => void
  readonly onArchiveBranch: (sessionId: string, branch: SessionBranch) => void
}

function BranchRows({
  sessionId,
  rows,
  onSelectBranch,
  onRenameBranch,
  onArchiveBranch,
}: BranchRowsProps) {
  const [renamingBranchId, setRenamingBranchId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [menuBranchId, setMenuBranchId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!renamingBranchId) {
      return
    }
    renameInputRef.current?.focus()
    renameInputRef.current?.select()
  }, [renamingBranchId])

  function startRename(branch: SessionBranch): void {
    setMenuBranchId(null)
    setRenamingBranchId(String(branch.id))
    setRenameValue(branch.name)
  }

  function cancelRename(): void {
    setRenamingBranchId(null)
    setRenameValue('')
  }

  function saveRename(branch: SessionBranch): void {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== branch.name) {
      onRenameBranch(sessionId, branch, trimmed)
    }
    cancelRename()
  }
  if (rows.length === 0) {
    return null
  }

  return (
    <div className="mb-1 space-y-0.5">
      {rows.map((row) => {
        if (row.type === 'draft') {
          return <DraftBranchRow key="draft" sourceNodeId={String(row.sourceNodeId)} />
        }

        const branchId = String(row.branch.id)
        const isRenaming = renamingBranchId === branchId

        return (
          <div
            key={branchId}
            className={cn(
              'group mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md pl-11 pr-1.5 text-left transition-colors',
              row.isActive
                ? 'bg-bg-active text-text-primary'
                : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
            )}
          >
            {row.branch.interruptedRun ? (
              <AlertTriangle
                className="h-3 w-3 shrink-0 text-amber-400"
                aria-label="Interrupted run"
              />
            ) : (
              <GitBranch className="h-3 w-3 shrink-0" />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => saveRename(row.branch)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    saveRename(row.branch)
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelRename()
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-text-primary outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => onSelectBranch(sessionId, row.branch)}
                className="min-w-0 flex-1 truncate text-left text-[12px]"
              >
                {row.branch.name}
              </button>
            )}
            {!isRenaming ? (
              <Popover
                open={menuBranchId === branchId}
                onOpenChange={(open) => setMenuBranchId(open ? branchId : null)}
                placement="bottom-end"
                className="min-w-[132px] py-1"
                trigger={({ isOpen, toggle }) => (
                  <button
                    type="button"
                    aria-label={`Open branch actions for ${row.branch.name}`}
                    aria-expanded={isOpen}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggle()
                    }}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-tertiary opacity-0 transition-colors hover:bg-bg-hover hover:text-text-secondary group-hover:opacity-100 focus:opacity-100"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                )}
              >
                {!row.branch.isMain ? (
                  <button
                    type="button"
                    onClick={() => startRename(row.branch)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
                  >
                    <Edit3 className="h-3 w-3 shrink-0" />
                    <span>Rename</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMenuBranchId(null)
                    onArchiveBranch(sessionId, row.branch)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
                >
                  <Archive className="h-3 w-3 shrink-0" />
                  <span>{row.branch.isMain ? 'Archive session' : 'Archive'}</span>
                </button>
              </Popover>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

interface ProjectGroupSectionProps {
  readonly group: SidebarProjectGroup
  readonly isCurrentProject: boolean
  readonly activeSessionId: SessionId | null
  readonly activeSessionTree: SessionTree | null
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly draftBranch: ReturnType<typeof useSessions>['draftBranch']
  readonly displayProjectName: (path: string) => string
  readonly onSelectProjectPath: (path: string) => void
  readonly onSelectSession: (id: SessionId) => void
  readonly onDeleteSession: (id: SessionId) => void
  readonly onArchiveSession: (id: SessionId) => void
  readonly onCloneSession: (id: SessionId) => void
  readonly onMarkUnread: (id: SessionId) => void
  readonly onSelectBranch: (sessionId: string, branch: SessionBranch) => void
  readonly onRenameBranch: (sessionId: string, branch: SessionBranch, name: string) => void
  readonly onArchiveBranch: (sessionId: string, branch: SessionBranch) => void
  readonly onToggleBranches: (sessionId: SessionId, collapsed: boolean) => void
}

function ProjectGroupSection({
  group,
  isCurrentProject,
  activeSessionId,
  activeSessionTree,
  activeBranchId,
  draftBranch,
  displayProjectName,
  onSelectProjectPath,
  onSelectSession,
  onDeleteSession,
  onArchiveSession,
  onCloneSession,
  onMarkUnread,
  onSelectBranch,
  onRenameBranch,
  onArchiveBranch,
  onToggleBranches,
}: ProjectGroupSectionProps) {
  return (
    <section className="mb-2">
      <button
        type="button"
        onClick={() => onSelectProjectPath(group.projectPath)}
        className={cn(
          'flex h-7 w-full items-center gap-2 px-4 text-left transition-colors hover:bg-bg-hover',
          isCurrentProject ? 'text-text-secondary' : 'text-text-tertiary',
        )}
        title={group.projectPath}
      >
        <Folder className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {displayProjectName(group.projectPath)}
        </span>
      </button>

      {group.sessions.length === 0 ? (
        <div className="px-10 py-1.5 text-[12px] text-text-muted">No sessions</div>
      ) : (
        <div className="space-y-0.5">
          {group.sessions.map((session) => {
            const sourceBranches =
              activeSessionTree?.session.id === session.id
                ? activeSessionTree.branches
                : (session.branches ?? [])
            const visibleBranchCount = sourceBranches.filter(
              (branch) => branch.archived !== true,
            ).length
            const hasDraftBranch = draftBranch?.sessionId === session.id
            const hasBranchDisclosure = visibleBranchCount > 1 && !hasDraftBranch
            const branchesCollapsed = session.treeUiState?.branchesSidebarCollapsed === true
            const branchRowsCollapsed = branchesCollapsed && !hasDraftBranch
            const branchRows = buildSidebarBranchRows({
              session,
              activeSessionTree,
              activeBranchId:
                session.id === activeSessionId ? activeBranchId : session.lastActiveBranchId,
              branchesCollapsed: branchRowsCollapsed,
              draftBranch,
            })

            return (
              <div key={String(session.id)}>
                <SessionListItem
                  session={session}
                  isActive={session.id === activeSessionId}
                  variant="project"
                  onSelect={onSelectSession}
                  onDelete={onDeleteSession}
                  onArchive={onArchiveSession}
                  onClone={onCloneSession}
                  onMarkUnread={onMarkUnread}
                  hasBranchDisclosure={hasBranchDisclosure}
                  branchesCollapsed={branchRowsCollapsed}
                  onToggleBranches={() => onToggleBranches(session.id, !branchRowsCollapsed)}
                />
                <BranchRows
                  sessionId={String(session.id)}
                  rows={branchRows}
                  onSelectBranch={onSelectBranch}
                  onRenameBranch={onRenameBranch}
                  onArchiveBranch={onArchiveBranch}
                />
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function activeViewFromPathname(pathname: string): 'chat' | 'skills' | 'settings' {
  if (pathname.startsWith('/skills')) return 'skills'
  if (pathname.startsWith('/settings')) return 'settings'
  return 'chat'
}

interface SidebarBrandAreaProps {
  readonly isFullscreen: boolean
}

function SidebarBrandArea({ isFullscreen }: SidebarBrandAreaProps) {
  return (
    <>
      <div
        className="drag-region shrink-0 transition-[height] duration-200 ease-out"
        style={{ height: isFullscreen ? 0 : BITS_PER_UINT32 }}
      />
      <div className="drag-region flex shrink-0 items-center px-4 py-1">
        <img
          src={openwaggleLockup}
          alt="OpenWaggle"
          className="no-drag h-12 w-auto object-contain"
        />
      </div>
      <div
        className="shrink-0 transition-[height] duration-200 ease-out"
        style={{ height: isFullscreen ? SIDEBAR_VALUE_104 : SIDEBAR_VALUE_80 }}
      />
    </>
  )
}

interface SidebarPrimaryActionsProps {
  readonly activeView: 'chat' | 'skills' | 'settings'
  readonly onNewSession: () => void
  readonly onOpenSkills: () => void
}

function SidebarPrimaryActions({
  activeView,
  onNewSession,
  onOpenSkills,
}: SidebarPrimaryActionsProps) {
  return (
    <div className="shrink-0">
      <button
        type="button"
        aria-label="New session"
        onClick={onNewSession}
        className="no-drag flex h-[34px] w-full items-center gap-2 px-3 text-left transition-colors hover:bg-bg-hover"
      >
        <Edit3 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <span className="text-[14px] text-text-secondary">New session</span>
      </button>

      <button
        type="button"
        aria-label="Skills"
        onClick={onOpenSkills}
        className={cn(
          'no-drag flex h-8 w-full items-center gap-2 px-3 transition-colors',
          activeView === 'skills'
            ? 'bg-bg-active text-text-primary'
            : 'text-text-secondary hover:bg-bg-hover',
        )}
        title="Open skills"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <span className="text-[14px]">Skills</span>
      </button>
    </div>
  )
}

interface SidebarProjectsHeaderProps {
  readonly sortMenuOpen: boolean
  readonly sortMode: SidebarSessionSortMode
  readonly onOpenProject: () => void
  readonly onSetSortMenuOpen: (open: boolean) => void
  readonly onSetSortMode: (mode: SidebarSessionSortMode) => void
}

function SidebarProjectsHeader({
  sortMenuOpen,
  sortMode,
  onOpenProject,
  onSetSortMenuOpen,
  onSetSortMode,
}: SidebarProjectsHeaderProps) {
  return (
    <div className="no-drag flex h-[30px] shrink-0 items-center justify-between px-4">
      <span className="text-[12px] font-medium text-text-tertiary">Projects</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Open project folder"
          onClick={onOpenProject}
          className="rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
          title="Open project folder"
        >
          <FolderPlus className="h-[13px] w-[13px]" />
        </button>
        <Popover
          open={sortMenuOpen}
          onOpenChange={onSetSortMenuOpen}
          placement="bottom-end"
          className="min-w-[150px] py-1"
          trigger={
            <button
              type="button"
              aria-label="Sort sessions"
              onClick={() => onSetSortMenuOpen(!sortMenuOpen)}
              className={cn(
                'rounded p-0.5 transition-colors',
                sortMenuOpen ? 'text-text-primary' : 'text-text-tertiary hover:text-text-secondary',
              )}
              title="Sort sessions"
            >
              <LayoutList className="h-3 w-3" />
            </button>
          }
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onSetSortMode(opt.value)
                onSetSortMenuOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
                sortMode === opt.value ? 'text-accent' : 'text-text-secondary',
              )}
            >
              <opt.icon className="h-3 w-3 shrink-0" />
              <span className="flex-1">{opt.label}</span>
              {sortMode === opt.value ? <Check className="h-3 w-3 shrink-0" /> : null}
            </button>
          ))}
        </Popover>
      </div>
    </div>
  )
}

interface SidebarProjectListProps {
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly activeSessionId: SessionId | null
  readonly activeSessionTree: SessionTree | null
  readonly draftBranch: ReturnType<typeof useSessions>['draftBranch']
  readonly projectPath: string | null
  readonly sessionGroups: ReturnType<typeof buildSidebarProjectGroups>
  readonly displayProjectName: (path: string) => string
  readonly onArchiveBranch: (sessionId: string, branch: SessionBranch) => void
  readonly onArchiveSession: (id: SessionId) => void
  readonly onDeleteSession: (id: SessionId) => void
  readonly onCloneSession: (id: SessionId) => void
  readonly onRenameBranch: (sessionId: string, branch: SessionBranch, name: string) => void
  readonly onSelectBranch: (sessionId: string, branch: SessionBranch) => void
  readonly onSelectSession: (id: SessionId) => void
  readonly onSelectProjectPath: (path: string) => void
  readonly onToggleBranches: (sessionId: SessionId, collapsed: boolean) => void
}

function SidebarProjectList({
  activeBranchId,
  activeSessionId,
  activeSessionTree,
  draftBranch,
  projectPath,
  sessionGroups,
  displayProjectName,
  onArchiveBranch,
  onArchiveSession,
  onDeleteSession,
  onCloneSession,
  onRenameBranch,
  onSelectBranch,
  onSelectSession,
  onSelectProjectPath,
  onToggleBranches,
}: SidebarProjectListProps) {
  if (sessionGroups.projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Folder className="h-5 w-5 text-text-muted/75" />
        <p className="text-[13px] text-text-muted">No projects yet</p>
      </div>
    )
  }

  return sessionGroups.projects.map((group) => (
    <ProjectGroupSection
      key={group.projectPath}
      group={group}
      isCurrentProject={group.projectPath === projectPath}
      activeSessionId={activeSessionId}
      activeSessionTree={activeSessionTree}
      activeBranchId={activeBranchId}
      draftBranch={draftBranch}
      displayProjectName={displayProjectName}
      onSelectProjectPath={onSelectProjectPath}
      onSelectSession={onSelectSession}
      onDeleteSession={onDeleteSession}
      onArchiveSession={onArchiveSession}
      onCloneSession={onCloneSession}
      onMarkUnread={(id) => {
        useSessionStatusStore.getState().markUnread(id)
      }}
      onSelectBranch={onSelectBranch}
      onRenameBranch={onRenameBranch}
      onArchiveBranch={onArchiveBranch}
      onToggleBranches={onToggleBranches}
    />
  ))
}

interface SidebarSettingsButtonProps {
  readonly onOpenSettings: () => void
}

function SidebarSettingsButton({ onOpenSettings }: SidebarSettingsButtonProps) {
  return (
    <div className="no-drag shrink-0">
      <button
        type="button"
        aria-label="Settings"
        onClick={onOpenSettings}
        className="flex h-9 w-full items-center gap-2.5 px-4 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        <Settings className="h-3.5 w-3.5" />
        <span className="text-[14px] text-text-secondary">Settings</span>
      </button>
    </div>
  )
}

function useSidebarController() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const showToast = useUIStore((s) => s.showToast)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const activeView = activeViewFromPathname(pathname)

  const { projectPath, selectFolder, setProjectPath } = useProject()
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)
  const projectDisplayNames = usePreferencesStore((s) => s.settings.projectDisplayNames)
  const selectedModel = usePreferencesStore((s) => s.settings.selectedModel)
  const {
    activeSessionId: activeChatSessionId,
    startDraftSession,
    deleteSession,
    loadSessions: loadChatSessions,
  } = useChat()
  const {
    sessions,
    activeSessionTree,
    activeWorkspace,
    draftBranch,
    loadSessions: loadSessionTrees,
    refreshSessionTree,
    refreshSessionWorkspace,
    clearDraftBranchForSession,
  } = useSessions()
  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()
  const activeSessionId = activeChatSessionId ? SessionId(String(activeChatSessionId)) : null
  const matchingActiveSessionTree =
    activeSessionId && activeSessionTree?.session.id === activeSessionId ? activeSessionTree : null
  const matchingActiveWorkspace =
    activeSessionId && activeWorkspace?.tree.session.id === activeSessionId ? activeWorkspace : null
  const activeBranchId =
    matchingActiveWorkspace?.activeBranchId ?? matchingActiveSessionTree?.session.lastActiveBranchId

  const isFullscreen = useFullscreen()
  const [sortMode, setSortMode] = useState<SidebarSessionSortMode>('recent')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const sessionGroups = buildSidebarProjectGroups({
    sessions,
    currentProjectPath: projectPath,
    recentProjects,
    sortMode,
  })

  function displayProjectName(path: string): string {
    return projectDisplayNames[path]?.trim() || projectName(path)
  }

  function refreshGit(path: string | null): void {
    void Promise.all([refreshGitStatus(path), refreshGitBranches(path)])
  }

  function clearTransientDraftContext(): void {
    useBranchSummaryStore.getState().clearPrompt()
    if (draftBranch) {
      clearDraftBranchForSession(draftBranch.sessionId)
    }
  }

  function handleSelectSession(id: SessionId): void {
    clearTransientDraftContext()
    void navigate({ to: '/sessions/$sessionId', params: { sessionId: String(id) } })
  }

  async function refreshAfterSessionMutation(sessionId: SessionId): Promise<void> {
    await loadSessionTrees()
    await refreshSessionTree(sessionId)
  }

  function handleRenameBranch(sessionId: string, branch: SessionBranch, name: string): void {
    const targetSessionId = SessionId(sessionId)
    void api
      .renameSessionBranch(targetSessionId, branch.id, name)
      .then(() => refreshAfterSessionMutation(targetSessionId))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to rename branch: ${message}`)
      })
  }

  function handleSelectBranch(sessionId: string, branch: SessionBranch): void {
    const targetSessionId = SessionId(sessionId)
    const targetBranchId = String(branch.id)
    const headNodeId = branch.headNodeId ? String(branch.headNodeId) : null

    useBranchSummaryStore.getState().clearPrompt()
    if (activeSessionId) {
      clearDraftBranchForSession(activeSessionId)
    }
    clearDraftBranchForSession(targetSessionId)

    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId },
      search: (previous) => ({
        ...previous,
        branch: targetBranchId,
        node: headNodeId ?? undefined,
      }),
    })

    if (!headNodeId) {
      return
    }

    const targetNodeId = SessionNodeId(headNodeId)
    void api
      .navigateSessionTree(targetSessionId, selectedModel, targetNodeId, { summarize: false })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to switch session branch: ${message}`)
      })
      .finally(() => {
        void refreshSessionWorkspace(targetSessionId, {
          branchId: SessionBranchId(targetBranchId),
          nodeId: targetNodeId,
        })
      })
  }

  function navigateToMainBranchAfterArchive(sessionId: string): void {
    const session = sessions.find((item) => String(item.id) === sessionId)
    const mainBranch = session?.branches?.find((branch) => branch.isMain)
    if (mainBranch) {
      handleSelectBranch(sessionId, mainBranch)
      return
    }

    void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
  }

  function handleArchiveBranch(sessionId: string, branch: SessionBranch): void {
    const targetSessionId = SessionId(sessionId)
    if (branch.isMain) {
      handleArchiveSession(targetSessionId)
      return
    }

    void api
      .archiveSessionBranch(targetSessionId, branch.id)
      .then(() => {
        useComposerStore.getState().clearScopedDraftsForBranch(sessionId, String(branch.id))
      })
      .then(() => refreshAfterSessionMutation(targetSessionId))
      .then(() => {
        if (activeBranchId === branch.id) {
          navigateToMainBranchAfterArchive(sessionId)
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to archive branch: ${message}`)
      })
  }

  function handleArchiveSession(sessionId: SessionId): void {
    void (async () => {
      const confirmed = await api.showConfirm(
        'Archive this session?',
        'Archiving hides the full session and all branches from normal navigation.',
      )
      if (!confirmed) {
        return
      }

      await api.archiveSession(sessionId)
      useComposerStore.getState().clearScopedDraftsForSession(String(sessionId))
      await Promise.all([loadChatSessions(), loadSessionTrees()])
      if (activeSessionId === sessionId) {
        startDraftSession()
        void navigate({ to: '/' })
      }
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      showToast(`Failed to archive session: ${message}`)
    })
  }

  function handleDeleteSession(sessionId: SessionId): void {
    void deleteSession(sessionId)
      .then(() => {
        if (activeSessionId === sessionId) {
          startDraftSession()
          void navigate({ to: '/' })
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to delete session: ${message}`)
      })
  }

  function handleToggleBranches(sessionId: SessionId, collapsed: boolean): void {
    void api
      .updateSessionTreeUiState(sessionId, { branchesSidebarCollapsed: collapsed })
      .then(() => loadSessionTrees())
      .then(() => refreshSessionTree(sessionId))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to update branch list: ${message}`)
      })
  }

  function setComposerTextValue(text: string): void {
    const composer = useComposerStore.getState()
    composer.setInput(text)
    composer.setCursorIndex(text.length)
    if (composer.lexicalEditor) {
      setEditorText(composer.lexicalEditor, text)
    }
  }

  function activateClonedSession(sessionId: SessionId, project: string | null): void {
    const contextKey = buildComposerDraftContextKey({ projectPath: project, sessionId })
    useComposerStore.getState().switchScopedDraftContext(contextKey, {
      input: '',
      attachments: [],
    })
    setComposerTextValue('')
    useChatStore.getState().setActiveSession(sessionId)
    void navigate({ to: '/sessions/$sessionId', params: { sessionId: String(sessionId) } })
  }

  function handleCloneSession(sessionId: SessionId): void {
    if (activeSessionId !== sessionId) {
      showToast('Open this session before cloning it.')
      return
    }

    const targetNodeId =
      matchingActiveWorkspace?.activeNodeId ?? matchingActiveSessionTree?.session.lastActiveNodeId
    if (!targetNodeId) {
      showToast('No session history to clone.')
      return
    }

    void api
      .cloneSessionToNew(sessionId, selectedModel, SessionNodeId(String(targetNodeId)))
      .then((result) => {
        if (result.cancelled) {
          showToast('Session clone cancelled.')
          return
        }
        if (!result.session) {
          showToast('Session clone did not return a session.')
          return
        }
        useChatStore.getState().upsertSession(result.session)
        activateClonedSession(result.session.id, result.session.projectPath)
        return Promise.all([
          loadChatSessions(),
          loadSessionTrees(),
          refreshSessionWorkspace(result.session.id),
        ])
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to clone session: ${message}`)
      })
  }

  function handleNewSession(): void {
    clearTransientDraftContext()
    startDraftSession()
    void navigate({ to: '/' })
  }

  async function handleOpenProject(): Promise<void> {
    const path = await selectFolder()
    if (!path) return
    clearTransientDraftContext()
    await setProjectPath(path)
    startDraftSession()
    refreshGit(path)
    void navigate({ to: '/' })
  }

  async function handleSelectProjectPath(path: string): Promise<void> {
    clearTransientDraftContext()
    await setProjectPath(path)
    startDraftSession()
    refreshGit(path)
    void navigate({ to: '/' })
  }

  function handleOpenSkills(): void {
    void navigate({ to: '/skills' })
  }

  function handleOpenSettings(): void {
    void navigate({ to: '/settings' })
  }

  return {
    activeBranchId,
    activeSessionId,
    activeView,
    displayProjectName,
    draftBranch,
    handleArchiveBranch,
    handleArchiveSession,
    handleDeleteSession,
    handleCloneSession,
    handleNewSession,
    handleOpenProject,
    handleOpenSettings,
    handleOpenSkills,
    handleRenameBranch,
    handleSelectBranch,
    handleSelectProjectPath,
    handleSelectSession,
    handleToggleBranches,
    isFullscreen,
    matchingActiveSessionTree,
    projectPath,
    sessionGroups,
    setSortMenuOpen,
    setSortMode,
    sidebarOpen,
    sortMenuOpen,
    sortMode,
  }
}

export function Sidebar() {
  const {
    activeBranchId,
    activeSessionId,
    activeView,
    displayProjectName,
    draftBranch,
    handleArchiveBranch,
    handleArchiveSession,
    handleDeleteSession,
    handleCloneSession,
    handleNewSession,
    handleOpenProject,
    handleOpenSettings,
    handleOpenSkills,
    handleRenameBranch,
    handleSelectBranch,
    handleSelectProjectPath,
    handleSelectSession,
    handleToggleBranches,
    isFullscreen,
    matchingActiveSessionTree,
    projectPath,
    sessionGroups,
    setSortMenuOpen,
    setSortMode,
    sidebarOpen,
    sortMenuOpen,
    sortMode,
  } = useSidebarController()

  return (
    <div
      className={cn(
        'shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
        sidebarOpen ? 'w-[272px]' : 'w-0',
      )}
    >
      <nav
        aria-label="Sidebar"
        className="flex h-full w-[272px] shrink-0 flex-col justify-between border-r border-border bg-bg-secondary"
      >
        <div className="flex flex-1 flex-col overflow-hidden">
          <SidebarBrandArea isFullscreen={isFullscreen} />
          <SidebarPrimaryActions
            activeView={activeView}
            onNewSession={handleNewSession}
            onOpenSkills={handleOpenSkills}
          />
          <div className="shrink-0 h-20" />
          <SidebarProjectsHeader
            sortMenuOpen={sortMenuOpen}
            sortMode={sortMode}
            onOpenProject={() => {
              void handleOpenProject()
            }}
            onSetSortMenuOpen={setSortMenuOpen}
            onSetSortMode={setSortMode}
          />
          <div className="no-drag flex-1 overflow-y-auto pb-3">
            <SidebarProjectList
              activeBranchId={activeBranchId}
              activeSessionId={activeSessionId}
              activeSessionTree={matchingActiveSessionTree}
              draftBranch={draftBranch}
              projectPath={projectPath}
              sessionGroups={sessionGroups}
              displayProjectName={displayProjectName}
              onArchiveBranch={handleArchiveBranch}
              onArchiveSession={handleArchiveSession}
              onDeleteSession={handleDeleteSession}
              onCloneSession={handleCloneSession}
              onRenameBranch={handleRenameBranch}
              onSelectBranch={handleSelectBranch}
              onSelectSession={handleSelectSession}
              onSelectProjectPath={(nextProjectPath) => {
                void handleSelectProjectPath(nextProjectPath)
              }}
              onToggleBranches={handleToggleBranches}
            />
          </div>
        </div>

        <SidebarSettingsButton onOpenSettings={handleOpenSettings} />
      </nav>
    </div>
  )
}

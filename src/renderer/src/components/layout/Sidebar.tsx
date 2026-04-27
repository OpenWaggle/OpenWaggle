import { type ConversationId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type { SessionTree } from '@shared/types/session'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  ArrowDownAZ,
  Calendar,
  Check,
  Clock,
  Edit3,
  Folder,
  FolderPlus,
  GitBranch,
  LayoutList,
  Settings,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import openwaggleLockup from '@/assets/openwaggle-lockup.png'
import { Popover } from '@/components/shared/Popover'
import { useChat } from '@/hooks/useChat'
import { useFullscreen } from '@/hooks/useFullscreen'
import { useGit } from '@/hooks/useGit'
import { useProject } from '@/hooks/useProject'
import { useSessions } from '@/hooks/useSessions'
import { cn } from '@/lib/cn'
import { projectName } from '@/lib/format'
import { api } from '@/lib/ipc'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStatusStore } from '@/stores/session-status-store'
import { useUIStore } from '@/stores/ui-store'
import { SessionListItem } from './SessionListItem'
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
  readonly branches: SessionTree['branches']
  readonly activeBranchId: SessionTree['session']['lastActiveBranchId']
  readonly draftSourceNodeId: string | null
  readonly onSelectBranch: (branchId: string, headNodeId: string | null) => void
}

function BranchRows({
  branches,
  activeBranchId,
  draftSourceNodeId,
  onSelectBranch,
}: BranchRowsProps) {
  return (
    <div className="mb-1 space-y-0.5">
      {draftSourceNodeId ? <DraftBranchRow sourceNodeId={draftSourceNodeId} /> : null}
      {branches.map((branch) => {
        const isActiveBranch = branch.id === activeBranchId
        return (
          <button
            key={String(branch.id)}
            type="button"
            onClick={() =>
              onSelectBranch(
                String(branch.id),
                branch.headNodeId ? String(branch.headNodeId) : null,
              )
            }
            className={cn(
              'mx-2 flex h-7 w-[calc(100%-16px)] items-center gap-2 rounded-md pl-11 pr-3 text-left transition-colors',
              isActiveBranch
                ? 'bg-bg-active text-text-primary'
                : 'text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
            )}
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[12px]">{branch.name}</span>
          </button>
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
  readonly onSelectConversation: (id: ConversationId) => void
  readonly onDeleteConversation: (id: ConversationId) => void
  readonly onMarkUnread: (id: ConversationId) => void
  readonly onSelectBranch: (branchId: string, headNodeId: string | null) => void
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
  onSelectConversation,
  onDeleteConversation,
  onMarkUnread,
  onSelectBranch,
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
            const hasDraftBranch = draftBranch?.sessionId === session.id
            const showBranches =
              session.id === activeSessionId &&
              activeSessionTree !== null &&
              (activeSessionTree.branches.length > 1 || hasDraftBranch)

            return (
              <div key={String(session.id)}>
                <SessionListItem
                  session={session}
                  isActive={session.id === activeSessionId}
                  variant="project"
                  onSelect={onSelectConversation}
                  onDelete={onDeleteConversation}
                  onMarkUnread={onMarkUnread}
                />
                {showBranches ? (
                  <BranchRows
                    branches={activeSessionTree.branches}
                    activeBranchId={activeBranchId}
                    draftSourceNodeId={
                      draftBranch?.sessionId === activeSessionId
                        ? String(draftBranch.sourceNodeId)
                        : null
                    }
                    onSelectBranch={onSelectBranch}
                  />
                ) : null}
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

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const showToast = useUIStore((s) => s.showToast)
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const activeView = activeViewFromPathname(pathname)

  const { projectPath, selectFolder, setProjectPath } = useProject()
  const recentProjects = usePreferencesStore((s) => s.settings.recentProjects)
  const projectDisplayNames = usePreferencesStore((s) => s.settings.projectDisplayNames)
  const selectedModel = usePreferencesStore((s) => s.settings.selectedModel)
  const { activeConversationId, startDraftSession, deleteConversation } = useChat()
  const {
    sessions,
    activeSessionTree,
    activeWorkspace,
    draftBranch,
    refreshSessionWorkspace,
    clearDraftBranchForSession,
  } = useSessions()
  const { refreshStatus: refreshGitStatus, refreshBranches: refreshGitBranches } = useGit()
  const activeSessionId = activeConversationId ? SessionId(String(activeConversationId)) : null
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
  const hasProjectGroups = sessionGroups.projects.length > 0

  function displayProjectName(path: string): string {
    return projectDisplayNames[path]?.trim() || projectName(path)
  }

  function refreshGit(path: string | null): void {
    void Promise.all([refreshGitStatus(path), refreshGitBranches(path)])
  }

  function handleSelectConversation(id: ConversationId): void {
    void navigate({ to: '/sessions/$sessionId', params: { sessionId: String(id) } })
  }

  function handleSelectBranch(branchId: string, headNodeId: string | null): void {
    if (!activeSessionId) {
      return
    }

    clearDraftBranchForSession(activeSessionId)

    void navigate({
      to: '/sessions/$sessionId',
      params: { sessionId: String(activeSessionId) },
      search: (previous) => ({
        ...previous,
        branch: branchId,
        node: headNodeId ?? undefined,
      }),
    })

    if (!headNodeId) {
      return
    }

    const targetNodeId = SessionNodeId(headNodeId)
    void api
      .navigateSessionTree(activeSessionId, selectedModel, targetNodeId, { summarize: false })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        showToast(`Failed to switch session branch: ${message}`)
      })
      .finally(() => {
        void refreshSessionWorkspace(activeSessionId, {
          branchId: SessionBranchId(branchId),
          nodeId: targetNodeId,
        })
      })
  }

  function handleNewConversation(): void {
    startDraftSession()
    void navigate({ to: '/' })
  }

  async function handleOpenProject(): Promise<void> {
    const path = await selectFolder()
    if (!path) return
    await setProjectPath(path)
    startDraftSession()
    refreshGit(path)
    void navigate({ to: '/' })
  }

  async function handleSelectProjectPath(path: string): Promise<void> {
    await setProjectPath(path)
    startDraftSession()
    refreshGit(path)
    void navigate({ to: '/' })
  }

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

          <div className="shrink-0">
            <button
              type="button"
              aria-label="New session"
              onClick={() => {
                handleNewConversation()
              }}
              className="no-drag flex h-[34px] w-full items-center gap-2 px-3 text-left transition-colors hover:bg-bg-hover"
            >
              <Edit3 className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
              <span className="text-[14px] text-text-secondary">New session</span>
            </button>

            <button
              type="button"
              aria-label="Skills"
              onClick={() => {
                void navigate({ to: '/skills' })
              }}
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

          <div className="shrink-0 h-20" />

          <div className="no-drag flex h-[30px] shrink-0 items-center justify-between px-4">
            <span className="text-[12px] font-medium text-text-tertiary">Projects</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Open project folder"
                onClick={() => {
                  void handleOpenProject()
                }}
                className="rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
                title="Open project folder"
              >
                <FolderPlus className="h-[13px] w-[13px]" />
              </button>
              <Popover
                open={sortMenuOpen}
                onOpenChange={setSortMenuOpen}
                placement="bottom-end"
                className="min-w-[150px] py-1"
                trigger={
                  <button
                    type="button"
                    aria-label="Sort sessions"
                    onClick={() => setSortMenuOpen((open) => !open)}
                    className={cn(
                      'rounded p-0.5 transition-colors',
                      sortMenuOpen
                        ? 'text-text-primary'
                        : 'text-text-tertiary hover:text-text-secondary',
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
                      setSortMode(opt.value)
                      setSortMenuOpen(false)
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

          <div className="no-drag flex-1 overflow-y-auto pb-3">
            {!hasProjectGroups ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <Folder className="h-5 w-5 text-text-muted/75" />
                <p className="text-[13px] text-text-muted">No projects yet</p>
              </div>
            ) : (
              sessionGroups.projects.map((group) => (
                <ProjectGroupSection
                  key={group.projectPath}
                  group={group}
                  isCurrentProject={group.projectPath === projectPath}
                  activeSessionId={activeSessionId}
                  activeSessionTree={matchingActiveSessionTree}
                  activeBranchId={activeBranchId}
                  draftBranch={draftBranch}
                  displayProjectName={displayProjectName}
                  onSelectProjectPath={(nextProjectPath) => {
                    void handleSelectProjectPath(nextProjectPath)
                  }}
                  onSelectConversation={(id) => {
                    void handleSelectConversation(id)
                  }}
                  onDeleteConversation={(id) => {
                    void deleteConversation(id)
                  }}
                  onMarkUnread={(id) => {
                    useSessionStatusStore.getState().markUnread(id)
                  }}
                  onSelectBranch={handleSelectBranch}
                />
              ))
            )}
          </div>
        </div>

        <div className="no-drag shrink-0">
          <button
            type="button"
            aria-label="Settings"
            onClick={() => {
              void navigate({ to: '/settings' })
            }}
            className="flex h-9 w-full items-center gap-2.5 px-4 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="text-[14px] text-text-secondary">Settings</span>
          </button>
        </div>
      </nav>
    </div>
  )
}

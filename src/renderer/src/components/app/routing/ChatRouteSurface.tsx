import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect } from 'react'
import { ChatPanelContent } from '@/components/chat/ChatPanel'
import { useChatPanelSections } from '@/components/chat/use-chat-panel-controller'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { RightSidebarLayout } from '@/components/shared/RightSidebarLayout'
import { useBranchSummaryStore } from '@/stores/branch-summary-store'
import { useChatStore } from '@/stores/chat-store'
import { useGitStore } from '@/stores/git-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStatusStore } from '@/stores/session-status-store'
import { useSessionStore } from '@/stores/session-store'
import { CHAT_MIN_WIDTH, DIFF_PANEL_MAX, DIFF_PANEL_MIN, useUIStore } from '@/stores/ui-store'
import { resolveRightSidebarPanel } from './right-sidebar-panel'

const DIFF_PANEL_DEFAULT_WIDTH = 600
const DIFF_PANEL_STORAGE_KEY = 'openwaggle:diff-sidebar-width'
const DIFF_PANEL_SHEET_BREAKPOINT_PX = 1180
const OVERFLOW_TOLERANCE_PX = 0.5

const LazyChatDiffPane = lazy(() =>
  import('@/components/chat/ChatDiffPane').then((module) => ({ default: module.ChatDiffPane })),
)
const LazySessionTreePanel = lazy(() =>
  import('@/components/session-tree/SessionTreePanel').then((module) => ({
    default: module.SessionTreePanel,
  })),
)

interface ChatRouteSurfaceProps {
  readonly branchId: string | null
  readonly diffOpen: boolean
  readonly nodeId: string | null
  readonly sessionId: string | null
  readonly sessionTreeOpen: boolean
  readonly onDiffOpenChange: (open: boolean) => void
  readonly onSessionTreeOpenChange: (open: boolean) => void
}

function sessionIdFromRoute(sessionId: string): SessionId {
  return SessionId(sessionId)
}

function DiffSidebarFallback() {
  return (
    <output
      className="flex h-full w-full items-center justify-center bg-diff-bg text-[13px] text-text-tertiary"
      aria-live="polite"
    >
      Loading diff…
    </output>
  )
}

export function ChatRouteSurface({
  branchId,
  diffOpen,
  nodeId,
  sessionId,
  sessionTreeOpen,
  onDiffOpenChange,
  onSessionTreeOpenChange,
}: ChatRouteSurfaceProps) {
  const navigate = useNavigate()
  const sections = useChatPanelSections()
  const routeSessionId = sessionId ? sessionIdFromRoute(sessionId) : null
  const activeSessionId = useChatStore((state) => state.activeSessionId)
  const setActiveSession = useChatStore((state) => state.setActiveSession)
  const routeSessionSummary = useChatStore((state) => {
    if (routeSessionId === null) {
      return null
    }

    return state.sessions.find((session) => session.id === routeSessionId) ?? null
  })
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const setProjectPath = usePreferencesStore((state) => state.setProjectPath)
  const refreshGitStatus = useGitStore((state) => state.refreshStatus)
  const refreshGitBranches = useGitStore((state) => state.refreshBranches)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)
  const draftBranch = useSessionStore((state) => state.draftBranch)
  const clearDraftBranchForSession = useSessionStore((state) => state.clearDraftBranchForSession)
  const lastRightSidebarPanel = useUIStore((state) => state.lastRightSidebarPanel)
  const setLastRightSidebarPanel = useUIStore((state) => state.setLastRightSidebarPanel)
  const renderedRightSidebarPanel = resolveRightSidebarPanel({
    diffOpen,
    lastPanel: lastRightSidebarPanel,
    sessionTreeOpen,
  })

  useEffect(() => {
    if (routeSessionId === null) {
      if (activeSessionId !== null) {
        void navigate({
          to: '/sessions/$sessionId',
          params: { sessionId: String(activeSessionId) },
          replace: true,
          search: diffOpen ? { diff: 1 } : {},
        })
      }
      return
    }

    if (activeSessionId !== routeSessionId) {
      setActiveSession(routeSessionId)
    }
    useSessionStatusStore.getState().markVisited(routeSessionId)
  }, [activeSessionId, diffOpen, navigate, routeSessionId, setActiveSession])

  const routeSessionTreeId = routeSessionId ? SessionId(String(routeSessionId)) : null
  const routeBranchId = branchId ? SessionBranchId(branchId) : null
  const routeNodeId = nodeId ? SessionNodeId(nodeId) : null

  useEffect(() => {
    if (
      draftBranch &&
      (routeSessionTreeId === null || draftBranch.sessionId !== routeSessionTreeId || routeBranchId)
    ) {
      useBranchSummaryStore.getState().clearPrompt()
      clearDraftBranchForSession(draftBranch.sessionId)
    }
  }, [clearDraftBranchForSession, draftBranch, routeBranchId, routeSessionTreeId])

  useEffect(() => {
    void refreshSessionWorkspace(routeSessionTreeId, {
      branchId: routeBranchId,
      nodeId: routeNodeId,
    })
  }, [refreshSessionWorkspace, routeBranchId, routeNodeId, routeSessionTreeId])

  const routeProjectPath = routeSessionSummary?.projectPath ?? null
  const nextProjectPath = routeProjectPath ?? projectPath

  useEffect(() => {
    if (routeProjectPath !== null && routeProjectPath !== projectPath) {
      void setProjectPath(routeProjectPath)
    }
  }, [projectPath, routeProjectPath, setProjectPath])

  useEffect(() => {
    void refreshGitStatus(nextProjectPath)
    void refreshGitBranches(nextProjectPath)
  }, [nextProjectPath, refreshGitBranches, refreshGitStatus])

  function shouldAcceptDiffWidth(input: {
    readonly nextWidth: number
    readonly panel: HTMLDivElement
    readonly root: HTMLDivElement
    readonly sidebar: HTMLDivElement
  }): boolean {
    const previousPanelWidth = input.panel.style.width
    const previousSidebarWidth = input.sidebar.style.width
    input.panel.style.setProperty('width', `${String(input.nextWidth)}px`)
    input.sidebar.style.setProperty('width', `${String(input.nextWidth)}px`)

    const mainWidth = input.root.clientWidth - input.nextWidth
    const composerForm = input.root.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
    const composerFits = composerForm
      ? composerForm.scrollWidth <= composerForm.clientWidth + OVERFLOW_TOLERANCE_PX
      : true
    const accepted = mainWidth >= CHAT_MIN_WIDTH && composerFits

    if (previousPanelWidth.length > 0) {
      input.panel.style.setProperty('width', previousPanelWidth)
    } else {
      input.panel.style.removeProperty('width')
    }

    if (previousSidebarWidth.length > 0) {
      input.sidebar.style.setProperty('width', previousSidebarWidth)
    } else {
      input.sidebar.style.removeProperty('width')
    }

    return accepted
  }

  function handleDiffOpenChange(open: boolean): void {
    setLastRightSidebarPanel('diff')
    onDiffOpenChange(open)
  }

  function handleSessionTreeOpenChange(open: boolean): void {
    setLastRightSidebarPanel('session-tree')
    onSessionTreeOpenChange(open)
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PanelErrorBoundary name="Chat" className="flex min-w-0 flex-1 overflow-hidden">
        <RightSidebarLayout
          defaultWidth={DIFF_PANEL_DEFAULT_WIDTH}
          mainMinWidth={CHAT_MIN_WIDTH}
          maxWidth={DIFF_PANEL_MAX}
          minWidth={DIFF_PANEL_MIN}
          open={diffOpen || sessionTreeOpen}
          sheetBreakpointPx={DIFF_PANEL_SHEET_BREAKPOINT_PX}
          storageKey={DIFF_PANEL_STORAGE_KEY}
          onOpenChange={(open) => {
            if (renderedRightSidebarPanel === 'diff') {
              handleDiffOpenChange(open)
              return
            }
            handleSessionTreeOpenChange(open)
          }}
          shouldAcceptWidth={shouldAcceptDiffWidth}
          sidebar={
            <Suspense fallback={<DiffSidebarFallback />}>
              {renderedRightSidebarPanel === 'session-tree' ? (
                <LazySessionTreePanel onClose={() => handleSessionTreeOpenChange(false)} />
              ) : (
                <LazyChatDiffPane
                  section={sections.diff}
                  onClose={() => handleDiffOpenChange(false)}
                />
              )}
            </Suspense>
          }
        >
          <ChatPanelContent
            sections={sections}
            onOpenSessionTree={() => handleSessionTreeOpenChange(true)}
          />
        </RightSidebarLayout>
      </PanelErrorBoundary>
    </div>
  )
}

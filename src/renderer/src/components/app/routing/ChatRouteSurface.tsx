import { ConversationId, SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import { useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useEffect } from 'react'
import { ChatPanelContent } from '@/components/chat/ChatPanel'
import { useChatPanelSections } from '@/components/chat/use-chat-panel-controller'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { RightSidebarLayout } from '@/components/shared/RightSidebarLayout'
import { useChatStore } from '@/stores/chat-store'
import { useGitStore } from '@/stores/git-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useSessionStatusStore } from '@/stores/session-status-store'
import { useSessionStore } from '@/stores/session-store'
import { CHAT_MIN_WIDTH, DIFF_PANEL_MAX, DIFF_PANEL_MIN } from '@/stores/ui-store'

const DIFF_PANEL_DEFAULT_WIDTH = 600
const DIFF_PANEL_STORAGE_KEY = 'openwaggle:diff-sidebar-width'
const DIFF_PANEL_SHEET_BREAKPOINT_PX = 1180
const OVERFLOW_TOLERANCE_PX = 0.5

const LazyChatDiffPane = lazy(() =>
  import('@/components/chat/ChatDiffPane').then((module) => ({ default: module.ChatDiffPane })),
)

interface ChatRouteSurfaceProps {
  readonly branchId: string | null
  readonly diffOpen: boolean
  readonly nodeId: string | null
  readonly sessionId: string | null
  readonly onDiffOpenChange: (open: boolean) => void
}

function conversationIdFromRoute(sessionId: string): ConversationId {
  return ConversationId(sessionId)
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
  onDiffOpenChange,
}: ChatRouteSurfaceProps) {
  const navigate = useNavigate()
  const sections = useChatPanelSections()
  const routeConversationId = sessionId ? conversationIdFromRoute(sessionId) : null
  const activeConversationId = useChatStore((state) => state.activeConversationId)
  const setActiveConversation = useChatStore((state) => state.setActiveConversation)
  const routeConversationSummary = useChatStore((state) => {
    if (routeConversationId === null) {
      return null
    }

    return (
      state.conversations.find((conversation) => conversation.id === routeConversationId) ?? null
    )
  })
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const setProjectPath = usePreferencesStore((state) => state.setProjectPath)
  const refreshGitStatus = useGitStore((state) => state.refreshStatus)
  const refreshGitBranches = useGitStore((state) => state.refreshBranches)
  const refreshSessionWorkspace = useSessionStore((state) => state.refreshSessionWorkspace)

  useEffect(() => {
    if (routeConversationId === null) {
      if (activeConversationId !== null) {
        void navigate({
          to: '/sessions/$sessionId',
          params: { sessionId: String(activeConversationId) },
          replace: true,
          search: diffOpen ? { diff: 1 } : {},
        })
      }
      return
    }

    if (activeConversationId !== routeConversationId) {
      setActiveConversation(routeConversationId)
    }
    useSessionStatusStore.getState().markVisited(routeConversationId)
  }, [activeConversationId, diffOpen, navigate, routeConversationId, setActiveConversation])

  const routeSessionTreeId = routeConversationId ? SessionId(String(routeConversationId)) : null
  const routeBranchId = branchId ? SessionBranchId(branchId) : null
  const routeNodeId = nodeId ? SessionNodeId(nodeId) : null

  useEffect(() => {
    void refreshSessionWorkspace(routeSessionTreeId, {
      branchId: routeBranchId,
      nodeId: routeNodeId,
    })
  }, [refreshSessionWorkspace, routeBranchId, routeNodeId, routeSessionTreeId])

  const routeProjectPath = routeConversationSummary?.projectPath ?? null
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
    readonly currentWidth: number
    readonly nextWidth: number
    readonly gap: HTMLDivElement
    readonly panel: HTMLDivElement
    readonly root: HTMLDivElement
  }): boolean {
    const previousGapWidth = input.gap.style.width
    const previousPanelWidth = input.panel.style.width
    input.gap.style.setProperty('width', `${String(input.nextWidth)}px`)
    input.panel.style.setProperty('width', `${String(input.nextWidth)}px`)

    const mainWidth = input.root.clientWidth - input.nextWidth
    const composerForm = input.root.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
    const composerFits = composerForm
      ? composerForm.scrollWidth <= composerForm.clientWidth + OVERFLOW_TOLERANCE_PX
      : true
    const accepted = mainWidth >= CHAT_MIN_WIDTH && composerFits

    if (previousGapWidth.length > 0) {
      input.gap.style.setProperty('width', previousGapWidth)
    } else {
      input.gap.style.removeProperty('width')
    }

    if (previousPanelWidth.length > 0) {
      input.panel.style.setProperty('width', previousPanelWidth)
    } else {
      input.panel.style.removeProperty('width')
    }

    return accepted
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PanelErrorBoundary name="Chat" className="flex min-w-0 flex-1 overflow-hidden">
        <RightSidebarLayout
          defaultWidth={DIFF_PANEL_DEFAULT_WIDTH}
          maxWidth={DIFF_PANEL_MAX}
          minWidth={DIFF_PANEL_MIN}
          open={diffOpen}
          sheetBreakpointPx={DIFF_PANEL_SHEET_BREAKPOINT_PX}
          storageKey={DIFF_PANEL_STORAGE_KEY}
          onOpenChange={onDiffOpenChange}
          shouldAcceptWidth={shouldAcceptDiffWidth}
          sidebar={
            <Suspense fallback={<DiffSidebarFallback />}>
              <LazyChatDiffPane section={sections.diff} onClose={() => onDiffOpenChange(false)} />
            </Suspense>
          }
        >
          <ChatPanelContent sections={sections} />
        </RightSidebarLayout>
      </PanelErrorBoundary>
    </div>
  )
}

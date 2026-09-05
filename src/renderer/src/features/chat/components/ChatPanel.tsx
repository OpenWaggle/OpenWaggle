import type { SessionId } from '@shared/types/brand'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  type SessionResourceFilter,
  SessionResourceViewer,
  type SessionSummaryExtensionSidePanelTarget,
  SessionSummaryHub,
  useSessionResourceRunCompletion,
} from '@/features/session-summary'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useChatPanelSections } from '../hooks/use-chat-panel-controller'
import type { ChatPanelSections } from '../model'
import { useAgentLoopEventStore } from '../state/agent-loop-event-store'
import { AgentNotificationStack } from './AgentNotificationStack'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatDisplayPathProvider } from './ChatDisplayPathContext'
import { ChatTranscript } from './ChatTranscript'

const SESSION_SUMMARY_AUTO_OPEN_MIN_WIDTH_PX = 840

interface ChatPanelContentProps {
  readonly sections: ChatPanelSections
  readonly onOpenSessionTree?: () => void
  readonly onOpenDiff?: () => void
  readonly onOpenResources?: (filter?: SessionResourceFilter) => void
  readonly onNavigateSession?: (sessionId: string) => void
  readonly onOpenExtensionSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
  readonly rightSidebarOpen?: boolean
}

function useSessionSummarySpace(rightSidebarOpen: boolean) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [hasSpace, setHasSpace] = useState(true)

  useLayoutEffect(() => {
    if (rightSidebarOpen) return
    const element = panelRef.current
    if (!element) return
    const width = element.clientWidth
    setHasSpace(width === 0 || width >= SESSION_SUMMARY_AUTO_OPEN_MIN_WIDTH_PX)
  }, [rightSidebarOpen])

  useEffect(() => {
    const element = panelRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (rightSidebarOpen) return
      setHasSpace(element.clientWidth >= SESSION_SUMMARY_AUTO_OPEN_MIN_WIDTH_PX)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [rightSidebarOpen])

  return { panelRef, hasSpace }
}

function SessionNotificationStack({
  sessionId,
  events,
}: {
  readonly sessionId: SessionId | null
  readonly events: ChatPanelSections['agentInteractionEvents']
}) {
  const dismissNotification = useAgentLoopEventStore((state) => state.dismissNotification)
  const handleDismiss = useCallback(
    (interactionId: string) => {
      if (sessionId) dismissNotification(sessionId, interactionId)
    },
    [dismissNotification, sessionId],
  )
  return <AgentNotificationStack events={events} onDismiss={handleDismiss} />
}

export function ChatPanelContent({
  sections,
  onOpenSessionTree,
  onOpenDiff = () => {},
  onOpenResources = () => {},
  onNavigateSession = () => {},
  onOpenExtensionSidePanel = () => {},
  rightSidebarOpen = false,
}: ChatPanelContentProps) {
  const activeSessionId = sections.transcript.activeSessionId
    ? String(sections.transcript.activeSessionId)
    : null
  useSessionResourceRunCompletion(activeSessionId)
  const messageCount = Math.max(
    sections.transcript.messages.length,
    sections.transcript.chatRows.length,
  )
  const summaryMessageCount = sections.composer.isFirstMessage ? 0 : messageCount
  const activeMessageIds = new Set(
    sections.transcript.messages.map((message) => message.metadata?.sessionNodeId ?? message.id),
  )
  const summarySpace = useSessionSummarySpace(rightSidebarOpen)
  return (
    <div className="flex size-full overflow-hidden">
      <div
        ref={summarySpace.panelRef}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg"
        data-chat-panel-main="true"
        data-session-summary-space={summarySpace.hasSpace ? 'available' : 'constrained'}
      >
        <ChatDisplayPathProvider
          projectPath={sections.transcript.projectPath}
          worktreePath={sections.transcript.worktreePath}
        >
          <SessionSummaryHub
            key={activeSessionId ?? 'no-session-summary'}
            input={{
              session: sections.composer.session,
              messageCount: summaryMessageCount,
              autoHidden: !summarySpace.hasSpace,
              rightSidebarOpen,
              extensionRegistry: sections.extensionRegistry,
              extensionProjectPaths: sections.extensionProjectPaths,
              onOpenDiff,
              onOpenResources,
              onNavigateSession,
              onOpenExtensionSidePanel,
            }}
          />
          {/* Anchored here rather than inside the composer: the composer area is reserved for
            requests that hold the run, so the surface a user must answer is always the one nearest
            the prompt input, and a notice that can never be answered floats clear of it. */}
          <PanelErrorBoundary name="Notifications">
            <SessionNotificationStack
              events={sections.agentInteractionEvents}
              key={sections.transcript.activeSessionId ?? 'no-session'}
              sessionId={sections.transcript.activeSessionId}
            />
          </PanelErrorBoundary>
          <SessionResourceViewer
            activeSessionId={activeSessionId}
            activeMessageIds={activeMessageIds}
          />

          <PanelErrorBoundary
            name="Chat transcript"
            className="flex flex-1 flex-col overflow-hidden"
          >
            <ChatTranscript section={sections.transcript} />
          </PanelErrorBoundary>

          <PanelErrorBoundary name="Composer">
            <ChatComposerStack
              agentInteractions={sections.agentInteractions}
              extensionProjectPaths={sections.extensionProjectPaths}
              extensionRegistry={sections.extensionRegistry}
              onRespondAgentInteraction={sections.onRespondAgentInteraction}
              section={sections.composer}
              onOpenSessionTree={onOpenSessionTree}
            />
          </PanelErrorBoundary>
        </ChatDisplayPathProvider>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const sections = useChatPanelSections()
  return <ChatPanelContent sections={sections} />
}

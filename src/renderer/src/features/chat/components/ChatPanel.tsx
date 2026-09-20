import type { SessionId } from '@shared/types/brand'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  SessionMessageResourcesProvider,
  type SessionResourceBrowserTarget,
  SessionResourceViewer,
  type SessionSummaryExtensionSidePanelTarget,
  SessionSummaryHub,
  useSessionResourceBackfill,
  useSessionResourceOwnerActivation,
} from '@/features/session-summary'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useSessionFloatingPreviewStatus } from '@/shell'
import { useChatPanelSections } from '../hooks/use-chat-panel-controller'
import { CHAT_CONTENT_MAX_WIDTH_PX } from '../lib/chat-content-layout'
import type { ChatPanelSections } from '../model'
import { useAgentLoopEventStore } from '../state/agent-loop-event-store'
import { AgentNotificationStack } from './AgentNotificationStack'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatDisplayPathProvider } from './ChatDisplayPathContext'
import { ChatTranscript } from './ChatTranscript'

const SESSION_SUMMARY_WIDTH_PX = 300
const SESSION_SUMMARY_RIGHT_INSET_PX = 16
const SESSION_SUMMARY_CONTENT_GAP_PX = 16
const SESSION_SUMMARY_AUTO_OPEN_FALLBACK_WIDTH_PX =
  CHAT_CONTENT_MAX_WIDTH_PX +
  2 * (SESSION_SUMMARY_WIDTH_PX + SESSION_SUMMARY_RIGHT_INSET_PX + SESSION_SUMMARY_CONTENT_GAP_PX)

interface ChatPanelContentProps {
  readonly sections: ChatPanelSections
  readonly onOpenSessionTree?: () => void
  readonly onOpenDiff?: () => void
  readonly onOpenChangeRequest?: (url: string) => void
  readonly onOpenResources?: (target: SessionResourceBrowserTarget) => void
  readonly onNavigateSession?: (sessionId: string) => void
  readonly onOpenExtensionSidePanel?: (target: SessionSummaryExtensionSidePanelTarget) => void
  readonly rightSidebarOpen?: boolean
}

function useSessionSummarySpace(rightSidebarOpen: boolean) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [hasSpace, setHasSpace] = useState(true)

  const measure = useCallback(() => {
    if (rightSidebarOpen) return
    const container = panelRef.current
    if (!container) return
    const width = container.clientWidth
    if (width === 0) {
      setHasSpace(true)
      return
    }

    const contentFrame = container.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
    const containerRect = container.getBoundingClientRect()
    const contentRect = contentFrame?.getBoundingClientRect()
    const hasMeasuredGeometry =
      containerRect.width > 0 && contentRect !== undefined && contentRect.width > 0
    const roomForSummary = hasMeasuredGeometry
      ? containerRect.right - contentRect.right >=
        SESSION_SUMMARY_WIDTH_PX + SESSION_SUMMARY_RIGHT_INSET_PX + SESSION_SUMMARY_CONTENT_GAP_PX
      : width >= SESSION_SUMMARY_AUTO_OPEN_FALLBACK_WIDTH_PX
    setHasSpace(roomForSummary)
  }, [rightSidebarOpen])

  useLayoutEffect(() => {
    measure()
  }, [measure])

  useEffect(() => {
    const element = panelRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const contentFrame = element.querySelector<HTMLElement>('[data-chat-composer-form="true"]')
    if (contentFrame) observer.observe(contentFrame)
    return () => observer.disconnect()
  }, [measure])

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

function transcriptPathNodeIds(section: ChatPanelSections['transcript']) {
  if (section.activePathNodeIds) return section.activePathNodeIds
  return section.messages.map((message) => message.metadata?.sessionNodeId ?? message.id)
}

function summaryNeedsTransientOverlay(hasSpace: boolean, floatingPreviewVisible: boolean) {
  return !hasSpace || floatingPreviewVisible
}

export function ChatPanelContent({
  sections,
  onOpenSessionTree,
  onOpenDiff = () => {},
  onOpenChangeRequest = () => {},
  onOpenResources = () => {},
  onNavigateSession = () => {},
  onOpenExtensionSidePanel = () => {},
  rightSidebarOpen = false,
}: ChatPanelContentProps) {
  const activeSessionId = sections.transcript.activeSessionId
    ? String(sections.transcript.activeSessionId)
    : null
  useSessionResourceOwnerActivation(sections.transcript.activeSessionId)
  const messageCount = Math.max(
    sections.transcript.messages.length,
    sections.transcript.chatRows.length,
  )
  const summaryMessageCount = sections.composer.isFirstMessage ? 0 : messageCount
  const resourceSessionId = summaryMessageCount > 0 ? activeSessionId : null
  useSessionResourceBackfill(resourceSessionId)
  const activeMessageNodeIds = sections.transcript.messages.map(
    (message) => message.metadata?.sessionNodeId ?? message.id,
  )
  const activeMessageIds = new Set(activeMessageNodeIds)
  const activePathNodeIds = transcriptPathNodeIds(sections.transcript)
  const summarySpace = useSessionSummarySpace(rightSidebarOpen)
  const floatingPreviewVisible = useSessionFloatingPreviewStatus(activeSessionId)
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
              activeBranchId: sections.transcript.activeBranchId ?? null,
              activePathNodeIds,
              messageCount: summaryMessageCount,
              autoHidden: summaryNeedsTransientOverlay(
                summarySpace.hasSpace,
                floatingPreviewVisible,
              ),
              rightSidebarOpen,
              extensionRegistry: sections.extensionRegistry,
              extensionProjectPaths: sections.extensionProjectPaths,
              onOpenDiff,
              onOpenChangeRequest,
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
            activeBranchId={sections.transcript.activeBranchId ?? null}
            activeMessageIds={activeMessageIds}
            activePathNodeIds={activePathNodeIds}
          />

          <PanelErrorBoundary
            name="Chat transcript"
            className="flex flex-1 flex-col overflow-hidden"
          >
            <ChatTranscript
              section={sections.transcript}
              renderVisibleMessageRows={(nodeIds, rows) => (
                <SessionMessageResourcesProvider
                  sessionId={sections.transcript.activeSessionId}
                  nodeIds={nodeIds}
                >
                  {rows}
                </SessionMessageResourcesProvider>
              )}
            />
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

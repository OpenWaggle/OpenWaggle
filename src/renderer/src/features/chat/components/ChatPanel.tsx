import type { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import {
  SessionMessageResourcesProvider,
  type SessionResourceBrowserTarget,
  SessionResourceViewer,
  type SessionSummaryExtensionSidePanelTarget,
  SessionSummaryHub,
  useSessionResourceBackfill,
  useSessionResourceOwnerActivation,
} from '@/features/session-summary'
import { useSessionStore } from '@/features/sessions/state'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useSessionFloatingPreviewStatus } from '@/shell'
import { useChatPanelSections } from '../hooks/use-chat-panel-controller'
import { CHAT_CONTENT_MAX_WIDTH_PX } from '../lib/chat-content-layout'
import type { ChatPanelSections } from '../model'
import { useAgentLoopEventStore } from '../state/agent-loop-event-store'
import { AgentNotificationStack } from './AgentNotificationStack'
import { ArchivedSessionNotice } from './ArchivedSessionNotice'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatDisplayPathProvider } from './ChatDisplayPathContext'
import { ChatTranscript } from './ChatTranscript'
import { DeletedPiSessionFileNotice } from './DeletedPiSessionFileNotice'

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

  useEffect(() => {
    const element = panelRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    /*
     * A ResizeObserver reports each observed element once when it starts, after layout, so the
     * first measurement needs no read in a layout effect: that read forced the shell's first layout
     * inside its commit (B12). The update renders before paint, so the summary never flickers.
     */
    const observer = new ResizeObserver(() => flushSync(measure))
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

const NODE_ID_SEPARATOR = '\u0000'

function messageNodeIds(section: ChatPanelSections['transcript']) {
  return section.messages.map((message) => message.metadata?.sessionNodeId ?? message.id)
}

/**
 * Node ids as one string. The message list is a new array whenever any message changes (a tool
 * result, a settled answer), while its ids rarely do; deriving the id lists from this key keeps
 * their identity, so the Session Summary and the resource viewer render only when ids change.
 */
function nodeIdsKey(ids: readonly string[]) {
  return ids.join(NODE_ID_SEPARATOR)
}

/**
 * The id list and set for a key, memoized on the key alone. Inline, they joined the memo scope of
 * the message list and were rebuilt with it.
 */
function useNodeIdsForKey(key: string) {
  // It calls no hook, so the compiler skips it unless asked.
  'use memo'
  const ids: readonly string[] = key === '' ? [] : key.split(NODE_ID_SEPARATOR)
  return { ids, idSet: new Set(ids) }
}

function summaryNeedsTransientOverlay(hasSpace: boolean, floatingPreviewVisible: boolean) {
  return !hasSpace || floatingPreviewVisible
}

function matchesHiveSession(candidate: SessionSummary | null | undefined, sessionId: string) {
  return (
    candidate?.id === sessionId &&
    (candidate.lineage?.role === 'queen' || candidate.lineage?.role === 'worker')
  )
}

/** Whether the active Session belongs to a Hive the session store knows. */
function useHiveAvailable(activeSessionId: string | null) {
  return useSessionStore((state) => {
    if (!activeSessionId) return false
    return [
      state.activeSessionTree?.session,
      ...state.hiveSessions,
      ...state.sessions,
      ...state.archivedSessions,
    ].some((candidate) => matchesHiveSession(candidate, activeSessionId))
  })
}

export function ChatPanelContent({
  sections,
  onOpenSessionTree,
  onOpenDiff = () => {},
  onOpenChangeRequest = () => {},
  onOpenResources = () => {},
  onOpenExtensionSidePanel = () => {},
  rightSidebarOpen = false,
}: ChatPanelContentProps) {
  const activeSessionId = sections.transcript.activeSessionId
    ? String(sections.transcript.activeSessionId)
    : null
  const hiveAvailable = useHiveAvailable(activeSessionId)
  useSessionResourceOwnerActivation(sections.transcript.activeSessionId)
  const messageCount = Math.max(
    sections.transcript.messages.length,
    sections.transcript.chatRows.length,
  )
  const summaryMessageCount = sections.composer.isFirstMessage ? 0 : messageCount
  const resourceSessionId = summaryMessageCount > 0 ? activeSessionId : null
  useSessionResourceBackfill(resourceSessionId)
  const { ids: activeMessageNodeIds, idSet: activeMessageIds } = useNodeIdsForKey(
    nodeIdsKey(messageNodeIds(sections.transcript)),
  )
  const activePathNodeIds = sections.transcript.activePathNodeIds ?? activeMessageNodeIds
  const { panelRef, hasSpace } = useSessionSummarySpace(rightSidebarOpen)
  const floatingPreviewVisible = useSessionFloatingPreviewStatus(activeSessionId)
  return (
    <div className="flex size-full overflow-hidden">
      <div
        ref={panelRef}
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg"
        data-chat-panel-main="true"
        data-session-summary-space={hasSpace ? 'available' : 'constrained'}
      >
        <ChatDisplayPathProvider
          projectPath={sections.transcript.projectPath}
          worktreePath={sections.transcript.worktreePath}
          workingPath={sections.transcript.workingPath}
        >
          <SessionSummaryHub
            key={activeSessionId ?? 'no-session-summary'}
            input={{
              session: sections.composer.session,
              activeBranchId: sections.transcript.activeBranchId ?? null,
              activePathNodeIds,
              messageCount: summaryMessageCount,
              hiveAvailable,
              autoHidden: summaryNeedsTransientOverlay(hasSpace, floatingPreviewVisible),
              rightSidebarOpen,
              extensionRegistry: sections.extensionRegistry,
              extensionProjectPaths: sections.extensionProjectPaths,
              onOpenDiff,
              onOpenChangeRequest,
              onOpenResources,
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

          <ArchivedSessionNotice />
          <DeletedPiSessionFileNotice />
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

import { SessionResourceViewer, SessionSummaryHub } from '@/features/session-summary'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useChatPanelSections } from '../hooks/use-chat-panel-controller'
import type { ChatPanelSections } from '../model'
import { AgentNotificationStack } from './AgentNotificationStack'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatDisplayPathProvider } from './ChatDisplayPathContext'
import { ChatTranscript } from './ChatTranscript'

interface ChatPanelContentProps {
  readonly sections: ChatPanelSections
  readonly onOpenSessionTree?: () => void
  readonly onOpenDiff?: () => void
  readonly onOpenResources?: () => void
  readonly onNavigateSession?: (sessionId: string) => void
  readonly rightSidebarOpen?: boolean
}

export function ChatPanelContent({
  sections,
  onOpenSessionTree,
  onOpenDiff = () => {},
  onOpenResources = () => {},
  onNavigateSession = () => {},
  rightSidebarOpen = false,
}: ChatPanelContentProps) {
  const activeSessionId = sections.transcript.activeSessionId
    ? String(sections.transcript.activeSessionId)
    : null
  const messageCount = Math.max(
    sections.transcript.messages.length,
    sections.transcript.chatRows.length,
  )
  const activeMessageIds = new Set(sections.transcript.messages.map((message) => message.id))
  const sessionSummaryVisible = activeSessionId !== null && messageCount > 0 && !rightSidebarOpen
  return (
    <div className="flex size-full overflow-hidden">
      <div
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-bg"
        data-chat-panel-main="true"
      >
        <ChatDisplayPathProvider
          projectPath={sections.transcript.projectPath}
          worktreePath={sections.transcript.worktreePath}
        >
          <SessionSummaryHub
            key={activeSessionId ?? 'no-session-summary'}
            input={{
              session: sections.composer.session,
              messageCount,
              hidden: rightSidebarOpen,
              extensionRegistry: sections.extensionRegistry,
              extensionProjectPaths: sections.extensionProjectPaths,
              onOpenDiff,
              onOpenResources,
              onNavigateSession,
            }}
          />
          {/* Anchored here rather than inside the composer: the composer area is reserved for
            requests that hold the run, so the surface a user must answer is always the one nearest
            the prompt input, and a notice that can never be answered floats clear of it. */}
          <PanelErrorBoundary name="Notifications">
            <AgentNotificationStack
              events={sections.agentInteractionEvents}
              key={sections.transcript.activeSessionId ?? 'no-session'}
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
            <ChatTranscript
              section={sections.transcript}
              reserveSessionSummarySpace={sessionSummaryVisible}
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

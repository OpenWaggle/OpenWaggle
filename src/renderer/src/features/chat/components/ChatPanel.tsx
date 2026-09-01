import type { SessionId } from '@shared/types/brand'
import { useCallback } from 'react'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useChatPanelSections } from '../hooks/use-chat-panel-controller'
import type { ChatPanelSections } from '../model'
import { useAgentLoopEventStore } from '../state/agent-loop-event-store'
import { AgentNotificationStack } from './AgentNotificationStack'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatDisplayPathProvider } from './ChatDisplayPathContext'
import { ChatTranscript } from './ChatTranscript'

interface ChatPanelContentProps {
  readonly sections: ChatPanelSections
  readonly onOpenSessionTree?: () => void
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

export function ChatPanelContent({ sections, onOpenSessionTree }: ChatPanelContentProps) {
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

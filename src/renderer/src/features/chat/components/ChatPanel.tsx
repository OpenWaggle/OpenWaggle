import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useChatPanelSections } from '../hooks/use-chat-panel-controller'
import type { ChatPanelSections } from '../model'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatTranscript } from './ChatTranscript'

interface ChatPanelContentProps {
  readonly sections: ChatPanelSections
  readonly onOpenSessionTree?: () => void
}

export function ChatPanelContent({ sections, onOpenSessionTree }: ChatPanelContentProps) {
  return (
    <div className="flex size-full overflow-hidden">
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg"
        data-chat-panel-main="true"
      >
        <PanelErrorBoundary name="Chat transcript" className="flex flex-1 flex-col overflow-hidden">
          <ChatTranscript section={sections.transcript} />
        </PanelErrorBoundary>

        <PanelErrorBoundary name="Composer">
          <ChatComposerStack section={sections.composer} onOpenSessionTree={onOpenSessionTree} />
        </PanelErrorBoundary>
      </div>
    </div>
  )
}

export function ChatPanel() {
  const sections = useChatPanelSections()
  return <ChatPanelContent sections={sections} />
}

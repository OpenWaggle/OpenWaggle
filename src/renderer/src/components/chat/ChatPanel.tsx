import { useUIStore } from '@/stores/ui-store'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatDiffPane } from './ChatDiffPane'
import { ChatTranscript } from './ChatTranscript'
import { useChatPanelSections } from './use-chat-panel-controller'

export function ChatPanel(): React.JSX.Element {
  const diffPanelOpen = useUIStore((s) => s.diffPanelOpen)

  const sections = useChatPanelSections()

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
        <ChatTranscript section={sections.transcript} />

        <ChatComposerStack section={sections.composer} />
      </div>

      {diffPanelOpen && <ChatDiffPane section={sections.diff} />}
    </div>
  )
}

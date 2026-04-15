import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { useUIStore } from '@/stores/ui-store'
import { ChatComposerStack } from './ChatComposerStack'
import { ChatDiffPane } from './ChatDiffPane'
import { ChatTranscript } from './ChatTranscript'
import { ContextInspectorPane } from './ContextInspectorPane'
import { useChatPanelSections } from './use-chat-panel-controller'

export function ChatPanel() {
  const activeInspector = useUIStore((s) => s.activeInspector)

  const sections = useChatPanelSections()

  return (
    <div className="flex h-full w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg">
        <PanelErrorBoundary name="Chat transcript" className="flex flex-1 flex-col overflow-hidden">
          <ChatTranscript section={sections.transcript} />
        </PanelErrorBoundary>

        <PanelErrorBoundary name="Composer">
          <ChatComposerStack section={sections.composer} />
        </PanelErrorBoundary>
      </div>

      {activeInspector === 'diff' && <ChatDiffPane section={sections.diff} />}
      {activeInspector === 'context' && <ContextInspectorPane />}
    </div>
  )
}

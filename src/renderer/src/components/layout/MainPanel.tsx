import type { SupportedModelId } from '@shared/types/llm'
import { ChatPanel } from '@/components/chat/ChatPanel'

interface MainPanelProps {
  model: SupportedModelId
  projectPath: string | null
  hasProject: boolean
}

export function MainPanel(props: MainPanelProps): React.JSX.Element {
  return (
    <main className="flex-1 overflow-hidden">
      <ChatPanel {...props} />
    </main>
  )
}

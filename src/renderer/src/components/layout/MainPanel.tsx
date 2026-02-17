import type { AgentStatus, Message, MessagePart } from '@shared/types/agent'
import { ChatPanel } from '@/components/chat/ChatPanel'

interface MainPanelProps {
  messages: readonly Message[]
  status: AgentStatus
  streamingText: string
  streamingParts: readonly MessagePart[]
  onSend: (content: string) => void
  onCancel: () => void
  hasProject: boolean
}

export function MainPanel(props: MainPanelProps): React.JSX.Element {
  return (
    <main className="flex-1 overflow-hidden">
      <ChatPanel {...props} />
    </main>
  )
}

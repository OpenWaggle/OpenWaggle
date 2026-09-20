import { AgentDefinitionsPanel } from '@/features/agent-definitions/components'
import { MultiAgentAccessCard } from './MultiAgentAccessCard'

export function AgentsSettingsSection() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-5 py-4">
        <MultiAgentAccessCard />
      </div>
      <div className="min-h-0 flex-1 border-t border-border">
        <AgentDefinitionsPanel />
      </div>
    </div>
  )
}

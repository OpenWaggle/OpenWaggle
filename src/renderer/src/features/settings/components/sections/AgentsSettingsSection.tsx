import { AgentDefinitionsPanel } from '@/features/agent-definitions/components'
import { SettingsSectionContainer } from '../SettingsSectionContainer'
import { MultiAgentAccessCard } from './MultiAgentAccessCard'

export function AgentsSettingsSection() {
  return (
    <SettingsSectionContainer layout="fill">
      <div className="shrink-0 px-5 py-4">
        <MultiAgentAccessCard />
      </div>
      <div className="min-h-0 flex-1 border-t border-border">
        <AgentDefinitionsPanel />
      </div>
    </SettingsSectionContainer>
  )
}

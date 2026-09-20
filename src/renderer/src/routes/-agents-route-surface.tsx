import { AgentDefinitionsPanel } from '@/features/agent-definitions/components'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'

export function AgentsRouteSurface() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <PanelErrorBoundary name="Agents" className="flex min-w-0 flex-1 overflow-hidden">
        <AgentDefinitionsPanel />
      </PanelErrorBoundary>
    </div>
  )
}

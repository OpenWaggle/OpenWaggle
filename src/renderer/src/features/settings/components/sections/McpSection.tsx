import { useMcpSectionController } from '@/features/settings/hooks/useMcpSectionController'
import { usePreferences } from '@/features/settings/hooks/useSettings'
import {
  McpAdapterCard,
  McpErrorAlert,
  McpSectionHeading,
  McpServersPanel,
  McpSourcesPanel,
} from './McpSectionPanels'
import { McpSourceEditor } from './McpSourceEditor'

export function McpSection() {
  const { settings } = usePreferences()
  const controller = useMcpSectionController(settings.projectPath)
  const sources = controller.view?.sources ?? []
  const servers = controller.view?.servers ?? []

  return (
    <div className="space-y-6">
      <McpSectionHeading />
      <McpErrorAlert message={controller.error} />
      <McpErrorAlert message={controller.view?.adapter.lastError} />
      <McpAdapterCard
        view={controller.view}
        busy={controller.busy}
        onRefresh={() => void controller.refresh()}
        onToggle={() => void controller.toggleAdapter()}
      />
      <McpSourcesPanel
        sources={sources}
        selectedSource={controller.selectedSource}
        onSelectSource={controller.selectSource}
      />
      <McpServersPanel
        servers={servers}
        busy={controller.busy}
        onToggleServer={(server) => void controller.toggleServer(server)}
      />
      <McpSourceEditor
        selectedSource={controller.selectedSource}
        rawJson={controller.rawJson}
        busy={controller.busy}
        onSave={() => void controller.saveSelectedSource()}
        onRawJsonChange={controller.updateRawJson}
      />
    </div>
  )
}

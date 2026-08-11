import { useMcpSectionController } from '@/features/settings/hooks/useMcpSectionController'
import { usePreferences } from '@/features/settings/hooks/useSettings'
import { McpCapabilitiesPanel } from './McpCapabilitiesPanel'
import { McpMigrationPanel } from './McpMigrationPanel'
import {
  McpDoctorPanel,
  McpErrorAlert,
  McpNoticesPanel,
  McpScopeRail,
  McpSecretVault,
  McpSectionHeading,
  McpServersPanel,
  McpSourcesPanel,
} from './McpSectionPanels'
import { McpSourceEditor } from './McpSourceEditor'

interface McpSectionProps {
  readonly sessionId: string | null
}

export function McpSection({ sessionId }: McpSectionProps) {
  const { settings } = usePreferences()
  const controller = useMcpSectionController(settings.projectPath, sessionId)
  const sources = controller.view?.sources ?? []
  const servers = controller.view?.servers ?? []

  return (
    <div className="space-y-6">
      <McpSectionHeading
        view={controller.view}
        busy={controller.busy}
        onRefresh={() => void controller.refresh()}
      />
      <McpErrorAlert message={controller.error} />
      <McpScopeRail
        view={controller.view}
        busy={controller.busy}
        onChange={(scope, state) => void controller.setScopeState(scope, state)}
      />
      <McpNoticesPanel notices={controller.view?.notices ?? []} />
      <McpMigrationPanel
        projectPath={settings.projectPath}
        settingsBusy={controller.busy}
        onImported={controller.refresh}
      />
      <McpServersPanel
        servers={servers}
        busy={controller.busy}
        onToggleServer={(server) => void controller.toggleServer(server)}
        onTrustServer={(server, trusted, allowUnsandboxed, permissions) =>
          void controller.setServerTrust(server, trusted, allowUnsandboxed, permissions)
        }
        onRemoveServer={(server) => void controller.removeServer(server)}
        onAuthorizeServer={(server) => void controller.authorizeServer(server)}
        onLogoutServer={(server) => void controller.logoutServer(server)}
      />
      <McpCapabilitiesPanel
        projectPath={settings.projectPath}
        sessionId={sessionId}
        enabled={controller.view?.integration.desired.effective === 'on'}
        servers={servers}
      />
      <McpSourcesPanel
        sources={sources}
        selectedSource={controller.selectedSource}
        onSelectSource={controller.selectSource}
      />
      <McpSourceEditor
        selectedSource={controller.selectedSource}
        rawJson={controller.rawJson}
        busy={controller.busy}
        onSave={() => void controller.saveSelectedSource()}
        onRawJsonChange={controller.updateRawJson}
      />
      <McpSecretVault
        secrets={controller.secrets}
        busy={controller.busy}
        onSave={controller.saveSecret}
        onRemove={(name) => void controller.removeSecret(name)}
      />
      <McpDoctorPanel doctor={controller.doctor} />
    </div>
  )
}

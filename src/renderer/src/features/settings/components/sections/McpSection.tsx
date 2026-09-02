import { useMcpSectionController } from '@/features/settings/hooks/useMcpSectionController'
import { usePreferences } from '@/features/settings/hooks/useSettings'
import { projectName } from '@/shared/lib/format'
import { McpCapabilitiesPanel } from './McpCapabilitiesPanel'
import { McpMigrationPanel } from './McpMigrationPanel'
import { McpProjectControl } from './McpProjectControl'
import {
  McpDoctorPanel,
  McpErrorAlert,
  McpNoticesPanel,
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
  const projectLabel = (projectPath: string) =>
    settings.projectDisplayNames[projectPath]?.trim() || projectName(projectPath)

  return (
    <div className="space-y-6">
      <McpSectionHeading
        view={controller.view}
        busy={controller.busy}
        onRefresh={() => void controller.refresh()}
      />
      <McpErrorAlert message={controller.error} />
      <McpProjectControl
        view={controller.view}
        busy={controller.busy}
        recentProjects={settings.recentProjects}
        projectLabel={projectLabel}
        onSetGlobal={(on) => void controller.setScopeState('global', on ? 'on' : 'off')}
        onChanged={() => void controller.refresh()}
      />
      <McpNoticesPanel
        notices={controller.view?.notices ?? []}
        projectPath={settings.projectPath}
      />
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
        projectPath={settings.projectPath}
        onSelectSource={controller.selectSource}
      />
      <McpSourceEditor
        selectedSource={controller.selectedSource}
        projectPath={settings.projectPath}
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

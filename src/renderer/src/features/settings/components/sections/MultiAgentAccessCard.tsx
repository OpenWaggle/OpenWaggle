import type { Settings } from '@shared/types/settings'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { NumberStepper } from '@/shared/ui/NumberStepper'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const logger = createRendererLogger('settings')

function SettingRow({
  label,
  description,
  last = false,
  children,
}: {
  readonly label: string
  readonly description: string
  readonly last?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <div
      className={`flex min-h-14 items-center justify-between gap-4 px-5 py-3${last ? '' : ' border-b border-border'}`}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-xs font-medium text-text-primary">{label}</span>
        <span className="text-xs text-text-tertiary">{description}</span>
      </div>
      {children}
    </div>
  )
}

function SavedProjectOverrides({
  settings,
  saving,
  onClearMultiAgent,
  onClearParentLimit,
}: {
  readonly settings: Settings
  readonly saving: boolean
  readonly onClearMultiAgent: (projectPath: string) => void
  readonly onClearParentLimit: (projectPath: string) => void
}) {
  const projects = [
    ...new Set([
      ...Object.keys(settings.multiAgentEnabledByProject),
      ...Object.keys(settings.sessionHostParentConcurrencyLimitsByProject),
    ]),
  ].sort()
  if (projects.length === 0) return null

  return (
    <details className="rounded-lg border border-border bg-bg text-xs">
      <summary className="cursor-pointer px-4 py-3 font-medium text-text-primary">
        Saved project overrides ({projects.length})
      </summary>
      <div className="max-h-48 overflow-y-auto">
        <p className="px-4 pb-2 text-text-tertiary">
          These saved preferences override the global Hive controls, but project configuration files
          take precedence over both. Clearing a saved value does not remove a project-file override.
        </p>
        {projects.map((projectPath) => (
          <div key={projectPath} className="border-t border-border px-4 py-3">
            <p className="mb-2 break-all font-mono text-text-primary">{projectPath}</p>
            {Object.hasOwn(settings.multiAgentEnabledByProject, projectPath) ? (
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-text-tertiary">
                  Saved Worker creation:{' '}
                  {settings.multiAgentEnabledByProject[projectPath] ? 'On' : 'Off'}
                </span>
                <Button
                  aria-label={`Clear saved Worker permission for ${projectPath}`}
                  disabled={saving}
                  size="xs"
                  variant="secondary"
                  onClick={() => onClearMultiAgent(projectPath)}
                >
                  Clear saved value
                </Button>
              </div>
            ) : null}
            {Object.hasOwn(settings.sessionHostParentConcurrencyLimitsByProject, projectPath) ? (
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-text-tertiary">
                  Saved Workers per parent:{' '}
                  {settings.sessionHostParentConcurrencyLimitsByProject[projectPath]}
                </span>
                <Button
                  aria-label={`Clear saved Worker limit for ${projectPath}`}
                  disabled={saving}
                  size="xs"
                  variant="secondary"
                  onClick={() => onClearParentLimit(projectPath)}
                >
                  Clear saved value
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </details>
  )
}

export function MultiAgentAccessCard() {
  const settings = usePreferencesStore((state) => state.settings)
  const setMultiAgentEnabled = usePreferencesStore((state) => state.setMultiAgentEnabled)
  const setParentLimit = usePreferencesStore((state) => state.setSessionHostParentConcurrencyLimit)
  const setHostCeiling = usePreferencesStore((state) => state.setSessionHostRunCeiling)
  const setProjectMultiAgent = usePreferencesStore((state) => state.setProjectMultiAgentEnabled)
  const setProjectParentLimit = usePreferencesStore(
    (state) => state.setProjectParentConcurrencyLimit,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function persist(action: () => Promise<void>) {
    setSaving(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      logger.warn('Failed to update multi-agent Session settings', { error: String(cause) })
      setError('Could not save the multi-agent settings. The previous values still apply.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-2" aria-label="Hive controls">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-primary">Hive controls</h2>
        <p className="text-xs text-text-tertiary">
          Control agent-created Workers and concurrent runs. Saved Sessions are not limited.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <SettingRow
          label="Agent-created Workers"
          description="Let agents launch Worker Sessions in this app."
        >
          <ToggleSwitch
            checked={settings.multiAgentEnabled}
            disabled={saving}
            label="Allow agents to create Workers"
            onCheckedChange={(enabled) => {
              void persist(() => setMultiAgentEnabled(enabled))
            }}
          />
        </SettingRow>
        <SettingRow
          label="Workers per parent"
          description="Maximum direct Worker runs active under one parent at a time."
        >
          <NumberStepper
            label="Workers per parent"
            value={settings.sessionHostParentConcurrencyLimit}
            minimum={1}
            disabled={saving}
            onValueChange={(limit) => void persist(() => setParentLimit(limit))}
          />
        </SettingRow>
        <SettingRow
          label="Active agent runs"
          description="App-wide ceiling across independent Sessions and every Hive."
          last
        >
          <NumberStepper
            label="Active agent runs"
            value={settings.sessionHostRunCeiling}
            minimum={1}
            disabled={saving}
            onValueChange={(limit) => void persist(() => setHostCeiling(limit))}
          />
        </SettingRow>
      </div>
      <p className="text-xs text-text-tertiary">
        New runs are rejected with a retryable error at either limit; they are not queued. Higher
        values may strain your machine or model provider. Project configuration files can override
        these app-wide defaults.
      </p>
      <SavedProjectOverrides
        settings={settings}
        saving={saving}
        onClearMultiAgent={(projectPath) =>
          void persist(() => setProjectMultiAgent(projectPath, null))
        }
        onClearParentLimit={(projectPath) =>
          void persist(() => setProjectParentLimit(projectPath, null))
        }
      />
      {error ? (
        <p className="text-xs text-error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

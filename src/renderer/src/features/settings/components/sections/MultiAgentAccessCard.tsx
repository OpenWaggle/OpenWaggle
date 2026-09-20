import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
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

export function MultiAgentAccessCard() {
  const settings = usePreferencesStore((state) => state.settings)
  const setMultiAgentEnabled = usePreferencesStore((state) => state.setMultiAgentEnabled)
  const setParentLimit = usePreferencesStore((state) => state.setSessionHostParentConcurrencyLimit)
  const setHostCeiling = usePreferencesStore((state) => state.setSessionHostRunCeiling)
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
        values may strain your machine or model provider.
      </p>
      {error ? (
        <p className="text-xs text-error-text" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}

import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { createRendererLogger } from '@/shared/lib/logger'
import { TextInput } from '@/shared/ui/TextInput'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const logger = createRendererLogger('settings')

interface SettingRowProps {
  readonly label: string
  readonly description: string
  readonly last?: boolean
  readonly children: React.ReactNode
}

function SettingRow({ label, description, last = false, children }: SettingRowProps) {
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

function IntegerField({
  label,
  value,
  minimum = 1,
  disabled,
  onCommit,
}: {
  readonly label: string
  readonly value: number
  readonly minimum?: number
  readonly disabled: boolean
  readonly onCommit: (value: number) => Promise<void>
}) {
  return (
    <TextInput
      key={value}
      aria-label={label}
      className="w-20 text-right font-mono tabular-nums"
      defaultValue={value}
      disabled={disabled}
      inputMode="numeric"
      min={minimum}
      step={1}
      type="number"
      onBlur={(event) => {
        const input = event.currentTarget
        const next = Number(input.value)
        if (!Number.isSafeInteger(next) || next < minimum) {
          input.value = String(value)
          return
        }
        if (next === value) return
        void onCommit(next).catch(() => {
          input.value = String(value)
        })
      }}
    />
  )
}

export function MultiAgentAccessCard() {
  const settings = usePreferencesStore((state) => state.settings)
  const setMultiAgentEnabled = usePreferencesStore((state) => state.setMultiAgentEnabled)
  const setParentLimit = usePreferencesStore((state) => state.setSessionHostParentConcurrencyLimit)
  const setHostCeiling = usePreferencesStore((state) => state.setSessionHostRunCeiling)
  const setIdleGrace = usePreferencesStore((state) => state.setSessionHostIdleGracePeriodMs)
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
      throw cause
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-medium text-text-primary">Multi-agent sessions</span>
        <span className="text-xs text-text-tertiary">
          Controls agent-created Hives and concurrent agent runs. It does not limit saved Sessions.
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <SettingRow
          label="Agent-created Workers"
          description="Expose launch and spawn to OpenWaggle-hosted agents."
        >
          <ToggleSwitch
            checked={settings.multiAgentEnabled}
            disabled={saving}
            label="Allow agents to create Workers"
            onCheckedChange={(enabled) => {
              void persist(() => setMultiAgentEnabled(enabled)).catch(() => undefined)
            }}
          />
        </SettingRow>
        <SettingRow
          label="Workers per parent"
          description="Maximum direct Worker runs active under one parent at a time."
        >
          <IntegerField
            disabled={saving}
            label="Workers per parent"
            value={settings.sessionHostParentConcurrencyLimit}
            onCommit={(limit) => persist(() => setParentLimit(limit))}
          />
        </SettingRow>
        <SettingRow
          label="Active agent runs"
          description="App-wide safety ceiling across independent Sessions and every Hive."
        >
          <IntegerField
            disabled={saving}
            label="Active agent runs"
            value={settings.sessionHostRunCeiling}
            onCommit={(limit) => persist(() => setHostCeiling(limit))}
          />
        </SettingRow>
        <SettingRow
          label="Host idle grace (ms)"
          description="How long the local Session Host stays available after its last client or run."
          last={!settings.projectPath}
        >
          <IntegerField
            disabled={saving}
            label="Host idle grace in milliseconds"
            minimum={0}
            value={settings.sessionHostIdleGracePeriodMs}
            onCommit={(milliseconds) => persist(() => setIdleGrace(milliseconds))}
          />
        </SettingRow>
        {settings.projectPath ? (
          <>
            <SettingRow
              label="Current project agents"
              description="Override agent-created Workers for the selected project."
            >
              <div className="flex items-center gap-2">
                {settings.multiAgentEnabledByProject[settings.projectPath] !== undefined ? (
                  <button
                    className="text-xs text-text-tertiary hover:text-text-primary"
                    disabled={saving}
                    type="button"
                    onClick={() => {
                      void persist(() =>
                        setProjectMultiAgent(settings.projectPath ?? '', null),
                      ).catch(() => undefined)
                    }}
                  >
                    Use global
                  </button>
                ) : null}
                <ToggleSwitch
                  checked={
                    settings.multiAgentEnabledByProject[settings.projectPath] ??
                    settings.multiAgentEnabled
                  }
                  disabled={saving}
                  label="Allow agents in the current project to create Workers"
                  onCheckedChange={(enabled) => {
                    void persist(() =>
                      setProjectMultiAgent(settings.projectPath ?? '', enabled),
                    ).catch(() => undefined)
                  }}
                />
              </div>
            </SettingRow>
            <SettingRow
              label="Current project Workers"
              description="Override direct concurrent Worker runs for the selected project."
              last
            >
              <div className="flex items-center gap-2">
                {settings.sessionHostParentConcurrencyLimitsByProject[settings.projectPath] !==
                undefined ? (
                  <button
                    className="text-xs text-text-tertiary hover:text-text-primary"
                    disabled={saving}
                    type="button"
                    onClick={() => {
                      void persist(() =>
                        setProjectParentLimit(settings.projectPath ?? '', null),
                      ).catch(() => undefined)
                    }}
                  >
                    Use global
                  </button>
                ) : null}
                <IntegerField
                  disabled={saving}
                  label="Current project Workers per parent"
                  value={
                    settings.sessionHostParentConcurrencyLimitsByProject[settings.projectPath] ??
                    settings.sessionHostParentConcurrencyLimit
                  }
                  onCommit={(limit) =>
                    persist(() => setProjectParentLimit(settings.projectPath ?? '', limit))
                  }
                />
              </div>
            </SettingRow>
          </>
        ) : null}
      </div>
      {error ? (
        <p className="text-xs text-error-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

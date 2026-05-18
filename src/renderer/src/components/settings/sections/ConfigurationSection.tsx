import {
  MCP_DEFAULT_MODES,
  MCP_PROJECT_MODES,
  type McpDefaultMode,
  type McpProjectMode,
} from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { Boxes, PlugZap } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { usePreferencesStore } from '@/stores/preferences-store'

function formatMode(mode: McpDefaultMode | McpProjectMode): string {
  if (mode === 'inherit') {
    return 'Inherit global default'
  }
  return mode === 'enabled' ? 'Enabled' : 'Disabled'
}

function resolveEffectiveMode(
  globalDefault: McpDefaultMode,
  projectOverride: McpProjectMode,
): McpDefaultMode {
  return projectOverride === 'inherit' ? globalDefault : projectOverride
}

function parseMcpDefaultMode(value: string): McpDefaultMode | null {
  return includes(MCP_DEFAULT_MODES, value) ? value : null
}

function parseMcpProjectMode(value: string): McpProjectMode | null {
  return includes(MCP_PROJECT_MODES, value) ? value : null
}

export function ConfigurationSection() {
  const mcpDefault = usePreferencesStore((state) => state.settings.mcpDefault)
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const projectMcpEnabled = usePreferencesStore((state) => state.projectMcpSettings.enabled)
  const setMcpDefault = usePreferencesStore((state) => state.setMcpDefault)
  const setProjectMcpEnabled = usePreferencesStore((state) => state.setProjectMcpEnabled)
  const [error, setError] = useState<string | null>(null)
  const effectiveMode = resolveEffectiveMode(mcpDefault, projectMcpEnabled)

  async function updateGlobalDefault(mode: McpDefaultMode): Promise<void> {
    setError(null)
    try {
      await setMcpDefault(mode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update MCP default')
    }
  }

  async function updateProjectOverride(mode: McpProjectMode): Promise<void> {
    setError(null)
    try {
      await setProjectMcpEnabled(mode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project MCP setting')
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-[20px] font-semibold text-text-primary">Configuration</h2>
        <p className="text-[13px] text-text-tertiary">
          Control OpenWaggle-owned runtime capabilities that are loaded into future Pi sessions.
        </p>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-[#111418]">
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#28313d] bg-[#151b24] text-[#8fb7ff]">
            <PlugZap className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-semibold text-text-primary">MCP Extension</h3>
              <span
                className={cn(
                  'rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                  effectiveMode === 'enabled'
                    ? 'border-[#284a35] bg-[#142118] text-[#73c989]'
                    : 'border-[#4a3028] bg-[#211814] text-[#e09a75]',
                )}
              >
                {formatMode(effectiveMode)}
              </span>
            </div>
            <p className="max-w-[760px] text-[12px] leading-5 text-text-tertiary">
              OpenWaggle ships the MCP adapter as a core dependency. Disabling it prevents the MCP
              extension from loading into new Pi sessions; active sessions are not restarted.
            </p>
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div className="space-y-0.5">
            <span className="text-[13px] font-medium text-text-primary">Global default</span>
            <p className="text-[12px] text-text-tertiary">
              Used by every project unless the project override is set below.
            </p>
          </div>
          <select
            value={mcpDefault}
            onChange={(event) => {
              const mode = parseMcpDefaultMode(event.currentTarget.value)
              if (mode) {
                void updateGlobalDefault(mode)
              }
            }}
            className="h-8 rounded-md border border-input-card-border bg-[#161b22] px-2 text-[12px] font-medium text-text-secondary outline-none focus:border-border-light"
          >
            {MCP_DEFAULT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {formatMode(mode)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="space-y-0.5">
            <span className="text-[13px] font-medium text-text-primary">Project override</span>
            <p className="text-[12px] text-text-tertiary">
              {projectPath
                ? 'Stored in .openwaggle/settings.json for the selected project.'
                : 'Select a project to store a project-specific override.'}
            </p>
          </div>
          <select
            value={projectMcpEnabled}
            disabled={!projectPath}
            onChange={(event) => {
              const mode = parseMcpProjectMode(event.currentTarget.value)
              if (mode) {
                void updateProjectOverride(mode)
              }
            }}
            className="h-8 rounded-md border border-input-card-border bg-[#161b22] px-2 text-[12px] font-medium text-text-secondary outline-none focus:border-border-light disabled:cursor-not-allowed disabled:opacity-50"
          >
            {MCP_PROJECT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {formatMode(mode)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-[#252b34] bg-[#0f1318] px-4 py-3 text-[12px] leading-5 text-text-tertiary">
        <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
        <p>
          MCP server definitions remain Pi-adapter native. This setting only decides whether
          OpenWaggle loads the core MCP extension for newly created runtime sessions.
        </p>
      </div>

      {error ? <p className="text-[12px] text-[#ef4444]">{error}</p> : null}
    </div>
  )
}

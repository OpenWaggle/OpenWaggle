import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import { useEffect, useState } from 'react'
import {
  invalidateProjectAuthorizationDefault,
  usePreferencesStore,
} from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Select } from '@/shared/ui/Select'
import { AuthorizationGrantsCard } from './AuthorizationGrantsCard'

const logger = createRendererLogger('settings')

/** Sentinel for the select option that clears a project override. */
const INHERIT_VALUE = 'inherit'

function useProjectAuthorizationDefault(projectPath: string | null) {
  const [mode, setMode] = useState<AgentAuthorizationMode | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectPath || typeof api.getProjectPreferences !== 'function') {
      setMode(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    api
      .getProjectPreferences(projectPath)
      .then((preferences) => {
        if (cancelled) return
        setMode(preferences?.authorizationMode ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        logger.warn('Failed to load project authorization preferences', { error: String(err) })
        setMode(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  return { loading, mode, setMode }
}

function ModeOptions() {
  return (
    <>
      {AGENT_AUTHORIZATION_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {AGENT_AUTHORIZATION_MODE_LABELS[mode]}
        </option>
      ))}
    </>
  )
}

export function AgentAccessSection() {
  const settings = usePreferencesStore((s) => s.settings)
  const setDefaultAuthorizationMode = usePreferencesStore((s) => s.setDefaultAuthorizationMode)
  const projectAuthorization = useProjectAuthorizationDefault(settings.projectPath)
  const [savingGlobal, setSavingGlobal] = useState(false)
  const [savingProject, setSavingProject] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)

  function handleGlobalChange(mode: AgentAuthorizationMode) {
    if (mode === settings.defaultAuthorizationMode || savingGlobal) return

    setModeError(null)
    setSavingGlobal(true)
    setDefaultAuthorizationMode(mode)
      .catch((err: unknown) => {
        logger.warn('Failed to update global authorization mode', { error: String(err) })
        setModeError('Could not change the default access mode. The previous mode still applies.')
      })
      .finally(() => {
        setSavingGlobal(false)
      })
  }

  /** `null` clears the override, so the project inherits the global default again. */
  function handleProjectChange(mode: AgentAuthorizationMode | null) {
    if (!settings.projectPath || mode === projectAuthorization.mode || savingProject) return

    setModeError(null)
    setSavingProject(true)
    api
      .setProjectPreferences(settings.projectPath, { authorizationMode: mode })
      .then(() => {
        projectAuthorization.setMode(mode)
        // The composer names the mode in force for inheriting sessions, so it has to be told the
        // project default moved or it keeps naming the old one while runs use the new one.
        invalidateProjectAuthorizationDefault(settings.projectPath)
      })
      .catch((err: unknown) => {
        logger.warn('Failed to update project authorization mode', { error: String(err) })
        setModeError(
          'Could not change this project’s access mode. The previous mode still applies.',
        )
      })
      .finally(() => {
        setSavingProject(false)
      })
  }

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-text-primary">Agent access</h3>

      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-text-primary">Default access mode</span>
            <span className="text-xs text-text-tertiary">
              Used by any session and any project that has not set its own.
            </span>
          </div>
          <Select
            aria-label="Default access mode"
            disabled={savingGlobal}
            onChange={(event) => {
              if (isAgentAuthorizationMode(event.currentTarget.value)) {
                handleGlobalChange(event.currentTarget.value)
              }
            }}
            value={settings.defaultAuthorizationMode}
          >
            <ModeOptions />
          </Select>
        </div>

        <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-text-primary">Current project</span>
            <span className="text-xs text-text-tertiary">
              {settings.projectPath
                ? projectAuthorization.mode
                  ? 'This project overrides the default above.'
                  : 'This project uses the default above.'
                : 'Open a project to give it its own access mode.'}
            </span>
          </div>
          <Select
            aria-label="Current project access mode"
            disabled={!settings.projectPath || projectAuthorization.loading || savingProject}
            onChange={(event) => {
              const raw = event.currentTarget.value
              if (raw === INHERIT_VALUE) {
                handleProjectChange(null)
                return
              }
              if (isAgentAuthorizationMode(raw)) {
                handleProjectChange(raw)
              }
            }}
            value={projectAuthorization.mode ?? INHERIT_VALUE}
          >
            <option value={INHERIT_VALUE}>Use default</option>
            <ModeOptions />
          </Select>
        </div>
      </div>

      {modeError ? (
        <p className="text-xs text-error-text" role="alert">
          {modeError}
        </p>
      ) : null}

      <AuthorizationGrantsCard projectPath={settings.projectPath} />
    </div>
  )
}

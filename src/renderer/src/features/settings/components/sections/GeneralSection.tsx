import { matchBy } from '@diegogbrisa/ts-match'
import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { UpdateStatus } from '@shared/types/updater'
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

const logger = createRendererLogger('settings')

function useAppVersion() {
  const [version, setVersion] = useState('…')
  useEffect(() => {
    if (typeof api.getAppVersion !== 'function') return
    api
      .getAppVersion()
      .then(setVersion)
      .catch((err: unknown) => {
        logger.warn('Failed to load app version', { error: String(err) })
      })
  }, [])
  return version
}

function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>({ type: 'idle' })

  useEffect(() => {
    if (typeof api.getUpdateStatus !== 'function') return
    api
      .getUpdateStatus()
      .then(setStatus)
      .catch((err: unknown) => {
        logger.warn('Failed to load update status', { error: String(err) })
      })
  }, [])

  useEffect(() => {
    if (typeof api.onUpdateStatus !== 'function') return
    return api.onUpdateStatus(setStatus)
  }, [])

  return status
}

function useProjectAuthorizationDefault(projectPath: string | null) {
  const [mode, setMode] = useState<AgentAuthorizationMode | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!projectPath) {
      setMode(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    api
      .getProjectPreferences(projectPath)
      .then((preferences) => {
        if (cancelled) {
          return
        }
        setMode(preferences?.authorizationMode ?? null)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          logger.warn('Failed to load project authorization preferences', { error: String(err) })
          setMode(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  return { loading, mode, setMode }
}

interface StatusRow {
  subtitle: string
  subtitleClass: string
  dotClass: string | null
}

const UP_TO_DATE: StatusRow = {
  subtitle: 'You are up to date',
  subtitleClass: 'text-[#9098a8]',
  dotClass: null,
}

function getStatusRow(status: UpdateStatus) {
  return matchBy(status, 'type')
    .with('idle', () => UP_TO_DATE)
    .with('not-available', () => UP_TO_DATE)
    .with('checking', () => ({
      subtitle: 'Checking for updates…',
      subtitleClass: 'text-[#9098a8]',
      dotClass: null,
    }))
    .with('available', (s) => ({
      subtitle: `Downloading v${s.version}…`,
      subtitleClass: 'text-[#61a8ff]',
      dotClass: 'bg-[#61a8ff]',
    }))
    .with('downloading', (s) => ({
      subtitle: `Downloading v${s.version}… ${Math.round(s.percent)}%`,
      subtitleClass: 'text-[#61a8ff]',
      dotClass: 'bg-[#61a8ff]',
    }))
    .with('downloaded', (s) => ({
      subtitle: `v${s.version} ready to install`,
      subtitleClass: 'text-[#4caf72]',
      dotClass: 'bg-[#4caf72]',
    }))
    .with('error', () => ({
      subtitle: 'Update check failed',
      subtitleClass: 'text-[#ef4444]',
      dotClass: 'bg-[#ef4444]',
    }))
    .exhaustive()
}

function AgentAccessSection() {
  const settings = usePreferencesStore((s) => s.settings)
  const setDefaultAuthorizationMode = usePreferencesStore((s) => s.setDefaultAuthorizationMode)
  const projectAuthorization = useProjectAuthorizationDefault(settings.projectPath)
  const [savingGlobalAuthorization, setSavingGlobalAuthorization] = useState(false)
  const [savingProjectAuthorization, setSavingProjectAuthorization] = useState(false)

  function handleGlobalAuthorizationModeChange(mode: AgentAuthorizationMode) {
    if (mode === settings.defaultAuthorizationMode || savingGlobalAuthorization) {
      return
    }

    setSavingGlobalAuthorization(true)
    setDefaultAuthorizationMode(mode)
      .catch((err: unknown) => {
        logger.warn('Failed to update global authorization mode', { error: String(err) })
      })
      .finally(() => {
        setSavingGlobalAuthorization(false)
      })
  }

  function handleProjectAuthorizationModeChange(mode: AgentAuthorizationMode) {
    if (!settings.projectPath || mode === projectAuthorization.mode || savingProjectAuthorization) {
      return
    }

    setSavingProjectAuthorization(true)
    api
      .setProjectPreferences(settings.projectPath, { authorizationMode: mode })
      .then(() => {
        projectAuthorization.setMode(mode)
      })
      .catch((err: unknown) => {
        logger.warn('Failed to update project authorization mode', { error: String(err) })
      })
      .finally(() => {
        setSavingProjectAuthorization(false)
      })
  }

  return (
    <div className="space-y-3">
      <h3 className="text-[16px] font-semibold text-[#e7e9ee]">Agent access</h3>

      <div className="overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]">
        <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[#1e2229] px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[#e7e9ee]">Default for new sessions</span>
            <span className="text-[12px] text-[#9098a8]">
              New sessions use this access mode unless a project default exists.
            </span>
          </div>
          <Select
            aria-label="Default access mode for new sessions"
            disabled={savingGlobalAuthorization}
            value={settings.defaultAuthorizationMode}
            onChange={(event) => {
              if (isAgentAuthorizationMode(event.currentTarget.value)) {
                handleGlobalAuthorizationModeChange(event.currentTarget.value)
              }
            }}
          >
            {AGENT_AUTHORIZATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {AGENT_AUTHORIZATION_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex min-h-14 items-center justify-between gap-4 px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[#e7e9ee]">Current project default</span>
            <span className="text-[12px] text-[#9098a8]">
              {settings.projectPath
                ? projectAuthorization.mode
                  ? 'New sessions in this project use this mode.'
                  : 'No project override yet; new sessions use the global default.'
                : 'Open a project to set a project-specific default.'}
            </span>
          </div>
          <Select
            aria-label="Current project access mode"
            disabled={
              !settings.projectPath || projectAuthorization.loading || savingProjectAuthorization
            }
            value={projectAuthorization.mode ?? settings.defaultAuthorizationMode}
            onChange={(event) => {
              if (isAgentAuthorizationMode(event.currentTarget.value)) {
                handleProjectAuthorizationModeChange(event.currentTarget.value)
              }
            }}
          >
            {AGENT_AUTHORIZATION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {AGENT_AUTHORIZATION_MODE_LABELS[mode]}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  )
}

export function GeneralSection() {
  const version = useAppVersion()
  const status = useUpdateStatus()
  const statusRow = getStatusRow(status)

  const canCheck =
    status.type === 'idle' || status.type === 'not-available' || status.type === 'error'
  const isDownloaded = status.type === 'downloaded'
  const isChecking = status.type === 'checking'

  return (
    <div className="space-y-6">
      <AgentAccessSection />

      {/* About & Updates — title outside the card */}
      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-[#e7e9ee]">About & Updates</h3>

        <div className="overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]">
          {/* Row 1 — Version */}
          <div className="flex h-14 items-center justify-between border-b border-[#1e2229] px-5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-[#e7e9ee]">Version</span>
              <span className="text-[12px] text-[#9098a8]">OpenWaggle v{version}</span>
            </div>
          </div>

          {/* Row 2 — Latest version / status */}
          <div className="flex h-14 items-center justify-between px-5">
            <div className="flex items-center gap-2">
              {statusRow.dotClass ? (
                <div className={`size-2 shrink-0 rounded-full ${statusRow.dotClass}`} />
              ) : isChecking ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-[#9098a8]" />
              ) : null}
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-[#e7e9ee]">Latest version</span>
                <span className={`text-[12px] ${statusRow.subtitleClass}`}>
                  {statusRow.subtitle}
                </span>
              </div>
            </div>
            <div>
              {canCheck && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    if (typeof api.checkForUpdates === 'function') {
                      api.checkForUpdates().catch((err: unknown) => {
                        logger.warn('Failed to check for updates', { error: String(err) })
                      })
                    }
                  }}
                  className="h-7 border-[#2a2f3a] bg-[#1a1f28] text-[#c9cdd6] hover:bg-[#222830]"
                >
                  <RefreshCw className="size-3" />
                  Check now
                </Button>
              )}
              {isDownloaded && (
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => {
                    if (typeof api.installUpdate === 'function') {
                      api.installUpdate().catch((err: unknown) => {
                        logger.warn('Failed to install update', { error: String(err) })
                      })
                    }
                  }}
                  className="h-7 bg-[#f5a623] text-white hover:bg-[#e09520]"
                >
                  <RotateCcw className="size-3" />
                  Restart to update
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

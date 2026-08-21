import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import {
  AGENT_AUTHORIZATION_CAPABILITY_LABELS,
  authorizationScopeKeyId,
  type ScopedAuthorizationGrant,
} from '@shared/types/agent-authorization-grants'
import { useCallback, useEffect, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

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

function useProjectAuthorizationGrants(projectPath: string | null) {
  const [grants, setGrants] = useState<readonly ScopedAuthorizationGrant[]>([])
  const [loading, setLoading] = useState(false)

  const reload = useCallback(() => {
    if (!projectPath || typeof api.listAuthorizationGrants !== 'function') {
      setGrants([])
      return
    }

    setLoading(true)
    api
      .listAuthorizationGrants(projectPath)
      .then(setGrants)
      .catch((err: unknown) => {
        logger.warn('Failed to load authorization grants', { error: String(err) })
        setGrants([])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [projectPath])

  useEffect(reload, [reload])

  return { grants, loading, reload }
}

function grantDescription(grant: ScopedAuthorizationGrant) {
  const capability = AGENT_AUTHORIZATION_CAPABILITY_LABELS[grant.capability]
  return grant.resource ? `${capability} · ${grant.resource}` : capability
}

function AuthorizationGrantRow({
  grant,
  projectPath,
  onRevoked,
}: {
  readonly grant: ScopedAuthorizationGrant
  readonly projectPath: string
  readonly onRevoked: () => void
}) {
  const [revoking, setRevoking] = useState(false)

  function handleRevoke() {
    if (revoking || typeof api.revokeAuthorization !== 'function') return

    setRevoking(true)
    api
      .revokeAuthorization(projectPath, {
        requester: grant.requester,
        capability: grant.capability,
        ...(grant.resource === undefined ? {} : { resource: grant.resource }),
      })
      .then(onRevoked)
      .catch((err: unknown) => {
        logger.warn('Failed to revoke authorization grant', { error: String(err) })
      })
      .finally(() => {
        setRevoking(false)
      })
  }

  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[#1e2229] px-5 py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-[#e7e9ee]">{grant.requester}</span>
        <span className="truncate text-[12px] text-[#9098a8]">{grantDescription(grant)}</span>
      </div>
      <Button
        aria-label={`Revoke ${grantDescription(grant)} for ${grant.requester}`}
        disabled={revoking}
        onClick={handleRevoke}
        size="sm"
        variant="secondary"
      >
        Revoke
      </Button>
    </div>
  )
}

function AuthorizationGrantsCard({ projectPath }: { readonly projectPath: string | null }) {
  const { grants, loading, reload } = useProjectAuthorizationGrants(projectPath)

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-[#e7e9ee]">Saved approvals</span>
        <span className="text-[12px] text-[#9098a8]">
          Revoking stops future use. It does not recall work already done.
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]">
        {!projectPath ? (
          <p className="px-5 py-3 text-[12px] text-[#9098a8]">
            Open a project to see what it has approved.
          </p>
        ) : loading ? (
          <p className="px-5 py-3 text-[12px] text-[#9098a8]">Loading saved approvals…</p>
        ) : grants.length === 0 ? (
          <p className="px-5 py-3 text-[12px] text-[#9098a8]">
            This project has no saved approvals. Approvals you keep will appear here.
          </p>
        ) : (
          grants.map((grant) => (
            <AuthorizationGrantRow
              grant={grant}
              key={authorizationScopeKeyId(grant)}
              onRevoked={reload}
              projectPath={projectPath}
            />
          ))
        )}
      </div>
    </div>
  )
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

  function handleGlobalChange(mode: AgentAuthorizationMode) {
    if (mode === settings.defaultAuthorizationMode || savingGlobal) return

    setSavingGlobal(true)
    setDefaultAuthorizationMode(mode)
      .catch((err: unknown) => {
        logger.warn('Failed to update global authorization mode', { error: String(err) })
      })
      .finally(() => {
        setSavingGlobal(false)
      })
  }

  /** `null` clears the override, so the project inherits the global default again. */
  function handleProjectChange(mode: AgentAuthorizationMode | null) {
    if (!settings.projectPath || mode === projectAuthorization.mode || savingProject) return

    setSavingProject(true)
    api
      .setProjectPreferences(settings.projectPath, { authorizationMode: mode })
      .then(() => {
        projectAuthorization.setMode(mode)
      })
      .catch((err: unknown) => {
        logger.warn('Failed to update project authorization mode', { error: String(err) })
      })
      .finally(() => {
        setSavingProject(false)
      })
  }

  return (
    <div className="space-y-3">
      <h3 className="text-[16px] font-semibold text-[#e7e9ee]">Agent access</h3>

      <div className="overflow-hidden rounded-lg border border-[#1e2229] bg-[#111418]">
        <div className="flex min-h-14 items-center justify-between gap-4 border-b border-[#1e2229] px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[#e7e9ee]">Default access mode</span>
            <span className="text-[12px] text-[#9098a8]">
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
            <span className="text-[13px] font-medium text-[#e7e9ee]">Current project</span>
            <span className="text-[12px] text-[#9098a8]">
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

      <AuthorizationGrantsCard projectPath={settings.projectPath} />
    </div>
  )
}

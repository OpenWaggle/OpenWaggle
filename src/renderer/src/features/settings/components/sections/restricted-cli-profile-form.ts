import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import type { LocalSessionProfileSummary } from '@shared/types/local-session-profile-management'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import { useState } from 'react'

function lines(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ]
}

function resolvedScope(input: {
  readonly all: boolean
  readonly projectPaths: string
  readonly sessionIds: string
  readonly hiveRootSessionIds: string
}): LocalSessionProfileScope {
  if (input.all) return { all: true }
  const projectPaths = lines(input.projectPaths)
  const sessionIds = lines(input.sessionIds)
  const hiveRootSessionIds = lines(input.hiveRootSessionIds)
  return {
    ...(projectPaths.length > 0 ? { projectPaths } : {}),
    ...(sessionIds.length > 0 ? { sessionIds } : {}),
    ...(hiveRootSessionIds.length > 0 ? { hiveRootSessionIds } : {}),
  }
}

function scopeIsEmpty(scope: LocalSessionProfileScope) {
  return (
    !scope.all &&
    !scope.projectPaths?.length &&
    !scope.sessionIds?.length &&
    !scope.hiveRootSessionIds?.length
  )
}

export interface RestrictedCliProfileSaveCommand {
  readonly operation: 'create' | 'update'
  readonly name: string
  readonly capabilities: readonly SessionCapability[]
  readonly scope: LocalSessionProfileScope
  readonly authorizationCeiling: AgentAuthorizationMode
  readonly managementEnvelope?: {
    readonly capabilities: readonly SessionCapability[]
    readonly scope: LocalSessionProfileScope
    readonly authorizationCeiling: AgentAuthorizationMode
  }
}

function saveCommand(input: {
  readonly profile?: LocalSessionProfileSummary
  readonly name: string
  readonly capabilities: readonly SessionCapability[]
  readonly scope: LocalSessionProfileScope
  readonly authorizationCeiling: AgentAuthorizationMode
}): RestrictedCliProfileSaveCommand {
  return {
    operation: input.profile ? 'update' : 'create',
    name: input.name,
    capabilities: input.capabilities,
    scope: input.scope,
    authorizationCeiling: input.authorizationCeiling,
    ...(input.capabilities.includes('access:profiles')
      ? {
          managementEnvelope: {
            capabilities: input.capabilities.filter((item) => item !== 'access:profiles'),
            scope: input.scope,
            authorizationCeiling: input.authorizationCeiling,
          },
        }
      : {}),
  }
}

function joinedLines(values: readonly string[] | undefined) {
  return values ? values.join('\n') : ''
}

function initialForm(
  profile: LocalSessionProfileSummary | undefined,
  defaultProjectPath?: string | null,
) {
  if (!profile) {
    return {
      name: '',
      authorizationCeiling: 'ask-for-approval',
      all: false,
      projectPaths: defaultProjectPath ?? '',
      sessionIds: '',
      hiveRootSessionIds: '',
      capabilities: ['sessions:discover', 'sessions:read'],
    } satisfies {
      readonly name: string
      readonly authorizationCeiling: AgentAuthorizationMode
      readonly all: boolean
      readonly projectPaths: string
      readonly sessionIds: string
      readonly hiveRootSessionIds: string
      readonly capabilities: readonly SessionCapability[]
    }
  }
  return {
    name: profile.name,
    authorizationCeiling: profile.authorizationCeiling,
    all: profile.scope.all ?? false,
    projectPaths: joinedLines(profile.scope.projectPaths),
    sessionIds: joinedLines(profile.scope.sessionIds),
    hiveRootSessionIds: joinedLines(profile.scope.hiveRootSessionIds),
    capabilities: profile.capabilities,
  } satisfies {
    readonly name: string
    readonly authorizationCeiling: AgentAuthorizationMode
    readonly all: boolean
    readonly projectPaths: string
    readonly sessionIds: string
    readonly hiveRootSessionIds: string
    readonly capabilities: readonly SessionCapability[]
  }
}

function toggledCapabilities(
  current: readonly SessionCapability[],
  capability: SessionCapability,
  checked: boolean,
) {
  if (!checked) return current.filter((item) => item !== capability)
  return SESSION_CAPABILITIES.filter((item) => current.includes(item) || item === capability)
}

export function useRestrictedCliProfileForm(input: {
  readonly profile?: LocalSessionProfileSummary
  readonly defaultProjectPath?: string | null
  readonly onClose: () => void
  readonly onSave: (command: RestrictedCliProfileSaveCommand) => Promise<void>
}) {
  const initial = initialForm(input.profile, input.defaultProjectPath)
  const [name, setName] = useState(initial.name)
  const [authorizationCeiling, setAuthorizationCeiling] = useState<AgentAuthorizationMode>(
    initial.authorizationCeiling,
  )
  const [all, setAll] = useState(initial.all)
  const [projectPaths, setProjectPaths] = useState(initial.projectPaths)
  const [sessionIds, setSessionIds] = useState(initial.sessionIds)
  const [hiveRootSessionIds, setHiveRootSessionIds] = useState(initial.hiveRootSessionIds)
  const [capabilities, setCapabilities] = useState<readonly SessionCapability[]>(
    initial.capabilities,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleCapability(capability: SessionCapability, checked: boolean) {
    setCapabilities((current) => toggledCapabilities(current, capability, checked))
  }

  async function submit() {
    const selectedName = name.trim()
    const scope = resolvedScope({ all, projectPaths, sessionIds, hiveRootSessionIds })
    if (!selectedName) return setError('Give the profile a name.')
    if (scopeIsEmpty(scope)) {
      return setError('Choose at least one project, Session, Hive, or all Sessions.')
    }
    setSaving(true)
    setError(null)
    try {
      await input.onSave(
        saveCommand({
          profile: input.profile,
          name: selectedName,
          capabilities,
          scope,
          authorizationCeiling,
        }),
      )
      input.onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return {
    name,
    setName,
    authorizationCeiling,
    setAuthorizationCeiling,
    all,
    setAll,
    projectPaths,
    setProjectPaths,
    sessionIds,
    setSessionIds,
    hiveRootSessionIds,
    setHiveRootSessionIds,
    capabilities,
    toggleCapability,
    saving,
    error,
    submit,
  }
}

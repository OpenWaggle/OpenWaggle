import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
  DEFAULT_AGENT_AUTHORIZATION_MODE,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { SessionDetail } from '@shared/types/session'
import { useState } from 'react'
import { Select } from '@/shared/ui/Select'

export function SessionAuthorizationModeMenu({
  session,
  onSetAuthorizationMode,
}: {
  readonly session: SessionDetail | null
  readonly onSetAuthorizationMode: (authorizationMode: AgentAuthorizationMode) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const value = session?.authorizationMode ?? DEFAULT_AGENT_AUTHORIZATION_MODE

  if (!session) {
    return null
  }

  function handleChange(nextMode: AgentAuthorizationMode) {
    if (nextMode === value || saving) {
      return
    }

    setSaving(true)
    onSetAuthorizationMode(nextMode).finally(() => {
      setSaving(false)
    })
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
      <span className="shrink-0">Access</span>
      <Select
        aria-label="Session access mode"
        disabled={saving}
        selectSize="xs"
        value={value}
        onChange={(event) => {
          if (isAgentAuthorizationMode(event.currentTarget.value)) {
            handleChange(event.currentTarget.value)
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
  )
}

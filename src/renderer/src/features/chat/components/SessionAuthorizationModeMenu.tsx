import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODE_SHORT_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { SessionDetail } from '@shared/types/session'
import { useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { Select } from '@/shared/ui/Select'

/** Sentinel for the option that clears the session override. */
const INHERIT_VALUE = 'inherit'

/**
 * The session access-mode control in the composer row.
 *
 * Shows the compact label while closed and the full one while the user is choosing. A native select
 * renders the selected option's own text when closed, so the selected option carries the short label
 * until the control opens and then carries the full one. That keeps one real `<select>`, with its
 * keyboard behaviour and platform popup, instead of a custom menu that would have to reimplement
 * both.
 *
 * `Use default` clears the override. Without it the composer could set a session override but never
 * remove one, so a session could never be returned to following its project or global default.
 */
export function SessionAuthorizationModeMenu({
  session,
  onSetAuthorizationMode,
}: {
  readonly session: SessionDetail | null
  readonly onSetAuthorizationMode: (
    authorizationMode: AgentAuthorizationMode | null,
  ) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const globalDefault = usePreferencesStore((s) => s.settings.defaultAuthorizationMode)

  // Absent means the session holds no override and follows its project, then the global default.
  const override = session?.authorizationMode ?? null

  // Before a session exists there is nothing to hold an override, so the control shows the mode the
  // first run will actually use and is not editable yet. Hiding it instead would leave the composer
  // silent about access until after the first message, which is exactly when it matters least.
  const draft = session === null
  const value = draft ? globalDefault : (override ?? INHERIT_VALUE)

  function handleChange(next: AgentAuthorizationMode | null) {
    if (next === override || saving) return

    setSaving(true)
    onSetAuthorizationMode(next).finally(() => {
      setSaving(false)
    })
  }

  function labelFor(mode: AgentAuthorizationMode) {
    const isSelected = draft ? mode === globalDefault : mode === override
    return isSelected && !choosing
      ? AGENT_AUTHORIZATION_MODE_SHORT_LABELS[mode]
      : AGENT_AUTHORIZATION_MODE_LABELS[mode]
  }

  return (
    <div
      className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted"
      title={draft ? 'The first run uses this mode. Change it once the session exists.' : undefined}
    >
      <span className="shrink-0">Access</span>
      <Select
        aria-label="Session access mode"
        disabled={saving || draft}
        onBlur={() => setChoosing(false)}
        onChange={(event) => {
          setChoosing(false)
          const raw = event.currentTarget.value
          if (raw === INHERIT_VALUE) {
            handleChange(null)
            return
          }
          if (isAgentAuthorizationMode(raw)) {
            handleChange(raw)
          }
        }}
        // Both, because a pointer opens the popup without focusing first on some platforms and the
        // keyboard focuses without a pointer event. The labels have to be full before it paints.
        onFocus={() => setChoosing(true)}
        onKeyDown={() => setChoosing(true)}
        onMouseDown={() => setChoosing(true)}
        selectSize="xs"
        value={value}
      >
        {draft ? null : (
          <option value={INHERIT_VALUE}>
            {choosing || override !== null ? 'Use default' : 'Default'}
          </option>
        )}
        {AGENT_AUTHORIZATION_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {labelFor(mode)}
          </option>
        ))}
      </Select>
    </div>
  )
}

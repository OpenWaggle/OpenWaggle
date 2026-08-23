import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { SessionDetail } from '@shared/types/session'
import { useState } from 'react'
import { usePreferencesStore, useProjectAuthorizationDefault } from '@/features/settings/state'
import { Select } from '@/shared/ui/Select'

/** Sentinel for the option that clears the session override. */
const INHERIT_VALUE = 'inherit'

/**
 * Names the mode in force, marking it as inherited when the session holds no override.
 *
 * One label vocabulary in both states, deliberately. An earlier version showed compact forms
 * (`YOLO`, `Ask`) while closed and the full ones while open, which had two problems: `Ask` is the
 * contraction CONTEXT.md rules out for Ask for Approval, and the swap depended on Chromium
 * repainting `<option>` text before the native popup opened. If that race were lost while a session
 * inherited full access, the popup showed the same word twice with no way to tell inherit from
 * override.
 */
function inheritLabel(effective: AgentAuthorizationMode) {
  return `Default · ${AGENT_AUTHORIZATION_MODE_LABELS[effective]}`
}

/**
 * The session access-mode control in the composer row.
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
  const globalDefault = usePreferencesStore((s) => s.settings.defaultAuthorizationMode)
  const projectDefault = useProjectAuthorizationDefault(session?.projectPath ?? null)

  // Absent means the session holds no override and follows its project, then the global default.
  const override = session?.authorizationMode ?? null

  // The same precedence the main process resolves at request time, so the control cannot claim one
  // mode while the run uses another.
  const effective = override ?? projectDefault ?? globalDefault

  // Before a session exists there is nothing to hold an override, so the control shows the mode the
  // first run will actually use and is not editable yet. Hiding it instead would leave the composer
  // silent about access until after the first message, which is exactly when it matters least.
  const draft = session === null
  const value = draft ? effective : (override ?? INHERIT_VALUE)

  function handleChange(next: AgentAuthorizationMode | null) {
    if (next === override || saving) return

    setSaving(true)
    onSetAuthorizationMode(next).finally(() => {
      setSaving(false)
    })
  }

  return (
    <div
      className="flex min-w-0 items-center text-[11px] text-text-muted"
      title={draft ? 'The first run uses this mode. Change it once the session exists.' : undefined}
    >
      <Select
        aria-label="Session access mode"
        className="max-w-[15rem] truncate"
        disabled={saving || draft}
        onChange={(event) => {
          const raw = event.currentTarget.value
          if (raw === INHERIT_VALUE) {
            handleChange(null)
            return
          }
          if (isAgentAuthorizationMode(raw)) {
            handleChange(raw)
          }
        }}
        selectSize="xs"
        value={value}
      >
        {draft ? null : (
          // Names the mode in force rather than the bare word "Default", which would say nothing
          // about what will happen, while still marking it as inherited so it stays distinct from
          // pinning the same mode as an explicit override.
          <option value={INHERIT_VALUE}>{inheritLabel(effective)}</option>
        )}
        {AGENT_AUTHORIZATION_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {AGENT_AUTHORIZATION_MODE_LABELS[mode]}
          </option>
        ))}
      </Select>
    </div>
  )
}

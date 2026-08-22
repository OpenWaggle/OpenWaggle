import {
  AGENT_AUTHORIZATION_MODE_LABELS,
  AGENT_AUTHORIZATION_MODE_SHORT_LABELS,
  AGENT_AUTHORIZATION_MODES,
  type AgentAuthorizationMode,
  isAgentAuthorizationMode,
} from '@shared/types/agent-authorization'
import type { SessionDetail } from '@shared/types/session'
import { useEffect, useState } from 'react'
import { usePreferencesStore } from '@/features/settings/state'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { Select } from '@/shared/ui/Select'

const logger = createRendererLogger('session-access-mode')

/**
 * The project's own override, when it has one.
 *
 * Read here so the closed control can name the mode that will actually be used. Showing "Default"
 * instead would hide which mode is in force, which is the one thing this control exists to say.
 */
function useProjectDefault(projectPath: string | null) {
  const [projectDefault, setProjectDefault] = useState<AgentAuthorizationMode | null>(null)

  useEffect(() => {
    if (!projectPath || typeof api.getProjectPreferences !== 'function') {
      setProjectDefault(null)
      return
    }

    let cancelled = false
    api
      .getProjectPreferences(projectPath)
      .then((preferences) => {
        if (!cancelled) setProjectDefault(preferences?.authorizationMode ?? null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        logger.warn('Failed to read the project access mode', { error: String(err) })
        setProjectDefault(null)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  return projectDefault
}

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
  const projectDefault = useProjectDefault(session?.projectPath ?? null)

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

  function labelFor(mode: AgentAuthorizationMode) {
    // A native select shows the selected option's own text when closed, so the selected option
    // carries the compact label until the control opens and the full one after.
    const isSelected = draft ? mode === effective : mode === override
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
          // While inheriting and closed, this is the option on display, so it names the mode in
          // force rather than the word "Default", which would say nothing about what will happen.
          <option value={INHERIT_VALUE}>
            {choosing || override !== null
              ? 'Use default'
              : AGENT_AUTHORIZATION_MODE_SHORT_LABELS[effective]}
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

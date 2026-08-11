import type { SessionEnvironmentMode } from '@shared/types/git'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import { useId } from 'react'
import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'

const ENV_MODE_LABELS: Record<SessionEnvironmentMode, string> = {
  local: 'Current checkout',
  worktree: 'New worktree',
}

function toEnvMode(value: string): SessionEnvironmentMode {
  return value === 'worktree' ? 'worktree' : 'local'
}

interface SessionContextRowProps {
  readonly strip: SessionContextRowState
}

/**
 * Session context row (WS1b): states where the next send will run — Session
 * environment mode, Worktree base ref, and start-from-origin. Rendered below the
 * composer alongside the branch picker, using the same chip language as the
 * composer toolbar controls. Only shown before a Session worktree is born.
 */
export function SessionContextRow({ strip }: SessionContextRowProps) {
  const originToggleId = useId()
  if (!strip.visible) return null
  const isWorktree = strip.envMode === 'worktree'
  const blocked = strip.sendPlan.kind === 'blocked'

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-tertiary">
      <span>Run in</span>
      <Select
        aria-label="Session environment mode"
        value={strip.envMode}
        onChange={(event) => strip.setEnvMode(toEnvMode(event.target.value))}
        selectSize="xs"
      >
        {SESSION_ENVIRONMENT_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {ENV_MODE_LABELS[mode]}
          </option>
        ))}
      </Select>

      {isWorktree ? (
        <>
          <span>from</span>
          <Select
            aria-label="Worktree base branch"
            value={strip.baseRef ?? ''}
            onChange={(event) => strip.setBaseRef(event.target.value)}
            selectSize="xs"
          >
            <option value="" disabled>
              Select a base branch
            </option>
            {strip.branchNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <label htmlFor={originToggleId} className="flex items-center gap-1.5">
            <ToggleSwitch
              checked={strip.startFromOrigin}
              onCheckedChange={strip.setStartFromOrigin}
              label="Start from origin"
              size="compact"
            />
            Start from origin
          </label>
          <ChangeRequestCheckout strip={strip} />
        </>
      ) : null}

      {blocked && strip.sendPlan.kind === 'blocked' ? (
        <span role="alert" className="text-status-error">
          {strip.sendPlan.reason}
        </span>
      ) : null}
    </div>
  )
}

function ChangeRequestCheckout({ strip }: { readonly strip: SessionContextRowState }) {
  if (strip.changeRequests.length === 0) {
    return (
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void strip.loadChangeRequests()}
        className="h-6 rounded-[5px] border border-border px-2 text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        Checkout change request…
      </Button>
    )
  }
  return (
    <Select
      aria-label="Checkout change request"
      value=""
      selectSize="xs"
      onChange={(event) => {
        if (event.target.value) void strip.checkoutChangeRequest(event.target.value)
      }}
    >
      <option value="">Checkout change request…</option>
      {strip.changeRequests.map((cr) => (
        <option key={cr.url} value={cr.headRef}>
          {cr.title}
        </option>
      ))}
    </Select>
  )
}

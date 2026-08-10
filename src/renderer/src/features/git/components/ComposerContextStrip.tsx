import type { SessionEnvironmentMode } from '@shared/types/git'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import { useId } from 'react'
import type { ComposerContextStripState } from '@/features/git/hooks/useComposerContextStrip'
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

interface ComposerContextStripProps {
  readonly strip: ComposerContextStripState
}

/**
 * Composer context strip (WS1b): per-session env-mode + Worktree base ref +
 * start-from-origin controls, mirroring T3Code's BranchToolbar. Only rendered
 * before a Session worktree is born (first message, worktree not yet created).
 */
export function ComposerContextStrip({ strip }: ComposerContextStripProps) {
  const originToggleId = useId()
  if (!strip.visible) return null
  const isWorktree = strip.envMode === 'worktree'
  const blocked = strip.sendPlan.kind === 'blocked'

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-[12px]">
      <span className="text-text-tertiary">Run in</span>
      <Select
        aria-label="Session environment mode"
        value={strip.envMode}
        onChange={(event) => strip.setEnvMode(toEnvMode(event.target.value))}
      >
        {SESSION_ENVIRONMENT_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {ENV_MODE_LABELS[mode]}
          </option>
        ))}
      </Select>

      {isWorktree ? (
        <>
          <span className="text-text-tertiary">from</span>
          <Select
            aria-label="Worktree base branch"
            value={strip.baseRef ?? ''}
            onChange={(event) => strip.setBaseRef(event.target.value)}
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
          <label htmlFor={originToggleId} className="flex items-center gap-1.5 text-text-tertiary">
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

function ChangeRequestCheckout({ strip }: { readonly strip: ComposerContextStripState }) {
  if (strip.changeRequests.length === 0) {
    return (
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void strip.loadChangeRequests()}
        className="h-8 rounded-lg border border-input-card-border px-2.5 text-[13px] text-text-tertiary hover:text-text-secondary"
      >
        Checkout change request…
      </Button>
    )
  }
  return (
    <Select
      aria-label="Checkout change request"
      value=""
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

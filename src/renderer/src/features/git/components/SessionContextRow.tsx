import type { SessionEnvironmentMode } from '@shared/types/git'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import { SlidersHorizontal } from 'lucide-react'
import { useId } from 'react'
import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'
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

const CHIP_CLASS =
  'flex h-6 min-w-0 items-center gap-1 rounded-[5px] border border-border px-1.5 text-[12px] text-text-secondary transition-colors hover:bg-bg-hover'

/**
 * Session context row (WS1b): states where the next send will run.
 *
 * Deliberately ONE fixed row that never grows, matching T3Code's BranchToolbar.
 * The worktree's secondary options (base branch, start-from-origin, change-request
 * checkout) live in a popover rather than inline, because rendering them inline
 * stacked the row and shifted the composer every time the mode changed.
 */
export function SessionContextRow({ strip }: SessionContextRowProps) {
  if (!strip.visible) return null
  const isWorktree = strip.envMode === 'worktree'
  const blocked = strip.sendPlan.kind === 'blocked'

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-text-tertiary">
      <span className="shrink-0">Run in</span>
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

      {isWorktree ? <WorktreeOptionsPopover strip={strip} /> : null}

      {blocked && strip.sendPlan.kind === 'blocked' ? (
        <span role="alert" className="min-w-0 truncate text-status-error">
          {strip.sendPlan.reason}
        </span>
      ) : null}
    </div>
  )
}

/**
 * Base branch plus the worktree's secondary options, in one popover. The trigger
 * shows the chosen base ref, so the row still states where the run will start
 * without a second inline control.
 */
function WorktreeOptionsPopover({ strip }: { readonly strip: SessionContextRowState }) {
  const originToggleId = useId()
  const baseRefId = useId()
  const baseRefLabel = strip.baseRef ?? 'Select base branch'

  return (
    <Popover
      placement="top-start"
      className="w-72 p-2"
      trigger={({ isOpen, toggle }) => (
        <Button
          variant="unstyled"
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-label={`Worktree options, base branch ${baseRefLabel}`}
          title="Worktree options"
          className={cn(CHIP_CLASS, 'shrink-0', strip.baseRef === null && 'border-status-error/60')}
        >
          <SlidersHorizontal className="size-3 shrink-0 text-text-tertiary" />
          <span>Options</span>
        </Button>
      )}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={baseRefId} className="text-[11px] font-medium text-text-tertiary">
            Base branch
          </label>
          <Select
            id={baseRefId}
            aria-label="Worktree base branch"
            value={strip.baseRef ?? ''}
            onChange={(event) => strip.setBaseRef(event.target.value)}
            selectSize="sm"
            className="w-full"
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
        </div>

        <label htmlFor={originToggleId} className="flex items-center justify-between gap-2">
          <span className="text-[12px] text-text-secondary">Start from origin</span>
          <ToggleSwitch
            checked={strip.startFromOrigin}
            onCheckedChange={strip.setStartFromOrigin}
            label="Start from origin"
            size="compact"
          />
        </label>

        <ChangeRequestCheckout strip={strip} />
      </div>
    </Popover>
  )
}

function ChangeRequestCheckout({ strip }: { readonly strip: SessionContextRowState }) {
  if (strip.changeRequests.length === 0) {
    return (
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void strip.loadChangeRequests()}
        className="h-7 w-full rounded-[5px] border border-border px-2 text-left text-[12px] text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
      >
        Checkout change request…
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-text-tertiary">Change request</span>
      <Select
        aria-label="Checkout change request"
        value=""
        selectSize="sm"
        className="w-full"
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
    </div>
  )
}

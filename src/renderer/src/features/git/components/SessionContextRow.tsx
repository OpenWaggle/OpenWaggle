import type { SessionEnvironmentMode } from '@shared/types/git'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow'
import { Select } from '@/shared/ui/Select'

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
 * Left half of the composer context row (WS1b): where the next send will run.
 *
 * This owns only the environment mode. The ref it runs on is owned by the single
 * run-target picker on the right of the same row, so no branch string is shown
 * twice. Deliberately one fixed-height row that never grows — rendering worktree
 * options inline used to stack the row and shift the composer on every mode change.
 */
export function SessionContextRow({ strip }: SessionContextRowProps) {
  if (!strip.visible) return null

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

      {strip.sendPlan.kind === 'blocked' ? (
        <span role="alert" className="min-w-0 truncate text-status-error">
          {strip.sendPlan.reason}
        </span>
      ) : null}
    </div>
  )
}

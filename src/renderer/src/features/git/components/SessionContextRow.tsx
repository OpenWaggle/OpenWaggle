import type { SessionEnvironmentMode } from '@shared/types/git'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

const ENV_MODE_LABELS: Record<SessionEnvironmentMode, string> = {
  local: 'Current checkout',
  worktree: 'New worktree',
}

const NOTICE_ACTION_CLASS =
  'shrink-0 whitespace-nowrap rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover'

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
/**
 * A vanished worktree stops the send and offers the two ways out, rather than the
 * agent silently receiving a fresh empty tree while the session's earlier work is
 * gone. Recreate reattaches the session's own branch; switching runs in the opened
 * checkout, which is a real change of isolation and is recorded on the session.
 */
function MissingWorktreeNotice({
  reason,
  strip,
}: {
  readonly reason: string
  readonly strip: SessionContextRowState
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-2 gap-y-1 py-0.5">
      <span className="text-status-error">{reason}</span>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void strip.recreateWorktree()}
        className={NOTICE_ACTION_CLASS}
      >
        Recreate worktree
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={strip.switchToLocalMode}
        className={NOTICE_ACTION_CLASS}
      >
        Use current checkout
      </Button>
    </div>
  )
}

export function SessionContextRow({ strip }: SessionContextRowProps) {
  if (!strip.visible) return null

  /*
   * A vanished worktree replaces the compact mode row rather than squeezing into it:
   * the message and its two actions need the full width, and "Use current checkout"
   * already IS the switch to local mode, so a mode dropdown beside it duplicates it.
   */
  if (strip.sendPlan.kind === 'worktree-missing') {
    return <MissingWorktreeNotice reason={strip.sendPlan.reason} strip={strip} />
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-text-tertiary">
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

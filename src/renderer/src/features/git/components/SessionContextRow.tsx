import type { SessionEnvironmentMode } from '@shared/types/git'
import { SESSION_ENVIRONMENT_MODES } from '@shared/types/git'
import { Check, ChevronDown, GitFork, Laptop } from 'lucide-react'
import { useState } from 'react'
import type { SessionContextRowState } from '@/features/git/hooks/useSessionContextRow'
import { Button } from '@/shared/ui/Button'
import {
  CONTEXT_MENU_TRIGGER_CLASS,
  DENSE_MENU_ITEM_CLASS,
  DOCK_MENU_POPOVER_CLASS,
  MENU_SECTION_LABEL_CLASS,
} from '@/shared/ui/menu-styles'
import { Popover } from '@/shared/ui/Popover'

const ENV_MODE_LABELS: Record<SessionEnvironmentMode, string> = {
  local: 'Current checkout',
  worktree: 'New worktree',
}

const ENV_MODE_DESCRIPTIONS: Record<SessionEnvironmentMode, string> = {
  local: 'Run in the checkout opened in OpenWaggle',
  worktree: 'Create an isolated checkout on first send',
}

const NOTICE_ACTION_CLASS =
  'shrink-0 whitespace-nowrap rounded-md border border-border px-1.5 py-0.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover'

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
  const [open, setOpen] = useState(false)

  if (!strip.visible) return null

  /*
   * A vanished worktree replaces the compact mode row rather than squeezing into it:
   * the message and its two actions need the full width, and "Use current checkout"
   * already IS the switch to local mode, so a mode dropdown beside it duplicates it.
   */
  if (strip.sendPlan.kind === 'worktree-missing') {
    return <MissingWorktreeNotice reason={strip.sendPlan.reason} strip={strip} />
  }

  if (strip.editable === false) {
    const Icon = strip.envMode === 'worktree' ? GitFork : Laptop
    return (
      <span
        className="flex min-w-0 items-center gap-2 text-text-secondary"
        title={`Session environment: ${ENV_MODE_LABELS[strip.envMode]}`}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
        <span className="truncate">
          {strip.envMode === 'worktree' ? 'Local worktree' : ENV_MODE_LABELS[strip.envMode]}
        </span>
      </span>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm text-text-tertiary">
      <Popover
        className={DOCK_MENU_POPOVER_CLASS}
        onOpenChange={setOpen}
        open={open}
        placement="top-start"
        role="menu"
        trigger={({ toggle }) => {
          const Icon = strip.envMode === 'worktree' ? GitFork : Laptop
          return (
            <Button
              aria-label={`Session environment mode: ${ENV_MODE_LABELS[strip.envMode]}`}
              className={CONTEXT_MENU_TRIGGER_CLASS}
              onClick={toggle}
              variant="unstyled"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
              <span className="truncate">{ENV_MODE_LABELS[strip.envMode]}</span>
              <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
            </Button>
          )
        }}
      >
        <div className={MENU_SECTION_LABEL_CLASS}>Run environment</div>
        {SESSION_ENVIRONMENT_MODES.map((mode) => {
          const Icon = mode === 'worktree' ? GitFork : Laptop
          const checked = mode === strip.envMode
          return (
            <Button
              aria-checked={checked}
              className={DENSE_MENU_ITEM_CLASS}
              key={mode}
              onClick={() => {
                strip.setEnvMode(mode)
                setOpen(false)
              }}
              role="menuitemradio"
              variant="unstyled"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-text-tertiary" />
              <span className="flex min-w-0 flex-1 flex-col items-start">
                <span className="font-medium text-text-primary">{ENV_MODE_LABELS[mode]}</span>
                <span className="text-xs font-normal text-text-tertiary">
                  {ENV_MODE_DESCRIPTIONS[mode]}
                </span>
              </span>
              {checked ? (
                <Check aria-hidden="true" className="size-4 shrink-0 text-accent" />
              ) : null}
            </Button>
          )
        })}
      </Popover>

      {strip.sendPlan.kind === 'blocked' ? (
        <span role="alert" className="sr-only">
          {strip.sendPlan.reason}
        </span>
      ) : null}
    </div>
  )
}

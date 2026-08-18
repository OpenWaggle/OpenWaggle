import type { SessionContextRowState } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import type { ComposerActionDialogKind } from '../state/composer-action-store'

interface RunTargetOptionsProps {
  readonly strip: SessionContextRowState | null
  readonly selectedRef: string | null
  readonly onOpenActionDialog: (kind: ComposerActionDialogKind, initialValue?: string) => void
  readonly onToast?: (message: string) => void
}

const OPTION_ROW_CLASS =
  'h-7 w-full rounded-[5px] px-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50'

/**
 * Everything that used to live in the separate "Options" popover, plus the ref
 * actions that belong beside a ref chooser: create-and-switch, copy name,
 * start-from-origin, and change-request checkout. Keeping them here means the row
 * has exactly one popover and the user never has to reconcile two branch controls.
 */
export function RunTargetOptions({
  strip,
  selectedRef,
  onOpenActionDialog,
  onToast,
}: RunTargetOptionsProps) {
  const isWorktree = strip?.envMode === 'worktree'

  return (
    <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
      <Button
        variant="unstyled"
        type="button"
        onClick={() => onOpenActionDialog('create-branch')}
        className={OPTION_ROW_CLASS}
      >
        New branch…
      </Button>
      <Button
        variant="unstyled"
        type="button"
        disabled={selectedRef === null}
        onClick={() => {
          if (selectedRef === null) return
          api.copyToClipboard(selectedRef)
          onToast?.(`Copied "${selectedRef}"`)
        }}
        className={OPTION_ROW_CLASS}
      >
        Copy branch name
      </Button>
      {isWorktree && strip ? <WorktreeOptions strip={strip} /> : null}
    </div>
  )
}

function WorktreeOptions({ strip }: { readonly strip: SessionContextRowState }) {
  return (
    <>
      {/*
        ToggleSwitch renders a `role="switch"` button carrying its own accessible
        name, not a form input, so this must not be a <label>: an htmlFor here has
        nothing to point at. The visible text is hidden from assistive tech so the
        switch is announced exactly once.
      */}
      <div className="flex h-7 items-center justify-between gap-2 px-2">
        <span aria-hidden="true" className="text-[12px] text-text-secondary">
          Start from origin
        </span>
        <ToggleSwitch
          checked={strip.startFromOrigin}
          onCheckedChange={strip.setStartFromOrigin}
          label="Start from origin"
          size="compact"
        />
      </div>
      <ChangeRequestCheckout strip={strip} />
    </>
  )
}

function ChangeRequestCheckout({ strip }: { readonly strip: SessionContextRowState }) {
  if (strip.changeRequests.length === 0) {
    return (
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void strip.loadChangeRequests()}
        className={OPTION_ROW_CLASS}
      >
        Checkout change request…
      </Button>
    )
  }
  return (
    <div className="flex flex-col gap-1 px-2 pb-1">
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

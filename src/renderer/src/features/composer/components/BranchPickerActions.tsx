import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import type { ComposerActionDialogKind } from '../state/composer-action-store'

interface BranchPickerActionsProps {
  readonly currentBranch: string | null
  readonly onOpenActionDialog: (kind: ComposerActionDialogKind, initialValue?: string) => void
}

export function BranchPickerActions({
  currentBranch,
  onOpenActionDialog,
}: BranchPickerActionsProps) {
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      <BranchPickerActionButton onClick={() => onOpenActionDialog('create-branch')}>
        Create
      </BranchPickerActionButton>
      <BranchPickerActionButton
        onClick={() => openCurrentBranchDialog(currentBranch, onOpenActionDialog, 'rename-branch')}
      >
        Rename
      </BranchPickerActionButton>
      <BranchPickerActionButton
        disabled={!currentBranch}
        onClick={() => openCurrentBranchDialog(currentBranch, onOpenActionDialog, 'delete-branch')}
      >
        Delete current
      </BranchPickerActionButton>
      <BranchPickerActionButton
        onClick={() => openUpstreamDialog(currentBranch, onOpenActionDialog)}
      >
        Upstream
      </BranchPickerActionButton>
    </div>
  )
}

interface BranchPickerActionButtonProps {
  readonly children: ReactNode
  readonly disabled?: boolean
  readonly onClick: () => void
}

function BranchPickerActionButton({ children, disabled, onClick }: BranchPickerActionButtonProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-border px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
    >
      {children}
    </Button>
  )
}

function openCurrentBranchDialog(
  currentBranch: string | null,
  onOpenActionDialog: BranchPickerActionsProps['onOpenActionDialog'],
  kind: Extract<ComposerActionDialogKind, 'rename-branch' | 'delete-branch'>,
) {
  if (currentBranch) onOpenActionDialog(kind, currentBranch)
}

function openUpstreamDialog(
  currentBranch: string | null,
  onOpenActionDialog: BranchPickerActionsProps['onOpenActionDialog'],
) {
  if (currentBranch) onOpenActionDialog('set-upstream', `origin/${currentBranch}`)
}

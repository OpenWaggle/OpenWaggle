import type { GitBranchInfo } from '@shared/types/git'
import { Trash2 } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { ComposerActionDialogKind } from '../state/composer-action-store'

interface BranchPickerListProps {
  readonly filteredBranches: readonly GitBranchInfo[]
  readonly localBranches: readonly GitBranchInfo[]
  readonly remoteBranches: readonly GitBranchInfo[]
  readonly onCheckout: (branchName: string) => void
  readonly onOpenActionDialog: (kind: ComposerActionDialogKind, initialValue?: string) => void
}

export function BranchPickerList({
  filteredBranches,
  localBranches,
  remoteBranches,
  onCheckout,
  onOpenActionDialog,
}: BranchPickerListProps) {
  return (
    <div className="max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg">
      {filteredBranches.length === 0 ? <BranchPickerEmptyState /> : null}
      {localBranches.length > 0 ? (
        <BranchPickerLocalSection
          branches={localBranches}
          onCheckout={onCheckout}
          onOpenActionDialog={onOpenActionDialog}
        />
      ) : null}
      {remoteBranches.length > 0 ? (
        <BranchPickerRemoteSection branches={remoteBranches} onCheckout={onCheckout} />
      ) : null}
    </div>
  )
}

function BranchPickerEmptyState() {
  return <div className="px-2.5 py-2 text-[12px] text-text-tertiary">No branches found.</div>
}

interface BranchPickerSectionProps {
  readonly branches: readonly GitBranchInfo[]
  readonly onCheckout: (branchName: string) => void
}

interface BranchPickerLocalSectionProps extends BranchPickerSectionProps {
  readonly onOpenActionDialog: BranchPickerListProps['onOpenActionDialog']
}

function BranchPickerLocalSection({
  branches,
  onCheckout,
  onOpenActionDialog,
}: BranchPickerLocalSectionProps) {
  return (
    <div>
      <BranchPickerSectionHeader label="Local" />
      {branches.map((branch) => (
        <LocalBranchRow
          key={branch.fullName}
          branch={branch}
          onCheckout={onCheckout}
          onOpenActionDialog={onOpenActionDialog}
        />
      ))}
    </div>
  )
}

function BranchPickerRemoteSection({ branches, onCheckout }: BranchPickerSectionProps) {
  return (
    <div>
      <BranchPickerSectionHeader label="Remote" />
      {branches.map((branch) => (
        <RemoteBranchRow key={branch.fullName} branch={branch} onCheckout={onCheckout} />
      ))}
    </div>
  )
}

interface BranchPickerSectionHeaderProps {
  readonly label: string
}

function BranchPickerSectionHeader({ label }: BranchPickerSectionHeaderProps) {
  return (
    <div className="border-b border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
      {label}
    </div>
  )
}

interface LocalBranchRowProps {
  readonly branch: GitBranchInfo
  readonly onCheckout: (branchName: string) => void
  readonly onOpenActionDialog: BranchPickerListProps['onOpenActionDialog']
}

function LocalBranchRow({ branch, onCheckout, onOpenActionDialog }: LocalBranchRowProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 border-b border-border px-1.5 py-1 last:border-b-0',
        branch.isCurrent ? 'text-accent' : 'text-text-secondary',
      )}
    >
      <BranchCheckoutButton branch={branch} onCheckout={onCheckout} />
      {!branch.isCurrent ? (
        <Button
          variant="unstyled"
          type="button"
          onClick={() => onOpenActionDialog('delete-branch', branch.name)}
          className="flex size-6 items-center justify-center rounded border border-border text-text-tertiary transition-colors hover:bg-error/10 hover:text-error"
          title={`Delete "${branch.name}"`}
        >
          <Trash2 className="size-3" />
        </Button>
      ) : null}
    </div>
  )
}

interface BranchRowProps {
  readonly branch: GitBranchInfo
  readonly onCheckout: (branchName: string) => void
}

function RemoteBranchRow({ branch, onCheckout }: BranchRowProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onCheckout(branch.name)}
      className={cn(
        'flex w-full items-center justify-between border-b border-border px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover last:border-b-0',
        branch.isCurrent ? 'text-accent' : 'text-text-secondary',
      )}
    >
      <span className="truncate">{branch.name}</span>
      {branch.isCurrent ? <span>●</span> : null}
    </Button>
  )
}

function BranchCheckoutButton({ branch, onCheckout }: BranchRowProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onCheckout(branch.name)}
      className={cn(
        'flex min-w-0 flex-1 items-center justify-between rounded px-1 py-0.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
        branch.isCurrent ? 'text-accent' : 'text-text-secondary',
      )}
    >
      <span className="truncate">{branch.name}</span>
      {branch.isCurrent ? <span>●</span> : null}
    </Button>
  )
}

import type { GitBranchInfo } from '@shared/types/git'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

interface BranchPickerListProps {
  readonly filteredBranches: readonly GitBranchInfo[]
  readonly localBranches: readonly GitBranchInfo[]
  readonly remoteBranches: readonly GitBranchInfo[]
  readonly selectedRef: string | null
  readonly onSelectRef: (branchName: string) => void
}

export function BranchPickerList({
  filteredBranches,
  localBranches,
  remoteBranches,
  selectedRef,
  onSelectRef,
}: BranchPickerListProps) {
  return (
    <div className="max-h-[220px] overflow-y-auto rounded-md border border-border bg-bg">
      {filteredBranches.length === 0 ? <BranchPickerEmptyState /> : null}
      {localBranches.length > 0 ? (
        <BranchPickerSection
          label="Local"
          branches={localBranches}
          selectedRef={selectedRef}
          onSelectRef={onSelectRef}
        />
      ) : null}
      {remoteBranches.length > 0 ? (
        <BranchPickerSection
          label="Remote"
          branches={remoteBranches}
          selectedRef={selectedRef}
          onSelectRef={onSelectRef}
        />
      ) : null}
    </div>
  )
}

function BranchPickerEmptyState() {
  return <div className="px-2.5 py-2 text-[12px] text-text-tertiary">No branches found.</div>
}

interface BranchPickerSectionProps {
  readonly label: string
  readonly branches: readonly GitBranchInfo[]
  readonly selectedRef: string | null
  readonly onSelectRef: (branchName: string) => void
}

function BranchPickerSection({
  label,
  branches,
  selectedRef,
  onSelectRef,
}: BranchPickerSectionProps) {
  return (
    <div>
      <div className="border-b border-border px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">
        {label}
      </div>
      {branches.map((branch) => (
        <RefRow
          key={branch.fullName}
          branch={branch}
          isSelected={branch.name === selectedRef}
          onSelectRef={onSelectRef}
        />
      ))}
    </div>
  )
}

interface RefRowProps {
  readonly branch: GitBranchInfo
  readonly isSelected: boolean
  readonly onSelectRef: (branchName: string) => void
}

/**
 * Selection is marked against the resolved run target, not against
 * `branch.isCurrent`: in worktree mode the run starts from the chosen base ref,
 * which is usually not the checked-out branch.
 */
function RefRow({ branch, isSelected, onSelectRef }: RefRowProps) {
  return (
    <Button
      variant="unstyled"
      type="button"
      onClick={() => onSelectRef(branch.name)}
      aria-current={isSelected}
      className={cn(
        'flex w-full items-center justify-between border-b border-border px-2.5 py-1.5 text-left text-[12px] transition-colors last:border-b-0 hover:bg-bg-hover',
        isSelected ? 'text-accent' : 'text-text-secondary',
      )}
    >
      <span className="truncate">{branch.name}</span>
      {isSelected ? <span aria-hidden="true">●</span> : null}
    </Button>
  )
}

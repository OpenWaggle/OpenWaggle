import type { SessionContextRowState } from '@/features/git'
import { Popover } from '@/shared/ui/Popover'
import { useBranchPickerController } from '../hooks/useBranchPickerController'
import { BranchPickerList } from './BranchPickerList'
import { BranchPickerSearch } from './BranchPickerSearch'
import { RunTargetOptions } from './RunTargetOptions'
import { RunTargetTrigger } from './RunTargetTrigger'

interface RunTargetPickerProps {
  readonly strip: SessionContextRowState | null
  readonly onToast?: (message: string) => void
}

/**
 * The single ref chooser for the composer row, matching T3Code's
 * BranchToolbarBranchSelector: one control, one question — which ref does the
 * next send run on?
 *
 * Selecting a ref means different things per environment mode, and that is the
 * point of merging the two old controls: running in place checks the ref out,
 * while creating a worktree records it as the base to branch from. Previously
 * those were two chips showing the same branch string with no indication of
 * which one governed the send.
 */
export function RunTargetPicker({ strip, onToast }: RunTargetPickerProps) {
  const controller = useBranchPickerController({ onToast })
  if (!controller.projectPath) return null

  const isWorktree = strip?.envMode === 'worktree'
  const selectedRef = isWorktree ? (strip?.baseRef ?? null) : controller.currentBranch
  const isMissing = isWorktree && strip?.baseRef == null

  function selectRef(name: string) {
    if (isWorktree && strip) {
      strip.setBaseRef(name)
      controller.openMenu(null)
      return
    }
    void controller.checkoutBranch(name)
  }

  return (
    <Popover
      open={controller.branchMenuOpen}
      onOpenChange={(open) => controller.openMenu(open ? 'branch' : null)}
      placement="top-end"
      className="w-[320px] p-2"
      trigger={
        <RunTargetTrigger
          selectedRef={selectedRef}
          isOpen={controller.branchMenuOpen}
          isMissing={isMissing}
          onToggle={(open) => controller.openMenu(open ? 'branch' : null)}
        />
      }
    >
      <BranchPickerSearch
        query={controller.branchQuery}
        isBranchActionRunning={controller.isBranchActionRunning}
        onQueryChange={controller.setBranchQuery}
      />
      <BranchPickerList
        filteredBranches={controller.filteredBranches}
        localBranches={controller.localBranches}
        remoteBranches={controller.remoteBranches}
        selectedRef={selectedRef}
        onSelectRef={selectRef}
      />
      <RunTargetOptions
        strip={strip}
        selectedRef={selectedRef}
        onOpenActionDialog={controller.openActionDialog}
        onToast={onToast}
      />
    </Popover>
  )
}

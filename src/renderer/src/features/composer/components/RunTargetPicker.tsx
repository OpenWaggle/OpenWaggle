import type { SessionContextRowState } from '@/features/git'
import { selectWorkingTreeStatus, useGitStore } from '@/features/git'
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
 * The single ref chooser for the composer row: one control, one question — which
 * ref does the next send run on?
 *
 * Selecting a ref means different things per environment mode, and that is the
 * point of merging the two old controls: running in place checks the ref out,
 * while creating a worktree records it as the base to branch from. Previously
 * those were two chips showing the same branch string with no indication of
 * which one governed the send.
 */
export function RunTargetPicker({ strip, onToast }: RunTargetPickerProps) {
  const controller = useBranchPickerController({ onToast })
  /*
   * Read status for THIS strip's worktree rather than relying on the ambient active
   * session resolution. They agree in the app, but depending on two independent
   * resolutions of "which tree" is the coupling that produced this bug class.
   */
  const worktreeBranch = useGitStore((state) =>
    strip?.worktreePath == null
      ? null
      : (selectWorkingTreeStatus(state, strip.worktreePath).status?.branch ?? null),
  )
  if (!controller.projectPath) return null

  const isWorktree = strip?.envMode === 'worktree'
  /*
   * Once a worktree exists, the run target is the branch actually checked out inside
   * it, which `controller.currentBranch` reports because status is keyed to this
   * session's working path (ADR 0018). Before it exists there is no such branch yet,
   * so the chip shows the base ref the worktree will be forked from.
   */
  const hasWorktree = isWorktree && strip?.worktreePath != null
  const selectedRef = isWorktree
    ? (worktreeBranch ?? strip?.baseRef ?? null)
    : controller.currentBranch
  const isMissing = isWorktree && !hasWorktree && strip?.baseRef == null

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

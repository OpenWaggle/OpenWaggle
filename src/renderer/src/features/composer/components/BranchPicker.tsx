import { Popover } from '@/shared/ui/Popover'
import { useBranchPickerController } from '../hooks/useBranchPickerController'
import { BranchPickerActions } from './BranchPickerActions'
import { BranchPickerList } from './BranchPickerList'
import { BranchPickerSearch } from './BranchPickerSearch'
import { BranchPickerTrigger } from './BranchPickerTrigger'

interface BranchPickerProps {
  readonly onToast?: (message: string) => void
}

export function BranchPicker({ onToast }: BranchPickerProps) {
  const controller = useBranchPickerController({ onToast })
  if (!controller.projectPath) return null

  return (
    <Popover
      open={controller.branchMenuOpen}
      onOpenChange={(open) => controller.openMenu(open ? 'branch' : null)}
      placement="top-end"
      className="w-[320px] p-2"
      trigger={
        <BranchPickerTrigger
          currentBranch={controller.currentBranch}
          isOpen={controller.branchMenuOpen}
          onToggle={(open) => controller.openMenu(open ? 'branch' : null)}
        />
      }
    >
      <BranchPickerSearch
        query={controller.branchQuery}
        isBranchActionRunning={controller.isBranchActionRunning}
        onQueryChange={controller.setBranchQuery}
      />
      <BranchPickerActions
        currentBranch={controller.currentBranch}
        onOpenActionDialog={controller.openActionDialog}
      />
      <BranchPickerList
        filteredBranches={controller.filteredBranches}
        localBranches={controller.localBranches}
        remoteBranches={controller.remoteBranches}
        onCheckout={(branchName) => {
          void controller.checkoutBranch(branchName)
        }}
        onOpenActionDialog={controller.openActionDialog}
      />
    </Popover>
  )
}

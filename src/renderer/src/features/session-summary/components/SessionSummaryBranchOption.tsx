import type { GitBranchInfo } from '@shared/types/git'
import { Check, GitBranch } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS } from '@/shared/ui/menu-styles'

export function SessionSummaryBranchOption({
  input,
}: {
  readonly input: {
    readonly candidate: GitBranchInfo
    readonly currentBranch: string | null
    readonly busy: boolean
    readonly onSelect: (branch: string) => Promise<boolean>
    readonly onFinish: (action: Promise<boolean>) => void
  }
}) {
  const { candidate, currentBranch, busy, onSelect, onFinish } = input
  const selected = candidate.name === currentBranch
  return (
    <Button
      variant="unstyled"
      type="button"
      disabled={busy || selected}
      className={DENSE_MENU_ITEM_CLASS}
      onClick={() => onFinish(onSelect(candidate.name))}
    >
      <GitBranch aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
      {candidate.isRemote ? <span className="text-xs text-text-tertiary">Remote</span> : null}
      {selected ? <Check aria-hidden="true" className="size-3.5 text-accent" /> : null}
    </Button>
  )
}

import { useProject } from '@/features/sessions/hooks'
import { BranchPicker } from './BranchPicker'

interface ComposerBranchRowProps {
  readonly onToast?: (message: string) => void
}

export function ComposerBranchRow({ onToast }: ComposerBranchRowProps) {
  const { projectPath } = useProject()

  if (!projectPath) {
    return null
  }

  // Row layout is owned by the parent so this can share one row with the
  // Session context row.
  return <BranchPicker onToast={onToast} />
}

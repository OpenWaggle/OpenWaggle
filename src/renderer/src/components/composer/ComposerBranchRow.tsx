import { useProject } from '@/hooks/useProject'
import { BranchPicker } from './BranchPicker'

interface ComposerBranchRowProps {
  readonly onToast?: (message: string) => void
}

export function ComposerBranchRow({ onToast }: ComposerBranchRowProps) {
  const { projectPath } = useProject()

  if (!projectPath) {
    return null
  }

  return (
    <div className="mt-1 flex h-7 items-center justify-end px-4">
      <BranchPicker onToast={onToast} />
    </div>
  )
}

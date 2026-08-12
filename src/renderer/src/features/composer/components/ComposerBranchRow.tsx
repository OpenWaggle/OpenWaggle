import type { SessionContextRowState } from '@/features/git'
import { useProject } from '@/features/sessions/hooks'
import { RunTargetPicker } from './RunTargetPicker'

interface ComposerBranchRowProps {
  readonly strip: SessionContextRowState | null
  readonly onToast?: (message: string) => void
}

export function ComposerBranchRow({ strip, onToast }: ComposerBranchRowProps) {
  const { projectPath } = useProject()

  if (!projectPath) {
    return null
  }

  // Row layout is owned by the parent so this shares one row with the session
  // context row: mode on the left, the single run-target picker on the right.
  return <RunTargetPicker strip={strip} onToast={onToast} />
}

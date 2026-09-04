import type { SessionContextRowState } from '@/features/git'
import { useProject } from '@/features/sessions/hooks'
import { RunTargetPicker } from './RunTargetPicker'
import { RunTargetTrigger } from './RunTargetTrigger'

interface ComposerBranchRowProps {
  readonly strip: SessionContextRowState | null
  readonly onToast?: (message: string) => void
}

export function ComposerBranchRow({ strip, onToast }: ComposerBranchRowProps) {
  const { projectPath } = useProject()

  if (!projectPath) {
    return (
      <RunTargetTrigger
        disabled
        isMissing={false}
        isOpen={false}
        onToggle={() => {}}
        placeholder="Select project first"
        selectedRef={null}
      />
    )
  }

  if (strip?.branchStatus !== undefined && strip.branchStatus !== 'ready') {
    const placeholder = {
      'project-required': 'Select project first',
      loading: 'Loading branches…',
      empty: 'No branches found',
      error: 'Branches unavailable',
    }[strip.branchStatus]
    return (
      <RunTargetTrigger
        disabled
        isMissing={false}
        isOpen={false}
        onToggle={() => {}}
        placeholder={placeholder}
        selectedRef={null}
      />
    )
  }

  // Row layout is owned by the parent so this shares one row with the session
  // context row: mode on the left, the single run-target picker on the right.
  return <RunTargetPicker strip={strip} onToast={onToast} />
}

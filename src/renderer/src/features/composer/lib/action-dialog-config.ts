import { match } from '@diegogbrisa/ts-match'
import type { ComposerActionDialogKind } from '../state/composer-action-store'

export interface ActionDialogConfig {
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly confirmTone: 'normal' | 'danger'
  readonly inputPlaceholder?: string
}

export function getActionDialogConfig(
  kind: ComposerActionDialogKind,
  gitBranch: string | null | undefined,
  actionDialogInput: string,
) {
  const currentBranch = gitBranch ?? 'current branch'
  const targetBranch = actionDialogInput.trim() || currentBranch
  return match(kind)
    .with('create-branch', () => ({
      title: 'Create branch',
      description: 'Create and checkout a new branch from the current HEAD.',
      confirmLabel: 'Create',
      confirmTone: 'normal' as const,
      inputPlaceholder: 'feature/my-branch',
    }))
    .with('rename-branch', () => ({
      title: `Rename "${currentBranch}"`,
      description: 'Enter the new branch name.',
      confirmLabel: 'Rename',
      confirmTone: 'normal' as const,
      inputPlaceholder: 'feature/new-name',
    }))
    .with('delete-branch', () => ({
      title: `Delete "${targetBranch}"`,
      description: 'This removes the local branch. This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmTone: 'danger' as const,
      inputPlaceholder: undefined,
    }))
    .with('set-upstream', () => ({
      title: `Set upstream for "${currentBranch}"`,
      description: 'Enter the remote tracking branch (for example origin/main).',
      confirmLabel: 'Set upstream',
      confirmTone: 'normal' as const,
      inputPlaceholder: `origin/${currentBranch}`,
    }))
    .exhaustive()
}

export function actionDialogHasInput(kind: ComposerActionDialogKind | null) {
  return kind === 'create-branch' || kind === 'rename-branch' || kind === 'set-upstream'
}

import { match } from '@diegogbrisa/ts-match'
import type { ComposerActionDialogKind } from '../state/composer-action-store'

export interface ActionDialogConfig {
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly confirmTone: 'normal' | 'danger'
  readonly inputPlaceholder?: string
}

export function getActionDialogConfig(kind: ComposerActionDialogKind) {
  return match(kind)
    .with('create-branch', () => ({
      title: 'Create branch',
      description: 'Create and checkout a new branch from the current HEAD.',
      confirmLabel: 'Create',
      confirmTone: 'normal' as const,
      inputPlaceholder: 'feature/my-branch',
    }))
    .exhaustive()
}

export function actionDialogHasInput(kind: ComposerActionDialogKind | null) {
  return kind === 'create-branch'
}

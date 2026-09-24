import type { ActionCatalog } from '@shared/types/action-definitions'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshotDraftWorktreePlan } from '@/features/git'
import { actionCatalog } from './native-action-fixtures'

const mocks = vi.hoisted(() => ({
  catalog: ((): ActionCatalog | null => null)(),
}))
vi.mock('../../hooks/useNativeActions', () => ({
  useActionScope: (projectPath: string) => ({ projectPath }),
  useNativeActions: () => ({ data: mocks.catalog }),
}))
vi.mock('../../hooks/useWorkspacePreparation', () => ({
  useWorkspacePreparation: () => ({
    data: undefined,
    error: null,
    mutation: { error: null, isPending: false },
  }),
}))

import { WorktreePreparationChoice } from '../WorktreePreparationChoice'

describe('WorktreePreparationChoice', () => {
  beforeEach(() => {
    mocks.catalog = actionCatalog()
  })

  it('clears a deleted draft profile even after the chooser becomes hidden', () => {
    const frontend = { source: 'local' as const, definition: { id: 'frontend', name: 'Frontend' } }
    const catalog = { ...actionCatalog(), profiles: [...actionCatalog().profiles, frontend] }
    mocks.catalog = catalog
    const view = render(<WorktreePreparationChoice projectPath="/repo" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Preparation' }), {
      target: { value: 'frontend' },
    })
    expect(screen.getByRole('combobox', { name: 'Preparation' })).toHaveValue('frontend')

    mocks.catalog = actionCatalog()
    view.rerender(<WorktreePreparationChoice projectPath="/repo" />)

    expect(screen.queryByRole('combobox', { name: 'Preparation' })).not.toBeInTheDocument()
    expect(snapshotDraftWorktreePlan('/repo')?.plan.preparationProfileId).toBeUndefined()
    mocks.catalog = catalog
    view.rerender(<WorktreePreparationChoice projectPath="/repo" />)
    expect(screen.getByRole('combobox', { name: 'Preparation' })).toHaveValue('')
  })
})

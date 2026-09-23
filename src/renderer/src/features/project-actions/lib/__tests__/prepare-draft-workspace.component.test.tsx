import { describe, expect, it, vi } from 'vitest'

const manageProjectActions = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions } }))

const { validateDraftWorkspacePreparation } = await import('../prepare-draft-workspace')

const catalog = {
  type: 'catalog',
  catalog: {
    revision: 'catalog-1',
    actions: [],
    preparation: [],
    profiles: [
      { source: 'local', definition: { id: 'default', name: 'Default' } },
      { source: 'local', definition: { id: 'frontend', name: 'Frontend' } },
    ],
  },
} as const

describe('draft workspace preparation preflight', () => {
  it('waits for the live catalog and requires a choice when it has multiple profiles', async () => {
    let resolveCatalog: (value: typeof catalog) => void = () => {}
    manageProjectActions.mockReturnValueOnce(
      new Promise<typeof catalog>((resolve) => {
        resolveCatalog = resolve
      }),
    )
    const validation = validateDraftWorkspacePreparation('/repo', undefined)
    expect(manageProjectActions).toHaveBeenCalledWith({
      scope: { projectPath: '/repo' },
      operation: { type: 'catalog' },
    })
    resolveCatalog(catalog)
    await expect(validation).rejects.toThrow('Choose a Preparation profile')
  })

  it('accepts a live choice and rejects a removed one', async () => {
    manageProjectActions.mockResolvedValue(catalog)
    await expect(validateDraftWorkspacePreparation('/repo', 'frontend')).resolves.toBeUndefined()
    await expect(validateDraftWorkspacePreparation('/repo', 'removed')).rejects.toThrow(
      'no longer available',
    )
  })

  it('uses the sole profile without requiring an explicit choice', async () => {
    manageProjectActions.mockResolvedValue({
      ...catalog,
      catalog: { ...catalog.catalog, profiles: [catalog.catalog.profiles[0]] },
    })
    await expect(validateDraftWorkspacePreparation('/repo', undefined)).resolves.toBeUndefined()
  })
})

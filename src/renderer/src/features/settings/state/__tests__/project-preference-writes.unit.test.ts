import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getProjectPreferences: vi.fn(),
    setProjectPreferences: vi.fn(),
    removeProjectModel: vi.fn(),
  },
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: apiMock,
}))

import type { PreferencesState } from '../preferences-store-types'
import {
  persistProjectPreference,
  removeModelAndReferences,
  removeProjectModelTracked,
} from '../project-preference-writes'

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/** Minimal preferences store: only `settings` is read or written by the preference writes. */
function storeWith(settings: Settings) {
  let state = { settings }
  const get = () => state as PreferencesState
  const set = (update: (current: PreferencesState) => Partial<PreferencesState>) => {
    state = { ...state, ...update(state as PreferencesState) }
  }
  return { get, set, current: () => state.settings }
}

describe('project preference writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.getSettings.mockResolvedValue(DEFAULT_SETTINGS)
    apiMock.updateSettings.mockResolvedValue({ ok: true })
  })

  it('keeps a pending canonical write tracked when an alias write re-keys onto it', async () => {
    const canonicalWrite = deferred<string>()
    apiMock.setProjectPreferences.mockImplementation((path: string) =>
      path === '/collide/canonical'
        ? canonicalWrite.promise
        : Promise.resolve('/collide/canonical'),
    )
    const store = storeWith({ ...DEFAULT_SETTINGS, recentProjects: ['/collide/alias'] })

    const canonical = persistProjectPreference('/collide/canonical', { model: 'a/one' })
    await persistProjectPreference('/collide/alias', { model: 'a/two' }, store.set, store.get)

    const perform = vi.fn(async () => '/collide/canonical')
    const removal = removeProjectModelTracked('/collide/canonical', perform)
    await Promise.resolve()
    await Promise.resolve()
    // The displaced canonical write could still land after the deletion and recreate the entry.
    expect(perform).not.toHaveBeenCalled()

    canonicalWrite.resolve('/collide/canonical')
    await canonical
    await removal
    expect(perform).toHaveBeenCalledOnce()
  })

  it('re-keys the Host toggle maps instead of the stale renderer copies', async () => {
    apiMock.setProjectPreferences.mockResolvedValue('/toggles/canonical')
    // Skill and agent toggles persist through their own Host APIs, so the renderer copy is stale.
    const stale: Settings = {
      ...DEFAULT_SETTINGS,
      recentProjects: ['/toggles/alias'],
      skillTogglesByProject: { '/other': { lint: true } },
      agentDefinitionTogglesByProject: { '/other': { reviewer: true } },
    }
    apiMock.getSettings.mockResolvedValue({
      ...stale,
      skillTogglesByProject: { '/other': { lint: false }, '/toggles/alias': { fmt: true } },
      agentDefinitionTogglesByProject: { '/other': { reviewer: false } },
    })
    const store = storeWith(stale)

    await persistProjectPreference('/toggles/alias', { model: 'a/one' }, store.set, store.get)

    expect(apiMock.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        skillTogglesByProject: {
          '/other': { lint: false },
          '/toggles/canonical': { fmt: true },
        },
        agentDefinitionTogglesByProject: { '/other': { reviewer: false } },
      }),
    )
    expect(store.current().skillTogglesByProject['/other']).toEqual({ lint: false })
  })

  it('removes a project whose directory is gone without a preflight preference read', async () => {
    apiMock.getProjectPreferences.mockRejectedValue(new Error('ENOENT: no such file or directory'))
    apiMock.removeProjectModel.mockResolvedValue('/gone/project')
    apiMock.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      recentProjects: ['/gone/project', '/kept'],
    })

    const result = await removeModelAndReferences('/gone/project')

    expect(apiMock.removeProjectModel).toHaveBeenCalledWith('/gone/project', ['/kept'])
    expect(result.canonicalPath).toBe('/gone/project')
    expect(result.references.recentProjects).toEqual(['/kept'])
  })

  it('strips the removed project from the Host toggle map, not the stale renderer copy', async () => {
    apiMock.removeProjectModel.mockResolvedValue('/strip/project')
    apiMock.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      recentProjects: ['/strip/project'],
      skillTogglesByProject: { '/strip/project': { a: true }, '/other': { lint: false } },
    })

    await removeModelAndReferences('/strip/project')

    expect(apiMock.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ skillTogglesByProject: { '/other': { lint: false } } }),
    )
  })

  it('restores the references and writes no model when the Host removal fails', async () => {
    const before: Settings = {
      ...DEFAULT_SETTINGS,
      projectPath: '/fail/project',
      recentProjects: ['/first', '/fail/project', '/last'],
      projectDisplayNames: { '/fail/project': 'Fail' },
      skillTogglesByProject: { '/fail/project': { a: true } },
    }
    apiMock.getSettings.mockResolvedValueOnce(before).mockResolvedValueOnce({
      ...before,
      projectPath: null,
      recentProjects: ['/first', '/last'],
      projectDisplayNames: {},
      skillTogglesByProject: {},
    })
    apiMock.removeProjectModel.mockRejectedValue(new Error('alias write failed'))

    await expect(removeModelAndReferences('/fail/project')).rejects.toThrow('alias write failed')

    // The Host op owns model compensation under its recorded identity; the renderer must not
    // write a model back through a path that may now resolve to another project.
    expect(apiMock.setProjectPreferences).not.toHaveBeenCalled()
    expect(apiMock.getProjectPreferences).not.toHaveBeenCalled()
    expect(apiMock.updateSettings).toHaveBeenLastCalledWith({
      projectPath: '/fail/project',
      recentProjects: ['/first', '/fail/project', '/last'],
      projectDisplayNames: { '/fail/project': 'Fail' },
      skillTogglesByProject: { '/fail/project': { a: true } },
    })
  })
})

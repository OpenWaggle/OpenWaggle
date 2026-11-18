import type {
  SyntaxResourceCatalog,
  SyntaxThemeImportPreview,
} from '@shared/types/syntax-resources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerImportedSyntaxLanguageResources,
  syntaxLanguageCatalog,
} from '@/shared/lib/syntax/language-registry'
import { setImportedPierreSyntaxResources } from '@/shared/lib/syntax/pierre-syntax'
import { useSyntaxThemeRuntimeStore } from '@/shared/lib/syntax/syntax-theme-runtime'
import { registerImportedSyntaxThemeResources } from '@/shared/lib/syntax/theme-registry'

/*
 * Only the preload is replaced: the language, theme, Pierre and runtime registries the store
 * registers a catalog in are the real ones. The syntax service starts no worker until something
 * is highlighted, so registering resources here stays in process.
 */
const { applySyntaxThemeImportMock, listSyntaxThemesMock, removeSyntaxThemeMock } = vi.hoisted(
  () => ({
    applySyntaxThemeImportMock: vi.fn(),
    listSyntaxThemesMock: vi.fn(),
    removeSyntaxThemeMock: vi.fn(),
  }),
)

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    applySyntaxThemeImport: applySyntaxThemeImportMock,
    listSyntaxThemes: listSyntaxThemesMock,
    removeSyntaxTheme: removeSyntaxThemeMock,
  }),
}))

import { useSyntaxThemeCatalogStore } from '../syntax-theme-store'

const initialRuntime = useSyntaxThemeRuntimeStore.getInitialState()

const EMPTY_CATALOG: SyntaxResourceCatalog = {
  themes: [],
  languages: [],
  appearances: [],
}

const IMPORT_PREVIEW: SyntaxThemeImportPreview = {
  token: 'preview-token',
  sourcePath: '/tmp/theme.json',
  themes: [],
  languages: [],
  appearances: [],
  replacements: [],
  warnings: [],
}

const REFRESHED_CATALOG = {
  ...EMPTY_CATALOG,
  appearances: [
    {
      id: 'user:refreshed',
      packageId: 'user:package',
      revision: 'refreshed-revision',
      label: 'Refreshed appearance',
      variant: 'dark',
      scope: 'user',
      format: 'openwaggle',
      sourcePath: '/user/appearance.json',
      tokens: {},
      original: {},
    },
  ],
} satisfies SyntaxResourceCatalog

function deferred<T>() {
  let resolvePromise!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('syntax theme catalog store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    applySyntaxThemeImportMock.mockResolvedValue(EMPTY_CATALOG)
    removeSyntaxThemeMock.mockResolvedValue(EMPTY_CATALOG)
    useSyntaxThemeCatalogStore.setState(useSyntaxThemeCatalogStore.getInitialState())
  })

  afterEach(() => {
    registerImportedSyntaxLanguageResources([])
    registerImportedSyntaxThemeResources([])
    setImportedPierreSyntaxResources([], [])
    useSyntaxThemeRuntimeStore.setState(initialRuntime, true)
  })

  it('retains a disabled project grammar in the settings catalog but does not activate it', async () => {
    const language = (id: string, languageId: string, extension: string) =>
      ({
        id,
        packageId: 'project:package',
        revision: 'revision-1',
        label: `Project ${languageId}`,
        languageId,
        scope: 'project',
        format: 'openwaggle',
        sourcePath: `/project/.openwaggle/languages/${languageId}.json`,
        engine: 'javascript',
        registration: {
          name: languageId,
          displayName: `Project ${languageId}`,
          scopeName: `source.${languageId}`,
          aliases: [],
          fileExtensions: [extension],
          fileNames: [],
          embeddedLanguages: {},
          injectTo: [],
          grammar: {},
        },
        original: {},
      }) satisfies SyntaxResourceCatalog['languages'][number]
    // A project grammar may add a language but not replace the bundled TypeScript one.
    const replacing = language('project:typescript', 'typescript', '.ts')
    const adding = language('project:owlang', 'owlang', '.owl')
    listSyntaxThemesMock.mockResolvedValue({ ...EMPTY_CATALOG, languages: [replacing, adding] })

    await useSyntaxThemeCatalogStore.getState().load('/project')

    expect(useSyntaxThemeCatalogStore.getState().languages).toEqual([replacing, adding])
    const active = syntaxLanguageCatalog().filter((entry) => entry.provenance === 'project')
    expect(active.map((entry) => entry.name)).toEqual(['Project owlang'])
  })

  it('does not restore an imported-theme refresh after the active project changes', async () => {
    const oldCatalog = deferred<SyntaxResourceCatalog>()
    listSyntaxThemesMock.mockImplementation((projectPath: string | null | undefined) =>
      projectPath === '/old' ? oldCatalog.promise : Promise.resolve(EMPTY_CATALOG),
    )
    useSyntaxThemeCatalogStore.setState({
      preview: IMPORT_PREVIEW,
      loadedProjectPath: '/old',
    })

    const apply = useSyntaxThemeCatalogStore.getState().applyImport()
    await vi.waitFor(() => {
      expect(listSyntaxThemesMock).toHaveBeenCalledWith('/old')
    })

    await useSyntaxThemeCatalogStore.getState().load('/new')
    oldCatalog.resolve(EMPTY_CATALOG)
    await apply

    expect(useSyntaxThemeCatalogStore.getState()).toMatchObject({
      loadedProjectPath: '/new',
      loading: false,
    })
  })

  it('refreshes the active project after a stale import mutation succeeds', async () => {
    const importMutation = deferred<SyntaxResourceCatalog>()
    applySyntaxThemeImportMock.mockReturnValue(importMutation.promise)
    listSyntaxThemesMock
      .mockResolvedValueOnce(EMPTY_CATALOG)
      .mockResolvedValueOnce(REFRESHED_CATALOG)
    useSyntaxThemeCatalogStore.setState({
      preview: IMPORT_PREVIEW,
      activeProjectPath: '/old',
      loadedProjectPath: '/old',
    })

    const apply = useSyntaxThemeCatalogStore.getState().applyImport()
    await useSyntaxThemeCatalogStore.getState().load('/new')
    importMutation.resolve(EMPTY_CATALOG)
    await apply

    expect(listSyntaxThemesMock).toHaveBeenNthCalledWith(1, '/new')
    expect(listSyntaxThemesMock).toHaveBeenNthCalledWith(2, '/new')
    expect(useSyntaxThemeCatalogStore.getState()).toMatchObject({
      activeProjectPath: '/new',
      loadedProjectPath: '/new',
      appearances: REFRESHED_CATALOG.appearances,
      preview: null,
      loading: false,
    })
  })

  it('does not restore a stale catalog after the active project changes', async () => {
    const oldCatalog = deferred<SyntaxResourceCatalog>()
    const newCatalog = {
      ...EMPTY_CATALOG,
      appearances: [
        {
          id: 'project:new',
          packageId: 'project:package',
          revision: 'new-revision',
          label: 'New project appearance',
          variant: 'dark',
          scope: 'project',
          format: 'openwaggle',
          sourcePath: '/new/.openwaggle/appearance.json',
          tokens: {},
          original: {},
        },
      ],
    } satisfies SyntaxResourceCatalog
    listSyntaxThemesMock.mockImplementation((projectPath: string | null | undefined) =>
      projectPath === '/old' ? oldCatalog.promise : Promise.resolve(newCatalog),
    )

    const loadOld = useSyntaxThemeCatalogStore.getState().load('/old')
    await vi.waitFor(() => expect(listSyntaxThemesMock).toHaveBeenCalledWith('/old'))
    await useSyntaxThemeCatalogStore.getState().load('/new')
    oldCatalog.resolve(EMPTY_CATALOG)
    await loadOld

    expect(useSyntaxThemeCatalogStore.getState()).toMatchObject({
      loadedProjectPath: '/new',
      appearances: newCatalog.appearances,
      loading: false,
    })
  })

  it('does not restore a removed-theme refresh after the active project changes', async () => {
    const oldCatalog = deferred<SyntaxResourceCatalog>()
    listSyntaxThemesMock.mockImplementation((projectPath: string | null | undefined) =>
      projectPath === '/old' ? oldCatalog.promise : Promise.resolve(EMPTY_CATALOG),
    )
    useSyntaxThemeCatalogStore.setState({ loadedProjectPath: '/old' })

    const remove = useSyntaxThemeCatalogStore.getState().remove('theme-id')
    await vi.waitFor(() => {
      expect(listSyntaxThemesMock).toHaveBeenCalledWith('/old')
    })

    await useSyntaxThemeCatalogStore.getState().load('/new')
    oldCatalog.resolve(EMPTY_CATALOG)
    await remove

    expect(useSyntaxThemeCatalogStore.getState()).toMatchObject({
      loadedProjectPath: '/new',
      loading: false,
    })
  })

  it('refreshes the active project after a stale removal mutation succeeds', async () => {
    const removalMutation = deferred<SyntaxResourceCatalog>()
    removeSyntaxThemeMock.mockReturnValue(removalMutation.promise)
    listSyntaxThemesMock
      .mockResolvedValueOnce(EMPTY_CATALOG)
      .mockResolvedValueOnce(REFRESHED_CATALOG)
    useSyntaxThemeCatalogStore.setState({
      activeProjectPath: '/old',
      loadedProjectPath: '/old',
    })

    const remove = useSyntaxThemeCatalogStore.getState().remove('theme-id')
    await useSyntaxThemeCatalogStore.getState().load('/new')
    removalMutation.resolve(EMPTY_CATALOG)
    await remove

    expect(listSyntaxThemesMock).toHaveBeenNthCalledWith(1, '/new')
    expect(listSyntaxThemesMock).toHaveBeenNthCalledWith(2, '/new')
    expect(useSyntaxThemeCatalogStore.getState()).toMatchObject({
      activeProjectPath: '/new',
      loadedProjectPath: '/new',
      appearances: REFRESHED_CATALOG.appearances,
      loading: false,
    })
  })
})

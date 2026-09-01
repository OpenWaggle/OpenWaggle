import type {
  SyntaxResourceCatalog,
  SyntaxThemeImportPreview,
} from '@shared/types/syntax-resources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applySyntaxThemeImportMock,
  activatableLanguagesMock,
  listSyntaxThemesMock,
  removeSyntaxThemeMock,
  registerLanguagesMock,
  registerThemesMock,
} = vi.hoisted(() => ({
  applySyntaxThemeImportMock: vi.fn(),
  activatableLanguagesMock: vi.fn(),
  listSyntaxThemesMock: vi.fn(),
  removeSyntaxThemeMock: vi.fn(),
  registerLanguagesMock: vi.fn(),
  registerThemesMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    applySyntaxThemeImport: applySyntaxThemeImportMock,
    listSyntaxThemes: listSyntaxThemesMock,
    removeSyntaxTheme: removeSyntaxThemeMock,
  },
}))

vi.mock('@/shared/lib/syntax/language-registry', () => ({
  activatableSyntaxLanguageResources: activatableLanguagesMock,
  registerImportedSyntaxLanguageResources: vi.fn(),
}))

vi.mock('@/shared/lib/syntax/pierre-syntax', () => ({
  setImportedPierreSyntaxResources: vi.fn(),
}))

vi.mock('@/shared/lib/syntax/syntax-service', () => ({
  syntaxService: {
    registerLanguages: registerLanguagesMock,
    registerThemes: registerThemesMock,
  },
}))

vi.mock('@/shared/lib/syntax/syntax-theme-runtime', () => ({
  setRuntimeSyntaxThemeResources: vi.fn(),
}))

vi.mock('@/shared/lib/syntax/theme-registry', () => ({
  registerImportedSyntaxThemeResources: vi.fn(),
}))

vi.mock('@/shared/lib/syntax/validate-imported-languages', () => ({
  validateImportedSyntaxLanguages: vi.fn(),
}))

import { useSyntaxThemeCatalogStore } from '../syntax-theme-store'

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
    activatableLanguagesMock.mockImplementation((languages: readonly unknown[]) => languages)
    applySyntaxThemeImportMock.mockResolvedValue(EMPTY_CATALOG)
    removeSyntaxThemeMock.mockResolvedValue(EMPTY_CATALOG)
    useSyntaxThemeCatalogStore.setState({
      resources: [],
      languages: [],
      appearances: [],
      preview: null,
      loading: false,
      error: null,
      activeProjectPath: undefined,
      loadedProjectPath: undefined,
    })
  })

  it('retains disabled project grammars in the settings catalog', async () => {
    const projectLanguage = {
      id: 'project:typescript',
      packageId: 'project:package',
      revision: 'revision-1',
      label: 'Project TypeScript',
      languageId: 'typescript',
      scope: 'project',
      format: 'openwaggle',
      sourcePath: '/project/.openwaggle/languages/typescript.json',
      engine: 'javascript',
      registration: {
        name: 'typescript',
        displayName: 'Project TypeScript',
        scopeName: 'source.ts',
        aliases: [],
        fileExtensions: ['.ts'],
        fileNames: [],
        embeddedLanguages: {},
        injectTo: [],
        grammar: {},
      },
      original: {},
    } satisfies SyntaxResourceCatalog['languages'][number]
    const catalog = { ...EMPTY_CATALOG, languages: [projectLanguage] }
    listSyntaxThemesMock.mockResolvedValue(catalog)
    activatableLanguagesMock.mockReturnValue([])

    await useSyntaxThemeCatalogStore.getState().load('/project')

    expect(activatableLanguagesMock).toHaveBeenCalledWith([projectLanguage])
    expect(useSyntaxThemeCatalogStore.getState().languages).toEqual([projectLanguage])
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

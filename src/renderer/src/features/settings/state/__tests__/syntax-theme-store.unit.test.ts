import type {
  SyntaxResourceCatalog,
  SyntaxThemeImportPreview,
} from '@shared/types/syntax-resources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applySyntaxThemeImportMock,
  listSyntaxThemesMock,
  removeSyntaxThemeMock,
  registerLanguagesMock,
  registerThemesMock,
} = vi.hoisted(() => ({
  applySyntaxThemeImportMock: vi.fn(),
  listSyntaxThemesMock: vi.fn(),
  removeSyntaxThemeMock: vi.fn(),
  registerLanguagesMock: vi.fn(),
  registerThemesMock: vi.fn(),
}))

function activateLanguages<T>(languages: readonly T[]) {
  return languages
}

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    applySyntaxThemeImport: applySyntaxThemeImportMock,
    listSyntaxThemes: listSyntaxThemesMock,
    removeSyntaxTheme: removeSyntaxThemeMock,
  },
}))

vi.mock('@/shared/lib/syntax/language-registry', () => ({
  activatableSyntaxLanguageResources: activateLanguages,
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
    useSyntaxThemeCatalogStore.setState({
      resources: [],
      languages: [],
      appearances: [],
      preview: null,
      loading: false,
      error: null,
      loadedProjectPath: undefined,
    })
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
})

import type {
  SyntaxAppearanceResource,
  SyntaxLanguageResource,
  SyntaxResourceCatalog,
  SyntaxThemeImportPreview,
  SyntaxThemeResource,
} from '@shared/types/syntax-resources'
import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'
import {
  activatableSyntaxLanguageResources,
  registerImportedSyntaxLanguageResources,
} from '@/shared/lib/syntax/language-registry'
import { setImportedPierreSyntaxResources } from '@/shared/lib/syntax/pierre-syntax'
import { syntaxService } from '@/shared/lib/syntax/syntax-service'
import { setRuntimeSyntaxThemeResources } from '@/shared/lib/syntax/syntax-theme-runtime'
import { registerImportedSyntaxThemeResources } from '@/shared/lib/syntax/theme-registry'
import { validateImportedSyntaxLanguages } from '@/shared/lib/syntax/validate-imported-languages'

interface SyntaxThemeCatalogState {
  readonly resources: readonly SyntaxThemeResource[]
  readonly languages: readonly SyntaxLanguageResource[]
  readonly appearances: readonly SyntaxAppearanceResource[]
  readonly preview: SyntaxThemeImportPreview | null
  readonly loading: boolean
  readonly error: string | null
  readonly loadedProjectPath: string | null | undefined
  load: (projectPath?: string | null) => Promise<void>
  selectImport: () => Promise<void>
  applyImport: () => Promise<void>
  cancelImport: () => void
  remove: (themeId: string) => Promise<void>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

let latestCatalogLoad = 0
let registeredResourceKey = 'themes:|languages:'

function catalogLanguages(catalog: SyntaxResourceCatalog) {
  // Imports are validated before they are persisted. Re-validating the entire installed
  // catalog would eagerly start the syntax worker and parse every grammar during ordinary app
  // startup or file navigation. Runtime failures remain isolated by the syntax quarantine.
  return activatableSyntaxLanguageResources(catalog.languages)
}

function registerResources(
  catalog: SyntaxResourceCatalog,
  languages: readonly SyntaxLanguageResource[],
) {
  const nextResourceKey = [
    `themes:${catalog.themes
      .map((resource) => `${String(resource.id)}@${resource.revision}`)
      .sort()
      .join(',')}`,
    `languages:${languages
      .map((resource) => `${resource.id}@${resource.revision}`)
      .sort()
      .join(',')}`,
  ].join('|')
  if (nextResourceKey === registeredResourceKey) return
  registeredResourceKey = nextResourceKey
  registerImportedSyntaxThemeResources(catalog.themes)
  setImportedPierreSyntaxResources(catalog.themes, languages)
  setRuntimeSyntaxThemeResources(catalog.themes)
  syntaxService.registerThemes(catalog.themes.map((resource) => resource.theme))
  syntaxService.registerLanguages(languages)
  registerImportedSyntaxLanguageResources(languages)
}

function globalCatalog(state: SyntaxThemeCatalogState): SyntaxResourceCatalog {
  return {
    themes: state.resources.filter((resource) => resource.scope !== 'project'),
    languages: state.languages.filter((resource) => resource.scope !== 'project'),
    appearances: state.appearances.filter((resource) => resource.scope !== 'project'),
  }
}

export const useSyntaxThemeCatalogStore = create<SyntaxThemeCatalogState>((set, get) => ({
  resources: [],
  languages: [],
  appearances: [],
  preview: null,
  loading: false,
  error: null,
  loadedProjectPath: undefined,
  load: async (projectPath = null) => {
    if (get().loadedProjectPath === projectPath) return
    latestCatalogLoad += 1
    const loadId = latestCatalogLoad
    const current = get()
    if (current.loadedProjectPath !== undefined) {
      const global = globalCatalog(current)
      const languages = activatableSyntaxLanguageResources(global.languages)
      registerResources(global, languages)
      set({
        resources: global.themes,
        languages,
        appearances: global.appearances,
        loadedProjectPath: undefined,
      })
    }
    set({ loading: true, error: null })
    try {
      const catalog = await api.listSyntaxThemes(projectPath)
      if (loadId !== latestCatalogLoad) return
      const languages = catalogLanguages(catalog)
      registerResources(catalog, languages)
      set({
        resources: catalog.themes,
        languages,
        appearances: catalog.appearances,
        loading: false,
        loadedProjectPath: projectPath,
      })
    } catch (error) {
      if (loadId !== latestCatalogLoad) return
      set({ loading: false, error: errorMessage(error) })
    }
  },
  selectImport: async () => {
    set({ loading: true, error: null })
    try {
      const preview = await api.selectSyntaxThemeImport()
      if (preview) await validateImportedSyntaxLanguages(preview.languages)
      set({ preview, loading: false })
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },
  applyImport: async () => {
    const preview = get().preview
    if (!preview) return
    const projectPath = get().loadedProjectPath
    set({ loading: true, error: null })
    try {
      await api.applySyntaxThemeImport(preview.token)
      const catalog = await api.listSyntaxThemes(projectPath)
      const languages = catalogLanguages(catalog)
      registerResources(catalog, languages)
      set({
        resources: catalog.themes,
        languages,
        appearances: catalog.appearances,
        preview: null,
        loading: false,
        loadedProjectPath: projectPath,
      })
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },
  cancelImport: () => set({ preview: null }),
  remove: async (themeId) => {
    const projectPath = get().loadedProjectPath
    set({ loading: true, error: null })
    try {
      await api.removeSyntaxTheme(themeId)
      const catalog = await api.listSyntaxThemes(projectPath)
      const languages = catalogLanguages(catalog)
      registerResources(catalog, languages)
      set({
        resources: catalog.themes,
        languages,
        appearances: catalog.appearances,
        loading: false,
        loadedProjectPath: projectPath,
      })
    } catch (error) {
      set({ loading: false, error: errorMessage(error) })
    }
  },
}))

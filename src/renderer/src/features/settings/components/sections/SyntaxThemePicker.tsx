import {
  BUNDLED_SYNTAX_THEMES,
  DEFAULT_SYNTAX_THEME_SELECTIONS,
  SYNTAX_APPEARANCE_VARIANTS,
  type SyntaxAppearanceVariant,
  type SyntaxThemeId,
  type SyntaxThemePreviewPalette,
} from '@shared/types/syntax'
import type {
  SyntaxAppearanceResource,
  SyntaxLanguageResource,
  SyntaxThemeResource,
} from '@shared/types/syntax-resources'
import { Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useActiveWorkingPath } from '@/features/git/hooks'
import { usePreferencesStore } from '@/features/settings/state'
import { useSyntaxThemeCatalogStore } from '@/features/settings/state/syntax-theme-store'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { api } from '@/shared/lib/ipc'
import { syntaxLanguageResourceActivations } from '@/shared/lib/syntax/language-registry'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { SyntaxThemeCatalog } from './SyntaxThemeCatalog'
import { InstalledSyntaxResources, SyntaxImportStatus } from './SyntaxThemePickerParts'
import type { SyntaxThemeOption } from './SyntaxThemePickerTypes'
import { SyntaxVariantTabs } from './SyntaxThemeProfileCards'

const REVISION_PREVIEW_LENGTH = 8

function importedThemePreview(resource: SyntaxThemeResource) {
  const fallback = BUNDLED_SYNTAX_THEMES.find(
    (theme) => theme.variant === resource.variant,
  )?.preview
  if (!fallback) return BUNDLED_SYNTAX_THEMES[0].preview
  const accents: string[] = []
  const seenAccents = new Set<string>()
  for (const rule of resource.theme.settings) {
    const foreground = rule.settings.foreground
    if (!foreground || seenAccents.has(foreground)) continue
    seenAccents.add(foreground)
    accents.push(foreground)
  }

  return {
    background: resource.theme.colors['editor.background'] ?? fallback.background,
    foreground: resource.theme.colors['editor.foreground'] ?? fallback.foreground,
    accents: [
      accents[0] ?? fallback.accents[0],
      accents[1] ?? fallback.accents[1],
      accents[2] ?? fallback.accents[2],
      accents[3] ?? fallback.accents[3],
    ],
  } satisfies SyntaxThemePreviewPalette
}

function useSyntaxThemePickerState() {
  const selections = usePreferencesStore((state) => state.settings.syntaxThemeSelections)
  const activeSyntaxTheme = useSyntaxTheme()
  const setSyntaxTheme = usePreferencesStore((state) => state.setSyntaxTheme)
  const workingPath = useActiveWorkingPath()
  const resources = useSyntaxThemeCatalogStore((state) => state.resources)
  const languages = useSyntaxThemeCatalogStore((state) => state.languages)
  const appearances = useSyntaxThemeCatalogStore((state) => state.appearances)
  const preview = useSyntaxThemeCatalogStore((state) => state.preview)
  const loading = useSyntaxThemeCatalogStore((state) => state.loading)
  const error = useSyntaxThemeCatalogStore((state) => state.error)
  const load = useSyntaxThemeCatalogStore((state) => state.load)
  const selectImport = useSyntaxThemeCatalogStore((state) => state.selectImport)
  const applyImport = useSyntaxThemeCatalogStore((state) => state.applyImport)
  const cancelImport = useSyntaxThemeCatalogStore((state) => state.cancelImport)
  const removeImport = useSyntaxThemeCatalogStore((state) => state.remove)
  const [variant, setVariant] = useState<SyntaxAppearanceVariant>(activeSyntaxTheme.variant)
  const [query, setQuery] = useState('')
  const [previewThemeId, setPreviewThemeId] = useState<SyntaxThemeId>(selections.dark)
  const selectedThemeId = selections[variant]

  useEffect(() => setPreviewThemeId(selectedThemeId), [selectedThemeId])
  useEffect(() => {
    void load(workingPath)
  }, [load, workingPath])

  const allThemes = useMemo<readonly SyntaxThemeOption[]>(() => {
    return [
      ...BUNDLED_SYNTAX_THEMES.map((theme) => ({ ...theme, scope: 'bundled' as const })),
      ...resources.map((resource) => ({
        id: resource.id,
        shikiTheme: resource.theme.name,
        label: resource.label,
        variant: resource.variant,
        description: `${resource.scope === 'project' ? 'Project' : 'Imported'} · ${resource.format} · ${resource.revision.slice(0, REVISION_PREVIEW_LENGTH)}`,
        scope: resource.scope,
        preview: importedThemePreview(resource),
      })),
    ]
  }, [resources])
  const themes = useMemo<readonly SyntaxThemeOption[]>(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return allThemes
      .filter(
        (theme) =>
          !normalizedQuery ||
          `${theme.label} ${theme.description} ${theme.shikiTheme}`
            .toLowerCase()
            .includes(normalizedQuery),
      )
      .sort((left, right) => {
        const leftRank = left.variant === variant ? 0 : 1
        const rightRank = right.variant === variant ? 0 : 1
        return leftRank - rightRank || left.label.localeCompare(right.label)
      })
  }, [allThemes, query, variant])
  const languageActivations = syntaxLanguageResourceActivations(languages)
  const previewTheme = allThemes.find((theme) => theme.id === previewThemeId) ??
    allThemes.find((theme) => theme.id === selectedThemeId) ?? {
      ...BUNDLED_SYNTAX_THEMES[0],
      scope: 'bundled' as const,
    }

  return {
    selections,
    setSyntaxTheme,
    languageActivations,
    appearances,
    preview,
    loading,
    error,
    selectImport,
    applyImport,
    cancelImport,
    removeImport,
    variant,
    setVariant,
    query,
    setQuery,
    previewThemeId,
    setPreviewThemeId,
    selectedThemeId,
    allThemes,
    themes,
    previewTheme,
  }
}

export function SyntaxThemePicker() {
  const state = useSyntaxThemePickerState()
  const showToast = useUIStore((uiState) => uiState.showToast)

  function runPreferenceAction(action: Promise<void>) {
    void action.catch((error: unknown) => {
      showToast(
        error instanceof Error ? error.message : 'Could not save syntax preference.',
        'error',
      )
    })
  }

  async function removeTheme(theme: SyntaxThemeOption) {
    if (theme.scope !== 'user') return
    const selectedVariants = SYNTAX_APPEARANCE_VARIANTS.filter(
      (appearanceVariant) => state.selections[appearanceVariant] === theme.id,
    )
    const impact =
      selectedVariants.length > 0
        ? ` ${selectedVariants.map((variant) => variant.replaceAll('-', ' ')).join(', ')} will return to the bundled default.`
        : ''
    const confirmed = await api.showConfirm(
      `Remove ${theme.label}?`,
      `The imported resource will be removed from this OpenWaggle profile.${impact}`,
    )
    if (!confirmed) return
    await selectedVariants.reduce<Promise<void>>(
      (previous, appearanceVariant) =>
        previous.then(() =>
          state.setSyntaxTheme(
            appearanceVariant,
            DEFAULT_SYNTAX_THEME_SELECTIONS[appearanceVariant],
          ),
        ),
      Promise.resolve(),
    )
    await state.removeImport(theme.id)
  }

  async function removeResource(resource: SyntaxLanguageResource | SyntaxAppearanceResource) {
    if (resource.scope !== 'user') return
    const confirmed = await api.showConfirm(
      `Remove ${resource.label}?`,
      'The imported resource will be removed from this OpenWaggle profile.',
    )
    if (confirmed) await state.removeImport(resource.id)
  }

  function selectVariant(variant: SyntaxAppearanceVariant, themeId: SyntaxThemeId) {
    state.setVariant(variant)
    state.setPreviewThemeId(themeId)
  }

  return (
    <section className="space-y-4" aria-labelledby="syntax-theme-heading">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 id="syntax-theme-heading" className="text-base font-semibold text-text-primary">
            Color and syntax
          </h3>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            leftIcon={<Upload className="size-3.5" />}
            disabled={state.loading}
            onClick={() => void state.selectImport()}
          >
            Import
          </Button>
        </div>
        <p className="mt-1 text-xs leading-5 text-text-tertiary">
          Choose a code palette for each appearance profile. The same selection follows the editor,
          Markdown, diffs, search, and structured data.
        </p>
      </div>
      <SyntaxImportStatus
        error={state.error}
        preview={state.preview}
        onCancel={state.cancelImport}
        onApply={() => void state.applyImport()}
      />
      <SyntaxVariantTabs
        variant={state.variant}
        selections={state.selections}
        themes={state.allThemes}
        onSelect={selectVariant}
      />
      <SyntaxThemeCatalog
        state={{
          themes: state.themes,
          query: state.query,
          previewTheme: state.previewTheme,
          selectedThemeId: state.selectedThemeId,
          variant: state.variant,
        }}
        actions={{
          onQueryChange: state.setQuery,
          onPreview: state.setPreviewThemeId,
          onSelect: (themeId) => runPreferenceAction(state.setSyntaxTheme(state.variant, themeId)),
          onRemove: (theme) => runPreferenceAction(removeTheme(theme)),
        }}
      />
      <InstalledSyntaxResources
        languages={state.languageActivations}
        appearances={state.appearances}
        onRemove={(resource) => void removeResource(resource)}
      />
      <p className="text-xs text-text-muted">
        Imports accept VS Code JSON/JSONC, TextMate themes and grammars, VSIX or unpacked VS Code
        extensions, and native OpenWaggle packages. Project themes may override matching global
        themes. Project grammars stay disabled when they conflict with bundled or imported language
        identities and file associations.
      </p>
    </section>
  )
}

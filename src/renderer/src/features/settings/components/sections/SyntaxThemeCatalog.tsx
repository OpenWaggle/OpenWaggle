import type { SyntaxAppearanceVariant, SyntaxThemeId } from '@shared/types/syntax'
import { Check, Search, Trash2, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'
import { TextInput } from '@/shared/ui/TextInput'
import { APPEARANCE_LABELS, type SyntaxThemeOption } from './SyntaxThemePickerTypes'
import { SyntaxThemePreview } from './SyntaxThemePreview'
import { ThemeSpecimen } from './SyntaxThemeProfileCards'

interface SyntaxThemeCatalogState {
  readonly themes: readonly SyntaxThemeOption[]
  readonly query: string
  readonly previewTheme: SyntaxThemeOption
  readonly selectedThemeId: SyntaxThemeId
  readonly variant: SyntaxAppearanceVariant
}

interface SyntaxThemeCatalogActions {
  readonly onQueryChange: (query: string) => void
  readonly onPreview: (themeId: SyntaxThemeId) => void
  readonly onSelect: (themeId: SyntaxThemeId) => void
  readonly onRemove: (theme: SyntaxThemeOption) => void
}

function ThemeCard({
  theme,
  selected,
  matchingProfile,
  onPreview,
  onRestorePreview,
  onSelect,
  removeAction,
}: {
  readonly theme: SyntaxThemeOption
  readonly selected: boolean
  readonly matchingProfile: boolean
  readonly onPreview: () => void
  readonly onRestorePreview: () => void
  readonly onSelect: () => void
  readonly removeAction: ReactNode
}) {
  const provenance =
    theme.scope === 'bundled' ? (matchingProfile ? 'For this profile' : 'Bundled') : theme.scope
  return (
    <div className="relative min-w-0">
      <Button
        variant="unstyled"
        type="button"
        aria-label={`${theme.label}, ${APPEARANCE_LABELS[theme.variant]}`}
        aria-pressed={selected}
        title={theme.description}
        onFocus={onPreview}
        onBlur={onRestorePreview}
        onMouseEnter={onPreview}
        onMouseLeave={onRestorePreview}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onRestorePreview()
          }
        }}
        onClick={onSelect}
        className={`group block w-full rounded-lg border p-2 text-left transition-colors ${
          selected
            ? 'border-accent bg-accent/5'
            : 'border-border bg-bg-secondary hover:border-border-light hover:bg-bg-hover'
        }`}
      >
        <ThemeSpecimen palette={theme.preview} />
        <span className="mt-2 flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
            {theme.label}
          </span>
          {selected ? (
            <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent text-bg">
              <Check className="size-3" />
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-text-muted">
          {APPEARANCE_LABELS[theme.variant]} · {provenance}
        </span>
      </Button>
      {removeAction}
    </div>
  )
}

export function SyntaxThemeCatalog({
  state,
  actions,
}: {
  readonly state: SyntaxThemeCatalogState
  readonly actions: SyntaxThemeCatalogActions
}) {
  const mismatch = state.previewTheme.variant !== state.variant
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-bg">
        <div className="flex h-10 items-center gap-2 border-b border-border px-3">
          <Search className="size-3.5 text-text-muted" />
          <TextInput
            variant="transparent"
            inputSize="sm"
            value={state.query}
            onChange={(event) => actions.onQueryChange(event.target.value)}
            placeholder="Search themes"
            aria-label="Search syntax themes"
            className="h-9 px-0 text-xs"
          />
        </div>
        <div className="grid max-h-128 grid-cols-1 gap-2 overflow-auto p-2 sm:grid-cols-2">
          {state.themes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={state.selectedThemeId === theme.id}
              matchingProfile={theme.variant === state.variant}
              onPreview={() => actions.onPreview(theme.id)}
              onRestorePreview={() => actions.onPreview(state.selectedThemeId)}
              onSelect={() => actions.onSelect(theme.id)}
              removeAction={
                theme.scope === 'user' ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-8 top-3 bg-bg/80"
                    aria-label={`Remove ${theme.label}`}
                    title={`Remove ${theme.label}`}
                    onClick={() => actions.onRemove(theme)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                ) : null
              }
            />
          ))}
          {state.themes.length === 0 ? (
            <p className="col-span-full px-4 py-10 text-center text-xs text-text-tertiary">
              No matching themes.
            </p>
          ) : null}
        </div>
      </div>
      <div className="min-w-0 space-y-2 lg:sticky lg:top-0">
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-xs font-medium text-text-primary">
              Live workspace preview
            </span>
            <span className="block text-xs text-text-muted">{state.previewTheme.label}</span>
          </span>
          <span className="flex gap-1" aria-hidden="true">
            {state.previewTheme.preview.accents.map((color) => (
              <span
                key={color}
                className="size-2 rounded-full"
                style={{ backgroundColor: color }}
              />
            ))}
          </span>
        </div>
        <SyntaxThemePreview theme={state.previewTheme.shikiTheme} />
        {mismatch ? (
          <p className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-text-secondary">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" />
            {state.previewTheme.label} was designed for{' '}
            {APPEARANCE_LABELS[state.previewTheme.variant]}. OpenWaggle will keep the original
            palette if you use it here.
          </p>
        ) : null}
      </div>
    </div>
  )
}

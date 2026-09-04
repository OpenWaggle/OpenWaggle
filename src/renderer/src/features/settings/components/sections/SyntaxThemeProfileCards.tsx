import type {
  SyntaxAppearanceVariant,
  SyntaxThemeId,
  SyntaxThemePreviewPalette,
  SyntaxThemeSelections,
} from '@shared/types/syntax'
import { SYNTAX_APPEARANCE_VARIANTS } from '@shared/types/syntax'
import { Contrast, Moon, Sun } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  APPEARANCE_DESCRIPTIONS,
  APPEARANCE_LABELS,
  type SyntaxThemeOption,
} from './SyntaxThemePickerTypes'

function ProfileIcon({ variant }: { readonly variant: SyntaxAppearanceVariant }) {
  if (variant === 'light') return <Sun className="size-3.5" />
  if (variant === 'dark') return <Moon className="size-3.5" />
  return <Contrast className="size-3.5" />
}

export function ThemeSpecimen({ palette }: { readonly palette: SyntaxThemePreviewPalette }) {
  const [keywordColor, typeColor, stringColor, commentColor] = palette.accents
  return (
    <span
      aria-hidden="true"
      className="flex aspect-video overflow-hidden rounded-md border border-border/60"
      style={{ backgroundColor: palette.background, color: palette.foreground }}
    >
      <span className="flex w-1/4 flex-col gap-1.5 border-r border-current/15 p-2">
        <span className="h-1 w-2/3 rounded-full bg-current opacity-30" />
        <span className="h-1 w-full rounded-full bg-current opacity-15" />
        <span className="h-1 w-1/2 rounded-full bg-current opacity-15" />
      </span>
      <span className="flex flex-1 flex-col justify-center gap-2 p-3">
        <span className="flex gap-1.5">
          <span className="h-1.5 w-1/4 rounded-full" style={{ backgroundColor: keywordColor }} />
          <span className="h-1.5 w-1/3 rounded-full" style={{ backgroundColor: typeColor }} />
        </span>
        <span className="h-1.5 w-2/3 rounded-full bg-current opacity-60" />
        <span className="flex gap-1.5 pl-2">
          <span className="h-1.5 w-1/3 rounded-full" style={{ backgroundColor: stringColor }} />
          <span className="h-1.5 w-1/4 rounded-full" style={{ backgroundColor: commentColor }} />
        </span>
        <span className="h-1 w-3/4 rounded-full bg-current opacity-20" />
      </span>
    </span>
  )
}

export function SyntaxVariantTabs({
  variant,
  selections,
  themes,
  onSelect,
}: {
  readonly variant: SyntaxAppearanceVariant
  readonly selections: SyntaxThemeSelections
  readonly themes: readonly SyntaxThemeOption[]
  readonly onSelect: (variant: SyntaxAppearanceVariant, themeId: SyntaxThemeId) => void
}) {
  return (
    <div>
      <div className="mb-3">
        <h4 className="text-sm font-medium text-text-primary">Syntax profiles</h4>
        <p className="mt-0.5 text-xs leading-5 text-text-tertiary">
          Each app appearance remembers its own code palette.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {SYNTAX_APPEARANCE_VARIANTS.map((entry) => {
          const selectedTheme =
            themes.find((theme) => theme.id === selections[entry]) ??
            themes.find((theme) => theme.variant === entry) ??
            themes[0]
          if (!selectedTheme) return null
          const active = variant === entry
          return (
            <Button
              key={entry}
              type="button"
              variant="unstyled"
              aria-label={APPEARANCE_LABELS[entry]}
              aria-pressed={active}
              onClick={() => onSelect(entry, selections[entry])}
              className={`group min-w-0 rounded-lg border p-2 text-left transition-colors ${
                active
                  ? 'border-accent bg-accent/5'
                  : 'border-border bg-bg-secondary hover:border-border-light hover:bg-bg-hover'
              }`}
            >
              <ThemeSpecimen palette={selectedTheme.preview} />
              <span className="mt-2 flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <ProfileIcon variant={entry} />
                <span className="truncate">{APPEARANCE_LABELS[entry]}</span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-text-muted">
                {selectedTheme.label}
              </span>
              <span className="sr-only">{APPEARANCE_DESCRIPTIONS[entry]}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

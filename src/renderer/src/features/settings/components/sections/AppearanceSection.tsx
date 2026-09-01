import type { DiffSyntaxTheme, DiffView } from '@shared/types/settings'
import { DIFF_SYNTAX_THEMES, DIFF_VIEWS } from '@shared/types/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import type { SettingsChoice } from './SettingsChoiceGroup'
import { SettingsChoiceGroup } from './SettingsChoiceGroup'
import { SyntaxThemePreview } from './SyntaxThemePreview'

type ChoiceDetails<TValue extends number | string> = Omit<SettingsChoice<TValue>, 'value'>

const DIFF_VIEW_DETAILS: Record<DiffView, ChoiceDetails<DiffView>> = {
  unified: {
    label: 'Unified',
    description: 'One column, additions and deletions interleaved.',
  },
  split: {
    label: 'Split',
    description: 'Side-by-side, old on the left and new on the right.',
  },
}

const SYNTAX_THEME_DETAILS: Record<DiffSyntaxTheme, ChoiceDetails<DiffSyntaxTheme>> = {
  'pierre-dark': {
    label: 'Default',
    description: 'Balanced contrast for everyday review.',
  },
  'pierre-dark-soft': {
    label: 'Soft',
    description: 'Lower contrast, easier on long reading sessions.',
  },
  'pierre-dark-vibrant': {
    label: 'Vibrant',
    description: 'Higher saturation for stronger token separation.',
  },
  'pierre-dark-protanopia-deuteranopia': {
    label: 'Protanopia / deuteranopia safe',
    description: 'Avoids red/green pairs that are hard to distinguish.',
  },
  'pierre-dark-tritanopia': {
    label: 'Tritanopia safe',
    description: 'Avoids blue/yellow pairs that are hard to distinguish.',
  },
}

const DIFF_VIEW_CHOICES: readonly SettingsChoice<DiffView>[] = DIFF_VIEWS.map((value) => ({
  value,
  ...DIFF_VIEW_DETAILS[value],
}))

const SYNTAX_THEME_CHOICES: readonly SettingsChoice<DiffSyntaxTheme>[] = DIFF_SYNTAX_THEMES.map(
  (value) => ({ value, ...SYNTAX_THEME_DETAILS[value] }),
)

const ROW_CLASS =
  'flex w-full items-center justify-between border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-bg-hover'

/**
 * Appearance settings.
 *
 * The Syntax theme sits deliberately outside the Design token contract (ADR 0015
 * amendment): it colours language grammar scopes, not semantic roles, which is
 * why it is user-selectable on its own while the diff chrome follows the app's
 * Appearance. The colour-blind-safe variants are the main reason this is a real
 * setting rather than a constant.
 */
export function AppearanceSection() {
  const diffSyntaxTheme = usePreferencesStore((s) => s.settings.diffSyntaxTheme)
  const diffView = usePreferencesStore((s) => s.settings.diffView)
  const diffWrapLines = usePreferencesStore((s) => s.settings.diffWrapLines)
  const setDiffSyntaxTheme = usePreferencesStore((s) => s.setDiffSyntaxTheme)
  const setDiffView = usePreferencesStore((s) => s.setDiffView)
  const setDiffWrapLines = usePreferencesStore((s) => s.setDiffWrapLines)

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">Diff view</h3>
        <p className="text-xs text-text-tertiary">
          Applies to the diff panel. The panel's own toggles change this same setting.
        </p>
        <SettingsChoiceGroup
          choices={DIFF_VIEW_CHOICES}
          value={diffView}
          onSelect={(view) => void setDiffView(view)}
        />
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">Long lines</h3>
        <div className="overflow-hidden rounded-lg border border-border bg-bg">
          <Button
            variant="unstyled"
            type="button"
            role="switch"
            // Without an explicit name the switch is announced as its whole inner
            // text, description sentence included.
            aria-label="Wrap long lines"
            aria-checked={diffWrapLines}
            onClick={() => void setDiffWrapLines(!diffWrapLines)}
            className={ROW_CLASS}
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium text-text-primary">Wrap long lines</span>
              <span className="text-xs text-text-tertiary">
                Wrap instead of scrolling horizontally, so review controls stay in view.
              </span>
            </div>
            <div
              className={`flex h-4 w-7 shrink-0 items-center rounded-full border px-0.5 transition-colors ${
                diffWrapLines
                  ? 'justify-end border-accent bg-accent/30'
                  : 'justify-start border-border-light'
              }`}
            >
              <div
                className={`size-3 rounded-full ${diffWrapLines ? 'bg-accent' : 'bg-text-muted'}`}
              />
            </div>
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-base font-semibold text-text-primary">Syntax theme</h3>
        <p className="text-xs text-text-tertiary">
          Colours code text inside diffs. The panel's own colours follow the app appearance.
        </p>
        <SyntaxThemePreview theme={diffSyntaxTheme} />
        <SettingsChoiceGroup
          choices={SYNTAX_THEME_CHOICES}
          value={diffSyntaxTheme}
          onSelect={(theme) => void setDiffSyntaxTheme(theme)}
        />
      </div>
    </div>
  )
}

import type { DiffSyntaxTheme, DiffView } from '@shared/types/settings'
import { DIFF_SYNTAX_THEMES, DIFF_VIEWS } from '@shared/types/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { SyntaxThemePreview } from './SyntaxThemePreview'

const SYNTAX_THEME_LABELS: Record<DiffSyntaxTheme, string> = {
  'pierre-dark': 'Default',
  'pierre-dark-soft': 'Soft',
  'pierre-dark-vibrant': 'Vibrant',
  'pierre-dark-protanopia-deuteranopia': 'Protanopia / deuteranopia safe',
  'pierre-dark-tritanopia': 'Tritanopia safe',
}

const SYNTAX_THEME_DESCRIPTIONS: Record<DiffSyntaxTheme, string> = {
  'pierre-dark': 'Balanced contrast for everyday review.',
  'pierre-dark-soft': 'Lower contrast, easier on long reading sessions.',
  'pierre-dark-vibrant': 'Higher saturation for stronger token separation.',
  'pierre-dark-protanopia-deuteranopia': 'Avoids red/green pairs that are hard to distinguish.',
  'pierre-dark-tritanopia': 'Avoids blue/yellow pairs that are hard to distinguish.',
}

const DIFF_VIEW_LABELS: Record<DiffView, string> = {
  unified: 'Unified',
  split: 'Split',
}

const DIFF_VIEW_DESCRIPTIONS: Record<DiffView, string> = {
  unified: 'One column, additions and deletions interleaved.',
  split: 'Side-by-side, old on the left and new on the right.',
}

const ROW_CLASS =
  'flex w-full items-center justify-between border-b border-border px-5 py-3 text-left last:border-b-0 hover:bg-bg-hover'

function RadioDot({ active }: { readonly active: boolean }) {
  return (
    <div
      className={`size-3 shrink-0 rounded-full border ${active ? 'border-accent bg-accent' : 'border-border-light'}`}
    />
  )
}

/**
 * Appearance settings.
 *
 * The Syntax theme sits deliberately outside the Design token contract (ADR 0013
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
        <h3 className="text-[16px] font-semibold text-text-primary">Diff view</h3>
        <p className="text-[12px] text-text-tertiary">
          Applies to the diff panel. The panel's own toggles change this same setting.
        </p>
        <div className="overflow-hidden rounded-lg border border-border bg-diff-header-bg">
          {DIFF_VIEWS.map((view) => (
            <Button
              variant="unstyled"
              type="button"
              key={view}
              aria-pressed={diffView === view}
              onClick={() => void setDiffView(view)}
              className={ROW_CLASS}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-text-primary">
                  {DIFF_VIEW_LABELS[view]}
                </span>
                <span className="text-[12px] text-text-tertiary">
                  {DIFF_VIEW_DESCRIPTIONS[view]}
                </span>
              </div>
              <RadioDot active={diffView === view} />
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-[16px] font-semibold text-text-primary">Long lines</h3>
        <div className="overflow-hidden rounded-lg border border-border bg-diff-header-bg">
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
              <span className="text-[13px] font-medium text-text-primary">Wrap long lines</span>
              <span className="text-[12px] text-text-tertiary">
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
        <h3 className="text-[16px] font-semibold text-text-primary">Syntax theme</h3>
        <p className="text-[12px] text-text-tertiary">
          Colours code text inside diffs. The panel's own colours follow the app appearance.
        </p>
        <SyntaxThemePreview theme={diffSyntaxTheme} />
        <div className="overflow-hidden rounded-lg border border-border bg-diff-header-bg">
          {DIFF_SYNTAX_THEMES.map((theme) => (
            <Button
              variant="unstyled"
              type="button"
              key={theme}
              aria-pressed={diffSyntaxTheme === theme}
              onClick={() => void setDiffSyntaxTheme(theme)}
              className={ROW_CLASS}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[13px] font-medium text-text-primary">
                  {SYNTAX_THEME_LABELS[theme]}
                </span>
                <span className="text-[12px] text-text-tertiary">
                  {SYNTAX_THEME_DESCRIPTIONS[theme]}
                </span>
              </div>
              <RadioDot active={diffSyntaxTheme === theme} />
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

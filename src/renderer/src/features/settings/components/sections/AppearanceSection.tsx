import type { DiffView } from '@shared/types/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch'
import { SyntaxThemePicker } from './SyntaxThemePicker'
import { TypographySettings } from './TypographySettings'

const DIFF_VIEW_LABELS: Record<DiffView, string> = {
  unified: 'Unified',
  split: 'Side by side',
}

function ReviewAppearanceSettings() {
  const diffView = usePreferencesStore((state) => state.settings.diffView)
  const diffWrapLines = usePreferencesStore((state) => state.settings.diffWrapLines)
  const setDiffView = usePreferencesStore((state) => state.setDiffView)
  const setDiffWrapLines = usePreferencesStore((state) => state.setDiffWrapLines)

  return (
    <section className="space-y-3" aria-labelledby="review-appearance-heading">
      <div>
        <h3 id="review-appearance-heading" className="text-base font-semibold text-text-primary">
          Review presentation
        </h3>
        <p className="mt-1 text-xs leading-5 text-text-tertiary">
          Keep code review readable without changing the underlying patch.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-bg">
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <span>
            <span className="block text-xs font-medium text-text-primary">Diff layout</span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Choose a compact stream or compare both versions.
            </span>
          </span>
          <div className="flex rounded-md border border-border bg-bg-secondary p-0.5">
            {(['unified', 'split'] as const).map((view) => (
              <Button
                key={view}
                type="button"
                size="xs"
                variant={diffView === view ? 'subtle' : 'ghost'}
                aria-pressed={diffView === view}
                onClick={() => void setDiffView(view)}
              >
                {DIFF_VIEW_LABELS[view]}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <span>
            <span className="block text-xs font-medium text-text-primary">Wrap long lines</span>
            <span className="mt-0.5 block text-xs text-text-muted">
              Keep review controls visible instead of scrolling horizontally.
            </span>
          </span>
          <ToggleSwitch
            checked={diffWrapLines}
            onCheckedChange={(checked) => void setDiffWrapLines(checked)}
            label="Wrap long lines"
            size="compact"
          />
        </div>
      </div>
    </section>
  )
}

function AccessibilityAppearanceSettings() {
  const motion = usePreferencesStore((state) => state.settings.appearancePreferences.motion)
  const setMotion = usePreferencesStore((state) => state.setAppearanceMotion)
  const reduced = motion === 'reduced'

  return (
    <section className="space-y-3" aria-labelledby="accessibility-appearance-heading">
      <div>
        <h3
          id="accessibility-appearance-heading"
          className="text-base font-semibold text-text-primary"
        >
          Accessibility
        </h3>
        <p className="mt-1 text-xs leading-5 text-text-tertiary">
          High-contrast syntax profiles stay independent, so accessibility choices do not replace a
          preferred everyday theme.
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-bg px-4 py-3">
        <span>
          <span className="block text-xs font-medium text-text-primary">Reduce motion</span>
          <span className="mt-0.5 block text-xs text-text-muted">
            Follow the operating system by default, or always minimize app animation.
          </span>
        </span>
        <ToggleSwitch
          checked={reduced}
          onCheckedChange={(checked) => void setMotion(checked ? 'reduced' : 'system')}
          label="Reduce motion"
          size="compact"
        />
      </div>
    </section>
  )
}

export function AppearanceSection() {
  return (
    <div className="mx-auto max-w-6xl space-y-9 pb-10">
      <header className="max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">Appearance</h2>
        <p className="mt-1.5 text-sm leading-6 text-text-tertiary">
          Tune the workspace for reading, editing, reviewing, and terminal work. Theme packages
          provide the base; these preferences stay yours across projects and worktrees.
        </p>
      </header>
      <SyntaxThemePicker />
      <TypographySettings />
      <ReviewAppearanceSettings />
      <AccessibilityAppearanceSettings />
    </div>
  )
}

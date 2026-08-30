import {
  type AppearanceTypographyPreferences,
  DEFAULT_APPEARANCE_TYPOGRAPHY,
} from '@shared/types/appearance-preferences'
import { RotateCcw } from 'lucide-react'
import { usePreferencesStore } from '@/features/settings/state'
import { Button } from '@/shared/ui/Button'
import { TypographyControls } from './TypographyControls'
import { TypographyFontCards } from './TypographyFontCards'

export function TypographySettings() {
  const typography = usePreferencesStore((state) => state.settings.appearancePreferences.typography)
  const setTypography = usePreferencesStore((state) => state.setAppearanceTypography)

  function update(patch: Partial<AppearanceTypographyPreferences>) {
    void setTypography(patch)
  }

  return (
    <section className="space-y-3" aria-labelledby="typography-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="typography-heading" className="text-base font-semibold text-text-primary">
            Typography
          </h3>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">
            Choose a familiar font for each part of the workspace. The sample updates immediately;
            custom CSS font-family stacks remain available from each menu.
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          leftIcon={<RotateCcw className="size-3.5" />}
          onClick={() => void setTypography(DEFAULT_APPEARANCE_TYPOGRAPHY)}
        >
          Reset
        </Button>
      </div>
      <TypographyFontCards typography={typography} onUpdate={update} />
      <TypographyControls typography={typography} onUpdate={update} />
    </section>
  )
}

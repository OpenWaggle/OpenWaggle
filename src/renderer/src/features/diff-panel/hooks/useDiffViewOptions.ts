import type { DiffView } from '@shared/types/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import type { DiffViewOptions } from '../components/DiffCodeView'

/**
 * Diff view preferences, read straight from persisted settings.
 *
 * Write-through by design (ADR 0016): the in-panel toggles mutate the persisted
 * setting rather than a local copy, so the Settings screen and the panel can
 * never disagree and a toggle cannot silently revert on reload.
 */
export function useDiffViewOptions() {
  const { shikiTheme } = useSyntaxTheme()
  const diffView = usePreferencesStore((s) => s.settings.diffView)
  const diffWrapLines = usePreferencesStore((s) => s.settings.diffWrapLines)
  const setDiffView = usePreferencesStore((s) => s.setDiffView)
  const setDiffWrapLines = usePreferencesStore((s) => s.setDiffWrapLines)

  const viewOptions: DiffViewOptions = {
    syntaxTheme: shikiTheme,
    diffView,
    wrapLines: diffWrapLines,
  }

  return {
    viewOptions,
    setDiffView: (view: DiffView) => void setDiffView(view),
    toggleWrapLines: () => void setDiffWrapLines(!diffWrapLines),
  }
}

import type { DiffView } from '@shared/types/settings'
import { usePreferencesStore } from '@/features/settings/state'
import { useSyntaxTheme } from '@/shared/hooks/useSyntaxTheme'
import { createRendererLogger } from '@/shared/lib/logger'
import type { DiffViewOptions } from '../components/DiffCodeView'

const logger = createRendererLogger('diff-view')

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

  /*
   * The panel fires these with `void`, so a transient Settings IPC failure would otherwise
   * float as an unhandled renderer rejection (Sentry issue OPENWAGGLE-6). The store keeps the
   * previous value, so the failure is logged and the next toggle retries it.
   */
  return {
    viewOptions,
    setDiffView: (view: DiffView) =>
      void setDiffView(view).catch((error: unknown) => {
        logger.warn('Failed to change the diff view', { error: String(error) })
      }),
    toggleWrapLines: () =>
      void setDiffWrapLines(!diffWrapLines).catch((error: unknown) => {
        logger.warn('Failed to change line wrapping', { error: String(error) })
      }),
  }
}

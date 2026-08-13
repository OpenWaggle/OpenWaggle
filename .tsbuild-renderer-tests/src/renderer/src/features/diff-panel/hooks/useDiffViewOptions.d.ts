import type { DiffSyntaxTheme, DiffView } from '@shared/types/settings';
import type { DiffViewOptions } from '../components/DiffCodeView';
/**
 * Diff view preferences, read straight from persisted settings.
 *
 * Write-through by design (ADR 0014): the in-panel toggles mutate the persisted
 * setting rather than a local copy, so the Settings screen and the panel can
 * never disagree and a toggle cannot silently revert on reload.
 */
export declare function useDiffViewOptions(): {
    viewOptions: DiffViewOptions;
    setSyntaxTheme: (theme: DiffSyntaxTheme) => undefined;
    setDiffView: (view: DiffView) => undefined;
    toggleWrapLines: () => undefined;
};

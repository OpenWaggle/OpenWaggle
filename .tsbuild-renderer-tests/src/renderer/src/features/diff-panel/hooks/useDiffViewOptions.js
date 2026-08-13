import { usePreferencesStore } from '@/features/settings/state';
/**
 * Diff view preferences, read straight from persisted settings.
 *
 * Write-through by design (ADR 0014): the in-panel toggles mutate the persisted
 * setting rather than a local copy, so the Settings screen and the panel can
 * never disagree and a toggle cannot silently revert on reload.
 */
export function useDiffViewOptions() {
    const diffSyntaxTheme = usePreferencesStore((s) => s.settings.diffSyntaxTheme);
    const diffView = usePreferencesStore((s) => s.settings.diffView);
    const diffWrapLines = usePreferencesStore((s) => s.settings.diffWrapLines);
    const setDiffSyntaxTheme = usePreferencesStore((s) => s.setDiffSyntaxTheme);
    const setDiffView = usePreferencesStore((s) => s.setDiffView);
    const setDiffWrapLines = usePreferencesStore((s) => s.setDiffWrapLines);
    const viewOptions = {
        syntaxTheme: diffSyntaxTheme,
        diffView,
        wrapLines: diffWrapLines,
    };
    return {
        viewOptions,
        setSyntaxTheme: (theme) => void setDiffSyntaxTheme(theme),
        setDiffView: (view) => void setDiffView(view),
        toggleWrapLines: () => void setDiffWrapLines(!diffWrapLines),
    };
}

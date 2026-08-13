import { jsx as _jsx } from "react/jsx-runtime";
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreferencesStore } from '@/features/settings/state';
import { AppearanceSection } from '../sections/AppearanceSection';
vi.mock('@/shared/lib/ipc', () => ({
    api: { updateSettings: vi.fn().mockResolvedValue(undefined) },
}));
describe('Appearance settings', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        usePreferencesStore.setState({
            ...usePreferencesStore.getInitialState(),
        });
    });
    it('shows the current diff view, wrap, and syntax theme selections', () => {
        render(_jsx(AppearanceSection, {}));
        // Defaults: unified, no wrap, default syntax theme.
        expect(screen.getByRole('button', { name: /Unified/ })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /Split/ })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('switch', { name: /Wrap long lines/ })).toHaveAttribute('aria-checked', 'false');
    });
    it('offers the colour-blind-safe syntax themes', () => {
        render(_jsx(AppearanceSection, {}));
        expect(screen.getByRole('button', { name: /Protanopia \/ deuteranopia safe/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Tritanopia safe/ })).toBeInTheDocument();
    });
    it('writes the diff view straight to settings', () => {
        const setDiffView = vi.fn().mockResolvedValue(undefined);
        usePreferencesStore.setState({ setDiffView });
        render(_jsx(AppearanceSection, {}));
        fireEvent.click(screen.getByRole('button', { name: /Split/ }));
        expect(setDiffView).toHaveBeenCalledWith('split');
    });
    it('toggles line wrapping through settings rather than local state', () => {
        const setDiffWrapLines = vi.fn().mockResolvedValue(undefined);
        usePreferencesStore.setState({ setDiffWrapLines });
        render(_jsx(AppearanceSection, {}));
        fireEvent.click(screen.getByRole('switch', { name: /Wrap long lines/ }));
        expect(setDiffWrapLines).toHaveBeenCalledWith(true);
    });
    it('selects a syntax theme', () => {
        const setDiffSyntaxTheme = vi.fn().mockResolvedValue(undefined);
        usePreferencesStore.setState({ setDiffSyntaxTheme });
        render(_jsx(AppearanceSection, {}));
        fireEvent.click(screen.getByRole('button', { name: /Tritanopia safe/ }));
        expect(setDiffSyntaxTheme).toHaveBeenCalledWith('pierre-dark-tritanopia');
    });
});

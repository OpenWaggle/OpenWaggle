import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const useSettingsSetupMock = vi.fn();
const usePreferencesMock = vi.fn();
vi.mock('@/features/settings/hooks/useSettings', () => ({
    useSettingsSetup: () => {
        useSettingsSetupMock();
    },
    usePreferences: () => usePreferencesMock(),
}));
vi.mock('@tanstack/react-router', () => ({
    RouterProvider: () => _jsx("div", { "data-testid": "router-provider", children: "router" }),
}));
vi.mock('@/router', () => ({
    router: {},
}));
import { App } from '../App';
describe('App', () => {
    beforeEach(() => {
        useSettingsSetupMock.mockReset();
        usePreferencesMock.mockReset();
        usePreferencesMock.mockReturnValue({ isLoaded: true });
    });
    it('renders loading view before preferences are loaded', () => {
        usePreferencesMock.mockReturnValue({ isLoaded: false });
        render(_jsx(App, {}));
        expect(screen.queryByTestId('router-provider')).toBeNull();
        expect(screen.getByText('Loading…')).toBeInTheDocument();
    });
    it('renders the route tree after preferences are loaded', () => {
        render(_jsx(App, {}));
        expect(screen.getByTestId('router-provider')).toBeInTheDocument();
    });
});

import { jsx as _jsx } from "react/jsx-runtime";
import { useRouterState } from '@tanstack/react-router';
import { AppSettingsView } from '@/features/settings/components';
import { SETTINGS_TABS } from '@/shell/ui-store';
const SETTINGS_PATH_PREFIX = '/settings/';
function isSettingsTab(value) {
    return SETTINGS_TABS.some((candidate) => candidate === value);
}
function settingsTabFromPathname(pathname) {
    if (!pathname.startsWith(SETTINGS_PATH_PREFIX)) {
        return null;
    }
    const candidate = pathname.slice(SETTINGS_PATH_PREFIX.length).split('/')[0];
    return candidate && isSettingsTab(candidate) ? candidate : null;
}
export function SettingsRouteSurface({ tab }) {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    const effectiveTab = settingsTabFromPathname(pathname) ?? tab;
    return _jsx(AppSettingsView, { activeTab: effectiveTab });
}

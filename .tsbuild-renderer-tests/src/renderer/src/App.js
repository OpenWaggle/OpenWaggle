import { jsx as _jsx } from "react/jsx-runtime";
import { RouterProvider } from '@tanstack/react-router';
import { usePreferences, useSettingsSetup } from '@/features/settings/hooks';
import { router } from '@/router';
function AppLoadingView() {
    return (_jsx("div", { className: "flex h-full items-center justify-center bg-bg", children: _jsx("div", { className: "text-text-tertiary text-sm", children: "Loading\u2026" }) }));
}
export function App() {
    useSettingsSetup();
    const { isLoaded } = usePreferences();
    if (!isLoaded) {
        return _jsx(AppLoadingView, {});
    }
    return _jsx(RouterProvider, { router: router });
}

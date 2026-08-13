import { jsx as _jsx } from "react/jsx-runtime";
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
export function AppSettingsView({ activeTab }) {
    return (_jsx("div", { className: "absolute inset-0 z-50 flex size-full overflow-hidden bg-bg", children: _jsx(PanelErrorBoundary, { name: "Settings", className: "flex flex-1 overflow-hidden", children: _jsx(SettingsPage, { activeTab: activeTab }) }) }));
}

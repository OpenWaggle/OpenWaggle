import { jsx as _jsx } from "react/jsx-runtime";
import { createFileRoute } from '@tanstack/react-router';
import { SettingsRouteSurface } from './-settings-route-surface';
export const Route = createFileRoute('/settings')({
    component: SettingsRouteView,
});
function SettingsRouteView() {
    return _jsx(SettingsRouteSurface, { tab: "general" });
}

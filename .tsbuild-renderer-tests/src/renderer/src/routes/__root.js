import { jsx as _jsx } from "react/jsx-runtime";
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import { WorkspaceShell } from '@/shell';
export const Route = createRootRouteWithContext()({
    component: RootRouteView,
});
function RootRouteView() {
    return (_jsx(WorkspaceShell, { children: _jsx(Outlet, {}) }));
}

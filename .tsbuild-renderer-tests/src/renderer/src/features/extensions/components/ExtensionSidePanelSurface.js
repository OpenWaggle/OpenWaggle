import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PanelRight, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { resolveExtensionSidePanelContribution } from '../lib/extension-side-panel-resolution';
import { ExtensionContributionRuntimeHost } from './ExtensionContributionRuntimeHost';
function ExtensionSidePanelShell({ title, children, onClose, }) {
    return (_jsxs("section", { "aria-label": "Extension side panel", className: "flex size-full flex-col bg-diff-bg", children: [_jsxs("header", { className: "flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary/80 px-3", children: [_jsx("div", { className: "flex size-7 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent", children: _jsx(PanelRight, { className: "size-3.5" }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-[10px] font-medium tracking-wide text-text-muted uppercase", children: "Extension side panel" }), _jsx("h2", { className: "truncate text-[13px] font-semibold text-text-primary", children: title })] }), _jsx(Button, { "aria-label": "Close extension side panel", className: "size-7 rounded-md p-0 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary", onClick: onClose, type: "button", variant: "unstyled", children: _jsx(X, { className: "size-4" }) })] }), _jsx("div", { className: "flex min-h-0 flex-1 flex-col overflow-hidden p-3", children: children })] }));
}
function ExtensionSidePanelStatusCard({ icon, title, message, action, }) {
    return (_jsx("section", { role: "alert", className: "rounded-xl border border-border bg-[#111418] p-4", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: "mt-0.5 text-accent", children: icon }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("h3", { className: "text-[13px] font-semibold text-text-primary", children: title }), _jsx("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: message }), action ? _jsx("div", { className: "mt-3", children: action }) : null] })] }) }));
}
function ExtensionSidePanelLoadingCard() {
    return (_jsx("output", { className: "rounded-xl border border-border bg-[#111418] p-4", children: _jsxs("div", { className: "flex items-center gap-3 text-[12px] text-text-tertiary", children: [_jsx(RefreshCw, { className: "size-4 animate-spin text-accent" }), "Loading extension side panel registry\u2026"] }) }));
}
function ExtensionSidePanelContribution({ onSurfaceAction, resolution, surfacePayload, }) {
    const entry = resolution.contribution.entry;
    return (_jsx(PanelErrorBoundary, { className: "flex min-h-0 flex-1", name: `Extension side panel: ${entry.title}`, children: _jsx(ExtensionContributionRuntimeHost, { chrome: "bare", entry: entry, fill: true, onSurfaceAction: onSurfaceAction, surfacePayload: surfacePayload }) }));
}
function extensionSidePanelBody({ target, projectPaths, registry, loading, error, onRefresh, onSurfaceAction, surfacePayload, }) {
    if (loading && registry === null) {
        return _jsx(ExtensionSidePanelLoadingCard, {});
    }
    if (error !== null && registry === null) {
        return (_jsx(ExtensionSidePanelStatusCard, { action: _jsxs(Button, { onClick: onRefresh, size: "xs", variant: "accent", children: [_jsx(RefreshCw, { className: "size-3" }), "Retry"] }), icon: _jsx(ShieldAlert, { className: "size-4" }), message: error, title: "Could not load extension side panel registry" }));
    }
    if (registry === null) {
        return _jsx(ExtensionSidePanelLoadingCard, {});
    }
    const resolution = resolveExtensionSidePanelContribution({
        registry,
        target,
        requestedProjectPaths: projectPaths,
    });
    if (resolution.status === 'available') {
        return (_jsx(ExtensionSidePanelContribution, { onSurfaceAction: onSurfaceAction, resolution: resolution, surfacePayload: surfacePayload }));
    }
    return (_jsx(ExtensionSidePanelStatusCard, { icon: _jsx(ShieldAlert, { className: "size-4" }), message: resolution.message, title: resolution.title }));
}
function extensionSidePanelTitle({ registry, target, projectPaths, }) {
    if (registry === null) {
        return target.sidePanelId;
    }
    const resolution = resolveExtensionSidePanelContribution({
        registry,
        target,
        requestedProjectPaths: projectPaths,
    });
    return resolution.status === 'available'
        ? resolution.contribution.entry.title
        : target.sidePanelId;
}
export function ExtensionSidePanelSurfaceContent({ target, projectPaths, registry, loading, error, onRefresh, onClose, onSurfaceAction, surfacePayload, }) {
    const title = extensionSidePanelTitle({ registry, target, projectPaths });
    const body = extensionSidePanelBody({
        target,
        projectPaths,
        registry,
        loading,
        error,
        onRefresh,
        onSurfaceAction,
        surfacePayload,
    });
    return (_jsx(ExtensionSidePanelShell, { onClose: onClose, title: title, children: body }));
}
export function ExtensionSidePanelSurface({ target, projectPaths, registry, loading, error, onRefresh, onClose, onSurfaceAction, surfacePayload, }) {
    const contentProps = {
        error,
        loading,
        onClose,
        onRefresh,
        projectPaths,
        registry,
        target,
        ...(onSurfaceAction ? { onSurfaceAction } : {}),
        ...(surfacePayload !== undefined ? { surfacePayload } : {}),
    };
    return _jsx(ExtensionSidePanelSurfaceContent, { ...contentProps });
}

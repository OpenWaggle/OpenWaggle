import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { MessageSquare, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/shared/ui/Button';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { resolveExtensionDialogContribution } from '../lib/extension-dialog-resolution';
import { ExtensionContributionRuntimeHost } from './ExtensionContributionRuntimeHost';
function ExtensionDialogShell({ title, children, onClose, }) {
    const dialogRef = useRef(null);
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) {
            return;
        }
        if (typeof dialog.showModal === 'function') {
            if (!dialog.open) {
                dialog.showModal();
            }
        }
        else {
            dialog.setAttribute('open', '');
        }
        return () => {
            if (typeof dialog.close === 'function' && dialog.open) {
                dialog.close();
            }
            else {
                dialog.removeAttribute('open');
            }
        };
    }, []);
    return (_jsx("dialog", { "aria-label": title, className: "m-auto max-h-[calc(100vh-32px)] min-h-[420px] w-[calc(100%-32px)] max-w-3xl overflow-hidden rounded-2xl border border-border bg-bg p-0 shadow-2xl backdrop:bg-black/60", onCancel: (event) => {
            event.preventDefault();
            onClose();
        }, ref: dialogRef, children: _jsxs("section", { className: "flex max-h-[calc(100vh-32px)] min-h-[420px] flex-col overflow-hidden", children: [_jsxs("header", { className: "flex h-12 shrink-0 items-center gap-3 border-b border-border bg-bg-secondary/90 px-3", children: [_jsx("div", { className: "flex size-7 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent", children: _jsx(MessageSquare, { className: "size-3.5" }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("p", { className: "text-[10px] font-medium tracking-wide text-text-muted uppercase", children: "Extension dialog" }), _jsx("h2", { className: "truncate text-[13px] font-semibold text-text-primary", children: title })] }), _jsx(Button, { "aria-label": "Close extension dialog", className: "size-7 rounded-md p-0 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary", onClick: onClose, type: "button", variant: "unstyled", children: _jsx(X, { className: "size-4" }) })] }), _jsx("div", { className: "flex min-h-0 flex-1 flex-col overflow-hidden p-3", children: children })] }) }));
}
function ExtensionDialogStatusCard({ icon, title, message, action, }) {
    return (_jsx("section", { role: "alert", className: "rounded-xl border border-border bg-[#111418] p-4", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: "mt-0.5 text-accent", children: icon }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("h3", { className: "text-[13px] font-semibold text-text-primary", children: title }), _jsx("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: message }), action ? _jsx("div", { className: "mt-3", children: action }) : null] })] }) }));
}
function ExtensionDialogLoadingCard() {
    return (_jsx("output", { className: "rounded-xl border border-border bg-[#111418] p-4", children: _jsxs("div", { className: "flex items-center gap-3 text-[12px] text-text-tertiary", children: [_jsx(RefreshCw, { className: "size-4 animate-spin text-accent" }), "Loading extension dialog registry..."] }) }));
}
function ExtensionDialogContribution({ onSurfaceAction, resolution, surfacePayload, }) {
    const entry = resolution.contribution.entry;
    return (_jsx(PanelErrorBoundary, { className: "flex min-h-0 flex-1", name: `Extension dialog: ${entry.title}`, children: _jsx(ExtensionContributionRuntimeHost, { chrome: "bare", entry: entry, fill: true, onSurfaceAction: onSurfaceAction, surfacePayload: surfacePayload }) }));
}
function extensionDialogBody({ target, projectPaths, registry, loading, error, onRefresh, onSurfaceAction, surfacePayload, }) {
    if (loading && registry === null) {
        return _jsx(ExtensionDialogLoadingCard, {});
    }
    if (error !== null && registry === null) {
        return (_jsx(ExtensionDialogStatusCard, { action: _jsxs(Button, { onClick: onRefresh, size: "xs", variant: "accent", children: [_jsx(RefreshCw, { className: "size-3" }), "Retry"] }), icon: _jsx(ShieldAlert, { className: "size-4" }), message: error, title: "Could not load extension dialog registry" }));
    }
    if (registry === null) {
        return _jsx(ExtensionDialogLoadingCard, {});
    }
    const resolution = resolveExtensionDialogContribution({
        registry,
        target,
        requestedProjectPaths: projectPaths,
    });
    if (resolution.status === 'available') {
        return (_jsx(ExtensionDialogContribution, { onSurfaceAction: onSurfaceAction, resolution: resolution, surfacePayload: surfacePayload }));
    }
    return (_jsx(ExtensionDialogStatusCard, { icon: _jsx(ShieldAlert, { className: "size-4" }), message: resolution.message, title: resolution.title }));
}
function extensionDialogTitle({ registry, target, projectPaths, }) {
    if (registry === null) {
        return target.dialogId;
    }
    const resolution = resolveExtensionDialogContribution({
        registry,
        target,
        requestedProjectPaths: projectPaths,
    });
    return resolution.status === 'available' ? resolution.contribution.entry.title : target.dialogId;
}
export function ExtensionDialogSurfaceContent({ target, projectPaths, registry, loading, error, actions, surfacePayload, }) {
    const title = extensionDialogTitle({ registry, target, projectPaths });
    const body = extensionDialogBody({
        target,
        projectPaths,
        registry,
        loading,
        error,
        onRefresh: actions.onRefresh,
        onSurfaceAction: actions.onSurfaceAction,
        surfacePayload,
    });
    return (_jsx(ExtensionDialogShell, { onClose: actions.onClose, title: title, children: body }));
}
export function ExtensionDialogSurface({ target, projectPaths, registry, loading, error, onRefresh, onClose, onSurfaceAction, surfacePayload, }) {
    const actions = onSurfaceAction ? { onClose, onRefresh, onSurfaceAction } : { onClose, onRefresh };
    return (_jsx(ExtensionDialogSurfaceContent, { actions: actions, error: error, loading: loading, projectPaths: projectPaths, registry: registry, surfacePayload: surfacePayload, target: target }));
}

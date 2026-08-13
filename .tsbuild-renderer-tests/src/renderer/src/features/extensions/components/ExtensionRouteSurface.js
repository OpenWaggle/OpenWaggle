import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, PackageOpen, RefreshCw, ShieldAlert } from 'lucide-react';
import { usePreferences } from '@/features/settings/hooks';
import { extensionContributionsQueryOptions } from '@/queries/extensions';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { useFullscreen } from '@/shell/useFullscreen';
import { resolveExtensionRouteContribution } from '../lib/extension-route-resolution';
import { ExtensionContributionRuntimeHost } from './ExtensionContributionRuntimeHost';
function activeProjectPaths(projectPath) {
    return projectPath ? [projectPath] : [];
}
function projectScopeLabel(projectPaths) {
    if (projectPaths.length === 0) {
        return 'App scope';
    }
    return projectPaths[0] ?? 'App scope';
}
function ExtensionRouteShell({ extensionId, routeId, projectPaths, children, }) {
    const navigate = useNavigate();
    const isFullscreen = useFullscreen();
    return (_jsxs("div", { className: "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg", children: [_jsxs("header", { className: cn('drag-region flex h-12 shrink-0 items-center gap-3 border-b border-border px-4', !isFullscreen && 'pl-[80px]'), children: [_jsxs(Button, { className: "no-drag inline-flex h-8 items-center gap-2 rounded-md px-2 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary", onClick: () => void navigate({ to: '/settings/$tab', params: { tab: 'extensions' } }), type: "button", variant: "unstyled", children: [_jsx(ArrowLeft, { className: "size-4 shrink-0" }), _jsx("span", { className: "whitespace-nowrap text-[13px]", children: "Extensions" })] }), _jsxs("nav", { "aria-label": "Extension route breadcrumbs", className: "no-drag flex min-w-0 flex-1 items-center gap-2 text-[13px] text-text-muted", children: [_jsx(PackageOpen, { className: "size-4 shrink-0 text-accent" }), _jsx("span", { className: "min-w-0 truncate", children: extensionId }), _jsx("span", { "aria-hidden": "true", className: "shrink-0 text-text-muted", children: "/" }), _jsx("span", { className: "min-w-0 truncate text-text-secondary", children: routeId })] })] }), _jsx("main", { className: "min-h-0 flex-1 overflow-y-auto px-8 py-6", children: _jsxs("div", { className: "mx-auto flex max-w-5xl flex-col gap-4", children: [_jsx("section", { className: "rounded-xl border border-border bg-bg-secondary/30 p-4", children: _jsxs("div", { className: "flex flex-wrap items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h1", { className: "text-[18px] font-semibold text-text-primary", children: "Extension route" }), _jsx("p", { className: "mt-1 text-[12px] text-text-muted", children: "Controlled namespace mounted at /extensions/<extension-id>/<route-id>. Extension UI is contained and cannot replace the OpenWaggle shell or theme." })] }), _jsx("span", { className: "rounded-full border border-border/80 bg-bg-tertiary px-2.5 py-1 text-[11px] text-text-tertiary", children: projectScopeLabel(projectPaths) })] }) }), children] }) })] }));
}
function ExtensionRouteStatusCard({ icon, title, message, action, }) {
    return (_jsx("section", { role: "alert", className: "rounded-xl border border-border bg-[#111418] p-6", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: "mt-0.5 text-accent", children: icon }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("h2", { className: "text-[15px] font-semibold text-text-primary", children: title }), _jsx("p", { className: "mt-1 text-[13px] leading-6 text-text-tertiary", children: message }), action ? _jsx("div", { className: "mt-4", children: action }) : null] })] }) }));
}
function ExtensionRouteLoadingCard() {
    return (_jsx("output", { className: "rounded-xl border border-border bg-[#111418] p-6", children: _jsxs("div", { className: "flex items-center gap-3 text-[13px] text-text-tertiary", children: [_jsx(RefreshCw, { className: "size-4 animate-spin text-accent" }), "Loading extension route registry\u2026"] }) }));
}
function ExtensionRouteContributionCard({ resolution, }) {
    const contribution = resolution.contribution;
    const entry = contribution.entry;
    return (_jsx(PanelErrorBoundary, { name: `Extension route: ${entry.title}`, children: _jsxs("section", { className: "rounded-xl border border-border bg-[#111418] p-4", children: [_jsxs("div", { className: "mb-4 flex flex-wrap items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { className: "text-[16px] font-semibold text-text-primary", children: entry.title }), _jsxs("p", { className: "mt-1 text-[12px] text-text-muted", children: [entry.extensionName, " ", entry.extensionVersion] })] }), _jsxs("div", { className: "flex flex-wrap gap-1.5", children: [_jsx("span", { className: "rounded bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent", children: contribution.runtime }), _jsx("span", { className: "rounded bg-bg-tertiary px-2 py-1 text-[10px] font-medium text-text-tertiary", children: contribution.execution }), _jsx("span", { className: "rounded bg-bg-tertiary px-2 py-1 text-[10px] font-medium text-text-tertiary", children: entry.scope.label })] })] }), _jsx(ExtensionContributionRuntimeHost, { className: "min-h-[420px]", entry: entry }), _jsxs("dl", { className: "mt-4 grid gap-3 text-[12px] text-text-tertiary md:grid-cols-2", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("dt", { className: "text-text-muted", children: "Contribution ID" }), _jsx("dd", { className: "truncate text-text-secondary", children: entry.contributionId })] }), _jsxs("div", { className: "min-w-0", children: [_jsx("dt", { className: "text-text-muted", children: "Entry" }), _jsx("dd", { className: "truncate text-text-secondary", children: contribution.entryPath })] }), _jsxs("div", { className: "min-w-0", children: [_jsx("dt", { className: "text-text-muted", children: "Package" }), _jsx("dd", { className: "truncate text-text-secondary", children: entry.packagePath })] }), _jsxs("div", { className: "min-w-0", children: [_jsx("dt", { className: "text-text-muted", children: "Family" }), _jsx("dd", { className: "truncate text-text-secondary", children: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.ROUTES })] })] })] }) }));
}
function extensionRouteBody({ extensionId, routeId, projectPaths, registry, loading, error, onRefresh, }) {
    if (loading && registry === null) {
        return _jsx(ExtensionRouteLoadingCard, {});
    }
    if (error !== null && registry === null) {
        return (_jsx(ExtensionRouteStatusCard, { action: _jsxs(Button, { onClick: onRefresh, size: "xs", variant: "accent", children: [_jsx(RefreshCw, { className: "size-3" }), "Retry"] }), icon: _jsx(ShieldAlert, { className: "size-4" }), message: error, title: "Could not load extension route registry" }));
    }
    if (registry === null) {
        return _jsx(ExtensionRouteLoadingCard, {});
    }
    const resolution = resolveExtensionRouteContribution({
        registry,
        extensionId,
        routeId,
        requestedProjectPaths: projectPaths,
    });
    if (resolution.status === 'available') {
        return _jsx(ExtensionRouteContributionCard, { resolution: resolution });
    }
    return (_jsx(ExtensionRouteStatusCard, { icon: _jsx(ShieldAlert, { className: "size-4" }), message: resolution.message, title: resolution.title }));
}
export function ExtensionRouteSurfaceContent({ extensionId, routeId, projectPaths, registry, loading, error, onRefresh, }) {
    const body = extensionRouteBody({
        extensionId,
        routeId,
        projectPaths,
        registry,
        loading,
        error,
        onRefresh,
    });
    return (_jsx(ExtensionRouteShell, { extensionId: extensionId, projectPaths: projectPaths, routeId: routeId, children: body }));
}
export function ExtensionRouteSurface({ extensionId, routeId, }) {
    const { settings } = usePreferences();
    const projectPaths = activeProjectPaths(settings.projectPath);
    const { data: registry = null, error, isPending, refetch, } = useQuery(extensionContributionsQueryOptions(projectPaths));
    return (_jsx(ExtensionRouteSurfaceContent, { error: error?.message ?? null, extensionId: extensionId, loading: isPending, onRefresh: () => void refetch(), projectPaths: projectPaths, registry: registry, routeId: routeId }));
}

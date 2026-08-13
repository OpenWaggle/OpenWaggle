import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Activity } from 'lucide-react';
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary';
import { resolveExtensionAgentLoopAuxiliaryContributions, } from '../lib/extension-agent-loop-auxiliary-surfaces';
import { ExtensionContributionRuntimeHost } from './ExtensionContributionRuntimeHost';
const STATUS_WIDGET_MAX_HEIGHT = 160;
const STATUS_WIDGET_MIN_HEIGHT = 72;
function ExtensionAgentLoopStatusWidget({ auxiliary, onSurfaceAction, }) {
    const entry = auxiliary.contribution.entry;
    return (_jsx(PanelErrorBoundary, { name: `Extension status widget: ${entry.title}`, children: _jsxs("section", { className: "rounded-lg border border-border/80 bg-bg-secondary/40 p-2", children: [_jsxs("div", { className: "mb-2 flex min-w-0 items-center gap-2 text-[11px] text-text-tertiary", children: [_jsx(Activity, { className: "size-3.5 shrink-0 text-accent" }), _jsx("span", { className: "truncate font-medium text-text-secondary", children: entry.title })] }), _jsx(ExtensionContributionRuntimeHost, { autoHeight: true, chrome: "bare", entry: entry, maxAutoHeight: STATUS_WIDGET_MAX_HEIGHT, minAutoHeight: STATUS_WIDGET_MIN_HEIGHT, onSurfaceAction: onSurfaceAction, surfacePayload: auxiliary.surfacePayload })] }) }));
}
export function ExtensionAgentLoopStatusWidgets({ input, registry, projectPaths, onSurfaceAction, }) {
    const widgets = resolveExtensionAgentLoopAuxiliaryContributions({
        input,
        registry,
        projectPaths,
        placement: 'status-widget',
    });
    if (widgets.length === 0) {
        return null;
    }
    return (_jsx("section", { "aria-label": "Extension status widgets", className: "grid gap-2", children: widgets.map((auxiliary) => (_jsx(ExtensionAgentLoopStatusWidget, { auxiliary: auxiliary, onSurfaceAction: onSurfaceAction }, `${auxiliary.contribution.entry.packagePath}:${auxiliary.contribution.entry.contentHash}:${auxiliary.contribution.entry.contributionId}`))) }));
}

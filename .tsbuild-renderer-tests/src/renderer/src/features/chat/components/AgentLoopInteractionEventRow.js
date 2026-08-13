import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ExtensionAgentLoopSurface } from '@/features/extensions';
import { agentLoopInteractionRequiresDesktopRenderer, agentLoopInteractionTitle, toExtensionInteractionView, } from '../lib/agent-loop-interaction-view';
const RESPONSE_JSON_INDENT = 2;
function eventTimeLabel(timestamp) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}
function InteractionRequestAuditCard({ event, }) {
    return (_jsxs("section", { className: "rounded-xl border border-border bg-bg-secondary/70 p-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("h3", { className: "text-[12px] font-semibold text-text-primary", children: "Interaction requested" }), _jsx("span", { className: "text-[11px] text-text-muted tabular-nums", children: eventTimeLabel(event.timestamp) })] }), _jsx("p", { className: "mt-1 text-[12px] text-text-secondary", children: agentLoopInteractionTitle(event.interaction) }), _jsxs("p", { className: "mt-1 text-[11px] text-text-tertiary", children: [event.interaction.kind, " \u00B7 ", event.interaction.source] })] }));
}
function InteractionResolvedAuditCard({ event, }) {
    return (_jsxs("section", { className: "rounded-xl border border-border bg-bg-secondary/70 p-3", children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2", children: [_jsx("h3", { className: "text-[12px] font-semibold text-text-primary", children: "Interaction resolved" }), _jsx("span", { className: "text-[11px] text-text-muted tabular-nums", children: eventTimeLabel(event.timestamp) })] }), _jsxs("p", { className: "mt-1 text-[12px] text-text-secondary", children: [event.kind, " \u00B7 ", event.status] }), event.error ? (_jsx("p", { className: "mt-1 text-[12px] text-error", children: event.error.message })) : event.response ? (_jsx("pre", { className: "mt-2 max-h-24 overflow-auto rounded-lg bg-bg-tertiary p-2 text-[11px] leading-5 text-text-tertiary", children: JSON.stringify(event.response, null, RESPONSE_JSON_INDENT) })) : null] }));
}
export function InteractionEventRow({ event, extensions, }) {
    if (event.type === 'agent_interaction_request') {
        const fallback = agentLoopInteractionRequiresDesktopRenderer(event.interaction)
            ? undefined
            : null;
        return (_jsxs("div", { className: "grid gap-3", children: [_jsx(InteractionRequestAuditCard, { event: event }), _jsx(ExtensionAgentLoopSurface, { fallback: fallback, input: {
                        surface: 'interaction',
                        interaction: toExtensionInteractionView(event.interaction),
                    }, projectPaths: extensions.projectPaths, registry: extensions.registry })] }));
    }
    return _jsx(InteractionResolvedAuditCard, { event: event });
}

import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { MessageSquareWarning } from 'lucide-react';
import { ExtensionAgentLoopStatusWidgets, ExtensionAgentLoopSurface, } from '@/features/extensions';
import { responseFromExtensionAction } from '../lib/agent-loop-interaction-response-actions';
import { agentLoopInteractionMessage, agentLoopInteractionRequiresDesktopRenderer, agentLoopInteractionTitle, toExtensionInteractionView, } from '../lib/agent-loop-interaction-view';
import { AgentInteractionControls } from './AgentInteractionControls';
function InteractionHeader({ interaction }) {
    return (_jsxs("div", { className: "flex items-start gap-3", children: [_jsx(MessageSquareWarning, { className: "mt-0.5 size-4 shrink-0 text-accent" }), _jsxs("div", { className: "min-w-0", children: [_jsx("h3", { className: "text-[13px] font-semibold text-text-primary", children: "Pi interaction pending" }), _jsxs("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: [interaction.kind, " \u00B7 ", interaction.source] })] })] }));
}
function interactionSurfaceInput(interaction) {
    return {
        surface: 'interaction',
        interaction: toExtensionInteractionView(interaction),
    };
}
function InteractionExtensionSurfaces({ interaction, busy, extensionRegistry, extensionProjectPaths, submit, }) {
    const extensionInput = interactionSurfaceInput(interaction);
    const requiresDesktopRenderer = agentLoopInteractionRequiresDesktopRenderer(interaction);
    const extensionFallback = requiresDesktopRenderer ? undefined : null;
    const handleSurfaceAction = busy
        ? undefined
        : (actionId, payload) => {
            const response = responseFromExtensionAction({
                interaction,
                actionId,
                payload,
            });
            if (response !== null) {
                submit(interaction, response);
            }
        };
    const primaryInput = handleSurfaceAction === undefined
        ? extensionInput
        : {
            ...extensionInput,
            onAction: (interactionId, actionId, payload) => {
                if (interactionId !== interaction.interactionId) {
                    return;
                }
                handleSurfaceAction(actionId, payload);
            },
        };
    return (_jsxs(_Fragment, { children: [_jsx(ExtensionAgentLoopSurface, { fallback: extensionFallback, input: primaryInput, projectPaths: extensionProjectPaths, registry: extensionRegistry }), _jsx(ExtensionAgentLoopStatusWidgets, { input: extensionInput, onSurfaceAction: handleSurfaceAction, projectPaths: extensionProjectPaths, registry: extensionRegistry })] }));
}
function InteractionSummary({ interaction }) {
    const message = agentLoopInteractionMessage(interaction);
    return (_jsxs("div", { children: [_jsx("div", { className: "text-[13px] font-medium text-text-primary", children: agentLoopInteractionTitle(interaction) }), message ? _jsx("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: message }) : null] }));
}
export function AgentInteractionCard({ interaction, busy, extensionRegistry, extensionProjectPaths, submit, }) {
    return (_jsxs("section", { className: "grid gap-3 rounded-xl border border-accent/25 bg-accent/5 p-3", children: [_jsx(InteractionHeader, { interaction: interaction }), _jsx(InteractionExtensionSurfaces, { busy: busy, extensionProjectPaths: extensionProjectPaths, extensionRegistry: extensionRegistry, interaction: interaction, submit: submit }), _jsx(InteractionSummary, { interaction: interaction }), _jsx(AgentInteractionControls, { interaction: interaction, busy: busy, submit: (response) => submit(interaction, response) })] }));
}

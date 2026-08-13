import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { AgentInteractionCard } from './AgentInteractionCard';
const EMPTY_EXTENSION_PROJECT_PATHS = [];
function isPending(busyInteractionId, interaction) {
    return busyInteractionId === interaction.interactionId;
}
export function AgentInteractionsPanel({ interactions, extensionRegistry = null, extensionProjectPaths = EMPTY_EXTENSION_PROJECT_PATHS, onRespond, }) {
    const [busyInteractionId, setBusyInteractionId] = useState(null);
    const [error, setError] = useState(null);
    if (interactions.length === 0) {
        return null;
    }
    function submit(interaction, response) {
        setError(null);
        setBusyInteractionId(interaction.interactionId);
        onRespond(interaction, response)
            .catch((cause) => {
            setError(cause instanceof Error ? cause.message : String(cause));
        })
            .finally(() => {
            setBusyInteractionId(null);
        });
    }
    return (_jsx("div", { className: "border-t border-border bg-bg-secondary/40 px-6 py-3", children: _jsxs("div", { className: "mx-auto grid max-w-[720px] gap-3", children: [interactions.map((interaction) => (_jsx(AgentInteractionCard, { busy: isPending(busyInteractionId, interaction), extensionProjectPaths: extensionProjectPaths, extensionRegistry: extensionRegistry, interaction: interaction, submit: submit }, interaction.interactionId))), error ? _jsx("p", { className: "text-[12px] text-error", children: error }) : null] }) }));
}

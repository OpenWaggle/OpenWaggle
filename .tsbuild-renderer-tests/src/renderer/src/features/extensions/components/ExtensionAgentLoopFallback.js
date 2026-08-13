import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { matchBy } from '@diegogbrisa/ts-match';
import { AlertTriangle, CheckCircle2, CircleDashed, MessagesSquare, Wrench } from 'lucide-react';
import { Button } from '@/shared/ui/Button';
import { CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID } from '../lib/extension-agent-loop-surface-model';
const JSON_INDENT = 2;
function prettyJson(value) {
    return JSON.stringify(value, null, JSON_INDENT);
}
function renderToolFallback({ toolCall, toolResult, }) {
    return (_jsxs("div", { className: "grid gap-3", children: [_jsxs("div", { className: "flex items-center gap-2 text-[13px] font-medium text-text-primary", children: [_jsx(Wrench, { className: "size-4 text-accent" }), _jsx("span", { children: toolCall.name }), _jsx("span", { className: "rounded bg-bg-tertiary px-2 py-0.5 text-[10px] text-text-tertiary", children: toolCall.state })] }), _jsx("pre", { className: "max-h-40 overflow-auto rounded-lg border border-border/80 bg-bg p-3 text-[11px] leading-5 text-text-tertiary", children: toolCall.arguments || '{}' }), toolResult ? (_jsxs("div", { className: "rounded-lg border border-border/80 bg-bg-secondary/50 p-3", children: [_jsxs("div", { className: "mb-1 text-[10px] tracking-wide text-text-muted uppercase", children: ["Result \u00B7 ", toolResult.state] }), _jsx("p", { className: "whitespace-pre-wrap text-[12px] leading-5 text-text-secondary", children: toolResult.error ?? toolResult.content })] })) : null] }));
}
function renderCustomMessageFallback(message) {
    return (_jsxs("div", { className: "grid gap-2", children: [_jsxs("div", { className: "flex items-center gap-2 text-[13px] font-medium text-text-primary", children: [_jsx(MessagesSquare, { className: "size-4 text-accent" }), _jsx("span", { children: message.name })] }), _jsx("pre", { className: "max-h-48 overflow-auto rounded-lg border border-border/80 bg-bg p-3 text-[11px] leading-5 text-text-tertiary", children: prettyJson(message.value) })] }));
}
function actionVariant(tone) {
    if (tone === 'primary') {
        return 'accent';
    }
    return 'secondary';
}
function renderInteractionFallback({ interaction, onAction, }) {
    if (interaction.kind === 'custom') {
        return (_jsx("div", { role: "alert", className: "rounded-lg border border-error/25 bg-error/5 p-3", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(AlertTriangle, { className: "mt-0.5 size-4 shrink-0 text-error" }), _jsxs("div", { className: "min-w-0", children: [_jsx("h4", { className: "text-[13px] font-semibold text-text-primary", children: "Custom desktop interaction renderer unavailable" }), _jsx("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: "OpenWaggle does not execute Pi TUI custom components inside Electron. This interaction needs a matching extension interaction renderer." }), _jsxs("dl", { className: "mt-3 grid gap-1 text-[11px] text-text-muted", children: [_jsxs("div", { className: "flex min-w-0 gap-2", children: [_jsx("dt", { className: "shrink-0 text-text-tertiary", children: "Interaction" }), _jsx("dd", { className: "truncate", children: interaction.id })] }), _jsxs("div", { className: "flex min-w-0 gap-2", children: [_jsx("dt", { className: "shrink-0 text-text-tertiary", children: "State" }), _jsx("dd", { children: interaction.state })] })] }), onAction ? (_jsx("div", { className: "mt-3", children: _jsx(Button, { onClick: () => onAction(interaction.id, CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID), size: "xs", type: "button", variant: "secondary", children: "Reject interaction" }) })) : null] })] }) }));
    }
    return (_jsxs("div", { className: "grid gap-3", children: [_jsxs("div", { children: [_jsx("h4", { className: "text-[13px] font-semibold text-text-primary", children: interaction.title }), interaction.description ? (_jsx("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: interaction.description })) : null] }), _jsx("div", { className: "flex flex-wrap gap-2", children: interaction.actions.map((action) => (_jsx(Button, { disabled: interaction.state !== 'pending', onClick: () => onAction?.(interaction.id, action.id), size: "xs", type: "button", variant: actionVariant(action.tone), children: action.label }, action.id))) }), _jsxs("div", { className: "text-[11px] text-text-muted", children: ["State: ", interaction.state] })] }));
}
function renderStatusFallback(status) {
    const icon = status.tone === 'success' ? (_jsx(CheckCircle2, { className: "size-4 text-emerald-300" })) : status.tone === 'warning' || status.tone === 'error' ? (_jsx(AlertTriangle, { className: "size-4 text-amber-300" })) : (_jsx(CircleDashed, { className: "size-4 text-accent" }));
    return (_jsxs("div", { className: "flex items-start gap-3 rounded-lg border border-border/80 bg-bg-secondary/50 p-3", children: [icon, _jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "text-[13px] font-medium text-text-primary", children: status.label }), status.detail ? (_jsx("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: status.detail })) : null] })] }));
}
function renderTranscriptFallback(transcript) {
    return (_jsxs("div", { className: "rounded-lg border border-border/80 bg-bg-secondary/50 p-3", children: [_jsx("div", { className: "text-[13px] font-medium text-text-primary", children: "Transcript extension card" }), _jsxs("p", { className: "mt-1 text-[12px] leading-5 text-text-tertiary", children: [transcript.messageCount, " messages \u00B7 ", transcript.state] })] }));
}
function fallbackFor(input) {
    return matchBy(input, 'surface')
        .with('tool', (value) => renderToolFallback({ toolCall: value.toolCall, toolResult: value.toolResult }))
        .with('custom-message', (value) => renderCustomMessageFallback(value.message))
        .with('interaction', (value) => renderInteractionFallback({ interaction: value.interaction, onAction: value.onAction }))
        .with('transcript', (value) => renderTranscriptFallback(value.transcript))
        .with('status', (value) => renderStatusFallback(value.status))
        .exhaustive();
}
export function ExtensionAgentLoopFallback({ input, }) {
    return fallbackFor(input);
}

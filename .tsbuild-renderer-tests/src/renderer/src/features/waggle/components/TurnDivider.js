import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { generateDisplayName } from '@shared/types/llm';
import { AGENT_TEXT } from '@/features/waggle/lib/agent-colors';
import { cn } from '@/shared/lib/cn';
export function TurnDivider({ turnNumber, agentLabel, agentColor, agentModel }) {
    return (_jsxs("div", { className: "flex items-center gap-3 py-2", children: [_jsx("div", { className: "flex-1 border-t border-border" }), _jsxs("span", { className: cn('inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-secondary px-2 py-1 text-[11px] font-medium shadow-sm', AGENT_TEXT[agentColor]), children: [_jsxs("span", { "data-waggle-turn-label": "true", children: ["Turn ", turnNumber + 1, ": ", agentLabel] }), agentModel ? (_jsxs("span", { className: "text-text-tertiary", children: ["\u00B7 ", generateDisplayName(agentModel)] })) : null] }), _jsx("div", { className: "flex-1 border-t border-border" })] }));
}

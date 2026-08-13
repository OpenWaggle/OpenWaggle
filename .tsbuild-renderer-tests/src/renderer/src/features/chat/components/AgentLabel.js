import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { generateDisplayName } from '@shared/types/llm';
import { AGENT_BG, AGENT_TEXT } from '@/features/waggle/lib';
import { cn } from '@/shared/lib/cn';
export function AgentLabel({ assistantModel, waggle }) {
    if (waggle) {
        return (_jsx("div", { children: _jsxs("span", { className: cn('inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-bg-tertiary/50 px-2 py-1 text-[11px] font-medium shadow-sm', AGENT_TEXT[waggle.agentColor]), children: [_jsx("span", { className: cn('size-1.5 rounded-full', AGENT_BG[waggle.agentColor]) }), _jsx("span", { children: waggle.agentLabel }), assistantModel && ` \u00b7 ${generateDisplayName(assistantModel)}`] }) }));
    }
    if (assistantModel) {
        return (_jsx("div", { children: _jsx("span", { className: "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] text-text-muted bg-bg-tertiary/40 border border-border/70", children: generateDisplayName(assistantModel) }) }));
    }
    return null;
}

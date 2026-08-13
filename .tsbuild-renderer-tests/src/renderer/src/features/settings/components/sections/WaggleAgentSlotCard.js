import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { isInheritedWaggleModelBinding, WAGGLE_AGENT_COLORS, } from '@shared/types/waggle';
import { ModelSelector } from '@/features/providers/components';
import { AGENT_BG, AGENT_BORDER } from '@/features/waggle/lib';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Textarea } from '@/shared/ui/Textarea';
import { TextInput } from '@/shared/ui/TextInput';
const ROWS = 3;
export function WaggleAgentSlotCard({ index, agent, dispatchForm, dotLabel, settings, providerModels, }) {
    const selectedAgentModel = isInheritedWaggleModelBinding(agent.model)
        ? settings.selectedModel
        : agent.model;
    return (_jsxs("div", { className: cn('rounded-lg border bg-[#111418] p-5 space-y-4', AGENT_BORDER[agent.color]), children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: cn('size-2.5 rounded-full', AGENT_BG[agent.color]) }), _jsxs("h3", { className: "text-sm font-medium text-text-secondary", children: ["Agent ", dotLabel] })] }), _jsxs("div", { className: "flex items-center justify-between h-[40px]", children: [_jsx("span", { className: "text-[13px] text-text-primary", children: "Label" }), _jsx(TextInput, { type: "text", value: agent.label, onChange: (e) => dispatchForm({ type: 'set-agent-label', index, label: e.target.value }), inputSize: "sm", className: "w-[200px] border-border focus:border-border-light" })] }), _jsxs("div", { className: "flex items-center justify-between h-[40px]", children: [_jsx("span", { className: "text-[13px] text-text-primary", children: "Model" }), _jsx(ModelSelector, { value: selectedAgentModel, onChange: (model) => dispatchForm({ type: 'set-agent-model', index, model }), settings: settings, providerModels: providerModels })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx("span", { className: "text-[13px] text-text-primary", children: "Role description" }), _jsx(Textarea, { value: agent.roleDescription, onChange: (e) => dispatchForm({ type: 'set-agent-role', index, roleDescription: e.target.value }), rows: ROWS, placeholder: "Describe this agent's role and perspective...", resize: "none", className: "rounded-md border-border text-text-primary placeholder:text-text-tertiary" })] }), _jsxs("div", { className: "flex items-center justify-between h-[40px]", children: [_jsx("span", { className: "text-[13px] text-text-primary", children: "Color" }), _jsx("div", { className: "flex items-center gap-2", children: WAGGLE_AGENT_COLORS.map((color) => (_jsx(Button, { variant: "unstyled", type: "button", onClick: () => dispatchForm({ type: 'set-agent-color', index, color }), className: cn('size-6 rounded-full transition-all', AGENT_BG[color], agent.color === color
                                ? 'ring-2 ring-white/40 ring-offset-1 ring-offset-[#111418]'
                                : 'opacity-50 hover:opacity-75') }, color))) })] })] }));
}

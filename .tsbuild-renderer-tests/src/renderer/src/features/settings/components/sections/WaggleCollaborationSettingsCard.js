import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { RangeInput } from '@/shared/ui/RangeInput';
const MIN_TURNS = 4;
const MAX_TURNS = 20;
export function CollaborationSettingsCard({ stopCondition, maxTurns, onStopConditionChange, onMaxTurnsChange, }) {
    return (_jsxs("div", { className: "rounded-lg border border-border bg-[#111418] p-5 space-y-4", children: [_jsx("h3", { className: "text-sm font-medium text-text-secondary", children: "Collaboration" }), _jsxs("div", { className: "flex items-center justify-between h-[40px]", children: [_jsx("span", { className: "text-[13px] text-text-primary", children: "Stop when" }), _jsx(StopConditionToggle, { stopCondition: stopCondition, onStopConditionChange: onStopConditionChange })] }), _jsxs("div", { className: "flex items-center justify-between h-[40px]", children: [_jsx("span", { className: "text-[13px] text-text-primary", children: "Max turns" }), _jsx(MaxTurnsSlider, { maxTurns: maxTurns, onMaxTurnsChange: onMaxTurnsChange })] })] }));
}
function StopConditionToggle({ stopCondition, onStopConditionChange }) {
    return (_jsxs("div", { className: "flex rounded-md border border-border overflow-hidden", children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: () => onStopConditionChange('consensus'), className: cn('px-3 py-1.5 text-[12px] font-medium transition-colors', stopCondition === 'consensus'
                    ? 'bg-accent/15 text-accent'
                    : 'bg-bg text-text-tertiary hover:text-text-secondary'), children: "Consensus" }), _jsx(Button, { variant: "unstyled", type: "button", onClick: () => onStopConditionChange('user-stop'), className: cn('px-3 py-1.5 text-[12px] font-medium transition-colors border-l border-border', stopCondition === 'user-stop'
                    ? 'bg-accent/15 text-accent'
                    : 'bg-bg text-text-tertiary hover:text-text-secondary'), children: "Manual" })] }));
}
function MaxTurnsSlider({ maxTurns, onMaxTurnsChange }) {
    return (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(RangeInput, { min: MIN_TURNS, max: MAX_TURNS, value: maxTurns, onChange: (event) => onMaxTurnsChange(Number(event.target.value)), className: "w-[120px] accent-accent" }), _jsx("span", { className: "text-[13px] text-text-secondary w-6 text-right", children: maxTurns })] }));
}

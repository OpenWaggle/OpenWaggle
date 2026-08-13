import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
const CHECKBOX_CLASS = 'size-3.5 shrink-0 rounded border-border bg-bg text-accent';
export function Checkbox({ ref, label, labelClassName, className, ...props }) {
    if (!label) {
        return _jsx("input", { ref: ref, type: "checkbox", className: cn(CHECKBOX_CLASS, className), ...props });
    }
    return (_jsxs("label", { className: cn('flex items-center gap-2 text-[13px] text-text-secondary', props.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', labelClassName), children: [_jsx("input", { ref: ref, type: "checkbox", className: cn(CHECKBOX_CLASS, className), ...props }), label] }));
}

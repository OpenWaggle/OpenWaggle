import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
const TRACK_CLASS = {
    compact: 'h-4 w-7',
    default: 'h-5 w-9',
};
const THUMB_CLASS = {
    compact: 'size-3',
    default: 'size-3.5',
};
const THUMB_OFFSET_CLASS = {
    compact: { on: 'translate-x-3.5', off: 'translate-x-0.5' },
    default: { on: 'translate-x-5', off: 'translate-x-0.5' },
};
export function ToggleSwitch({ checked, onCheckedChange, label, disabled = false, className, size = 'default', stopPropagation = false, }) {
    function toggle() {
        if (!disabled) {
            onCheckedChange(!checked);
        }
    }
    function toggleFromClick(event) {
        if (stopPropagation) {
            event.stopPropagation();
        }
        toggle();
    }
    return (_jsx("button", { type: "button", role: "switch", "aria-checked": checked, "aria-disabled": disabled, "aria-label": label, disabled: disabled, onClick: toggleFromClick, className: cn('inline-flex shrink-0 items-center rounded-full transition-colors', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer', checked ? 'bg-accent' : 'bg-bg-hover', TRACK_CLASS[size], className), children: _jsx("span", { className: cn('block rounded-full transition-transform', checked ? 'bg-white' : 'bg-text-tertiary', THUMB_CLASS[size], checked ? THUMB_OFFSET_CLASS[size].on : THUMB_OFFSET_CLASS[size].off) }) }));
}

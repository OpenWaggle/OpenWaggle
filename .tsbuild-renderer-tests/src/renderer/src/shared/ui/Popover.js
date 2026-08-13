import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEscapeHotkey } from '@/shared/hooks/useEscapeHotkey';
import { usePopover } from '@/shared/hooks/usePopover';
import { cn } from '@/shared/lib/cn';
const placementClasses = {
    'top-start': 'bottom-full left-0 mb-1',
    'top-end': 'bottom-full right-0 mb-1',
    'bottom-start': 'top-full left-0 mt-1',
    'bottom-end': 'top-full right-0 mt-1',
};
export function Popover({ trigger, children, open: controlledOpen, onOpenChange, placement = 'bottom-start', className, }) {
    const isControlled = controlledOpen !== undefined;
    const { isOpen: popoverIsOpen, close: popoverClose, toggle: popoverToggle, containerRef, } = usePopover({
        onClose: () => onOpenChange?.(false),
        isActive: isControlled ? controlledOpen : undefined,
    });
    const isOpen = isControlled ? controlledOpen : popoverIsOpen;
    function toggle() {
        if (isControlled) {
            onOpenChange?.(!controlledOpen);
        }
        else {
            popoverToggle();
        }
    }
    useEscapeHotkey(() => {
        if (isControlled) {
            onOpenChange?.(false);
        }
        else {
            popoverClose();
        }
    }, { enabled: isOpen });
    const triggerContent = typeof trigger === 'function' ? trigger({ isOpen, toggle }) : trigger;
    return (_jsxs("div", { ref: containerRef, className: "relative", children: [triggerContent, isOpen && (_jsx("div", { className: cn('absolute z-50 rounded-lg border border-border-light bg-bg-secondary shadow-lg', placementClasses[placement], className), children: children }))] }));
}

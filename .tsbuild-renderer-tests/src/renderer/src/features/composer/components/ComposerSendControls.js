import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
export function ComposerSendControls({ isLoading, canSend, sendTitle, onSend, onCancel, }) {
    return (_jsxs(_Fragment, { children: [isLoading ? _jsx(CancelRunButton, { onCancel: onCancel }) : null, _jsx(SendMessageButton, { isLoading: isLoading, canSend: canSend, sendTitle: sendTitle, onSend: onSend })] }));
}
function CancelRunButton({ onCancel }) {
    return (_jsx(Button, { variant: "unstyled", type: "button", onClick: onCancel, className: "flex size-8 items-center justify-center rounded-full border border-error/35 bg-error/10 text-error transition-colors hover:bg-error/18", title: "Cancel", children: _jsx(Square, { className: "size-3.5" }) }));
}
function SendMessageButton({ isLoading, canSend, sendTitle, onSend }) {
    return (_jsx(Button, { variant: "unstyled", type: "button", onClick: onSend, disabled: !canSend, className: cn('flex size-8 items-center justify-center rounded-full transition-colors', getSendButtonTone(isLoading, canSend)), title: sendTitle ?? (isLoading ? 'Add message' : 'Send message'), children: _jsx(ArrowUp, { className: cn('size-4', canSend ? getSendIconTone(isLoading) : 'text-text-muted') }) }));
}
function getSendButtonTone(isLoading, canSend) {
    if (!canSend)
        return 'border border-border bg-bg-tertiary cursor-not-allowed';
    return isLoading
        ? 'border border-accent/35 bg-accent/10 text-accent hover:bg-accent/18'
        : 'bg-gradient-to-b from-accent to-accent-dim';
}
function getSendIconTone(isLoading) {
    return isLoading ? 'text-accent' : 'text-bg';
}

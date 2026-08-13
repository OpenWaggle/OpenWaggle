import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from '@/shared/ui/Button';
export function ActionDialogFooter({ config, busy, onCancel, onConfirm }) {
    return (_jsxs("div", { className: "mt-4 flex items-center justify-end gap-2", children: [_jsx(Button, { variant: "secondary", onClick: onCancel, disabled: busy, className: "h-8", children: "Cancel" }), _jsx(Button, { variant: config.confirmTone === 'danger' ? 'danger' : 'accent', onClick: () => {
                    void onConfirm();
                }, disabled: busy, className: "h-8", children: busy ? 'Working...' : config.confirmLabel })] }));
}

import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useActionDialogController } from '../hooks/useActionDialogController';
import { ActionDialogError } from './ActionDialogError';
import { ActionDialogFooter } from './ActionDialogFooter';
import { ActionDialogInput } from './ActionDialogInput';
export function ActionDialog({ onToast }) {
    const dialog = useActionDialogController({ onToast });
    if (!dialog.actionDialog || !dialog.config)
        return null;
    return (_jsx("div", { className: "fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4", children: _jsxs("div", { className: "w-full max-w-[360px] rounded-xl border border-border-light bg-bg-secondary p-4 shadow-2xl", children: [_jsx("h3", { className: "text-sm font-semibold text-text-primary", children: dialog.config.title }), _jsx("p", { className: "mt-1 text-[12px] text-text-tertiary", children: dialog.config.description }), _jsx(ActionDialogInput, { inputRef: dialog.inputRef, value: dialog.actionDialogInput, placeholder: dialog.config.inputPlaceholder, onValueChange: dialog.setActionDialogInput, onConfirm: dialog.handleConfirm }), _jsx(ActionDialogError, { message: dialog.actionDialogError }), _jsx(ActionDialogFooter, { config: dialog.config, busy: dialog.actionDialogBusy, onCancel: dialog.closeActionDialog, onConfirm: dialog.handleConfirm })] }) }));
}

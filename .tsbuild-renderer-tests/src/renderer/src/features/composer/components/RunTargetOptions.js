import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { api } from '@/shared/lib/ipc';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
import { ToggleSwitch } from '@/shared/ui/ToggleSwitch';
const OPTION_ROW_CLASS = 'h-7 w-full rounded-[5px] px-2 text-left text-[12px] text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50';
/**
 * Everything that used to live in the separate "Options" popover, plus the ref
 * actions that belong beside a ref chooser: create-and-switch, copy name,
 * start-from-origin, and change-request checkout. Keeping them here means the row
 * has exactly one popover and the user never has to reconcile two branch controls.
 */
export function RunTargetOptions({ strip, selectedRef, onOpenActionDialog, onToast, }) {
    const isWorktree = strip?.envMode === 'worktree';
    return (_jsxs("div", { className: "mt-2 flex flex-col gap-1 border-t border-border pt-2", children: [_jsx(Button, { variant: "unstyled", type: "button", onClick: () => onOpenActionDialog('create-branch'), className: OPTION_ROW_CLASS, children: "New branch\u2026" }), _jsx(Button, { variant: "unstyled", type: "button", disabled: selectedRef === null, onClick: () => {
                    if (selectedRef === null)
                        return;
                    api.copyToClipboard(selectedRef);
                    onToast?.(`Copied "${selectedRef}"`);
                }, className: OPTION_ROW_CLASS, children: "Copy branch name" }), isWorktree && strip ? _jsx(WorktreeOptions, { strip: strip }) : null] }));
}
function WorktreeOptions({ strip }) {
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex h-7 items-center justify-between gap-2 px-2", children: [_jsx("span", { "aria-hidden": "true", className: "text-[12px] text-text-secondary", children: "Start from origin" }), _jsx(ToggleSwitch, { checked: strip.startFromOrigin, onCheckedChange: strip.setStartFromOrigin, label: "Start from origin", size: "compact" })] }), _jsx(ChangeRequestCheckout, { strip: strip })] }));
}
function ChangeRequestCheckout({ strip }) {
    if (strip.changeRequests.length === 0) {
        return (_jsx(Button, { variant: "unstyled", type: "button", onClick: () => void strip.loadChangeRequests(), className: OPTION_ROW_CLASS, children: "Checkout change request\u2026" }));
    }
    return (_jsxs("div", { className: "flex flex-col gap-1 px-2 pb-1", children: [_jsx("span", { className: "text-[11px] font-medium text-text-tertiary", children: "Change request" }), _jsxs(Select, { "aria-label": "Checkout change request", value: "", selectSize: "sm", className: "w-full", onChange: (event) => {
                    if (event.target.value)
                        void strip.checkoutChangeRequest(event.target.value);
                }, children: [_jsx("option", { value: "", children: "Checkout change request\u2026" }), strip.changeRequests.map((cr) => (_jsx("option", { value: cr.headRef, children: cr.title }, cr.url)))] })] }));
}

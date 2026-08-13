import { jsx as _jsx } from "react/jsx-runtime";
export function ActionDialogError({ message }) {
    if (!message)
        return null;
    return (_jsx("div", { className: "mt-3 rounded-md border border-error/30 bg-error/10 px-2.5 py-1.5 text-[12px] text-error", children: message }));
}

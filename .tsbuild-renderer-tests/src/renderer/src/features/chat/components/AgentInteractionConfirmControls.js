import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from '@/shared/ui/Button';
export function AgentInteractionConfirmControls({ busy, submit, }) {
    return (_jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { disabled: busy, variant: "accent", onClick: () => submit({ kind: 'confirm', accepted: true }), children: "Approve" }), _jsx(Button, { disabled: busy, onClick: () => submit({ kind: 'confirm', accepted: false }), children: "Decline" })] }));
}

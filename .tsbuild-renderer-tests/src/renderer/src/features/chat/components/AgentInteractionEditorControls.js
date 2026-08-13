import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Textarea } from '@/shared/ui/Textarea';
export function AgentInteractionEditorControls({ interaction, busy, submit, }) {
    const [value, setValue] = useState(interaction.prefill ?? '');
    return (_jsxs("div", { className: "grid gap-2", children: [_jsx(Textarea, { disabled: busy, value: value, resize: "vertical", onChange: (event) => setValue(event.currentTarget.value) }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { disabled: busy, variant: "accent", onClick: () => submit({ kind: 'editor', value }), children: "Submit" }), _jsx(Button, { disabled: busy, onClick: () => submit({ kind: 'editor', value: null }), children: "Cancel" })] })] }));
}

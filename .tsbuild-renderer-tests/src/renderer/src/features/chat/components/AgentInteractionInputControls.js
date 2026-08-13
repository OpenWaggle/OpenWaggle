import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { TextInput } from '@/shared/ui/TextInput';
export function AgentInteractionInputControls({ interaction, busy, submit, }) {
    const [value, setValue] = useState('');
    return (_jsxs("div", { className: "grid gap-2", children: [_jsx(TextInput, { disabled: busy, placeholder: interaction.placeholder ?? '', value: value, onChange: (event) => setValue(event.currentTarget.value) }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { disabled: busy, variant: "accent", onClick: () => submit({ kind: 'input', value }), children: "Submit" }), _jsx(Button, { disabled: busy, onClick: () => submit({ kind: 'input', value: null }), children: "Cancel" })] })] }));
}

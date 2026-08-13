import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Button } from '@/shared/ui/Button';
import { Select } from '@/shared/ui/Select';
export function AgentInteractionSelectControls({ interaction, busy, submit, }) {
    const [selected, setSelected] = useState(interaction.choices[0] ?? '');
    return (_jsxs("div", { className: "grid gap-2", children: [_jsx(Select, { disabled: busy, value: selected, onChange: (event) => setSelected(event.currentTarget.value), children: interaction.choices.map((choice) => (_jsx("option", { value: choice, children: choice }, choice))) }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { disabled: busy || selected.length === 0, variant: "accent", onClick: () => submit({ kind: 'select', selected }), children: "Select" }), _jsx(Button, { disabled: busy, onClick: () => submit({ kind: 'select', selected: null }), children: "Cancel" })] })] }));
}

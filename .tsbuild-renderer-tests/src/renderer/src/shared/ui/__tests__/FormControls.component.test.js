import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from '../Checkbox';
import { RangeInput } from '../RangeInput';
import { Select } from '../Select';
import { TextInput } from '../TextInput';
describe('shared form controls', () => {
    it('renders text inputs with shared focus and typography classes', () => {
        render(_jsx(TextInput, { "aria-label": "API key", monospace: true, placeholder: "sk-..." }));
        expect(screen.getByRole('textbox', { name: 'API key' })).toHaveClass('border-border', 'bg-bg', 'font-mono');
    });
    it('supports labeled checkboxes through the public input interface', () => {
        const onChange = vi.fn();
        render(_jsx(Checkbox, { label: "Include logs", checked: false, onChange: onChange }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include logs' }));
        expect(onChange).toHaveBeenCalledTimes(1);
    });
    it('renders native selects with shared dropdown styling', () => {
        render(_jsxs(Select, { "aria-label": "Filter", value: "all", onChange: () => undefined, children: [_jsx("option", { value: "all", children: "All" }), _jsx("option", { value: "active", children: "Active" })] }));
        expect(screen.getByRole('combobox', { name: 'Filter' })).toHaveClass('border-input-card-border', 'bg-bg-secondary');
    });
    it('renders range controls with the shared accent styling', () => {
        render(_jsx(RangeInput, { "aria-label": "Max turns", min: 4, max: 20, value: 8, onChange: () => undefined }));
        expect(screen.getByRole('slider', { name: 'Max turns' })).toHaveClass('accent-accent');
    });
});

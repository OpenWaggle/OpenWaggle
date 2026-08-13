import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '../Button';
describe('Button', () => {
    it('defaults to a semantic button with the shared secondary tone', () => {
        render(_jsx(Button, { children: "Open" }));
        const button = screen.getByRole('button', { name: 'Open' });
        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveClass('border-border', 'bg-bg', 'text-text-secondary');
    });
    it('renders icon slots without changing the accessible name', () => {
        render(_jsx(Button, { leftIcon: _jsx("span", { "aria-hidden": "true", children: "L" }), rightIcon: _jsx("span", { "aria-hidden": "true", children: "R" }), children: "Save" }));
        expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('LSaveR');
    });
    it('supports product variants, sizes, radius, and full-width layout', () => {
        render(_jsx(Button, { variant: "primary", size: "lg", radius: "full", fullWidth: true, children: "Ship" }));
        expect(screen.getByRole('button', { name: 'Ship' })).toHaveClass('from-accent', 'px-7', 'rounded-full', 'w-full');
    });
    it('allows exact layout control for specialized buttons', () => {
        render(_jsx(Button, { variant: "unstyled", className: "flex size-5 items-center", children: "More" }));
        const button = screen.getByRole('button', { name: 'More' });
        expect(button).toHaveClass('flex', 'size-5', 'items-center');
        expect(button).not.toHaveClass('rounded-md', 'px-2.5');
    });
});

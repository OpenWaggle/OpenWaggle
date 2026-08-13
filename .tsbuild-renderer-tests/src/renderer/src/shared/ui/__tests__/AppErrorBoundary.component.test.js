import { jsx as _jsx } from "react/jsx-runtime";
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../AppErrorBoundary';
const loggerMock = vi.hoisted(() => ({
    error: vi.fn(),
}));
vi.mock('@/shared/lib/logger', () => ({
    createRendererLogger: () => loggerMock,
}));
function ThrowingChild() {
    throw new Error('Renderer exploded');
}
describe('AppErrorBoundary', () => {
    afterEach(() => {
        loggerMock.error.mockClear();
    });
    it('renders children until a child throws', () => {
        render(_jsx(AppErrorBoundary, { children: _jsx("p", { children: "Healthy app" }) }));
        expect(screen.getByText('Healthy app')).toBeInTheDocument();
    });
    it('shows a recoverable error panel and logs component stack context', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        render(_jsx(AppErrorBoundary, { children: _jsx(ThrowingChild, {}) }));
        expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
        expect(screen.getByText('Renderer exploded')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reload app' })).toBeInTheDocument();
        expect(loggerMock.error).toHaveBeenCalledWith('Unhandled render error', expect.objectContaining({ message: 'Renderer exploded' }));
        consoleError.mockRestore();
    });
});

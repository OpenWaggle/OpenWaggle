import { jsx as _jsx } from "react/jsx-runtime";
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommitMessageDialog } from '../CommitMessageDialog';
describe('CommitMessageDialog', () => {
    it('renders nothing when closed', () => {
        const { container } = render(_jsx(CommitMessageDialog, { open: false, fileCount: 1, onCancel: vi.fn(), onConfirm: vi.fn() }));
        expect(container).toBeEmptyDOMElement();
    });
    it('blocks confirm until a non-empty message is entered', () => {
        const onConfirm = vi.fn();
        render(_jsx(CommitMessageDialog, { open: true, fileCount: 2, onCancel: vi.fn(), onConfirm: onConfirm }));
        const confirm = screen.getByRole('button', { name: 'Continue' });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
            target: { value: '  ' },
        });
        expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
        fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
            target: { value: ' fix: thing ' },
        });
        screen.getByRole('button', { name: 'Continue' }).click();
        expect(onConfirm).toHaveBeenCalledWith('fix: thing');
    });
    it('reports the number of files being committed', () => {
        render(_jsx(CommitMessageDialog, { open: true, fileCount: 3, onCancel: vi.fn(), onConfirm: vi.fn() }));
        expect(screen.getByText('3 files will be committed.')).toBeInTheDocument();
    });
});

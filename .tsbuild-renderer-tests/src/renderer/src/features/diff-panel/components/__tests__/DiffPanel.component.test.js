import { jsx as _jsx } from "react/jsx-runtime";
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGitStore } from '@/features/git';
import { api } from '@/shared/lib/ipc';
import { useUIStore } from '@/shell/ui-store';
import { useReviewStore } from '../../state/review-store';
import { DiffPanel } from '../DiffPanel';
import { fileDiff, gitStatus } from './diff-panel.test-harness';
/**
 * CodeView is a measurement-driven renderer (Shiki, virtualization, ResizeObserver)
 * and does not render meaningfully under jsdom. Stub it so these tests exercise OUR
 * wiring -- items, annotations, selection plumbing -- and verify the real renderer
 * in the Electron app instead.
 */
// Async factory + dynamic import: vi.mock is hoisted above imports, so the stub
// cannot be referenced from an ordinary top-level import here.
vi.mock('@pierre/diffs/react', async () => ({
    CodeView: (await import('./diff-panel.test-harness')).StubCodeView,
}));
vi.mock('@/shared/lib/ipc', () => ({
    api: {
        getGitDiff: vi.fn(),
        getGitStatus: vi.fn(),
        listGitBranches: vi.fn(),
        stageAllGitChanges: vi.fn(),
        revertAllGitChanges: vi.fn(),
        showConfirm: vi.fn(),
    },
}));
/** Status keyed by working path (ADR 0016). */
function statusSliceFor(workingPath, status) {
    return { [workingPath]: { status, isLoading: false, error: null } };
}
describe('Diff panel components', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        useGitStore.setState({ statusByWorkingPath: {} });
        useReviewStore.setState({ comments: [], activeCommentLocation: null, summary: '' });
        useUIStore.setState({ toastMessage: null, toastData: null });
    });
    it('stages every change and refreshes the diff and Git status', async () => {
        vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] });
        vi.mocked(api.getGitStatus).mockResolvedValue(gitStatus([
            {
                path: 'src/app.ts',
                status: 'modified',
                staged: true,
                unstaged: false,
                additions: 1,
                deletions: 1,
            },
        ]));
        vi.mocked(api.stageAllGitChanges).mockResolvedValue({
            ok: true,
            message: 'All working-tree changes staged.',
        });
        render(_jsx(DiffPanel, { workingPath: "/repo", onSendMessage: vi.fn() }));
        await screen.findByRole('button', { name: /select src\/app.ts/ });
        fireEvent.click(screen.getByRole('button', { name: /Stage all/ }));
        await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(2));
        expect(api.stageAllGitChanges).toHaveBeenCalledWith('/repo');
        expect(api.getGitStatus).toHaveBeenCalledWith('/repo');
        expect(screen.getByRole('button', { name: /Stage all/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Revert all' })).toBeEnabled();
        expect(useUIStore.getState().toastData).toMatchObject({
            message: 'All working-tree changes staged.',
            variant: 'success',
        });
    });
    it('keeps every change when main-process revert confirmation is cancelled', async () => {
        vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] });
        vi.mocked(api.revertAllGitChanges).mockResolvedValue({
            ok: false,
            code: 'cancelled',
            message: 'Revert all cancelled.',
        });
        render(_jsx(DiffPanel, { workingPath: "/repo", onSendMessage: vi.fn() }));
        await screen.findByRole('button', { name: /select src\/app.ts/ });
        fireEvent.click(screen.getByRole('button', { name: 'Revert all' }));
        await waitFor(() => expect(api.revertAllGitChanges).toHaveBeenCalledWith('/repo'));
        expect(api.getGitDiff).toHaveBeenCalledOnce();
        expect(api.getGitStatus).not.toHaveBeenCalled();
        expect(useUIStore.getState().toastData).toBeNull();
    });
    it('reverts confirmed changes and refreshes the diff and Git status', async () => {
        vi.mocked(api.getGitDiff)
            .mockResolvedValueOnce({ ok: true, files: [fileDiff()] })
            .mockResolvedValueOnce({ ok: true, files: [] });
        vi.mocked(api.getGitStatus).mockResolvedValue(gitStatus([]));
        vi.mocked(api.revertAllGitChanges).mockResolvedValue({
            ok: true,
            message: 'All eligible working-tree changes reverted.',
        });
        render(_jsx(DiffPanel, { workingPath: "/repo", onSendMessage: vi.fn() }));
        await screen.findByRole('button', { name: /select src\/app.ts/ });
        fireEvent.click(screen.getByRole('button', { name: 'Revert all' }));
        await screen.findByText('No changes to review');
        expect(api.revertAllGitChanges).toHaveBeenCalledWith('/repo');
        expect(api.getGitDiff).toHaveBeenCalledTimes(2);
        expect(api.getGitStatus).toHaveBeenCalledWith('/repo');
        expect(screen.getByRole('button', { name: 'Revert all' })).toBeDisabled();
        expect(useUIStore.getState().toastData).toMatchObject({
            message: 'All eligible working-tree changes reverted.',
            variant: 'success',
        });
    });
    it('surfaces a stage failure and still refreshes potentially changed Git state', async () => {
        vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] });
        vi.mocked(api.getGitStatus).mockResolvedValue(gitStatus([
            {
                path: 'src/app.ts',
                status: 'modified',
                staged: false,
                unstaged: true,
                additions: 1,
                deletions: 1,
            },
        ]));
        vi.mocked(api.stageAllGitChanges).mockResolvedValue({
            ok: false,
            code: 'unknown',
            message: 'Git index is locked.',
        });
        render(_jsx(DiffPanel, { workingPath: "/repo", onSendMessage: vi.fn() }));
        await screen.findByRole('button', { name: /select src\/app.ts/ });
        fireEvent.click(screen.getByRole('button', { name: /Stage all/ }));
        await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledTimes(2));
        expect(api.getGitStatus).toHaveBeenCalledWith('/repo');
        expect(useUIStore.getState().toastData).toMatchObject({
            message: 'Git index is locked.',
            variant: 'error',
        });
    });
    it('keeps Stage all enabled for files with staged and unstaged changes', async () => {
        vi.mocked(api.getGitDiff).mockResolvedValue({ ok: true, files: [fileDiff()] });
        useGitStore.setState({
            statusByWorkingPath: statusSliceFor('/repo', gitStatus([
                {
                    path: 'src/app.ts',
                    status: 'modified',
                    staged: true,
                    unstaged: true,
                    additions: 1,
                    deletions: 1,
                },
            ])),
        });
        vi.mocked(api.stageAllGitChanges).mockResolvedValue({
            ok: true,
            message: 'All working-tree changes staged.',
        });
        render(_jsx(DiffPanel, { workingPath: "/repo", onSendMessage: vi.fn() }));
        await screen.findByRole('button', { name: /select src\/app.ts/ });
        expect(screen.getByRole('button', { name: /Stage all/ })).toBeEnabled();
    });
    it('does not refresh or toast an action result after switching projects', async () => {
        let resolveStage;
        vi.mocked(api.getGitDiff).mockImplementation(async (projectPath) => ({
            ok: true,
            files: [fileDiff(projectPath)],
        }));
        vi.mocked(api.stageAllGitChanges).mockImplementation(() => new Promise((resolve) => {
            resolveStage = resolve;
        }));
        const { rerender } = render(_jsx(DiffPanel, { workingPath: "/repo-a", onSendMessage: vi.fn() }));
        await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-a'));
        fireEvent.click(screen.getByRole('button', { name: /Stage all/ }));
        rerender(_jsx(DiffPanel, { workingPath: "/repo-b", onSendMessage: vi.fn() }));
        await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-b'));
        resolveStage?.({ ok: true, message: 'All working-tree changes staged.' });
        await waitFor(() => expect(api.stageAllGitChanges).toHaveBeenCalledWith('/repo-a'));
        expect(api.getGitDiff).toHaveBeenCalledTimes(2);
        expect(api.getGitStatus).not.toHaveBeenCalled();
        expect(useUIStore.getState().toastData).toBeNull();
    });
    it('does not toast an action rejection after switching projects', async () => {
        let rejectStage;
        vi.mocked(api.getGitDiff).mockImplementation(async (projectPath) => ({
            ok: true,
            files: [fileDiff(projectPath)],
        }));
        vi.mocked(api.stageAllGitChanges).mockImplementation(() => new Promise((_resolve, reject) => {
            rejectStage = reject;
        }));
        const { rerender } = render(_jsx(DiffPanel, { workingPath: "/repo-a", onSendMessage: vi.fn() }));
        await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-a'));
        fireEvent.click(screen.getByRole('button', { name: /Stage all/ }));
        rerender(_jsx(DiffPanel, { workingPath: "/repo-b", onSendMessage: vi.fn() }));
        await waitFor(() => expect(api.getGitDiff).toHaveBeenCalledWith('/repo-b'));
        rejectStage?.(new Error('obsolete failure'));
        await waitFor(() => expect(api.stageAllGitChanges).toHaveBeenCalledWith('/repo-a'));
        expect(useUIStore.getState().toastData).toBeNull();
    });
    it('renders empty and failed diff states without stale files', async () => {
        const { rerender } = render(_jsx(DiffPanel, { workingPath: null, onSendMessage: vi.fn() }));
        expect(screen.getByText('No changes to review')).toBeInTheDocument();
        vi.mocked(api.getGitDiff).mockRejectedValue(new Error('git unavailable'));
        rerender(_jsx(DiffPanel, { workingPath: "/repo", onSendMessage: vi.fn() }));
        expect(await screen.findByText('No changes to review')).toBeInTheDocument();
    });
});

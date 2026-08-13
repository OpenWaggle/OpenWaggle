import { jsx as _jsx } from "react/jsx-runtime";
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTree } from '../FileTree';
function fileDiff(path, additions = 1, deletions = 1, diff = '@@ -1 +1 @@\n-a\n+b') {
    return { path, diff, additions, deletions };
}
describe('Changed-file navigator', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });
    it('exposes ARIA tree semantics from the tree library', () => {
        render(_jsx(FileTree, { files: [fileDiff('src/app.ts')], onFileClick: vi.fn() }));
        expect(screen.getByRole('tree')).toBeInTheDocument();
        expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0);
    });
    // Regression: the panel mounts before a diff has loaded, and in Branch/Turn
    // scope the working tree can be clean at mount. The tree library applies
    // initialState.expandedItems only once, so an empty first render used to leave
    // the navigator permanently collapsed -- it rendered zero rows while the diff
    // body showed files. Found in real-Electron QA, not by any existing test.
    it('lists files that arrive after mounting with an empty diff', () => {
        const { rerender } = render(_jsx(FileTree, { files: [], onFileClick: vi.fn() }));
        expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
        rerender(_jsx(FileTree, { files: [fileDiff('src/app.ts'), fileDiff('docs/readme.md')], onFileClick: vi.fn() }));
        expect(screen.getByText('app.ts')).toBeInTheDocument();
        expect(screen.getByText('readme.md')).toBeInTheDocument();
    });
    it('keeps a user collapse across an unchanged re-render', () => {
        const files = [fileDiff('src/app.ts')];
        const { rerender } = render(_jsx(FileTree, { files: files, onFileClick: vi.fn() }));
        fireEvent.click(screen.getByText('src'));
        expect(screen.queryByText('app.ts')).not.toBeInTheDocument();
        // A fresh array with identical content must not remount and re-expand:
        // the diff poll produces a new array reference on every tick.
        rerender(_jsx(FileTree, { files: [fileDiff('src/app.ts')], onFileClick: vi.fn() }));
        expect(screen.queryByText('app.ts')).not.toBeInTheDocument();
    });
    it('opens a file when its row is activated', () => {
        const onFileClick = vi.fn();
        render(_jsx(FileTree, { files: [fileDiff('src/app.ts')], onFileClick: onFileClick }));
        fireEvent.click(screen.getByText('app.ts'));
        expect(onFileClick).toHaveBeenCalledWith('src/app.ts');
    });
    it('collapses and expands a directory without opening a file', () => {
        const onFileClick = vi.fn();
        render(_jsx(FileTree, { files: [fileDiff('src/app.ts')], onFileClick: onFileClick }));
        fireEvent.click(screen.getByText('src'));
        expect(screen.queryByText('app.ts')).not.toBeInTheDocument();
        expect(onFileClick).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText('src'));
        expect(screen.getByText('app.ts')).toBeInTheDocument();
    });
    it('shows per-file status and change counts', () => {
        render(_jsx(FileTree, { files: [
                fileDiff('added.ts', 3, 0, 'diff --git a/added.ts b/added.ts\nnew file mode 100644\n@@ -0,0 +1 @@\n+x'),
                fileDiff('gone.ts', 0, 5, 'diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n@@ -1 +0,0 @@\n-x'),
            ], onFileClick: vi.fn() }));
        expect(screen.getByRole('img', { name: 'added' })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'deleted' })).toBeInTheDocument();
        expect(screen.getByText('+3')).toBeInTheDocument();
        expect(screen.getByText('-5')).toBeInTheDocument();
    });
    it('resizes with the keyboard and persists the width', () => {
        const { unmount } = render(_jsx(FileTree, { files: [fileDiff('a.ts')], onFileClick: vi.fn() }));
        const rail = screen.getByRole('button', { name: /Resize changed file list/ });
        // Left widens, because the navigator is docked on the right.
        fireEvent.keyDown(rail, { key: 'ArrowLeft' });
        const widened = screen.getByRole('button', { name: /Resize changed file list/ });
        expect(widened.getAttribute('aria-label')).toMatch(/236 pixels/);
        unmount();
        render(_jsx(FileTree, { files: [fileDiff('a.ts')], onFileClick: vi.fn() }));
        expect(screen.getByRole('button', { name: /Resize changed file list/ }).getAttribute('aria-label')).toMatch(/236 pixels/);
    });
    it('clamps the width at its minimum', () => {
        render(_jsx(FileTree, { files: [fileDiff('a.ts')], onFileClick: vi.fn() }));
        const rail = screen.getByRole('button', { name: /Resize changed file list/ });
        for (let press = 0; press < 12; press += 1) {
            fireEvent.keyDown(rail, { key: 'ArrowRight' });
        }
        expect(screen.getByRole('button', { name: /Resize changed file list/ }).getAttribute('aria-label')).toMatch(/140 pixels/);
    });
});

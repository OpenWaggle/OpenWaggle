import type { GitFileDiff } from '@shared/types/git'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileTree } from '../FileTree'

function fileDiff(path: string, additions = 1, deletions = 1, diff = '@@ -1 +1 @@\n-a\n+b') {
  return { path, diff, additions, deletions } satisfies GitFileDiff
}

describe('Changed-file navigator', () => {
  it('exposes ARIA tree semantics from the tree library', () => {
    render(<FileTree files={[fileDiff('src/app.ts')]} onFileClick={vi.fn()} />)

    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0)
    expect(screen.getByRole('treeitem', { name: /app\.ts/ })).toHaveStyle({
      contentVisibility: 'auto',
      containIntrinsicSize: 'auto 1.375rem',
    })
  })

  // Regression: the panel mounts before a diff has loaded, and in Branch/Turn
  // scope the working tree can be clean at mount. The tree library applies
  // initialState.expandedItems only once, so an empty first render used to leave
  // the navigator permanently collapsed -- it rendered zero rows while the diff
  // body showed files. Found in real-Electron QA, not by any existing test.
  it('lists files that arrive after mounting with an empty diff', () => {
    const { rerender } = render(<FileTree files={[]} onFileClick={vi.fn()} />)
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0)

    rerender(
      <FileTree
        files={[fileDiff('src/app.ts'), fileDiff('docs/readme.md')]}
        onFileClick={vi.fn()}
      />,
    )

    expect(screen.getByText('app.ts')).toBeInTheDocument()
    expect(screen.getByText('readme.md')).toBeInTheDocument()
  })

  it('keeps a user collapse across an unchanged re-render', () => {
    const files = [fileDiff('src/app.ts')]
    const { rerender } = render(<FileTree files={files} onFileClick={vi.fn()} />)

    fireEvent.click(screen.getByText('src'))
    expect(screen.queryByText('app.ts')).not.toBeInTheDocument()

    // A fresh array with identical content must not remount and re-expand:
    // the diff poll produces a new array reference on every tick.
    rerender(<FileTree files={[fileDiff('src/app.ts')]} onFileClick={vi.fn()} />)

    expect(screen.queryByText('app.ts')).not.toBeInTheDocument()
  })

  it('opens a file when its row is activated', () => {
    const onFileClick = vi.fn()
    render(<FileTree files={[fileDiff('src/app.ts')]} onFileClick={onFileClick} />)

    fireEvent.click(screen.getByText('app.ts'))

    expect(onFileClick).toHaveBeenCalledWith('src/app.ts')
  })

  it('collapses and expands a directory without opening a file', () => {
    const onFileClick = vi.fn()
    render(<FileTree files={[fileDiff('src/app.ts')]} onFileClick={onFileClick} />)

    fireEvent.click(screen.getByText('src'))
    expect(screen.queryByText('app.ts')).not.toBeInTheDocument()
    expect(onFileClick).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('src'))
    expect(screen.getByText('app.ts')).toBeInTheDocument()
  })

  it('shows per-file status and change counts', () => {
    render(
      <FileTree
        files={[
          fileDiff(
            'added.ts',
            3,
            0,
            'diff --git a/added.ts b/added.ts\nnew file mode 100644\n@@ -0,0 +1 @@\n+x',
          ),
          fileDiff(
            'gone.ts',
            0,
            5,
            'diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n@@ -1 +0,0 @@\n-x',
          ),
        ]}
        onFileClick={vi.fn()}
      />,
    )

    expect(screen.getByRole('img', { name: 'added' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'deleted' })).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('-5')).toBeInTheDocument()
  })

  it('windows a large changed-file list and reveals later rows on scroll', () => {
    const files = Array.from({ length: 80 }, (_, index) =>
      fileDiff(`src/file-${String(index).padStart(3, '0')}.ts`),
    )
    render(<FileTree files={files} onFileClick={vi.fn()} />)

    expect(screen.getAllByRole('treeitem').length).toBeLessThan(40)
    expect(screen.queryByText('file-079.ts')).not.toBeInTheDocument()
    const focusedRow = screen.getByText('src').closest('button')
    expect(focusedRow).not.toBeNull()
    focusedRow?.focus()

    const tree = screen.getByRole('tree')
    Object.defineProperty(tree, 'scrollTop', { configurable: true, value: 1_760 })
    fireEvent.scroll(tree)

    expect(screen.getByText('file-079.ts')).toBeInTheDocument()
    expect(screen.getByText('src').closest('button')).toBe(focusedRow)
    expect(focusedRow).toHaveFocus()
    expect(screen.getAllByRole('treeitem').length).toBeLessThan(40)
  })

  it('keeps virtual geometry aligned when the interface scale changes', async () => {
    const root = document.documentElement
    const previousFontSize = root.style.fontSize
    try {
      render(<FileTree files={[fileDiff('src/app.ts')]} onFileClick={vi.fn()} />)
      const virtualSpace = document.querySelector('[data-navigator-virtual-space="true"]')
      expect(virtualSpace).toHaveStyle({ height: '44px' })

      root.style.fontSize = '20px'

      await waitFor(() => expect(virtualSpace).toHaveStyle({ height: '55px' }))
    } finally {
      root.style.fontSize = previousFontSize
    }
  })
})

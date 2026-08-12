import type { GitFileDiff } from '@shared/types/git'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../FileTree'

function fileDiff(path: string, additions = 1, deletions = 1, diff = '@@ -1 +1 @@\n-a\n+b') {
  return { path, diff, additions, deletions } satisfies GitFileDiff
}

describe('Changed-file navigator', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('exposes ARIA tree semantics from the tree library', () => {
    render(<FileTree files={[fileDiff('src/app.ts')]} onFileClick={vi.fn()} />)

    expect(screen.getByRole('tree')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(0)
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

  it('resizes with the keyboard and persists the width', () => {
    const { unmount } = render(<FileTree files={[fileDiff('a.ts')]} onFileClick={vi.fn()} />)

    const rail = screen.getByRole('button', { name: /Resize changed file list/ })
    // Left widens, because the navigator is docked on the right.
    fireEvent.keyDown(rail, { key: 'ArrowLeft' })

    const widened = screen.getByRole('button', { name: /Resize changed file list/ })
    expect(widened.getAttribute('aria-label')).toMatch(/236 pixels/)

    unmount()
    render(<FileTree files={[fileDiff('a.ts')]} onFileClick={vi.fn()} />)
    expect(
      screen.getByRole('button', { name: /Resize changed file list/ }).getAttribute('aria-label'),
    ).toMatch(/236 pixels/)
  })

  it('clamps the width at its minimum', () => {
    render(<FileTree files={[fileDiff('a.ts')]} onFileClick={vi.fn()} />)
    const rail = screen.getByRole('button', { name: /Resize changed file list/ })

    for (let press = 0; press < 12; press += 1) {
      fireEvent.keyDown(rail, { key: 'ArrowRight' })
    }

    expect(
      screen.getByRole('button', { name: /Resize changed file list/ }).getAttribute('aria-label'),
    ).toMatch(/140 pixels/)
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiffCodeView } from '../DiffCodeView'
import { fileDiff } from './diff-panel.test-harness'

vi.mock('@pierre/diffs/react', async () => ({
  CodeView: (await import('./diff-panel.test-harness')).StubCodeView,
}))

const VIEW_OPTIONS = { syntaxTheme: 'github-dark', diffView: 'unified', wrapLines: false } as const

describe('review comment anchoring', () => {
  it('anchors a selection to the exact file, not one whose path is a suffix of it', () => {
    /*
     * The file was recovered with `id.endsWith(path)`. Item ids are `diff:<path>`, so for a diff
     * containing both README.md and docs/README.md the id `diff:docs/README.md` matched README.md
     * and `find` returned whichever git listed first. The comment, the filePath sent to the agent
     * and the snippet all named a file the reviewer never looked at.
     */
    const onSetActiveComment = vi.fn()
    render(
      <DiffCodeView
        files={[fileDiff('README.md'), fileDiff('docs/README.md')]}
        isLoading={false}
        loadError={null}
        onRetryLoad={vi.fn()}
        viewOptions={VIEW_OPTIONS}
        review={{
          comments: [],
          activeCommentLocation: null,
          onSetActiveComment,
          onAddSingleComment: vi.fn(),
          onAddToReview: vi.fn(),
          onRemoveComment: vi.fn(),
        }}
      />,
    )

    // The stub exposes one "select" button per rendered file, in diff order.
    const selectButtons = screen.getAllByRole('button', { name: /^select/ })
    const nestedFileButton = selectButtons.at(1)
    if (!nestedFileButton) throw new Error('expected a button for the nested file')
    nestedFileButton.click()

    expect(onSetActiveComment).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'docs/README.md' }),
    )
  })
})

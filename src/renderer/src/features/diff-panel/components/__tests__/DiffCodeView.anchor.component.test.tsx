import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DiffCodeView } from '../DiffCodeView'
import { fileDiff } from './diff-panel.test-harness'

const pierreMocks = vi.hoisted(() => ({ workerProvider: vi.fn() }))

vi.mock('@pierre/diffs/react', async () => ({
  CodeView: (await import('./diff-panel.test-harness')).StubCodeView,
  WorkerPoolContextProvider: ({
    children,
    poolOptions,
    highlighterOptions,
  }: {
    children: ReactNode
    poolOptions: unknown
    highlighterOptions: unknown
  }) => {
    pierreMocks.workerProvider({ poolOptions, highlighterOptions })
    return children
  },
}))

const VIEW_OPTIONS = { syntaxTheme: 'github-dark', diffView: 'unified', wrapLines: false } as const

describe('review comment anchoring', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('yields before mounting a multi-file diff worker', async () => {
    pierreMocks.workerProvider.mockClear()
    render(
      <DiffCodeView
        files={Array.from({ length: 8 }, (_, index) => fileDiff(`src/file-${String(index)}.ts`))}
        isLoading={false}
        loadError={null}
        onRetryLoad={vi.fn()}
        viewOptions={VIEW_OPTIONS}
        review={{
          comments: [],
          activeCommentLocation: null,
          onSetActiveComment: vi.fn(),
          onAddSingleComment: vi.fn(),
          onAddToReview: vi.fn(),
          onRemoveComment: vi.fn(),
        }}
      />,
    )

    expect(screen.getByLabelText('Loading')).toBeVisible()
    expect(pierreMocks.workerProvider).not.toHaveBeenCalled()
    await waitFor(() => expect(pierreMocks.workerProvider).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^select/ })).toHaveLength(8))
  })

  it('replays navigation once a late progressive item is prepared', async () => {
    render(
      <DiffCodeView
        files={Array.from({ length: 8 }, (_, index) => fileDiff(`src/file-${String(index)}.ts`))}
        fileNavigation={{ path: 'src/file-7.ts', requestId: 1 }}
        isLoading={false}
        loadError={null}
        onRetryLoad={vi.fn()}
        viewOptions={VIEW_OPTIONS}
        review={{
          comments: [],
          activeCommentLocation: null,
          onSetActiveComment: vi.fn(),
          onAddSingleComment: vi.fn(),
          onAddToReview: vi.fn(),
          onRemoveComment: vi.fn(),
        }}
      />,
    )

    await waitFor(() =>
      expect(screen.getByTestId('code-view')).toHaveAttribute(
        'data-scrolled-item-id',
        'diff:src/file-7.ts',
      ),
    )
  })

  it('offloads a single oversized patch before parsing it', async () => {
    const posted: unknown[] = []
    class ParserWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage(message: unknown) {
        posted.push(message)
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', ParserWorker)
    const oversized = fileDiff('src/large.ts')

    render(
      <DiffCodeView
        files={[{ ...oversized, diff: `${oversized.diff}\n${'x'.repeat(70 * 1024)}` }]}
        isLoading={false}
        loadError={null}
        onRetryLoad={vi.fn()}
        viewOptions={VIEW_OPTIONS}
        review={{
          comments: [],
          activeCommentLocation: null,
          onSetActiveComment: vi.fn(),
          onAddSingleComment: vi.fn(),
          onAddToReview: vi.fn(),
          onRemoveComment: vi.fn(),
        }}
      />,
    )

    expect(screen.getByLabelText('Loading')).toBeVisible()
    await waitFor(() => expect(posted).toHaveLength(1))
  })

  it('routes diff rendering through a bounded worker pool', () => {
    render(
      <DiffCodeView
        files={[fileDiff()]}
        isLoading={false}
        loadError={null}
        onRetryLoad={vi.fn()}
        viewOptions={VIEW_OPTIONS}
        review={{
          comments: [],
          activeCommentLocation: null,
          onSetActiveComment: vi.fn(),
          onAddSingleComment: vi.fn(),
          onAddToReview: vi.fn(),
          onRemoveComment: vi.fn(),
        }}
      />,
    )

    expect(pierreMocks.workerProvider).toHaveBeenCalledWith({
      poolOptions: expect.objectContaining({ poolSize: 1 }),
      highlighterOptions: { theme: 'github-dark' },
    })
  })

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

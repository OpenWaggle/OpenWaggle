import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  type DiffParserWorkerResponse,
  parseCodeViewItems,
} from '@/features/diff-panel/lib/code-view-items'
import { DiffCodeView } from '../DiffCodeView'
import { fileDiff } from './diff-panel.test-harness'

const pierreMocks = vi.hoisted(() => ({
  headerOnly: vi.fn(() => false),
  setRenderOptions: vi.fn(async () => {}),
}))

vi.mock('@pierre/diffs/react', async () => {
  const { StubCodeView } = await import('./diff-panel.test-harness')
  type StubProps = Parameters<typeof StubCodeView>[0]
  function HeaderOnlyCodeView() {
    return (
      <div
        data-testid="code-view"
        ref={(host) => {
          if (!host || host.querySelector('diffs-container')) return
          const container = document.createElement('diffs-container')
          host.append(container)
          const shadowRoot = container.shadowRoot
          if (!shadowRoot) throw new Error('expected the test diffs container to expose its root')
          const header = document.createElement('div')
          header.dataset.diffsHeader = 'diff'
          shadowRoot.append(header)
        }}
      />
    )
  }
  return {
    CodeView: (props: StubProps) =>
      pierreMocks.headerOnly() ? <HeaderOnlyCodeView /> : <StubCodeView {...props} />,
    WorkerPoolContextProvider: ({ children }: { children: ReactNode }) => children,
    useWorkerPool: () => ({ setRenderOptions: pierreMocks.setRenderOptions }),
  }
})

const VIEW_OPTIONS = { syntaxTheme: 'github-dark', diffView: 'unified', wrapLines: false } as const
const REVIEW = {
  comments: [],
  activeCommentLocation: null,
  onSetActiveComment: vi.fn(),
  onAddSingleComment: vi.fn(),
  onAddToReview: vi.fn(),
  onRemoveComment: vi.fn(),
} as const

function renderDiff(files: readonly ReturnType<typeof fileDiff>[], onRetryLoad = vi.fn()) {
  return render(
    <DiffCodeView
      files={files}
      isLoading={false}
      loadError={null}
      onRetryLoad={onRetryLoad}
      viewOptions={VIEW_OPTIONS}
      review={REVIEW}
    />,
  )
}

function oversizedDiff(path = 'src/large.ts') {
  const file = fileDiff(path)
  return { ...file, diff: `${file.diff}\n${'x'.repeat(70 * 1024)}` }
}

describe('diff loading edges', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    pierreMocks.headerOnly.mockReturnValue(false)
  })

  it('accepts a completed header-only Pierre render', async () => {
    pierreMocks.headerOnly.mockReturnValue(true)
    const { container } = renderDiff([fileDiff('src/renamed.ts')])

    await waitFor(() => expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument())
    expect(container.querySelector('[data-diff-code-ready]')).toHaveAttribute(
      'data-diff-code-ready',
      'true',
    )
    expect(container.querySelector('[data-diff-preparation-complete]')).toHaveAttribute(
      'data-diff-preparation-complete',
      'true',
    )
  })

  it('surfaces an oversized parser failure instead of spinning forever', async () => {
    class FailingParserWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage() {
        this.onmessage?.(
          new MessageEvent('message', { data: { ok: false, error: 'Parser exploded.' } }),
        )
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', FailingParserWorker)
    const onRetryLoad = vi.fn()
    renderDiff([oversizedDiff()], onRetryLoad)

    expect(await screen.findByText('Parser exploded.')).toBeVisible()
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
    screen.getByRole('button', { name: 'Try again' }).click()
    expect(onRetryLoad).toHaveBeenCalledOnce()
  })

  it('publishes ordinary files before offloading one oversized patch', async () => {
    const posted: unknown[] = []
    let finishParsing: () => void = () => {
      throw new Error('Parser worker did not receive a request.')
    }
    class PendingParserWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      postMessage(message: unknown) {
        posted.push(message)
        finishParsing = () => {
          this.onmessage?.(
            new MessageEvent('message', {
              data: {
                ok: true,
                items: parseCodeViewItems([fileDiff('src/large.ts')]),
              } satisfies DiffParserWorkerResponse,
            }),
          )
        }
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', PendingParserWorker)
    const { container } = renderDiff([fileDiff('src/first.ts'), oversizedDiff('src/large.ts')])

    expect(await screen.findByRole('button', { name: 'select src/app.ts' })).toBeVisible()
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toEqual({ files: [expect.objectContaining({ path: 'src/large.ts' })] })
    expect(container.querySelector('[data-diff-preparation-complete]')).toHaveAttribute(
      'data-diff-preparation-complete',
      'false',
    )
    finishParsing()
    await waitFor(() =>
      expect(container.querySelector('[data-diff-preparation-complete]')).toHaveAttribute(
        'data-diff-preparation-complete',
        'true',
      ),
    )
  })
})

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PIERRE_WORKER_POOL_OPTIONS } from '@/shared/lib/syntax/pierre-worker-pool'
import { DiffBlock } from '../DiffBlock'

const pierreMocks = vi.hoisted(() => ({
  setRenderOptions: vi.fn(async () => undefined),
  patchDiff: vi.fn((_props: { readonly patch: string; readonly options: object }) => null),
  workerProvider: vi.fn((_props: { readonly poolOptions: unknown }) => undefined),
}))

vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: (props: { readonly patch: string; readonly options: object }) =>
    pierreMocks.patchDiff(props),
  useWorkerPool: () => ({ setRenderOptions: pierreMocks.setRenderOptions }),
  WorkerPoolContextProvider: ({
    children,
    poolOptions,
  }: {
    readonly children: ReactNode
    readonly poolOptions: unknown
  }) => {
    pierreMocks.workerProvider({ poolOptions })
    return children
  },
}))

vi.mock('../SourceView', () => ({
  SourceView: ({ className }: { readonly className?: string }) => (
    <section aria-label="Large diff source" className={className} />
  ),
}))

vi.mock('@/shared/lib/syntax/pierre-syntax-runtime', () => ({
  registerPendingPierreSyntaxResources: vi.fn(),
}))

describe('DiffBlock', () => {
  it('updates the mounted Pierre worker when the Syntax theme changes', () => {
    const props = {
      patch: '@@ -1 +1 @@\n-old\n+new',
      view: 'unified',
      wrap: false,
    } as const
    const view = render(<DiffBlock {...props} theme="dark-plus" />)

    expect(pierreMocks.setRenderOptions).toHaveBeenCalledWith({ theme: 'dark-plus' })
    pierreMocks.setRenderOptions.mockClear()
    view.rerender(<DiffBlock {...props} theme="github-light" />)

    expect(pierreMocks.setRenderOptions).toHaveBeenCalledWith({ theme: 'github-light' })
  })

  it('hides the file header and quiets hunk separators when embedded in a card', () => {
    const patch = '--- a.ts\n+++ a.ts\n@@ -1 +1 @@\n-old\n+new'
    render(<DiffBlock patch={patch} view="unified" wrap theme="dark-plus" embedded />)

    expect(pierreMocks.patchDiff).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patch,
        options: expect.objectContaining({
          disableFileHeader: true,
          hunkSeparators: 'simple',
          diffStyle: 'unified',
          overflow: 'wrap',
          unsafeCSS: expect.stringContaining(
            '[data-code] { max-height: 15rem; overflow-y: auto; }',
          ),
        }),
      }),
    )
  })

  it('gives an embedded oversized diff a fixed scrolling height', () => {
    const patch = `@@ -1,2000 +1,2000 @@\n${'+line\n'.repeat(2000)}`
    render(<DiffBlock patch={patch} view="unified" wrap theme="dark-plus" embedded />)

    expect(screen.getByRole('region', { name: 'Large diff source' })).toHaveClass('h-60')
    expect(screen.getByRole('region', { name: 'Large diff source' })).not.toHaveClass('max-h-128')
  })

  it('keeps the Pierre file header outside a card', () => {
    render(<DiffBlock patch="@@ -1 +1 @@\n-a\n+b" view="split" wrap={false} theme="dark-plus" />)

    const options = pierreMocks.patchDiff.mock.lastCall?.[0].options
    expect(options).not.toHaveProperty('disableFileHeader')
    expect(options).toMatchObject({ diffStyle: 'split', overflow: 'scroll' })
  })

  it('joins the shared Pierre worker pool every surface uses', () => {
    render(<DiffBlock patch="@@ -1 +1 @@\n-a\n+b" view="unified" wrap theme="dark-plus" />)

    expect(pierreMocks.workerProvider).toHaveBeenLastCalledWith({
      poolOptions: PIERRE_WORKER_POOL_OPTIONS,
    })
  })
})

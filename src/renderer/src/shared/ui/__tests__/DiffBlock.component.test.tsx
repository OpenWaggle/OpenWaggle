import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DiffBlock } from '../DiffBlock'

const pierreMocks = vi.hoisted(() => ({
  setRenderOptions: vi.fn(async () => undefined),
}))

vi.mock('@pierre/diffs/react', () => ({
  PatchDiff: () => null,
  useWorkerPool: () => ({ setRenderOptions: pierreMocks.setRenderOptions }),
  WorkerPoolContextProvider: ({ children }: { readonly children: ReactNode }) => children,
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
})

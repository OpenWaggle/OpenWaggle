import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FocusedSourceEditor } from '../FocusedSourceEditor'

const pierreMocks = vi.hoisted(() => ({
  highlighterOptions: vi.fn(),
  setRenderOptions: vi.fn(async () => undefined),
  syntaxTheme: {
    shikiTheme: 'dark-plus',
    variant: 'dark',
  },
}))

vi.mock('@pierre/diffs/edit', () => ({
  Editor: class Editor {},
}))

vi.mock('@pierre/diffs/react', () => ({
  EditProvider: ({ children }: { children: ReactNode }) => children,
  File: () => null,
  Virtualizer: ({ children }: { children: ReactNode }) => children,
  useWorkerPool: () => ({ setRenderOptions: pierreMocks.setRenderOptions }),
  WorkerPoolContextProvider: ({
    children,
    highlighterOptions,
  }: {
    children: ReactNode
    highlighterOptions: unknown
  }) => {
    pierreMocks.highlighterOptions(highlighterOptions)
    return children
  },
}))

vi.mock('@/shared/hooks/useSyntaxTheme', () => ({
  useSyntaxTheme: () => pierreMocks.syntaxTheme,
}))

vi.mock('@/shared/lib/syntax/pierre-syntax-runtime', () => ({
  pierreLanguageId: (language: string) => language,
}))

describe('FocusedSourceEditor', () => {
  beforeEach(() => {
    pierreMocks.highlighterOptions.mockClear()
    pierreMocks.setRenderOptions.mockClear()
    pierreMocks.syntaxTheme.shikiTheme = 'dark-plus'
    pierreMocks.syntaxTheme.variant = 'dark'
  })

  it('initializes Pierre with the active Syntax theme', () => {
    render(
      <FocusedSourceEditor
        source="const value = 42"
        path="src/example.ts"
        language="typescript"
        cacheKey="/project\u0000src/example.ts\u0000revision-1"
        wordWrap={false}
        ariaLabel="Edit src/example.ts"
        onChange={() => undefined}
        onSave={() => undefined}
      />,
    )

    expect(pierreMocks.highlighterOptions).toHaveBeenCalledWith({
      langs: ['typescript'],
      theme: 'dark-plus',
    })
    expect(pierreMocks.setRenderOptions).toHaveBeenCalledWith({ theme: 'dark-plus' })
  })

  it('updates the mounted Pierre worker when the active Syntax theme changes', () => {
    const props = {
      source: 'const value = 42',
      path: 'src/example.ts',
      language: 'typescript',
      cacheKey: '/project\u0000src/example.ts\u0000revision-1',
      wordWrap: false,
      ariaLabel: 'Edit src/example.ts',
      onChange: () => undefined,
      onSave: () => undefined,
    } as const
    const view = render(<FocusedSourceEditor {...props} />)

    pierreMocks.setRenderOptions.mockClear()
    pierreMocks.syntaxTheme.shikiTheme = 'github-light'
    pierreMocks.syntaxTheme.variant = 'light'
    view.rerender(<FocusedSourceEditor {...props} />)

    expect(pierreMocks.setRenderOptions).toHaveBeenCalledWith({ theme: 'github-light' })
  })
})

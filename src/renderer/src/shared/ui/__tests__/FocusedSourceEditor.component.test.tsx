import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FocusedSourceEditor } from '../FocusedSourceEditor'

const pierreMocks = vi.hoisted(() => ({
  highlighterOptions: vi.fn(),
}))

vi.mock('@pierre/diffs/edit', () => ({
  Editor: class Editor {},
}))

vi.mock('@pierre/diffs/react', () => ({
  EditProvider: ({ children }: { children: ReactNode }) => children,
  File: () => null,
  Virtualizer: ({ children }: { children: ReactNode }) => children,
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
  useSyntaxTheme: () => ({
    shikiTheme: 'dark-plus',
    variant: 'dark',
  }),
}))

vi.mock('@/shared/lib/syntax/pierre-syntax-runtime', () => ({
  pierreLanguageId: (language: string) => language,
}))

describe('FocusedSourceEditor', () => {
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
  })
})

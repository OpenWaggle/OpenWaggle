import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SyntaxBlock } from '../SyntaxBlock'

const syntaxMocks = vi.hoisted(() => ({
  highlight: vi.fn(
    async ({
      language,
      theme,
      lineRange,
    }: {
      language: string
      theme: string
      lineRange?: { start: number; end: number }
    }) => ({
      status: 'plain-text' as const,
      language,
      theme,
      lines: [],
      lineOffset: lineRange?.start ?? 0,
      elapsedMs: 0,
    }),
  ),
}))

vi.mock('@/shared/hooks/useSyntaxTheme', () => ({
  useSyntaxTheme: () => ({ shikiTheme: 'dark-plus' }),
}))

vi.mock('@/shared/lib/syntax/syntax-service', () => ({
  syntaxService: {
    highlight: syntaxMocks.highlight,
  },
}))

describe('SyntaxBlock rendering tiers', () => {
  it('keeps compact source on the lightweight preformatted surface', () => {
    render(<SyntaxBlock source="const value = 42" language="typescript" ariaLabel="Snippet" />)

    const region = screen.getByRole('region', { name: 'Snippet' })
    expect(region.querySelector('pre')).not.toBeNull()
  })

  it('bounds mounted rows for large highlighted payloads', async () => {
    const source = Array.from(
      { length: 5_000 },
      (_, index) => `const value${index} = ${index}`,
    ).join('\n')
    render(<SyntaxBlock source={source} language="typescript" ariaLabel="Large payload" />)

    const region = screen.getByRole('region', { name: 'Large payload' })
    await waitFor(() => expect(syntaxMocks.highlight).toHaveBeenCalled())
    expect(region.querySelector('pre')).toBeNull()
    expect(region.querySelectorAll('[data-line-number]').length).toBeLessThan(100)
  })
})

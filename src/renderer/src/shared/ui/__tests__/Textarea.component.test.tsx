import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { codeToTokensBaseMock, getHighlighterMock, warnMock } = vi.hoisted(() => ({
  codeToTokensBaseMock: vi.fn(),
  getHighlighterMock: vi.fn(),
  warnMock: vi.fn(),
}))

vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: vi.fn(() => ({
    warn: warnMock,
  })),
}))

vi.mock('@/shared/lib/shiki/highlighter', () => ({
  DEFAULT_THEME: 'github-dark',
  getHighlighter: getHighlighterMock,
  resolveLanguage: vi.fn((language: string) => (language === 'json' ? 'json' : undefined)),
}))

const { Textarea } = await import('../Textarea')

describe('Textarea', () => {
  beforeEach(() => {
    codeToTokensBaseMock.mockReset()
    warnMock.mockReset()
    getHighlighterMock.mockReset()
    getHighlighterMock.mockResolvedValue({
      codeToTokensBase: codeToTokensBaseMock,
    })
  })

  it('renders a Shiki token overlay when a highlight language is provided', async () => {
    codeToTokensBaseMock.mockReturnValue([
      [{ content: '{', offset: 0, color: '#f0f6fc' }],
      [
        { content: '  ', offset: 1 },
        { content: '"mcpServers"', offset: 3, color: '#79c0ff' },
      ],
      [{ content: '}', offset: 15, color: '#f0f6fc' }],
    ])

    const { container } = render(
      <Textarea highlightLanguage="json" value={'{\n  "mcpServers"\n}'} readOnly />,
    )

    await waitFor(() => {
      expect(codeToTokensBaseMock).toHaveBeenCalledWith('{\n  "mcpServers"\n}', {
        lang: 'json',
        theme: 'github-dark',
      })
    })

    expect(screen.getByRole('textbox')).toHaveClass('!text-transparent')
    expect(container.querySelector('pre')).toHaveClass('m-0')
    expect(container.querySelector('code')).toHaveClass('text-[13px]')
    expect(screen.getByText('"mcpServers"')).toHaveStyle({ color: '#79c0ff' })
  })

  it('uses matching mono text metrics for highlighted code and the textarea caret layer', async () => {
    codeToTokensBaseMock.mockReturnValue([[{ content: '{}', offset: 0, color: '#f0f6fc' }]])

    const { container } = render(
      <Textarea highlightLanguage="json" variant="mono" value="{}" readOnly />,
    )

    await waitFor(() => {
      expect(codeToTokensBaseMock).toHaveBeenCalled()
    })

    expect(screen.getByRole('textbox')).toHaveClass('font-mono', 'text-[12px]', 'leading-5')
    expect(container.querySelector('code')).toHaveClass('font-mono', 'text-[12px]', 'leading-5')
  })

  it('logs and falls back when the syntax highlighter cannot load', async () => {
    getHighlighterMock.mockRejectedValueOnce(new Error('highlighter unavailable'))

    const { container } = render(<Textarea highlightLanguage="json" value="{}" readOnly />)

    await waitFor(() => {
      expect(warnMock).toHaveBeenCalledWith('Failed to load syntax highlighter', {
        language: 'json',
        error: 'highlighter unavailable',
      })
    })

    expect(screen.getByRole('textbox')).not.toHaveClass('!text-transparent')
    expect(container.querySelector('pre')).toBeNull()
  })
})

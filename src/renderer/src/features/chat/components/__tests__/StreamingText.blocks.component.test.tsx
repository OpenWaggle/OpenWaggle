import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Completed blocks parse through the block processor; the live tail through react-markdown. */
const parses = vi.hoisted(() => ({ count: 0, tails: 0 }))

vi.mock('react-markdown', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-markdown')>()
  const Markdown = original.default
  return {
    ...original,
    default: function CountedMarkdown(props: Parameters<typeof Markdown>[0]) {
      parses.tails += 1
      return <Markdown {...props} />
    },
  }
})

vi.mock('remark-parse', async (importOriginal) => {
  const original = await importOriginal<typeof import('remark-parse')>()
  return {
    default: function countedRemarkParse(this: unknown, ...args: unknown[]) {
      const parser: unknown = Reflect.apply(original.default, this, args)
      const originalParser = Reflect.get(Object(this), 'parser')
      Reflect.set(Object(this), 'parser', (document: string, file: unknown) => {
        parses.count += 1
        return Reflect.apply(originalParser, this, [document, file])
      })
      return parser
    },
  }
})

vi.mock('@/shared/lib/syntax/syntax-service', () => ({
  syntaxService: {
    highlight: vi.fn(async (input: { source: string; language: string; theme: string }) => ({
      status: 'plain-text' as const,
      language: input.language,
      theme: input.theme,
      lines: input.source.split('\n').map((line) => [{ content: line }]),
      elapsedMs: 0,
    })),
  },
}))

import { ChatDisplayPathProvider } from '../ChatDisplayPathContext'
import { StreamingText } from '../StreamingText'

const PARAGRAPHS = 30

function streamed(text: string, isStreaming = true) {
  return (
    <ChatDisplayPathProvider projectPath="/repo" worktreePath={null} workingPath="/repo">
      <StreamingText text={text} isStreaming={isStreaming} />
    </ChatDisplayPathProvider>
  )
}

/**
 * Streaming Markdown renders each completed block once (B9, ADR 0026). It used to re-render the
 * whole parsed prefix whenever a paragraph completed, and to re-parse a whole open fence on every
 * token.
 */
describe('streaming Markdown blocks', () => {
  beforeEach(() => {
    parses.count = 0
    parses.tails = 0
  })

  it('parses only the tail per token, however many blocks came before it', () => {
    const prefix = Array.from(
      { length: PARAGRAPHS },
      (_, index) => `Paragraph ${String(index)} about /repo/src/file-${String(index)}.ts.\n\n`,
    ).join('')
    const view = render(streamed(`${prefix}The tail`))
    expect(parses.count).toBe(PARAGRAPHS)
    parses.count = 0
    parses.tails = 0

    view.rerender(streamed(`${prefix}The tail grows`))
    view.rerender(streamed(`${prefix}The tail grows again`))

    expect(parses.count).toBe(0)
    expect(parses.tails).toBe(2)
    // Display paths are shortened in completed blocks too.
    expect(view.container.textContent).toContain('Paragraph 29 about src/file-29.ts.')
  })

  it('parses each completed block once as more blocks complete', () => {
    const view = render(streamed('One\n\nTwo'))
    parses.count = 0

    view.rerender(streamed('One\n\nTwo\n\nThree'))

    // "Two" completed and is parsed once; "One" is not parsed again.
    expect(parses.count).toBe(1)
  })

  it('does not parse an open fence while its lines stream', () => {
    const view = render(streamed('Code:\n```ts\nconst a = 1\n'))
    parses.count = 0
    parses.tails = 0

    view.rerender(streamed('Code:\n```ts\nconst a = 1\nconst b = 2\n'))

    expect(parses.count + parses.tails).toBe(0)
    expect(screen.getByLabelText('ts streaming source').textContent).toContain(
      'const a = 1\nconst b = 2',
    )
  })

  it('renders the same document while streaming as once settled', () => {
    const text = [
      '## Plan',
      '',
      'Read **/repo/src/a.ts** first, see [docs](https://example.com).',
      '- one',
      '- two',
      '```ts',
      'export const a = 1',
      '```',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      'Done.',
    ].join('\n')
    const streaming = render(streamed(text))
    const settled = render(streamed(text, false))

    // Separately parsed blocks have no whitespace text between them; the layout is the same.
    const words = (element: HTMLElement) => element.textContent?.replace(/\s+/gu, '')
    expect(words(streaming.container)).toBe(words(settled.container))
    expect(streaming.container.querySelectorAll('li')).toHaveLength(2)
    expect(streaming.container.querySelector('table')).not.toBeNull()
    expect(streaming.container.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  })
})

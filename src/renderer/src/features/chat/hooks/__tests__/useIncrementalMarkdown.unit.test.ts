// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { findSplitIndex, useIncrementalMarkdown } from '../useIncrementalMarkdown'

describe('findSplitIndex', () => {
  it('returns -1 when no paragraph breaks exist', () => {
    expect(findSplitIndex('hello world no breaks')).toBe(-1)
    expect(findSplitIndex('single\nline break only')).toBe(-1)
  })

  it('splits correctly at last double-newline', () => {
    const text = 'paragraph one\n\nparagraph two\n\nparagraph three'
    const idx = findSplitIndex(text)
    // Should split at the last \n\n (between "two" and "three")
    expect(idx).toBe(text.lastIndexOf('\n\n') + 2)
    expect(text.slice(0, idx)).toBe('paragraph one\n\nparagraph two\n\n')
    expect(text.slice(idx)).toBe('paragraph three')
  })

  it('does not split inside a code fence', () => {
    const text = 'before\n\n```\ncode block\n\nstill in fence\n```\n\nafter fence'
    const idx = findSplitIndex(text)
    // The \n\n inside the fence should be skipped.
    // Valid split is the \n\n after the closing fence (before "after fence").
    const prefix = text.slice(0, idx)
    const tail = text.slice(idx)
    expect(prefix).toContain('```')
    expect(prefix).toContain('still in fence')
    expect(tail).toBe('after fence')
  })

  it('skips all split points when entire text is inside an open fence', () => {
    const text = '```\nline one\n\nline two\n\nline three'
    expect(findSplitIndex(text)).toBe(-1)
  })

  it('handles multiple code fences correctly', () => {
    const text = 'intro\n\n```\ncode1\n```\n\nmiddle\n\n```\ncode2\n```\n\nend'
    const idx = findSplitIndex(text)
    expect(text.slice(idx)).toBe('end')
  })

  it('honors CommonMark tilde, indentation, and delimiter-length rules', () => {
    expect(findSplitIndex('~~~ts\none\n\ninside\n~~~\n\nafter')).toBe(
      '~~~ts\none\n\ninside\n~~~\n\n'.length,
    )
    expect(findSplitIndex('   ```ts\none\n\ninside\n   ```\n\nafter')).toBe(
      '   ```ts\none\n\ninside\n   ```\n\n'.length,
    )
    expect(findSplitIndex('    ```ts\nordinary indented code\n\nafter')).toBe(
      '    ```ts\nordinary indented code\n\n'.length,
    )
    expect(findSplitIndex('````ts\none\n```\n\nstill fenced')).toBe(-1)
  })
})

describe('useIncrementalMarkdown', () => {
  it('returns full text as tail when not streaming', () => {
    const text = 'paragraph one\n\nparagraph two'
    const { result } = renderHook(() => useIncrementalMarkdown(text, false))
    expect(result.current.prefixHast).toBeNull()
    expect(result.current.tail).toBe(text)
    expect(result.current.prefixKey).toBe('')
  })

  it('splits text and returns HAST prefix when streaming', () => {
    const text = 'paragraph one\n\nparagraph two'
    const { result } = renderHook(() => useIncrementalMarkdown(text, true))
    expect(result.current.prefixHast).not.toBeNull()
    expect(result.current.prefixHast?.type).toBe('root')
    expect(result.current.tail).toBe('paragraph two')
    expect(result.current.prefixKey).toBe('paragraph one\n\n')
  })

  it('returns cached HAST on repeated renders with same prefix', () => {
    const text = 'paragraph one\n\nparagraph two'
    const { result, rerender } = renderHook(() => useIncrementalMarkdown(text, true))

    const firstHast = result.current.prefixHast

    // Re-render with the same text — should return the same cached object
    rerender()
    expect(result.current.prefixHast).toBe(firstHast)
  })

  it('returns full text when streaming but no paragraph breaks', () => {
    const text = 'single paragraph still streaming'
    const { result } = renderHook(() => useIncrementalMarkdown(text, true))
    expect(result.current.prefixHast).toBeNull()
    expect(result.current.tail).toBe(text)
    expect(result.current.prefixKey).toBe('')
  })

  it('incrementally extends prefix HAST when new paragraphs arrive', () => {
    let text = 'paragraph one\n\nparagraph two'
    const { result, rerender } = renderHook(({ t }) => useIncrementalMarkdown(t, true), {
      initialProps: { t: text },
    })

    const firstHast = result.current.prefixHast
    expect(firstHast).not.toBeNull()
    const initialChildCount = firstHast?.children.length ?? 0

    // Add a third paragraph — prefix should grow incrementally
    text = 'paragraph one\n\nparagraph two\n\nparagraph three'
    rerender({ t: text })

    // New HAST reference (not mutated in-place) so React detects prop change
    expect(result.current.prefixHast).not.toBe(firstHast)
    // More children in the new tree
    expect(result.current.prefixHast?.children.length).toBeGreaterThan(initialChildCount)
    expect(result.current.tail).toBe('paragraph three')
  })

  it('reparses an earlier reference when its definition arrives in a later chunk', () => {
    const { result, rerender } = renderHook(({ text }) => useIncrementalMarkdown(text, true), {
      initialProps: { text: '[OpenWaggle][docs]\n\nStill streaming' },
    })
    expect(JSON.stringify(result.current.prefixHast)).not.toContain('"tagName":"a"')

    rerender({
      text: '[OpenWaggle][docs]\n\nParagraph\n\n[docs]: https://openwaggle.dev\n\nTail',
    })

    expect(result.current.prefixHast).toEqual(
      expect.objectContaining({
        children: expect.arrayContaining([
          expect.objectContaining({
            tagName: 'p',
            children: expect.arrayContaining([
              expect.objectContaining({
                tagName: 'a',
                properties: expect.objectContaining({ href: 'https://openwaggle.dev' }),
              }),
            ]),
          }),
        ]),
      }),
    )
  })

  it('keeps a delimiter split across chunks inside its fenced tail', () => {
    const { result, rerender } = renderHook(({ text }) => useIncrementalMarkdown(text, true), {
      initialProps: { text: '``' },
    })
    expect(result.current.prefixHast).toBeNull()

    rerender({ text: '```ts\nline one\n\nline two' })
    expect(result.current.prefixHast).toBeNull()
    expect(result.current.tail).toBe('```ts\nline one\n\nline two')

    rerender({ text: '```ts\nline one\n\nline two\n```\n\nafter' })
    expect(result.current.prefixKey).toBe('```ts\nline one\n\nline two\n```\n\n')
    expect(result.current.tail).toBe('after')
  })

  it('rebuilds the prefix after a non-monotonic text replacement', () => {
    const { result, rerender } = renderHook(({ text }) => useIncrementalMarkdown(text, true), {
      initialProps: { text: 'paragraph one\n\nparagraph two' },
    })
    const firstHast = result.current.prefixHast
    rerender({ text: 'replacement paragraph\n\nnew tail' })
    expect(result.current.prefixHast).not.toBe(firstHast)
    expect(result.current.prefixKey).toBe('replacement paragraph\n\n')
  })
})

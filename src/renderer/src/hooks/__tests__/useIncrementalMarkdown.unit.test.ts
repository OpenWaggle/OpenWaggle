// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/shiki/rehype-shiki-plugin', () => ({
  applyShikiToHast: vi.fn(),
}))

import { ShikiCache } from '@/lib/shiki/shiki-cache'
import { findSplitIndex, useIncrementalMarkdown } from '../useIncrementalMarkdown'

const SHIKI_OPTIONS = { highlighter: undefined, cache: new ShikiCache() }

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
})

describe('useIncrementalMarkdown', () => {
  it('returns full text as tail when not streaming', () => {
    const text = 'paragraph one\n\nparagraph two'
    const { result } = renderHook(() => useIncrementalMarkdown(text, false, SHIKI_OPTIONS))
    expect(result.current.prefixHast).toBeNull()
    expect(result.current.tail).toBe(text)
    expect(result.current.prefixKey).toBe('')
  })

  it('splits text and returns HAST prefix when streaming', () => {
    const text = 'paragraph one\n\nparagraph two'
    const { result } = renderHook(() => useIncrementalMarkdown(text, true, SHIKI_OPTIONS))
    expect(result.current.prefixHast).not.toBeNull()
    expect(result.current.prefixHast?.type).toBe('root')
    expect(result.current.tail).toBe('paragraph two')
    expect(result.current.prefixKey).toBe('paragraph one\n\n')
  })

  it('returns cached HAST on repeated renders with same prefix', () => {
    const text = 'paragraph one\n\nparagraph two'
    const { result, rerender } = renderHook(() => useIncrementalMarkdown(text, true, SHIKI_OPTIONS))

    const firstHast = result.current.prefixHast

    // Re-render with the same text — should return the same cached object
    rerender()
    expect(result.current.prefixHast).toBe(firstHast)
  })

  it('returns full text when streaming but no paragraph breaks', () => {
    const text = 'single paragraph still streaming'
    const { result } = renderHook(() => useIncrementalMarkdown(text, true, SHIKI_OPTIONS))
    expect(result.current.prefixHast).toBeNull()
    expect(result.current.tail).toBe(text)
    expect(result.current.prefixKey).toBe('')
  })

  it('incrementally extends prefix HAST when new paragraphs arrive', () => {
    let text = 'paragraph one\n\nparagraph two'
    const { result, rerender } = renderHook(
      ({ t }) => useIncrementalMarkdown(t, true, SHIKI_OPTIONS),
      { initialProps: { t: text } },
    )

    const firstHast = result.current.prefixHast
    expect(firstHast).not.toBeNull()
    const initialChildCount = firstHast?.children.length ?? 0

    // Add a third paragraph — prefix should grow incrementally
    text = 'paragraph one\n\nparagraph two\n\nparagraph three'
    rerender({ t: text })

    // Same HAST object reference (mutated in-place, not recreated)
    expect(result.current.prefixHast).toBe(firstHast)
    // More children appended
    expect(result.current.prefixHast?.children.length).toBeGreaterThan(initialChildCount)
    expect(result.current.tail).toBe('paragraph three')
  })

  it('invalidates prefix cache when highlighter changes', () => {
    const text = 'paragraph one\n\nparagraph two'
    const options1 = { highlighter: undefined, cache: new ShikiCache() }

    const { result, rerender } = renderHook(
      ({ opts }) => useIncrementalMarkdown(text, true, opts),
      { initialProps: { opts: options1 } },
    )

    const firstHast = result.current.prefixHast

    // Simulate highlighter becoming available
    const fakeHighlighter = {} as import('shiki').Highlighter
    const options2 = { highlighter: fakeHighlighter, cache: options1.cache }
    rerender({ opts: options2 })

    // Should produce a new HAST (cache was invalidated)
    expect(result.current.prefixHast).not.toBe(firstHast)
  })
})

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatRow } from '../../lib/types-chat-row'
import { useTranscriptWindowRange } from '../useTranscriptWindowRange'

const row = (id: string): ChatRow => ({
  type: 'message',
  message: { id, role: 'user', parts: [{ type: 'text', content: id }] },
  isStreaming: false,
  isRunActive: false,
  showTurnDivider: false,
})
const rowsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => row(`m-${String(index)}`))

describe('useTranscriptWindowRange', () => {
  it('stays bounded while rows arrive under an anchored reader', () => {
    let rows = rowsOf(400)
    let keys = rows.map((r) => (r.type === 'message' ? `message:${r.message.id}` : ''))
    const sizes: number[] = []
    const { result, rerender } = renderHook(() => {
      const range = useTranscriptWindowRange({
        rows,
        keys,
        anchorKey: null,
        isFollowing: () => false,
        following: false,
      })
      sizes.push(range.end - range.start)
      return range
    })
    const start = result.current.start

    // A long run appends 1,000 rows while the reader is up in history.
    rows = rowsOf(1_400)
    keys = rows.map((r) => (r.type === 'message' ? `message:${r.message.id}` : ''))
    act(() => rerender())

    // Review finding: the live window rendered 1,040 rows once before it was trimmed after commit.
    expect(Math.max(...sizes)).toBeLessThanOrEqual(160)
    expect(result.current.start).toBe(start)
    expect(result.current.hasLater).toBe(true)
  })

  it('rejoins the live end when the reader follows again', () => {
    let rows = rowsOf(400)
    let keys = rows.map((r) => (r.type === 'message' ? `message:${r.message.id}` : ''))
    let following = false
    const { result, rerender } = renderHook(() =>
      useTranscriptWindowRange({
        rows,
        keys,
        anchorKey: null,
        isFollowing: () => following,
        following,
      }),
    )
    rows = rowsOf(1_400)
    keys = rows.map((r) => (r.type === 'message' ? `message:${r.message.id}` : ''))
    act(() => rerender())
    expect(result.current.hasLater).toBe(true)

    // Review finding: returning to following left the capped slice with `hasLater` still set.
    following = true
    act(() => rerender())
    expect(result.current.hasLater).toBe(false)
    expect(result.current.end).toBe(1_400)
    expect(result.current.end - result.current.start).toBeLessThanOrEqual(160)
  })
})

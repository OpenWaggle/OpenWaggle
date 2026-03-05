import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  api: {
    onAgentPhase: vi.fn(() => vi.fn()),
    getAgentPhase: vi.fn(async () => null),
  },
}))

import { formatElapsed } from './useStreamingPhase'

describe('formatElapsed', () => {
  it('formats seconds under 60', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(3_000)).toBe('3s')
    expect(formatElapsed(11_500)).toBe('11s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  it('formats minutes and seconds at 60+', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s')
    expect(formatElapsed(83_000)).toBe('1m 23s')
    expect(formatElapsed(125_000)).toBe('2m 5s')
  })
})

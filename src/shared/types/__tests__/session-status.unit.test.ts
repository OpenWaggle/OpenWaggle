import { describe, expect, it } from 'vitest'
import { resolveSessionStatusPill, type SessionStatus, TERMINAL_STATUSES } from '../session-status'

describe('resolveSessionStatusPill', () => {
  it('returns null for idle status', () => {
    expect(resolveSessionStatusPill('idle')).toBeNull()
  })

  const statusCases: Array<{
    status: SessionStatus
    icon: string
    animateClass: string | null
  }> = [
    { status: 'working', icon: 'GitCompareArrows', animateClass: 'animate-pulse' },
    { status: 'connecting', icon: 'Loader2', animateClass: 'animate-spin' },
    { status: 'completed', icon: 'CircleCheck', animateClass: null },
    { status: 'awaiting-input', icon: 'MessageCircle', animateClass: null },
    { status: 'error', icon: 'XCircle', animateClass: null },
  ]

  for (const { status, icon, animateClass } of statusCases) {
    it(`maps "${status}" to icon "${icon}" with animateClass=${animateClass}`, () => {
      const pill = resolveSessionStatusPill(status)
      expect(pill).not.toBeNull()
      expect(pill?.icon).toBe(icon)
      expect(pill?.animateClass).toBe(animateClass)
      expect(pill?.colorClass).toBeTruthy()
    })
  }

  it('working and connecting use sky-500 color', () => {
    const working = resolveSessionStatusPill('working')
    const connecting = resolveSessionStatusPill('connecting')
    expect(working?.colorClass).toContain('sky-500')
    expect(connecting?.colorClass).toContain('sky-500')
  })

  it('completed uses emerald-500 color', () => {
    const pill = resolveSessionStatusPill('completed')
    expect(pill?.colorClass).toContain('emerald-500')
  })

  it('error uses red-500 color', () => {
    const pill = resolveSessionStatusPill('error')
    expect(pill?.colorClass).toContain('red-500')
  })
})

describe('TERMINAL_STATUSES', () => {
  it('contains exactly completed and error', () => {
    expect(TERMINAL_STATUSES.size).toBe(2)
    expect(TERMINAL_STATUSES.has('completed')).toBe(true)
    expect(TERMINAL_STATUSES.has('error')).toBe(true)
  })

  it('does not contain live statuses', () => {
    const liveStatuses: SessionStatus[] = ['working', 'connecting', 'awaiting-input', 'idle']
    for (const status of liveStatuses) {
      expect(TERMINAL_STATUSES.has(status)).toBe(false)
    }
  })
})

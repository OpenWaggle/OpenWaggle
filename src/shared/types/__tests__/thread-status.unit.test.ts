import { describe, expect, it } from 'vitest'
import { resolveThreadStatusPill, TERMINAL_STATUSES, type ThreadStatus } from '../thread-status'

describe('resolveThreadStatusPill', () => {
  it('returns null for idle status', () => {
    expect(resolveThreadStatusPill('idle')).toBeNull()
  })

  const statusCases: Array<{
    status: ThreadStatus
    icon: string
    animateClass: string | null
  }> = [
    { status: 'working', icon: 'GitCompareArrows', animateClass: 'animate-pulse' },
    { status: 'connecting', icon: 'Loader2', animateClass: 'animate-spin' },
    { status: 'completed', icon: 'CircleCheck', animateClass: null },
    { status: 'pending-approval', icon: 'CirclePause', animateClass: null },
    { status: 'awaiting-input', icon: 'MessageCircle', animateClass: null },
    { status: 'plan-ready', icon: 'ClipboardList', animateClass: null },
    { status: 'error', icon: 'XCircle', animateClass: null },
  ]

  for (const { status, icon, animateClass } of statusCases) {
    it(`maps "${status}" to icon "${icon}" with animateClass=${animateClass}`, () => {
      const pill = resolveThreadStatusPill(status)
      expect(pill).not.toBeNull()
      expect(pill?.icon).toBe(icon)
      expect(pill?.animateClass).toBe(animateClass)
      expect(pill?.colorClass).toBeTruthy()
    })
  }

  it('working and connecting use sky-500 color', () => {
    const working = resolveThreadStatusPill('working')
    const connecting = resolveThreadStatusPill('connecting')
    expect(working?.colorClass).toContain('sky-500')
    expect(connecting?.colorClass).toContain('sky-500')
  })

  it('completed uses emerald-500 color', () => {
    const pill = resolveThreadStatusPill('completed')
    expect(pill?.colorClass).toContain('emerald-500')
  })

  it('error uses red-500 color', () => {
    const pill = resolveThreadStatusPill('error')
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
    const liveStatuses: ThreadStatus[] = [
      'working',
      'connecting',
      'pending-approval',
      'awaiting-input',
      'plan-ready',
      'idle',
    ]
    for (const status of liveStatuses) {
      expect(TERMINAL_STATUSES.has(status)).toBe(false)
    }
  })
})

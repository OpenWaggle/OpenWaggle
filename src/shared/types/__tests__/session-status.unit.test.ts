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

  /*
   * Colours are semantic roles, not palette values. These assert the role each status means,
   * so a theme can re-map the role without the test caring what hue it lands on. They used to
   * assert sky-500, emerald-500 and red-500, which pinned the status vocabulary to one palette.
   * See ADR 0021.
   */
  it('working and connecting both mean progress', () => {
    expect(resolveSessionStatusPill('working')?.colorClass).toBe('text-progress')
    expect(resolveSessionStatusPill('connecting')?.colorClass).toBe('text-progress')
  })

  it('completed means success', () => {
    expect(resolveSessionStatusPill('completed')?.colorClass).toBe('text-success')
  })

  it('awaiting input means information', () => {
    expect(resolveSessionStatusPill('awaiting-input')?.colorClass).toBe('text-info')
  })

  it('a waggle run wears the brand accent', () => {
    expect(resolveSessionStatusPill('waggle-running')?.colorClass).toBe('text-accent')
  })

  it('error means error', () => {
    expect(resolveSessionStatusPill('error')?.colorClass).toBe('text-error')
  })

  /**
   * --color-error is 4.49:1 on the row background, which clears the 3:1 bar for an icon but
   * misses 4.5:1 for small text, so the label takes a lighter partner role.
   */
  it('gives error a separate role for small text', () => {
    const pill = resolveSessionStatusPill('error')
    expect(pill?.colorVar).toBe('var(--color-error)')
    expect(pill?.labelColorVar).toBe('var(--color-error-text)')
  })

  it('names every state in one word for the row', () => {
    expect(resolveSessionStatusPill('working')?.shortLabel).toBe('Working')
    expect(resolveSessionStatusPill('awaiting-input')?.shortLabel).toBe('Input')
    expect(resolveSessionStatusPill('completed')?.shortLabel).toBe('Done')
    expect(resolveSessionStatusPill('error')?.shortLabel).toBe('Error')
    expect(resolveSessionStatusPill('waggle-running')?.shortLabel).toBe('Waggle')
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

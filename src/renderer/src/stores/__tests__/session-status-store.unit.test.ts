import type { ConversationId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionStatusStore } from '../session-status-store'

const ID_A = 'conv-a' as ConversationId
const ID_B = 'conv-b' as ConversationId

describe('session-status-store', () => {
  beforeEach(() => {
    useSessionStatusStore.setState({
      statuses: new Map(),
      completedAt: new Map(),
      lastVisitedAt: new Map(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('setStatus with completedAt tracking', () => {
    it('records completedAt when setting a terminal status', () => {
      const now = 1000
      vi.spyOn(Date, 'now').mockReturnValue(now)

      useSessionStatusStore.getState().setStatus(ID_A, 'completed')

      expect(useSessionStatusStore.getState().statuses.get(ID_A)).toBe('completed')
      expect(useSessionStatusStore.getState().completedAt.get(ID_A)).toBe(now)
    })

    it('records completedAt for error status', () => {
      const now = 2000
      vi.spyOn(Date, 'now').mockReturnValue(now)

      useSessionStatusStore.getState().setStatus(ID_A, 'error')

      expect(useSessionStatusStore.getState().statuses.get(ID_A)).toBe('error')
      expect(useSessionStatusStore.getState().completedAt.get(ID_A)).toBe(now)
    })

    it('clears completedAt when setting a live status', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      useSessionStatusStore.getState().setStatus(ID_A, 'completed')
      expect(useSessionStatusStore.getState().completedAt.has(ID_A)).toBe(true)

      useSessionStatusStore.getState().setStatus(ID_A, 'working')
      expect(useSessionStatusStore.getState().completedAt.has(ID_A)).toBe(false)
    })

    it('clears completedAt when setting idle', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      useSessionStatusStore.getState().setStatus(ID_A, 'error')
      expect(useSessionStatusStore.getState().completedAt.has(ID_A)).toBe(true)

      useSessionStatusStore.getState().setStatus(ID_A, 'idle')
      expect(useSessionStatusStore.getState().completedAt.has(ID_A)).toBe(false)
      expect(useSessionStatusStore.getState().statuses.has(ID_A)).toBe(false)
    })
  })

  describe('markVisited', () => {
    it('sets lastVisitedAt to current time', () => {
      const now = 5000
      vi.spyOn(Date, 'now').mockReturnValue(now)

      useSessionStatusStore.getState().markVisited(ID_A)

      expect(useSessionStatusStore.getState().lastVisitedAt.get(ID_A)).toBe(now)
    })
  })

  describe('markUnread', () => {
    it('sets lastVisitedAt to completedAt - 1 when completedAt exists', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      useSessionStatusStore.getState().setStatus(ID_A, 'completed')

      vi.spyOn(Date, 'now').mockReturnValue(2000)
      useSessionStatusStore.getState().markVisited(ID_A)

      // Now the icon is "seen" — markUnread should re-show it
      useSessionStatusStore.getState().markUnread(ID_A)

      const completedAt = useSessionStatusStore.getState().completedAt.get(ID_A)
      const lastVisited = useSessionStatusStore.getState().lastVisitedAt.get(ID_A)

      expect(completedAt).toBe(1000)
      expect(lastVisited).toBe(999) // completedAt - 1
    })

    it('uses Date.now() - 1 when completedAt does not exist', () => {
      const now = 3000
      vi.spyOn(Date, 'now').mockReturnValue(now)

      useSessionStatusStore.getState().markUnread(ID_B)

      expect(useSessionStatusStore.getState().lastVisitedAt.get(ID_B)).toBe(now - 1)
    })
  })

  describe('terminal seen/unseen logic', () => {
    it('terminal status is unseen when no visit recorded', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      useSessionStatusStore.getState().setStatus(ID_A, 'completed')

      const state = useSessionStatusStore.getState()
      const completedAt = state.completedAt.get(ID_A)
      const lastVisited = state.lastVisitedAt.get(ID_A)

      // No visit → unseen
      expect(completedAt).toBeDefined()
      expect(lastVisited).toBeUndefined()
    })

    it('terminal status becomes seen after visit', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      useSessionStatusStore.getState().setStatus(ID_A, 'completed')

      vi.spyOn(Date, 'now').mockReturnValue(2000)
      useSessionStatusStore.getState().markVisited(ID_A)

      const state = useSessionStatusStore.getState()
      const completedAt = state.completedAt.get(ID_A)
      const lastVisited = state.lastVisitedAt.get(ID_A)

      expect(completedAt).toBe(1000)
      expect(lastVisited).toBe(2000)
      // completedAt <= lastVisited → seen
      expect(completedAt).toBeDefined()
      expect(lastVisited).toBeDefined()
      expect(completedAt).toBeLessThanOrEqual(lastVisited ?? 0)
    })

    it('markUnread makes a seen terminal status unseen again', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      useSessionStatusStore.getState().setStatus(ID_A, 'error')

      vi.spyOn(Date, 'now').mockReturnValue(2000)
      useSessionStatusStore.getState().markVisited(ID_A)

      useSessionStatusStore.getState().markUnread(ID_A)

      const state = useSessionStatusStore.getState()
      const completedAt = state.completedAt.get(ID_A)
      const lastVisited = state.lastVisitedAt.get(ID_A)

      // completedAt > lastVisited → unseen
      expect(completedAt).toBeDefined()
      expect(lastVisited).toBeDefined()
      expect(completedAt).toBeGreaterThan(lastVisited ?? 0)
    })
  })

  describe('clearStatus', () => {
    it('removes both status and completedAt', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1000)
      useSessionStatusStore.getState().setStatus(ID_A, 'completed')

      useSessionStatusStore.getState().clearStatus(ID_A)

      expect(useSessionStatusStore.getState().statuses.has(ID_A)).toBe(false)
      expect(useSessionStatusStore.getState().completedAt.has(ID_A)).toBe(false)
    })
  })
})

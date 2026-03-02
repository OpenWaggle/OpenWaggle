import { SubAgentId } from '@shared/types/brand'
import type { SubAgentResult } from '@shared/types/sub-agent'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import {
  cancelBackground,
  canStartBackground,
  clearAllBackground,
  getBackgroundCount,
  isBackgroundRunning,
  startBackground,
} from '../background-executor'

function makeResult(
  agentId: SubAgentId,
  status: SubAgentResult['status'] = 'completed',
): SubAgentResult {
  return { agentId, status, output: 'done', turnCount: 1, toolCallCount: 1 }
}

function makeRunner(result: SubAgentResult): (signal: AbortSignal) => Promise<SubAgentResult> {
  return () => Promise.resolve(result)
}

function makePendingRunner(): {
  runner: (signal: AbortSignal) => Promise<SubAgentResult>
  resolve: (result: SubAgentResult) => void
  reject: (error: Error) => void
} {
  let resolve!: (result: SubAgentResult) => void
  let reject!: (error: Error) => void
  const runner = () =>
    new Promise<SubAgentResult>((res, rej) => {
      resolve = res
      reject = rej
    })
  return { runner, resolve, reject }
}

describe('background-executor', () => {
  beforeEach(() => {
    clearAllBackground()
  })

  describe('getBackgroundCount', () => {
    it('returns 0 when no tasks are active', () => {
      expect(getBackgroundCount()).toBe(0)
    })
  })

  describe('canStartBackground', () => {
    it('returns true when empty', () => {
      expect(canStartBackground()).toBe(true)
    })

    it('returns false when 4 tasks are active', () => {
      for (let i = 0; i < 4; i++) {
        const id = SubAgentId(`agent-${String(i)}`)
        const { runner } = makePendingRunner()
        startBackground(id, runner)
      }
      expect(canStartBackground()).toBe(false)
    })
  })

  describe('startBackground', () => {
    it('increments the background count', () => {
      const id = SubAgentId('agent-1')
      const { runner } = makePendingRunner()
      startBackground(id, runner)
      expect(getBackgroundCount()).toBe(1)
    })

    it('returns an AbortController', () => {
      const id = SubAgentId('agent-1')
      const { runner } = makePendingRunner()
      const controller = startBackground(id, runner)
      expect(controller).toBeInstanceOf(AbortController)
    })

    it('decrements count when runner resolves', async () => {
      const id = SubAgentId('agent-1')
      const result = makeResult(id)
      startBackground(id, makeRunner(result))

      await vi.waitFor(() => {
        expect(getBackgroundCount()).toBe(0)
      })
    })

    it('decrements count when runner rejects', async () => {
      const id = SubAgentId('agent-1')
      startBackground(id, () => Promise.reject(new Error('boom')))

      await vi.waitFor(() => {
        expect(getBackgroundCount()).toBe(0)
      })
    })

    it('throws when max concurrent limit is reached', () => {
      for (let i = 0; i < 4; i++) {
        const id = SubAgentId(`agent-${String(i)}`)
        const { runner } = makePendingRunner()
        startBackground(id, runner)
      }

      const extraId = SubAgentId('agent-extra')
      const { runner } = makePendingRunner()
      expect(() => startBackground(extraId, runner)).toThrow(/Cannot start background agent/)
    })

    it('passes the AbortSignal to the runner', () => {
      const id = SubAgentId('agent-1')
      let receivedSignal: AbortSignal | undefined
      const runner = (signal: AbortSignal) => {
        receivedSignal = signal
        return new Promise<SubAgentResult>(() => {})
      }
      const controller = startBackground(id, runner)
      expect(receivedSignal).toBe(controller.signal)
    })
  })

  describe('cancelBackground', () => {
    it('aborts the task and returns true', () => {
      const id = SubAgentId('agent-1')
      const { runner } = makePendingRunner()
      const controller = startBackground(id, runner)
      const cancelled = cancelBackground(id)

      expect(cancelled).toBe(true)
      expect(controller.signal.aborted).toBe(true)
    })

    it('returns false for unknown agent', () => {
      const result = cancelBackground(SubAgentId('nonexistent'))
      expect(result).toBe(false)
    })
  })

  describe('isBackgroundRunning', () => {
    it('returns true for an active task', () => {
      const id = SubAgentId('agent-1')
      const { runner } = makePendingRunner()
      startBackground(id, runner)
      expect(isBackgroundRunning(id)).toBe(true)
    })

    it('returns false for an unknown agent', () => {
      expect(isBackgroundRunning(SubAgentId('nonexistent'))).toBe(false)
    })

    it('returns false after a task completes', async () => {
      const id = SubAgentId('agent-1')
      const result = makeResult(id)
      startBackground(id, makeRunner(result))

      await vi.waitFor(() => {
        expect(isBackgroundRunning(id)).toBe(false)
      })
    })
  })

  describe('onComplete callback', () => {
    it('fires with the result on success', async () => {
      const id = SubAgentId('agent-1')
      const result = makeResult(id)
      const onComplete = vi.fn()

      startBackground(id, makeRunner(result), onComplete)

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce()
      })
      expect(onComplete).toHaveBeenCalledWith(result)
    })

    it('fires with a failed result on error', async () => {
      const id = SubAgentId('agent-1')
      const onComplete = vi.fn()

      startBackground(id, () => Promise.reject(new Error('runner failed')), onComplete)

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce()
      })

      const failedResult = onComplete.mock.calls[0][0] as SubAgentResult
      expect(failedResult.agentId).toBe(id)
      expect(failedResult.status).toBe('failed')
      expect(failedResult.output).toBe('runner failed')
      expect(failedResult.turnCount).toBe(0)
      expect(failedResult.toolCallCount).toBe(0)
    })

    it('fires with stringified error for non-Error throws', async () => {
      const id = SubAgentId('agent-1')
      const onComplete = vi.fn()

      startBackground(id, () => Promise.reject('string error'), onComplete)

      await vi.waitFor(() => {
        expect(onComplete).toHaveBeenCalledOnce()
      })

      const failedResult = onComplete.mock.calls[0][0] as SubAgentResult
      expect(failedResult.output).toBe('string error')
    })
  })

  describe('clearAllBackground', () => {
    it('aborts all active tasks', () => {
      const controllers: AbortController[] = []
      for (let i = 0; i < 3; i++) {
        const id = SubAgentId(`agent-${String(i)}`)
        const { runner } = makePendingRunner()
        controllers.push(startBackground(id, runner))
      }

      clearAllBackground()

      for (const controller of controllers) {
        expect(controller.signal.aborted).toBe(true)
      }
    })

    it('resets count to 0', () => {
      for (let i = 0; i < 3; i++) {
        const id = SubAgentId(`agent-${String(i)}`)
        const { runner } = makePendingRunner()
        startBackground(id, runner)
      }

      expect(getBackgroundCount()).toBe(3)
      clearAllBackground()
      expect(getBackgroundCount()).toBe(0)
    })

    it('allows starting new tasks after clearing', () => {
      for (let i = 0; i < 4; i++) {
        const id = SubAgentId(`agent-${String(i)}`)
        const { runner } = makePendingRunner()
        startBackground(id, runner)
      }

      clearAllBackground()
      expect(canStartBackground()).toBe(true)

      const newId = SubAgentId('agent-new')
      const { runner } = makePendingRunner()
      expect(() => startBackground(newId, runner)).not.toThrow()
      expect(getBackgroundCount()).toBe(1)
    })
  })
})

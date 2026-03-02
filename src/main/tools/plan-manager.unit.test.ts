import { ConversationId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPlanProposal,
  PLAN_PROPOSAL_TTL_MS,
  respondToPlan,
  waitForPlanResponse,
} from './plan-manager'

describe('plan-manager TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const convId = ConversationId('test-conv-1')

  it('auto-rejects after TTL expires', async () => {
    const promise = waitForPlanResponse(convId)

    vi.advanceTimersByTime(PLAN_PROPOSAL_TTL_MS)

    await expect(promise).rejects.toThrow('Plan proposal cancelled')
  })

  it('clears timer on normal respondToPlan', async () => {
    const promise = waitForPlanResponse(convId)

    respondToPlan(convId, { action: 'approve' })

    const result = await promise
    expect(result).toEqual({ action: 'approve' })

    // Advance past TTL — should NOT reject (timer was cleared)
    vi.advanceTimersByTime(PLAN_PROPOSAL_TTL_MS + 1000)
  })

  it('clears timer on cancelPlanProposal', async () => {
    const promise = waitForPlanResponse(convId)

    cancelPlanProposal(convId)

    await expect(promise).rejects.toThrow('Plan proposal cancelled')

    // Advance past TTL — no double rejection
    vi.advanceTimersByTime(PLAN_PROPOSAL_TTL_MS + 1000)
  })

  it('clears timer on abort signal', async () => {
    const controller = new AbortController()
    const promise = waitForPlanResponse(convId, controller.signal)

    controller.abort()

    await expect(promise).rejects.toThrow('Plan proposal cancelled')

    // Advance past TTL — no double rejection
    vi.advanceTimersByTime(PLAN_PROPOSAL_TTL_MS + 1000)
  })

  it('rejects immediately when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const promise = waitForPlanResponse(convId, controller.signal)

    await expect(promise).rejects.toThrow('Plan proposal cancelled')
  })
})

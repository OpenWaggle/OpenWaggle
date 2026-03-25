import { ConversationId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelPlanProposal,
  clearAllPlanProposals,
  PLAN_PROPOSAL_TTL_MS,
  pendingPlanCount,
  respondToPlan,
  waitForPlanResponse,
} from '../plan-manager'

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

  it('clearAllPlanProposals rejects all pending and empties map', async () => {
    const convA = ConversationId('conv-a')
    const convB = ConversationId('conv-b')

    const promiseA = waitForPlanResponse(convA)
    const promiseB = waitForPlanResponse(convB)

    expect(pendingPlanCount()).toBe(2)

    clearAllPlanProposals()

    expect(pendingPlanCount()).toBe(0)
    await expect(promiseA).rejects.toThrow('All plan proposals cleared')
    await expect(promiseB).rejects.toThrow('All plan proposals cleared')
  })

  it('pendingPlanCount tracks pending proposals', async () => {
    expect(pendingPlanCount()).toBe(0)

    const promise = waitForPlanResponse(convId)
    expect(pendingPlanCount()).toBe(1)

    respondToPlan(convId, { action: 'approve' })
    await promise

    expect(pendingPlanCount()).toBe(0)
  })

  it('superseded proposal clears old TTL timer', async () => {
    const promise1 = waitForPlanResponse(convId)

    // Supersede with a new proposal
    const promise2 = waitForPlanResponse(convId)

    await expect(promise1).rejects.toThrow('Superseded by a new plan proposal')

    // Advance past old TTL — should not affect the new proposal
    vi.advanceTimersByTime(PLAN_PROPOSAL_TTL_MS - 1000)
    expect(pendingPlanCount()).toBe(1)

    respondToPlan(convId, { action: 'revise', feedback: 'no' })
    await expect(promise2).resolves.toMatchObject({ action: 'revise' })
    expect(pendingPlanCount()).toBe(0)
  })
})

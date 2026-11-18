import { describe, expect, it } from 'vitest'
import { mergeExactTerminalCounts, resolveVisibleSessionStatus } from '../sidebar-row-state'

/**
 * One rule for "has the user already seen this finish".
 *
 * It used to be written twice, once in the hook a row uses and once in the hook the chips and
 * project roll-ups use, with the comparison and the terminal-status set duplicated. They agreed
 * only because the two copies happened to match, so a row and its own project heading were one
 * edit away from describing the same session differently. These tests cover the rule itself, which
 * is now the only copy.
 */

const SEEN_AT = 2_000
const FINISHED_AT = 1_000

describe('resolveVisibleSessionStatus', () => {
  it('reports idle for a finished run the user already visited', () => {
    // Otherwise a completed session keeps its tick forever and the tick stops meaning news.
    expect(
      resolveVisibleSessionStatus({
        status: 'completed',
        completedAt: FINISHED_AT,
        lastVisitedAt: SEEN_AT,
      }),
    ).toBe('idle')
  })

  it('keeps a finished run that finished after the last visit', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'completed',
        completedAt: SEEN_AT,
        lastVisitedAt: FINISHED_AT,
      }),
    ).toBe('completed')
  })

  it('treats a visit at the same instant as having seen it', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'completed',
        completedAt: SEEN_AT,
        lastVisitedAt: SEEN_AT,
      }),
    ).toBe('idle')
  })

  it('keeps a finished run that was never visited', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'completed',
        completedAt: FINISHED_AT,
        lastVisitedAt: undefined,
      }),
    ).toBe('completed')
  })

  it('keeps a run with no completion time, however long ago the visit was', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'completed',
        completedAt: undefined,
        lastVisitedAt: SEEN_AT,
      }),
    ).toBe('completed')
  })

  it('leaves a run that has not finished alone, visited or not', () => {
    // Only a terminal status can be "already seen"; work in flight still needs reporting.
    expect(
      resolveVisibleSessionStatus({
        status: 'working',
        completedAt: FINISHED_AT,
        lastVisitedAt: SEEN_AT,
      }),
    ).toBe('working')
  })

  it('applies to every terminal status, not only completed', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'error',
        completedAt: FINISHED_AT,
        lastVisitedAt: SEEN_AT,
      }),
    ).toBe('idle')
  })
})

describe('mergeExactTerminalCounts', () => {
  it('replaces page-local terminal counts while preserving live state counts', () => {
    expect(
      mergeExactTerminalCounts(
        [
          { state: 'awaiting-input', count: 2 },
          { state: 'error', count: 1 },
          { state: 'working', count: 4 },
          { state: 'completed', count: 3 },
        ],
        { error: 250, completed: 175 },
      ),
    ).toEqual([
      { state: 'awaiting-input', count: 2 },
      { state: 'error', count: 250 },
      { state: 'working', count: 4 },
      { state: 'completed', count: 175 },
    ])
  })
})

describe('a parent row follows its Workers (ADR 0065)', () => {
  const lineage = (facts: { runningWorkerCount?: number; workersLastRunEndedAt?: number }) => ({
    role: 'queen' as const,
    directWorkerCount: 3,
    activeDirectWorkerCount: 3,
    ...facts,
  })

  it('reads Working while the Queen is idle and a Worker below runs', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'idle',
        completedAt: undefined,
        lastVisitedAt: SEEN_AT,
        lineage: lineage({ runningWorkerCount: 2 }),
      }),
    ).toBe('working')
  })

  it('reads Working over her own unread Done while Workers run', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'completed',
        completedAt: SEEN_AT,
        lastVisitedAt: FINISHED_AT,
        lineage: lineage({ runningWorkerCount: 1 }),
      }),
    ).toBe('working')
  })

  it('keeps her own attention and in-flight states first', () => {
    for (const status of ['awaiting-input', 'error', 'connecting', 'waggle-running'] as const) {
      expect(
        resolveVisibleSessionStatus({
          status,
          completedAt: undefined,
          lastVisitedAt: undefined,
          lineage: lineage({ runningWorkerCount: 1 }),
        }),
      ).toBe(status)
    }
  })

  it('reads Done below once the last Worker Run ended after her last visit', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'completed',
        completedAt: FINISHED_AT,
        lastVisitedAt: SEEN_AT,
        lineage: lineage({ runningWorkerCount: 0, workersLastRunEndedAt: SEEN_AT + 1 }),
      }),
    ).toBe('completed')
  })

  it('clears Done below when she is visited after it', () => {
    expect(
      resolveVisibleSessionStatus({
        status: 'idle',
        completedAt: undefined,
        lastVisitedAt: SEEN_AT,
        lineage: lineage({ runningWorkerCount: 0, workersLastRunEndedAt: FINISHED_AT }),
      }),
    ).toBe('idle')
  })
})

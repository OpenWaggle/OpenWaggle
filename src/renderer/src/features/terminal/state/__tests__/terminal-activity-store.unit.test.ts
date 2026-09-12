import type {
  TerminalActivitySnapshot,
  TerminalActivityStatus,
  TerminalActivitySummary,
} from '@shared/types/terminal'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getRunningTerminalCount,
  getTerminalActivityStatus,
  getTerminalProjectActionPending,
  useTerminalActivityStore,
} from '../terminal-activity-store'

function summary(
  ownerKey: string,
  terminalId: string,
  activityStatus: TerminalActivityStatus,
  overrides: Partial<TerminalActivitySummary> = {},
): TerminalActivitySummary {
  return {
    ownerKey,
    terminalId,
    activityStatus,
    processName: null,
    ports: [],
    projectActionPending: false,
    ...overrides,
  }
}

function snapshot(
  revision: number,
  summaries: TerminalActivitySnapshot['summaries'],
): TerminalActivitySnapshot {
  return { revision, summaries, truncated: false }
}

describe('terminal activity store', () => {
  beforeEach(() => useTerminalActivityStore.getState().reset())

  it('aggregates one running count per unique owner and terminal', () => {
    useTerminalActivityStore
      .getState()
      .applySnapshot(
        snapshot(1, [
          summary('session-1', 'main', 'running'),
          summary('session-1', 'main', 'running'),
          summary('session-1', 'side', 'idle'),
          summary('session-2', 'main', 'running'),
        ]),
      )

    expect(getRunningTerminalCount('session-1')).toBe(1)
    expect(getRunningTerminalCount('session-2')).toBe(1)
    expect(getTerminalActivityStatus('session-1', 'side')).toBe('idle')
  })

  it('keeps missing and explicitly unreliable metadata conservative', () => {
    useTerminalActivityStore
      .getState()
      .applySnapshot(snapshot(1, [summary('session-1', 'main', 'unknown')]))

    expect(getTerminalActivityStatus('session-1', 'main')).toBe('unknown')
    expect(getTerminalActivityStatus('session-1', 'missing')).toBe('unknown')
    expect(getRunningTerminalCount('session-1')).toBe(0)
  })

  it('ignores a slow initial response after a newer event revision', () => {
    const store = useTerminalActivityStore.getState()
    store.applySnapshot(snapshot(8, [summary('session-1', 'main', 'running')]))
    store.applySnapshot(snapshot(7, [summary('session-1', 'main', 'idle')]))

    expect(useTerminalActivityStore.getState().revision).toBe(8)
    expect(getTerminalActivityStatus('session-1', 'main')).toBe('running')
  })

  it('replaces removed, migrated, and stopped records from a full snapshot', () => {
    const store = useTerminalActivityStore.getState()
    store.applySnapshot(snapshot(1, [summary('draft:/repo', 'main', 'running')]))
    store.applySnapshot(snapshot(2, [summary('session-born', 'main', 'idle')]))

    expect(getTerminalActivityStatus('draft:/repo', 'main')).toBe('unknown')
    expect(getTerminalActivityStatus('session-born', 'main')).toBe('idle')
    expect(getRunningTerminalCount('draft:/repo')).toBe(0)
  })

  it('exposes the main-owned Project Action barrier and ignores stale metadata', () => {
    const store = useTerminalActivityStore.getState()
    store.applySnapshot(
      snapshot(2, [
        summary('session-1', 'main', 'idle', {
          processName: 'node',
          ports: [5173],
          projectActionPending: true,
        }),
      ]),
    )
    store.applySnapshot(
      snapshot(1, [
        summary('session-1', 'main', 'idle', {
          projectActionPending: false,
        }),
      ]),
    )

    expect(getTerminalProjectActionPending('session-1', 'main')).toBe(true)
    expect(getTerminalProjectActionPending('session-1', 'missing')).toBe(false)
    expect(useTerminalActivityStore.getState().summariesByKey.get('session-1::main')).toMatchObject(
      {
        processName: 'node',
        ports: [5173],
      },
    )
  })
})

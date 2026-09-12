import { TERMINAL } from '@shared/constants/resource-limits'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  projectTerminalActivitySnapshot,
  terminalActivityStatus,
  terminalEventCanChangeActivitySummary,
} from '../terminal-activity-snapshot'
import type { TerminalRecord } from '../terminal-records'

function liveRecord(overrides: Partial<TerminalRecord> = {}) {
  return fromPartial<TerminalRecord>({
    key: 'session-1::main',
    ownerKey: 'session-1',
    terminalId: 'main',
    closed: false,
    exitCode: null,
    live: { pid: 100 },
    activity: null,
    ...overrides,
  })
}

describe('terminal activity metadata projection', () => {
  it('keeps output batches off the global metadata projection hot path', () => {
    expect(
      terminalEventCanChangeActivitySummary({
        type: 'output',
        data: 'x',
        outputGeneration: 0,
        startOffset: 0,
        endOffset: 1,
      }),
    ).toBe(false)
    expect(terminalEventCanChangeActivitySummary({ type: 'closed' })).toBe(true)
  })

  it('reports running only from a reliable descendant observation', () => {
    expect(terminalActivityStatus(liveRecord())).toBe('unknown')
    expect(
      terminalActivityStatus(
        liveRecord({
          activity: {
            processName: 'pnpm',
            processNames: ['pnpm'],
            processPids: [100, 101],
            processIdentities: [],
            tty: 'ttys001',
            ports: [],
            processReliable: true,
            reliable: false,
          },
        }),
      ),
    ).toBe('running')
  })

  it('keeps process-idle reusable when only the independent port probe failed', () => {
    expect(
      terminalActivityStatus(
        liveRecord({
          activity: {
            processName: null,
            processNames: [],
            processPids: [100],
            processIdentities: [],
            tty: 'ttys001',
            ports: [],
            processReliable: true,
            reliable: false,
          },
        }),
      ),
    ).toBe('idle')
  })

  it('keeps a failed process-table observation unknown and a confirmed dead shell idle', () => {
    expect(
      terminalActivityStatus(
        liveRecord({
          activity: {
            processName: 'pnpm',
            processNames: ['pnpm'],
            processPids: [100, 101],
            processIdentities: [],
            tty: 'ttys001',
            ports: [],
            processReliable: false,
            reliable: false,
          },
        }),
      ),
    ).toBe('unknown')
    expect(terminalActivityStatus(liveRecord({ live: null, exitCode: 0 }))).toBe('idle')
  })

  it('projects one conservative summary per owner and terminal identity', () => {
    const idle = liveRecord({
      activity: {
        processName: null,
        processNames: [],
        processPids: [100],
        processIdentities: [],
        tty: 'ttys001',
        ports: [],
        processReliable: true,
        reliable: true,
      },
    })
    const running = liveRecord({
      activity: {
        processName: 'node',
        processNames: ['node'],
        processPids: [100, 101],
        processIdentities: [],
        tty: 'ttys001',
        ports: [],
        processReliable: true,
        reliable: true,
      },
    })

    expect(projectTerminalActivitySnapshot([idle, running], 1).summaries).toEqual([
      {
        ownerKey: 'session-1',
        terminalId: 'main',
        activityStatus: 'running',
        processName: 'node',
        ports: [],
        projectActionPending: false,
      },
    ])
  })

  it('keeps the barrier and metadata conservative if duplicate identities are projected', () => {
    const pendingIdle = liveRecord({
      projectAction: {
        executionId: 'action-1',
        deliveredAfterPromptEpoch: 0,
        sawRunning: false,
        deliveredAtMonotonicMs: 10,
        reliableIdleObservations: 0,
      },
      activity: {
        processName: null,
        processNames: [],
        processPids: [100],
        processIdentities: [],
        tty: 'ttys001',
        ports: [5173],
        processReliable: true,
        reliable: true,
      },
    })
    const running = liveRecord({
      activity: {
        processName: 'node',
        processNames: ['node'],
        processPids: [100, 101],
        processIdentities: [],
        tty: 'ttys001',
        ports: [4173],
        processReliable: true,
        reliable: true,
      },
    })

    expect(projectTerminalActivitySnapshot([pendingIdle, running], 1).summaries).toEqual([
      {
        ownerKey: 'session-1',
        terminalId: 'main',
        activityStatus: 'running',
        processName: 'node',
        ports: [4173, 5173],
        projectActionPending: true,
      },
    ])
  })

  it('sorts and bounds the transport snapshot', () => {
    const records = Array.from({ length: TERMINAL.ACTIVITY_SUMMARY_LIMIT }, (_, index) =>
      liveRecord({
        key: `session-${String(index)}::main`,
        ownerKey: `session-${String(index).padStart(4, '0')}`,
      }),
    )
    records.push(
      liveRecord({
        key: 'zzzz-running::main',
        ownerKey: 'zzzz-running',
        activity: {
          processName: 'node',
          processNames: ['node'],
          processPids: [100, 101],
          processIdentities: [],
          tty: 'ttys001',
          ports: [],
          processReliable: true,
          reliable: true,
        },
      }),
    )

    const snapshot = projectTerminalActivitySnapshot(records, 3)

    expect(snapshot.revision).toBe(3)
    expect(snapshot.summaries).toHaveLength(TERMINAL.ACTIVITY_SUMMARY_LIMIT)
    expect(snapshot.truncated).toBe(true)
    expect(snapshot.summaries[0]).toEqual({
      ownerKey: 'zzzz-running',
      terminalId: 'main',
      activityStatus: 'running',
      processName: 'node',
      ports: [],
      projectActionPending: false,
    })
    expect(snapshot.summaries[1]?.ownerKey).toBe('session-0000')
  })
})

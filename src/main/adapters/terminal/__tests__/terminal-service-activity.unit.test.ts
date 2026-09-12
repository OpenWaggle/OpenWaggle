import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  activitySnapshots,
  OWNER,
  open,
  ptys,
  readinessMarker,
  service,
  settle,
  setupTerminalServiceActionsTest,
  TERMINAL_ID,
  TERMINAL_KEY,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

describe('makeNodePtyTerminalService activity metadata', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('publishes hidden terminal activity once per owner and terminal lifecycle', async () => {
    await open(workDirA)
    await settle()
    const record = service.records.get(TERMINAL_KEY)
    if (record === undefined) throw new Error('Expected terminal record')

    expect((await Effect.runPromise(service.getActivitySnapshot())).summaries).toEqual([
      {
        ownerKey: OWNER,
        terminalId: TERMINAL_ID,
        activityStatus: 'unknown',
        processName: null,
        ports: [],
        projectActionPending: false,
      },
    ])

    record.activity = {
      processName: 'pnpm',
      processNames: ['pnpm', 'node'],
      processPids: [record.live?.pid ?? 0],
      processIdentities: [],
      tty: 'ttys001',
      ports: [],
      processReliable: true,
      reliable: true,
    }
    await Effect.runPromise(service.clear(OWNER, TERMINAL_ID))
    expect(activitySnapshots.at(-1)?.summaries).toEqual([
      {
        ownerKey: OWNER,
        terminalId: TERMINAL_ID,
        activityStatus: 'running',
        processName: 'pnpm',
        ports: [],
        projectActionPending: false,
      },
    ])

    await Effect.runPromise(service.migrateOwner(OWNER, 'session-born'))
    expect(activitySnapshots.at(-1)?.summaries).toEqual([
      {
        ownerKey: 'session-born',
        terminalId: TERMINAL_ID,
        activityStatus: 'running',
        processName: 'pnpm',
        ports: [],
        projectActionPending: false,
      },
    ])

    await Effect.runPromise(service.close('session-born', TERMINAL_ID, false))
    expect(activitySnapshots.at(-1)?.summaries).toEqual([])
  })

  it('publishes the Project Action barrier from acceptance through the next prompt', async () => {
    await open(workDirA)
    await settle()
    const marker = readinessMarker(0)
    ptys[0]?.dataListeners[0]?.(marker)

    const write = await Effect.runPromise(
      service.write(
        OWNER,
        TERMINAL_ID,
        'pnpm test\r',
        { generation: 'renderer-a', sequence: 0 },
        { kind: 'project-action', executionId: 'action-1' },
      ),
    )

    expect(write.status).toBe('written')
    expect(activitySnapshots.at(-1)?.summaries[0]?.projectActionPending).toBe(true)
    expect(ptys[0]?.write).toHaveBeenCalledWith('pnpm test\r')

    ptys[0]?.dataListeners[0]?.(marker)

    expect(activitySnapshots.at(-1)?.summaries[0]?.projectActionPending).toBe(false)
  })
})

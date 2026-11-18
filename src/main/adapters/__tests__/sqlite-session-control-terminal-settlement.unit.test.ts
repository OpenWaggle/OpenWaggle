import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RunId, SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'
import {
  PAUSE_REASON_BY_STATUS,
  prepareRunWithFollowUp,
  readSettlementState,
  UNSUCCESSFUL_TERMINAL_STATUSES,
} from './sqlite-session-control-settlement-test-support'

describe('SQLite Session Control terminal settlement', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-terminal-settlement-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each(UNSUCCESSFUL_TERMINAL_STATUSES)(
    'pauses and retains queued work after %s settlement',
    async (terminalStatus) => {
      const layer = makeSessionControlRunLifecycleTestLayer(
        path.join(temporaryRoot, `${terminalStatus}.sqlite`),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const lifecycle = yield* prepareRunWithFollowUp()
          const settlement = yield* lifecycle.settle({
            sessionId: SessionId('session-target'),
            runId: RunId('run-next'),
            nextRunId: RunId('run-after'),
            terminalStatus,
          })
          return { settlement, ...(yield* readSettlementState()) }
        }).pipe(Effect.provide(layer)),
      )

      expect(result).toEqual({
        settlement: { accepted: true, stateRevision: 5 },
        state: { active_run_id: null, queue_state: 'paused', queue_revision: 2 },
        followUps: [{ id: 'follow-up-next' }],
        run: { status: terminalStatus },
        pauseReason: PAUSE_REASON_BY_STATUS[terminalStatus],
      })
    },
  )

  it('leaves retained work running for a claimed replacement successor', async () => {
    const layer = makeSessionControlRunLifecycleTestLayer(
      path.join(temporaryRoot, 'claimed-successor.sqlite'),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* prepareRunWithFollowUp()
        const settlement = yield* lifecycle.settle({
          sessionId: SessionId('session-target'),
          runId: RunId('run-next'),
          nextRunId: RunId('run-after'),
          terminalStatus: 'interrupted',
          suppressFollowUpScheduling: true,
        })
        return { settlement, ...(yield* readSettlementState()) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result).toEqual({
      settlement: { accepted: true, stateRevision: 4 },
      state: { active_run_id: null, queue_state: 'running', queue_revision: 1 },
      followUps: [{ id: 'follow-up-next' }],
      run: { status: 'interrupted' },
      pauseReason: null,
    })
  })
})

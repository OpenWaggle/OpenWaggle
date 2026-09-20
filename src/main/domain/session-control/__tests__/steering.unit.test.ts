import { RunId } from '@shared/types/brand'
import { describe, expect, it } from 'vitest'
import { planSteeringMessage } from '../steering'

describe('Session Control steering', () => {
  it('appends input to the exact active Run without interrupting or replacing it', () => {
    const activeRunId = RunId('run-active')

    const plan = planSteeringMessage({
      requestedRunId: activeRunId,
      run: { state: 'active', runId: activeRunId, acceptsSteering: true },
    })

    expect(plan).toEqual({ accepted: true, action: 'append-steering', runId: activeRunId })
  })
})

import { SupportedModelId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import { refineSessionTitle } from '../session-title-refinement'
import { regenerateSessionTitle } from '../session-title-service'
import {
  json,
  resetWorld,
  run,
  SESSION_ID,
  text,
  world,
} from './session-title-service.test-harness'

vi.mock('../../session-host/session-host-events', async () => ({
  publishSessionHostEvent: (await import('./session-title-service.test-harness'))
    .publishSessionHostEventMock,
}))

const ANSWERED_BY = SupportedModelId('fake/fake-model-2')

/** A Session on a virtual model whose extension is gone; its Runs continue on `ANSWERED_BY`. */
function sessionOnGoneModel(overrides: Parameters<typeof resetWorld>[0]) {
  resetWorld({ executionModel: SupportedModelId('qa-router/auto'), ...overrides })
  world().messages = [
    text('user', 'look at this', 'u1'),
    { ...text('assistant', 'The sidebar.', 'a1'), model: ANSWERED_BY },
  ]
  world().replies.push(json('Sidebar review'))
}

describe('the Title model of a Session whose model is gone', () => {
  it('is asked to fall back to the model that answered last on Regenerate', async () => {
    sessionOnGoneModel({ title: 'Old title', source: 'manual' })

    await run(regenerateSessionTitle(SESSION_ID))

    expect(world().requests[0]).toMatchObject({ fallbackModel: ANSWERED_BY })
  })

  it('is asked to fall back to the model that answered last on refinement', async () => {
    sessionOnGoneModel({ title: 'Screenshot', source: 'generated', needsRefinement: true })

    await run(refineSessionTitle(SESSION_ID))

    expect(world().requests[0]).toMatchObject({ fallbackModel: ANSWERED_BY })
  })
})

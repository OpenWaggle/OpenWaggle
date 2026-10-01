import { MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS } from '@shared/types/session-control-returned-steers'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { sessionsToolParameters } from '../sessions-tool-parameters'
import { buildSessionsToolPayload } from '../sessions-tool-payload'

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `follow-up-${String(index)}`)
}

const source = { sessionId: 'queen', runId: 'run-queen', workingDirectory: '/workspace' }

describe('Pi Sessions Follow-up ID contract', () => {
  it.each([
    { action: 'queue_withdraw', sessionId: 'queen' },
    { action: 'queue_reorder', sessionId: 'queen', queueRevision: 1 },
  ] as const)(
    'bounds unique IDs for $action at the queue capacity, including returned steers',
    (base) => {
      expect(
        Check(sessionsToolParameters, {
          ...base,
          followUpIds: ids(MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS),
        }),
      ).toBe(true)
      expect(
        Check(sessionsToolParameters, {
          ...base,
          followUpIds: ids(MAX_FOLLOW_UP_QUEUE_LISTED_ITEMS + 1),
        }),
      ).toBe(false)
      expect(
        Check(sessionsToolParameters, {
          ...base,
          followUpIds: ['follow-up-1', 'follow-up-1'],
        }),
      ).toBe(false)
    },
  )

  it('deduplicates direct adapter input before Host decoding', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'queue_reorder',
          sessionId: 'queen',
          queueRevision: 1,
          followUpIds: ['follow-up-1', 'follow-up-1'],
        },
        source,
      ),
    ).toMatchObject({
      request: { command: { orderedFollowUpIds: ['follow-up-1'] } },
    })
  })
})

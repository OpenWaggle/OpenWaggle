import { MAX_FOLLOW_UP_QUEUE_ITEMS } from '@shared/types/session-control-queue'
import { describe, expect, it } from 'vitest'
import { buildMcpSessionPayloadV2, sessionInputSchemaV2 } from '../openwaggle-mcp-session-tool-v2'

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `follow-up-${String(index)}`)
}

describe('OpenWaggle MCP Session Follow-up ID contract', () => {
  it.each(['queue-withdraw', 'queue-reorder'] as const)(
    'bounds unique IDs for %s at the shared queue capacity',
    (operation) => {
      const base = {
        operation,
        sessionId: 'queen',
        ...(operation === 'queue-reorder' ? { queueRevision: 1 } : {}),
      }
      expect(
        sessionInputSchemaV2.safeParse({
          ...base,
          followUpIds: ids(MAX_FOLLOW_UP_QUEUE_ITEMS),
        }).success,
      ).toBe(true)
      expect(
        sessionInputSchemaV2.safeParse({
          ...base,
          followUpIds: ids(MAX_FOLLOW_UP_QUEUE_ITEMS + 1),
        }).success,
      ).toBe(false)
      expect(
        sessionInputSchemaV2.safeParse({ ...base, followUpIds: ['follow-up-1', 'follow-up-1'] })
          .success,
      ).toBe(false)
    },
  )

  it('deduplicates direct builder input before Host decoding', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'queue-reorder',
        sessionId: 'queen',
        queueRevision: 1,
        followUpIds: ['follow-up-1', 'follow-up-1'],
      }),
    ).toMatchObject({
      request: { command: { orderedFollowUpIds: ['follow-up-1'] } },
    })
  })
})

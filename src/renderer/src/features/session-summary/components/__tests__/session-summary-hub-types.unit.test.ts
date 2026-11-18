import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { hasSummaryContent, type SessionSummaryHubInput } from '../session-summary-hub-types'

const EMPTY = fromPartial<SessionSummaryHubInput>({ messageCount: 0 })

describe('Session Summary content', () => {
  it('shows for a Session a Scheduled task touches before its first message', () => {
    expect(hasSummaryContent(EMPTY)).toBe(false)
    expect(hasSummaryContent({ ...EMPTY, scheduledAvailable: true })).toBe(true)
  })
})

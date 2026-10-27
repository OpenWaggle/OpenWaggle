import { SessionId } from '@shared/types/brand'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  type SessionQueryRequest,
  type SessionQueryResponse,
} from '@shared/types/session-query'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createSessionControlQueryReader } from '../session-control-query-reader'

function request(requestId: string, sessionId = 'session-1'): SessionQueryRequest {
  return {
    contractVersion: SESSION_QUERY_CONTRACT_VERSION,
    requestId,
    query: { operation: 'queue-list', sessionId: SessionId(sessionId) },
  }
}

describe('createSessionControlQueryReader (boot fetch dedupe)', () => {
  it('asks the Host once for identical queries in the same task, whatever their request ids', async () => {
    const query = vi.fn(async () => fromPartial<SessionQueryResponse>({ requestId: 'r1' }))
    const read = createSessionControlQueryReader(query)

    await Promise.all([read(request('r1')), read(request('r2')), read(request('r3', 'other'))])

    expect(query).toHaveBeenCalledTimes(2)
  })

  it('asks again for a query made in a later task', async () => {
    const query = vi.fn(async () => fromPartial<SessionQueryResponse>({ requestId: 'r' }))
    const read = createSessionControlQueryReader(query)

    await read(request('r1'))
    await read(request('r2'))

    expect(query).toHaveBeenCalledTimes(2)
  })
})

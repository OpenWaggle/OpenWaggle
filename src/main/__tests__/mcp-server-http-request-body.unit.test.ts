import { describe, expect, it } from 'vitest'
import { makeMcpHttpRequestBodyAdmission } from '../mcp-server-http-request-body'

function acceptedLease(
  result: ReturnType<ReturnType<typeof makeMcpHttpRequestBodyAdmission>['acquire']>,
) {
  if (!result.accepted) throw new Error(`Expected admission, received ${result.reason}.`)
  return result.lease
}

describe('loopback MCP request body admission', () => {
  it('reserves declared bodies before their bytes arrive', () => {
    const admission = makeMcpHttpRequestBodyAdmission({
      maxConcurrentBodies: 4,
      maxAggregateBytes: 10,
    })
    const first = acceptedLease(admission.acquire(6))

    expect(admission.acquire(5)).toEqual({ accepted: false, reason: 'aggregate-bytes' })

    first.release()
    expect(admission.acquire(10)).toMatchObject({ accepted: true })
  })

  it('charges chunked bodies incrementally and restores capacity once', () => {
    const admission = makeMcpHttpRequestBodyAdmission({
      maxConcurrentBodies: 2,
      maxAggregateBytes: 10,
    })
    const first = acceptedLease(admission.acquire(undefined))
    const second = acceptedLease(admission.acquire(undefined))

    expect(first.retainChunk(6)).toBe(true)
    expect(second.retainChunk(5)).toBe(false)
    first.release()
    first.release()
    expect(second.retainChunk(5)).toBe(true)
  })
})

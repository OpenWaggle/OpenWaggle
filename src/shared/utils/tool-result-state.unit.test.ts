import { describe, expect, it } from 'vitest'
import {
  hasConcreteToolOutput,
  isDeniedApprovalPayload,
  isIncompleteToolPayload,
  isPendingExecutionPayload,
  normalizeToolResultPayload,
} from './tool-result-state'

describe('tool-result-state', () => {
  it('normalizes structured JSON tool payloads', () => {
    expect(
      normalizeToolResultPayload(
        '{"kind":"json","data":{"approved":true,"pendingExecution":true}}',
      ),
    ).toEqual({
      approved: true,
      pendingExecution: true,
    })
  })

  it('treats pendingExecution payloads as incomplete tool output', () => {
    const payload = '{"kind":"json","data":{"approved":true,"pendingExecution":true}}'

    expect(isPendingExecutionPayload(payload)).toBe(true)
    expect(isIncompleteToolPayload(payload)).toBe(true)
    expect(hasConcreteToolOutput(payload)).toBe(false)
  })

  it('treats denied approval payloads as terminal concrete output', () => {
    const payload =
      '{"kind":"json","data":{"approved":false,"message":"User declined tool execution"}}'

    expect(isDeniedApprovalPayload(payload)).toBe(true)
    expect(isIncompleteToolPayload(payload)).toBe(false)
    expect(hasConcreteToolOutput(payload)).toBe(true)
  })

  it('does not classify arbitrary strings as denied approval payloads', () => {
    expect(isDeniedApprovalPayload('not-json')).toBe(false)
    expect(hasConcreteToolOutput('not-json')).toBe(true)
  })
})

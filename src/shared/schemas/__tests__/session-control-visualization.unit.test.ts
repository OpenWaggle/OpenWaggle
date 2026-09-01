import { describe, expect, it } from 'vitest'
import {
  decodeSessionControlMutationRequest,
  SESSION_CONTROL_CONTRACT_VERSION,
} from '../session-control'

describe('Session Control visualization boundary', () => {
  it('preserves bounded inline visualization state for immediate and durable messages', () => {
    const visualizationContext = {
      title: 'Service map',
      sourcePath: '/repo/service-map.html',
      state: { selectedService: 'api' },
    }
    for (const operation of ['message', 'follow-up'] as const) {
      const request = decodeSessionControlMutationRequest({
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: `request-${operation}`,
        idempotencyKey: `idempotency-${operation}`,
        command: {
          operation,
          sessionId: 'session-target',
          input: { text: 'Explain this selection.', attachmentIds: [], visualizationContext },
        },
      })

      expect(request.command).toMatchObject({ input: { visualizationContext } })
    }
  })
})

import { describe, expect, it } from 'vitest'
import { buildSessionsToolExportOperationPayload } from '../sessions-tool-export-operation-payload'

describe('Sessions tool durable export selection', () => {
  it('propagates explicit queue-body access to export history reads', () => {
    expect(
      buildSessionsToolExportOperationPayload(
        {
          action: 'exports_read',
          sessionId: 'worker',
          exportOperationId: 'export-1',
          includeQueueBodies: true,
        },
        { workingDirectory: '/workspace', sessionId: 'queen', runId: 'run-queen' },
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'exports-read',
          includeQueueBodies: true,
        },
      },
    })
  })

  it('rejects a branch selector for a tree export', () => {
    expect(() =>
      buildSessionsToolExportOperationPayload(
        {
          action: 'export_create',
          sessionId: 'worker',
          destinationPath: 'exports/worker.jsonl',
          branchScope: 'tree',
          branchId: 'branch-main',
        },
        { workingDirectory: '/workspace', sessionId: 'queen', runId: 'run-queen' },
      ),
    ).toThrow('active-branch')
  })
})

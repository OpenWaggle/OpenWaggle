import { describe, expect, it } from 'vitest'
import { buildSessionsToolExportOperationPayload } from '../sessions-tool-export-operation-payload'

describe('Sessions tool durable export selection', () => {
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

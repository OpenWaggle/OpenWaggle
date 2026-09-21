import { SESSION_EXPORT_RESOURCE_LIMIT } from '@shared/types/session-export-operation'
import { SESSION_QUERY_MAX_PATH_LENGTH } from '@shared/types/session-query'
import { Check } from 'typebox/value'
import { describe, expect, it } from 'vitest'
import { sessionsToolExportOperationParameters } from '../sessions-tool-export-operation-parameters'
import { buildSessionsToolExportOperationPayload } from '../sessions-tool-export-operation-payload'
import { sessionsToolParameters } from '../sessions-tool-parameters'

describe('Sessions tool durable export selection', () => {
  it('advertises every durable export status, including installation', () => {
    expect(JSON.stringify(sessionsToolExportOperationParameters)).toContain('installing')
  })

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

  it('matches Host path and resource-count bounds before building export arguments', () => {
    const base = {
      action: 'export_create',
      sessionId: 'worker',
      destinationPath: 'exports/worker.jsonl',
    } as const
    const resources = Array.from(
      { length: SESSION_EXPORT_RESOURCE_LIMIT },
      (_, index) => `artifact-${String(index)}`,
    )
    expect(Check(sessionsToolParameters, { ...base, resources })).toBe(true)
    expect(Check(sessionsToolParameters, { ...base, resources: [...resources, 'extra'] })).toBe(
      false,
    )
    expect(
      Check(sessionsToolParameters, {
        ...base,
        resources: ['x'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1)],
      }),
    ).toBe(false)
    expect(
      Check(sessionsToolParameters, {
        ...base,
        destinationPath: 'x'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1),
      }),
    ).toBe(false)
  })
})

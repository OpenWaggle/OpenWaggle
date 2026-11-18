import { SESSION_EXPORT_RESOURCE_LIMIT } from '@shared/types/session-export-operation'
import { expect, it } from 'vitest'
import { decodeSessionControlMutationRequest } from '../session-control'

it('bounds bundle resources before artifact handles are opened', () => {
  const baseCommand = {
    operation: 'export-create',
    sessionId: 'session-target',
    format: 'bundle',
    destinationPath: '/tmp/session.zip',
  } as const
  const resources = Array.from({ length: SESSION_EXPORT_RESOURCE_LIMIT }, (_, index) => ({
    kind: 'workspace-file' as const,
    path: `resource-${String(index)}`,
  }))
  const request = {
    contractVersion: 2,
    requestId: 'request-export-bounds',
    idempotencyKey: 'export-bounds-once',
  } as const

  expect(() =>
    decodeSessionControlMutationRequest({
      ...request,
      command: { ...baseCommand, resources },
    }),
  ).not.toThrow()
  expect(() =>
    decodeSessionControlMutationRequest({
      ...request,
      command: {
        ...baseCommand,
        resources: [...resources, { kind: 'workspace-file', path: 'one-too-many' }],
      },
    }),
  ).toThrow()
})

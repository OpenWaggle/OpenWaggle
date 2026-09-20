import * as Effect from 'effect/Effect'

interface UiCommandIdentity {
  readonly requestId: string
  readonly sessionId: string
}

function record(value: unknown): object | null {
  return typeof value === 'object' && value !== null ? value : null
}

function field(value: object | null, key: string) {
  return value === null ? undefined : Reflect.get(value, key)
}

function uiCommandIdentity(input: unknown): UiCommandIdentity | null {
  const payload = record(field(record(input), 'payload'))
  if (field(payload, 'contract') !== 'local-ui-v1') return null
  const request = record(field(payload, 'request'))
  const command = record(field(request, 'command'))
  const requestId = field(request, 'requestId')
  const sessionId = field(command, 'sessionId')
  if (typeof requestId !== 'string' || typeof sessionId !== 'string') return null
  return { requestId, sessionId }
}

export function sessionDetailsCommandResponse(input: unknown) {
  const identity = uiCommandIdentity(input)
  if (identity !== null) {
    return Effect.succeed({
      contract: 'local-ui-v1' as const,
      response: {
        requestId: identity.requestId,
        effect: 'tree-ui-state-updated' as const,
        sessionId: identity.sessionId,
      },
    })
  }
  return Effect.succeed({
    contract: 'session-lifecycle-v2' as const,
    response: {
      contractVersion: 2 as const,
      requestId: 'create-request',
      replayed: false,
      outcome: {
        operation: 'create' as const,
        effect: 'created-root' as const,
        sessionId: 'session-created',
        workspaceId: 'workspace-created',
      },
    },
  })
}

import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

function launch(projectPath: string): LocalSessionCommandPayload {
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: 2,
      requestId: 'request-launch',
      idempotencyKey: 'launch-once',
      command: {
        operation: 'launch',
        projectPath,
        objective: 'Investigate.',
        attachmentIds: [],
        workspace: { mode: 'local' },
      },
    },
  }
}

const mocks = vi.hoisted(() => {
  const dispatched: unknown[] = []
  return { dispatched }
})

vi.mock('../session-tool-command-admission', () => ({
  // Stands in for the admission that normalizes `/projects/known/./` to `/projects/known`.
  admitSessionToolCommand: vi.fn(async () => ({
    caller: { callerId: 'session-agent:root:run-root' },
    payload: launch('/projects/known'),
  })),
}))

vi.mock('../../application/local-session-command-dispatcher', () => ({
  dispatchNonHostUiLocalSessionCommand: vi.fn((input: { readonly payload: unknown }) => {
    mocks.dispatched.push(input.payload)
    return Effect.succeed({ ok: true })
  }),
}))

const { installAppSessionToolGateway } = await import('../session-tool-gateway-installer')
const { executeSessionToolCommand } = await import('../session-tool-gateway')

describe('App Sessions tool gateway', () => {
  it('dispatches the payload its admission checked, not the one the agent sent', async () => {
    const services = Context.make(SqlClient.SqlClient, fromPartial<SqlClient.SqlClient>({}))
    // The mocked dispatcher uses none of the services the real one needs.
    const dependencies =
      fromPartial<Context.Context<Effect.Effect.Context<typeof installAppSessionToolGateway>>>(
        services,
      )

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* installAppSessionToolGateway
          yield* Effect.promise(() =>
            executeSessionToolCommand({
              sourceSessionId: 'root',
              sourceRunId: 'run-root',
              workingDirectory: '/projects/own',
              payload: launch('/projects/known/./'),
            }),
          )
        }),
      ).pipe(Effect.provide(dependencies)),
    )

    expect(mocks.dispatched).toEqual([launch('/projects/known')])
  })
})

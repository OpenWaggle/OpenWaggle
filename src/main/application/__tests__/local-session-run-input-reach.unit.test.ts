import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { SessionAuthorizationTargetRepository } from '../../ports/session-authorization-target-repository'
import { SettingsService } from '../../services/settings-service'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { authorizeLocalSessionCommand } from '../local-session-command-dispatcher'

const PROJECT = '/projects/a'

/** A CLI profile limited to project A, allowed to steer, promote, answer, and approve there. */
const projectProfile: LocalSessionCallerIdentity = {
  callerId: 'profile:ci',
  profileAuthority: {
    profileId: 'ci',
    profileName: 'ci',
    capabilities: [
      'sessions:read',
      'sessions:steer',
      'sessions:queue',
      'sessions:respond',
      'sessions:approve',
    ],
    scope: { projectPaths: [PROJECT] },
    authorizationCeiling: 'yolo',
  },
}

function control(
  command: Extract<
    LocalSessionCommandPayload,
    { contract: 'session-control-v2' }
  >['request']['command'],
): LocalSessionCommandPayload {
  return {
    contract: 'session-control-v2',
    request: {
      contractVersion: 2,
      requestId: `request-${command.operation}`,
      idempotencyKey: `once-${command.operation}`,
      command,
    },
  }
}

const runInputs = {
  steer: control({
    operation: 'steer',
    sessionId: 'desktop',
    expectedRunId: 'run-desktop',
    input: { text: 'List every project and report back.', attachmentIds: [] },
  }),
  promote: control({
    operation: 'promote',
    sessionId: 'desktop',
    expectedRunId: 'run-desktop',
    followUpId: 'follow-up',
  }),
  'request-respond': control({
    operation: 'request-respond',
    sessionId: 'desktop',
    runId: 'run-desktop',
    interactionId: 'interaction',
    kind: 'input',
    response: { kind: 'input', value: 'Now list every project.' },
  }),
  'approval-respond': control({
    operation: 'approval-respond',
    sessionId: 'desktop',
    runId: 'run-desktop',
    interactionId: 'approval',
    kind: 'confirm',
    response: { kind: 'confirm', accepted: true },
  }),
} satisfies Record<string, LocalSessionCommandPayload>

function authorize(payload: LocalSessionCommandPayload, widens: boolean) {
  const runInputWidensReach = vi.fn(() => Effect.succeed(widens))
  const layer = Layer.mergeAll(
    Layer.succeed(SessionAuthorizationTargetRepository, {
      resolve: (sessionId) =>
        Effect.succeed({
          sessionId,
          projectPath: PROJECT,
          hiveRootSessionId: sessionId,
          authorizationCeiling: 'yolo',
        }),
      resolveDelegation: () => Effect.die('unused'),
      listLiveDerivedAuthorities: () => Effect.succeed([]),
      runInputWidensReach,
    }),
    Layer.succeed(SettingsService, {
      get: () => Effect.succeed(DEFAULT_SETTINGS),
      update: () => Effect.void,
      initialize: () => Effect.void,
      flushForTests: () => Effect.void,
    }),
  )
  return {
    runInputWidensReach,
    result: Effect.runPromise(
      authorizeLocalSessionCommand({ caller: projectProfile, payload }).pipe(Effect.provide(layer)),
    ).then(
      () => undefined,
      (error: unknown) => error,
    ),
  }
}

describe('input into a Run that reaches every project', () => {
  it.each(Object.entries(runInputs))(
    'refuses %s from a caller that lacks the Run reach',
    async (name, payload) => {
      const { result, runInputWidensReach } = authorize(payload, true)

      const message = sessionCommandFailureMessage(await result)
      expect(message).toContain('(target_scope_denied)')
      expect(message).toContain('this Run can act in every project')
      expect(runInputWidensReach).toHaveBeenCalledWith(
        expect.objectContaining({
          callerId: 'profile:ci',
          sessionId: 'desktop',
          runId: 'run-desktop',
        }),
      )
      if (name === 'promote') {
        // The Follow-up is judged by who wrote it, so the check must receive it.
        expect(runInputWidensReach).toHaveBeenCalledWith(
          expect.objectContaining({ followUpId: 'follow-up' }),
        )
        expect(message).toContain('this Follow-up was written by a caller that cannot')
      }
    },
  )

  it.each(Object.entries(runInputs))(
    'allows %s when the Run stays within the caller reach',
    async (_name, payload) => {
      await expect(authorize(payload, false).result).resolves.toBeUndefined()
    },
  )
})

import { randomUUID } from 'node:crypto'
import { SessionId } from '@shared/types/brand'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { type PiDiscoveryFixture, run } from './pi-session-discovery.test-support'
import { FAKE_PROVIDER_MODEL } from './pi-session-fake-provider.test-support'

export type CreatedSessionWorkspace = { readonly mode: 'local' } | { readonly mode: 'new-worktree' }

/** A Session created in the project as the sidebar's New Session does, with a model to run. */
export async function createSession(
  fixture: PiDiscoveryFixture,
  workspace: CreatedSessionWorkspace = { mode: 'local' },
) {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({ enabledModels: [FAKE_PROVIDER_MODEL], selectedModel: FAKE_PROVIDER_MODEL }),
    ),
  )
  const { dispatchLocalSessionCommand } = await import(
    '../../../application/local-session-command-dispatcher'
  )
  const result = await run(
    dispatchLocalSessionCommand({
      caller: { callerId: 'gui:local-user', workingDirectory: fixture.project },
      payload: {
        contract: 'session-lifecycle-v2',
        request: {
          contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
          requestId: randomUUID(),
          idempotencyKey: randomUUID(),
          command: {
            operation: 'create',
            projectPath: fixture.project,
            title: 'New Session',
            workspace,
          },
        },
      },
    }),
  )
  if (result.contract !== 'session-lifecycle-v2') throw new Error('Not a lifecycle response.')
  const outcome = result.response.outcome
  if (outcome.effect !== 'created-root') throw new Error(`Not created: ${outcome.effect}`)
  return SessionId(outcome.sessionId)
}

/** One message sent to the Session, run to its end. */
export async function sendMessage(sessionId: SessionId, text: string, runId: string) {
  const { executeAgentRun } = await import('../../../application/agent-run-service')
  return run(
    executeAgentRun({
      sessionId,
      runId,
      payload: { text, attachments: [] },
      model: FAKE_PROVIDER_MODEL,
      signal: new AbortController().signal,
      onEvent: () => undefined,
    }),
  )
}

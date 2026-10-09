import { SessionManager } from '@earendil-works/pi-coding-agent'
import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  agePiFile,
  createPiCliSession,
  discoverOne,
  run,
  sessionDetail,
  setUpPiDiscoveryFixture,
} from './pi-session-discovery.test-support'
import { FAKE_PROVIDER_MODEL, setUpFakePiProvider } from './pi-session-fake-provider.test-support'

/**
 * The Pi settings a reader could not apply while a Run held a discovered Session are for that Run
 * only. A later Run never applies them over a setting the user chose since.
 */

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const fixture = setUpPiDiscoveryFixture(state)
setUpFakePiProvider(fixture, { reasoningModels: ['file-model'] })

async function selectDefaultModel() {
  const { SettingsService } = await import('../../../services/settings-service')
  await run(
    Effect.flatMap(SettingsService, (settings) =>
      settings.update({
        enabledModels: [FAKE_PROVIDER_MODEL, SupportedModelId('local/file-model')],
        selectedModel: FAKE_PROVIDER_MODEL,
      }),
    ),
  )
}

/** A message admitted and activated by Session Control, as the Run coordinator does. */
async function admit(sessionId: SessionId, key: string) {
  const { submitSessionMessage } = await import('../../../application/session-control-service')
  const { SessionControlRunLifecycleRepository } = await import(
    '../../../ports/session-control-run-lifecycle-repository'
  )
  return run(
    Effect.gen(function* () {
      const admitted = yield* submitSessionMessage({
        callerId: 'gui:local-user',
        request: {
          contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
          requestId: `request-${key}`,
          idempotencyKey: `idempotency-${key}`,
          command: { operation: 'message', sessionId, input: { text: 'Go on', attachmentIds: [] } },
        },
      })
      const outcome = admitted.outcome
      if (outcome.effect !== 'started-run') throw new Error(`Not started: ${outcome.effect}`)
      const runId = RunId(outcome.runId)
      yield* (yield* SessionControlRunLifecycleRepository).activate({ sessionId, runId })
      return runId
    }),
  )
}

async function settle(sessionId: SessionId, runId: RunId) {
  const { SessionControlRunLifecycleRepository } = await import(
    '../../../ports/session-control-run-lifecycle-repository'
  )
  await run(
    Effect.flatMap(SessionControlRunLifecycleRepository, (lifecycle) =>
      lifecycle.settle({
        sessionId,
        runId,
        nextRunId: RunId(`next-${runId}`),
        terminalStatus: 'failed',
      }),
    ),
  )
}

async function discoveredWithPiSettings() {
  await selectDefaultModel()
  const cli = createPiCliSession(fixture.project, 'First question')
  const cliManager = SessionManager.open(cli.file)
  cliManager.appendModelChange('local', 'file-model')
  cliManager.appendThinkingLevelChange('high')
  agePiFile(cli.file)
  return SessionId(await discoverOne())
}

describe('Pi settings a Run held off', () => {
  it('are not applied by a later Run over a setting the user chose since', async () => {
    const sessionId = await discoveredWithPiSettings()
    const first = await admit(sessionId, 'first')
    const { refreshPiSessionProjection } = await import(
      '../../../application/pi-session-projection-refresh'
    )
    await run(refreshPiSessionProjection(sessionId, 'reader'))
    // The first Run ends before its own refresh, as when its authority check fails.
    await settle(sessionId, first)
    const { SessionSettingsRepository } = await import('../../../ports/session-settings-repository')
    const change = await run(
      Effect.flatMap(SessionSettingsRepository, (settings) =>
        settings.setThinkingLevel(sessionId, 'low'),
      ),
    )
    expect(change).toMatchObject({ changed: true })

    const second = await admit(sessionId, 'second')
    await run(refreshPiSessionProjection(sessionId, 'run', second))

    expect(await sessionDetail(sessionId)).toMatchObject({
      executionModel: FAKE_PROVIDER_MODEL,
      executionThinkingLevel: 'low',
    })
  })

  it('are still applied by the Run that held them off', async () => {
    const sessionId = await discoveredWithPiSettings()
    const runId = await admit(sessionId, 'held')
    const { refreshPiSessionProjection } = await import(
      '../../../application/pi-session-projection-refresh'
    )
    await run(refreshPiSessionProjection(sessionId, 'reader'))

    await run(refreshPiSessionProjection(sessionId, 'run', runId))

    expect(await sessionDetail(sessionId)).toMatchObject({
      executionModel: 'local/file-model',
      executionThinkingLevel: 'high',
    })
  })
})

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
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
 * A discovered Pi session continues the way `pi --resume` would (ADR 0050) however its first Run
 * starts: a Session Control message to a Session nobody opened runs with the model and thinking
 * level the Pi file last used, not the Session lifecycle's defaults.
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
const provider = setUpFakePiProvider(fixture, { reasoningModels: ['file-model'] })

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

async function sessionControlRun(sessionId: SessionId, text: string) {
  const { SessionControlRunExecutor } = await import('../../../ports/session-control-run-executor')
  return run(
    Effect.flatMap(SessionControlRunExecutor, (executor) =>
      executor.execute({
        sessionId,
        runId: RunId('run-session-control'),
        intent: fromPartial({ callerId: 'gui:local-user', text, attachmentIds: [] }),
        controller: new AbortController(),
      }),
    ),
  )
}

/** A message admitted and activated by Session Control, as the Run coordinator does. */
async function admitSessionControlRun(sessionId: SessionId, text: string) {
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
          requestId: 'request-admit',
          idempotencyKey: 'idempotency-admit',
          command: { operation: 'message', sessionId, input: { text, attachmentIds: [] } },
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

/** A message admitted and activated by Session Control, as the Run coordinator does, then run. */
async function admittedSessionControlRun(sessionId: SessionId, text: string) {
  const runId = await admitSessionControlRun(sessionId, text)
  const { SessionControlRunExecutor } = await import('../../../ports/session-control-run-executor')
  return run(
    Effect.flatMap(SessionControlRunExecutor, (executor) =>
      executor.execute({
        sessionId,
        runId,
        intent: fromPartial({ callerId: 'gui:local-user', text, attachmentIds: [] }),
        controller: new AbortController(),
      }),
    ),
  )
}

describe('A Session Control Run in a discovered Pi session nobody opened', () => {
  it("runs an admitted, active Run with the Pi file's model and thinking level", async () => {
    await selectDefaultModel()
    const cli = createPiCliSession(fixture.project, 'First question')
    const cliManager = SessionManager.open(cli.file)
    cliManager.appendModelChange('local', 'file-model')
    cliManager.appendThinkingLevelChange('high')
    agePiFile(cli.file)
    const sessionId = SessionId(await discoverOne())

    const result = await admittedSessionControlRun(sessionId, 'Go on')

    expect(result.terminalStatus).toBe('completed')
    expect(provider.requests.map((request) => request.model)).toEqual(['file-model'])
    expect(provider.requests[0]).toMatchObject({ reasoning_effort: 'high' })
  })

  it("runs with the Pi file's model and thinking level, and writes no others into it", async () => {
    await selectDefaultModel()
    const cli = createPiCliSession(fixture.project, 'First question')
    const cliManager = SessionManager.open(cli.file)
    cliManager.appendModelChange('local', 'file-model')
    cliManager.appendThinkingLevelChange('high')
    agePiFile(cli.file)
    const sessionId = await discoverOne()

    const result = await sessionControlRun(SessionId(sessionId), 'Go on')

    expect(result.terminalStatus).toBe('completed')
    expect(provider.requests.map((request) => request.model)).toEqual(['file-model'])
    expect(await sessionDetail(sessionId)).toMatchObject({
      executionModel: 'local/file-model',
      executionThinkingLevel: 'high',
    })
    const entries = SessionManager.open(cli.file).getEntries()
    const models = entries.flatMap((entry) =>
      entry.type === 'model_change' ? [entry.modelId] : [],
    )
    const levels = entries.flatMap((entry) =>
      entry.type === 'thinking_level_change' ? [entry.thinkingLevel] : [],
    )
    expect(models.every((model) => model === 'file-model')).toBe(true)
    expect(levels.every((level) => level === 'high')).toBe(true)
  })

  it("waits for a reader's first projection, so a Run starting meanwhile reads its settings", async () => {
    await selectDefaultModel()
    const cli = createPiCliSession(fixture.project, 'First question')
    const cliManager = SessionManager.open(cli.file)
    cliManager.appendModelChange('local', 'file-model')
    agePiFile(cli.file)
    const sessionId = SessionId(await discoverOne())
    const { refreshPiSessionProjection } = await import(
      '../../../application/pi-session-projection-refresh'
    )
    const { SessionSettingsRepository } = await import('../../../ports/session-settings-repository')
    let releaseReader: () => void = () => undefined
    const readerHolds = new Promise<void>((resolve) => {
      releaseReader = resolve
    })
    let projected: () => void = () => undefined
    const readerProjected = new Promise<void>((resolve) => {
      projected = resolve
    })

    // The reader stops after persisting its projection, before it applies the Pi settings.
    const reader = run(
      Effect.gen(function* () {
        const settings = yield* SessionSettingsRepository
        return yield* refreshPiSessionProjection(sessionId, 'reader').pipe(
          Effect.provideService(SessionSettingsRepository, {
            ...settings,
            setModel: (...args: Parameters<typeof settings.setModel>) =>
              Effect.promise(async () => {
                projected()
                await readerHolds
              }).pipe(Effect.zipRight(settings.setModel(...args))),
          }),
        )
      }),
    )
    await readerProjected
    const runRefresh = run(refreshPiSessionProjection(sessionId, 'run')).then(
      async () => (await sessionDetail(sessionId))?.executionModel,
    )
    setTimeout(releaseReader, 200)

    expect(await runRefresh).toBe('local/file-model')
    await reader
  })

  it('applies, for its own Run, the Pi settings a reader could not while the Run held the Session', async () => {
    await selectDefaultModel()
    const cli = createPiCliSession(fixture.project, 'First question')
    const cliManager = SessionManager.open(cli.file)
    cliManager.appendModelChange('local', 'file-model')
    cliManager.appendThinkingLevelChange('high')
    agePiFile(cli.file)
    const sessionId = SessionId(await discoverOne())
    const runId = await admitSessionControlRun(sessionId, 'Go on')
    const { refreshPiSessionProjection } = await import(
      '../../../application/pi-session-projection-refresh'
    )

    // The sidebar opens it first; the admitted Run refuses the reader's change of its settings.
    await run(refreshPiSessionProjection(sessionId, 'reader'))
    expect((await sessionDetail(sessionId))?.executionModel).toBe(FAKE_PROVIDER_MODEL)
    await run(refreshPiSessionProjection(sessionId, 'run', runId))

    expect(await sessionDetail(sessionId)).toMatchObject({
      executionModel: 'local/file-model',
      executionThinkingLevel: 'high',
    })
  })
})

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { RunId, SessionId, SupportedModelId } from '@shared/types/brand'
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

describe('A Session Control Run in a discovered Pi session nobody opened', () => {
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
})

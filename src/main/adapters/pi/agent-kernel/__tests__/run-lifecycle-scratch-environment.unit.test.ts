import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const extensionPackagePaths: string[] = []
  const runtime: { model: { id: string }; services: object; modelFallbackMessage?: string } = {
    model: { id: 'model' },
    services: {},
  }
  return {
    createPiSessionForRun: vi.fn(),
    createIsolatedPiProjectRuntime: vi.fn(async (_input: { readonly options: object }) => ({
      runtime,
      enabledOpenWaggleExtensionPackagePaths: extensionPackagePaths,
    })),
    extensionPackagePaths,
    runtime,
  }
})

vi.mock('../pi-run-session', () => ({ createPiSessionForRun: mocks.createPiSessionForRun }))
vi.mock('../runtime-extension-isolation', () => ({
  createIsolatedPiProjectRuntime: mocks.createIsolatedPiProjectRuntime,
  createPiProjectModelRuntimeWithoutOpenWaggleExtensions: vi.fn(async () => ({
    model: { id: 'model' },
    services: {},
  })),
}))
vi.mock('../session-manager', () => ({
  createSessionManagerForSession: vi.fn(() => ({})),
  requireSessionProjectPath: vi.fn(() => '/repo'),
}))
vi.mock('../pi-run-control', () => ({ createPiRunControl: vi.fn() }))
vi.mock('../../pi-provider-catalog', () => ({
  getPiModelAvailableThinkingLevels: vi.fn(() => ['off', 'low', 'medium', 'high']),
}))

const { createPiRunSessionRuntime } = await import('../run-lifecycle')
const { idleCacheWarming } = await import('../pi-idle-cache-warming')

const SCRATCH = '/tmp/ow-scratch-501/37a8eec1/0123456789ab'

function runtimeInput() {
  return fromPartial<Parameters<typeof createPiRunSessionRuntime>[0]>({
    session: fromPartial({ id: SessionId('session'), projectPath: '/repo', messages: [] }),
    projectPath: '/repo',
    runId: 'run',
    payload: fromPartial({ text: 'Go.', attachments: [] }),
    modelReference: SupportedModelId('provider/model'),
    signal: new AbortController().signal,
    onEvent: vi.fn(),
    scratchDirectory: SCRATCH,
  })
}

describe('Pi run session scratch environment', () => {
  beforeEach(() => {
    mocks.createPiSessionForRun.mockReset().mockResolvedValue({ session: {} })
    mocks.extensionPackagePaths.splice(0)
    mocks.createIsolatedPiProjectRuntime.mockClear()
    delete mocks.runtime.modelFallbackMessage
  })

  it("hands the Session's scratch directory to the tools' environment", async () => {
    await createPiRunSessionRuntime(runtimeInput())

    expect(mocks.createPiSessionForRun).toHaveBeenCalledWith(
      expect.objectContaining({ scratchDirectory: SCRATCH }),
    )
  })

  it('keeps it when the run falls back to a runtime without OpenWaggle extensions', async () => {
    mocks.extensionPackagePaths.push('/extensions/broken')
    mocks.createPiSessionForRun
      .mockRejectedValueOnce(new Error('extension failed'))
      .mockResolvedValueOnce({ session: {} })

    await createPiRunSessionRuntime(runtimeInput())

    expect(mocks.createPiSessionForRun).toHaveBeenCalledTimes(2)
    expect(mocks.createPiSessionForRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ scratchDirectory: SCRATCH }),
    )
  })

  it('starts Pi with the Session thinking level, clamped to the model', async () => {
    const input = runtimeInput()
    await createPiRunSessionRuntime({
      ...input,
      session: { ...input.session, executionThinkingLevel: 'max' },
    })

    expect(mocks.createPiSessionForRun).toHaveBeenCalledWith(
      expect.objectContaining({ thinkingLevel: 'high' }),
    )
  })

  it("lets Pi restore the Session's own level when the Session stores none", async () => {
    await createPiRunSessionRuntime(runtimeInput())

    expect(mocks.createPiSessionForRun.mock.calls[0]?.[0]).not.toHaveProperty('thinkingLevel')
  })

  it("warns in the Run, in Pi's words, when the selected model fell back", async () => {
    const message =
      'Could not restore model router/auto (model no longer exists). Using provider/model.'
    mocks.runtime.modelFallbackMessage = message
    const input = runtimeInput()

    await createPiRunSessionRuntime({ ...input, modelFallback: 'last-answering-model' })

    expect(input.onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent_interaction_request',
        interaction: expect.objectContaining({ kind: 'notify', level: 'warning', message }),
      }),
    )
  })

  it("falls back to the last answering model only when the Run asks to, never for a Waggle agent's pinned model", async () => {
    const input = runtimeInput()
    const session = fromPartial<typeof input.session>({
      ...input.session,
      messages: [fromPartial({ role: 'assistant', model: SupportedModelId('other/agent-model') })],
    })

    await createPiRunSessionRuntime({ ...input, session })
    await createPiRunSessionRuntime({ ...input, session, modelFallback: 'last-answering-model' })

    const optionsOf = (call: number) =>
      mocks.createIsolatedPiProjectRuntime.mock.calls[call]?.[0]?.options
    expect(optionsOf(0)).not.toHaveProperty('fallbackModelReference')
    expect(optionsOf(1)).toMatchObject({ fallbackModelReference: 'other/agent-model' })
  })

  it("warms between runs once the user's Pi settings say so, though OpenWaggle's never changed", async () => {
    // The Host last applied OpenWaggle's mode, before the user edited their Pi settings.
    idleCacheWarming.applyMode('streaming')
    const agentDir = mkdtempSync(path.join(tmpdir(), 'openwaggle-pi-agent-'))
    writeFileSync(path.join(agentDir, 'settings.json'), '{"cacheWarming":"idle"}\n')
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)

    try {
      await createPiRunSessionRuntime(runtimeInput())
    } finally {
      vi.unstubAllEnvs()
      rmSync(agentDir, { recursive: true, force: true })
    }

    const warming = fromPartial<Parameters<typeof idleCacheWarming.settle>[1]>({
      cacheWarmingStatus: { state: 'scheduled', nextWarmAt: Date.now() + 60_000 },
      extensionRunner: { emit: vi.fn(async () => undefined) },
      dispose: vi.fn(),
      sessionManager: { appendUsage: vi.fn() },
    })
    await expect(idleCacheWarming.settle('session', warming, { aborted: false })).resolves.toBe(
      'warming',
    )
    await idleCacheWarming.releaseAll()
  })

  it('warns about a model fallback once per Session until the selection changes', async () => {
    mocks.runtime.modelFallbackMessage =
      'Could not restore model router/auto (model no longer exists). Using provider/model.'
    const notices = (onEvent: ReturnType<typeof vi.fn>) =>
      onEvent.mock.calls.filter(([event]) => event?.type === 'agent_interaction_request').length
    const run = async (modelReference: string) => {
      const input = { ...runtimeInput(), modelReference: SupportedModelId(modelReference) }
      const onEvent = vi.fn()
      await createPiRunSessionRuntime({
        ...input,
        session: fromPartial({ ...input.session, id: SessionId('session-with-fallback') }),
        onEvent,
        modelFallback: 'last-answering-model',
      })
      return notices(onEvent)
    }

    expect(await run('router/auto')).toBe(1)
    expect(await run('router/auto')).toBe(0)
    expect(await run('router/other-removed')).toBe(1)
  })
})

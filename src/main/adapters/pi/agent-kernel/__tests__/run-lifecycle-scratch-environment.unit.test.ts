import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
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
const { forgetModelFallbackNotice } = await import('../interaction-ui-context')
const { installPiRuntimeIntegration } = await import('../../../../runtime-pi-integration')
const { runSessionRemovalHooks } = await import('../../../../application/session-removal-hooks')

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

  it('keeps the fallback warning through a Waggle Run and forgets it with the Session', async () => {
    const message =
      'Could not restore model router/auto (model no longer exists). Using provider/model.'
    const sessionId = SessionId('session-waggle-and-removal')
    const run = async (modelFallback: 'last-answering-model' | undefined) => {
      const input = runtimeInput()
      const onEvent = vi.fn()
      await createPiRunSessionRuntime({
        ...input,
        session: fromPartial({ ...input.session, id: sessionId }),
        onEvent,
        ...(modelFallback ? { modelFallback } : {}),
      })
      return onEvent.mock.calls.filter(([event]) => event?.type === 'agent_interaction_request')
        .length
    }

    mocks.runtime.modelFallbackMessage = message
    expect(await run('last-answering-model')).toBe(1)
    // A Waggle agent runs on its own pinned model and says nothing about the Session's selection.
    delete mocks.runtime.modelFallbackMessage
    expect(await run(undefined)).toBe(0)
    mocks.runtime.modelFallbackMessage = message
    expect(await run('last-answering-model')).toBe(0)

    forgetModelFallbackNotice(sessionId)
    expect(await run('last-answering-model')).toBe(1)
  })

  it('warns again after the Host removes the Session and it is restored', async () => {
    mocks.runtime.modelFallbackMessage =
      'Could not restore model router/auto (model no longer exists). Using provider/model.'
    const sessionId = SessionId('session-removed-by-host')
    const run = async () => {
      const input = runtimeInput()
      const onEvent = vi.fn()
      await createPiRunSessionRuntime({
        ...input,
        session: fromPartial({ ...input.session, id: sessionId }),
        onEvent,
        modelFallback: 'last-answering-model',
      })
      return onEvent.mock.calls.filter(([event]) => event?.type === 'agent_interaction_request')
        .length
    }
    const uninstall = installPiRuntimeIntegration()
    try {
      expect(await run()).toBe(1)
      expect(await run()).toBe(0)

      // Archiving or deleting the Session runs the removal hooks the Host installed.
      await Effect.runPromise(runSessionRemovalHooks(sessionId))

      expect(await run()).toBe(1)
    } finally {
      uninstall()
    }
  })
})

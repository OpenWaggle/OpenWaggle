import { SessionId, SupportedModelId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const extensionPackagePaths: string[] = []
  return { createPiSessionForRun: vi.fn(), extensionPackagePaths }
})

vi.mock('../pi-run-session', () => ({ createPiSessionForRun: mocks.createPiSessionForRun }))
vi.mock('../runtime-extension-isolation', () => ({
  createIsolatedPiProjectRuntime: vi.fn(async () => ({
    runtime: { model: { id: 'model' }, services: {} },
    enabledOpenWaggleExtensionPackagePaths: mocks.extensionPackagePaths,
  })),
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
  getPiModelAvailableThinkingLevels: vi.fn(() => ['medium']),
}))

const { createPiRunSessionRuntime } = await import('../run-lifecycle')

const SCRATCH = '/tmp/ow-scratch-501/37a8eec1/0123456789ab'

function runtimeInput() {
  return fromPartial<Parameters<typeof createPiRunSessionRuntime>[0]>({
    session: fromPartial({ id: SessionId('session'), projectPath: '/repo' }),
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
})

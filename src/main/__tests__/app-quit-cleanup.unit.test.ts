import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  on: vi.fn<(name: string, handler: (event: { preventDefault: () => void }) => void) => void>(),
  quit: vi.fn(),
  showErrorBox: vi.fn(),
}))
vi.mock('electron', () => ({ app: { on: mocks.on, quit: mocks.quit } }))
vi.mock('../desktop-ui', () => ({ showErrorBox: mocks.showErrorBox }))

const { registerAppQuitCleanup } = await import('../app-quit-cleanup')

function setup() {
  const input = {
    disposeAutoUpdater: vi.fn(),
    persistActiveRuns: vi.fn(async () => undefined),
    cleanupTerminals: vi.fn<() => Promise<void>>(async () => undefined),
    disposeRuntime: vi.fn(async () => undefined),
  }
  registerAppQuitCleanup(input)
  const handler = mocks.on.mock.calls[0]?.[1]
  if (handler === undefined) throw new Error('Expected before-quit handler')
  const preventDefault = vi.fn()
  return { input, preventDefault, quit: () => handler({ preventDefault }) }
}

beforeEach(() => vi.resetAllMocks())

describe('app quit cleanup ownership', () => {
  it('serializes repeated quit requests and waits for terminal cleanup before runtime disposal', async () => {
    const subject = setup()
    let finish: (() => void) | undefined
    subject.input.cleanupTerminals.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    subject.quit()
    subject.quit()
    await vi.waitFor(() => expect(subject.input.cleanupTerminals).toHaveBeenCalledOnce())
    expect(subject.input.disposeRuntime).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    finish?.()
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(subject.input.disposeRuntime).toHaveBeenCalledOnce()
    subject.preventDefault.mockClear()
    subject.quit()
    expect(subject.preventDefault).not.toHaveBeenCalled()
    expect(subject.input.cleanupTerminals).toHaveBeenCalledOnce()
  })

  it('stays open after failed terminal cleanup and allows a fresh quit attempt', async () => {
    const subject = setup()
    subject.input.cleanupTerminals.mockRejectedValueOnce(new Error('owned child remains'))
    subject.quit()
    await vi.waitFor(() => expect(mocks.showErrorBox).toHaveBeenCalledOnce())
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(subject.input.disposeRuntime).not.toHaveBeenCalled()
    subject.quit()
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(subject.input.cleanupTerminals).toHaveBeenCalledTimes(2)
  })

  it('still drains terminals when persistence fails, then quits after safe cleanup', async () => {
    const subject = setup()
    subject.input.persistActiveRuns.mockRejectedValue(new Error('storage unavailable'))
    subject.quit()
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
    expect(subject.input.cleanupTerminals).toHaveBeenCalledOnce()
    expect(subject.input.disposeRuntime).toHaveBeenCalledOnce()
    expect(mocks.showErrorBox).not.toHaveBeenCalled()
  })

  it('can retry after hidden automation blocks the shutdown error dialog', async () => {
    const subject = setup()
    subject.input.cleanupTerminals.mockRejectedValueOnce(new Error('drain timed out'))
    mocks.showErrorBox.mockImplementationOnce(() => {
      throw new Error('hidden automation')
    })
    subject.quit()
    await vi.waitFor(() => expect(mocks.showErrorBox).toHaveBeenCalledOnce())
    expect(mocks.quit).not.toHaveBeenCalled()
    subject.quit()
    await vi.waitFor(() => expect(mocks.quit).toHaveBeenCalledOnce())
  })
})

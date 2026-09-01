import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import hostRuntime from '../inline-visualization-assets/host-runtime.js.raw?raw'

interface RuntimeWindow {
  readonly openai?: {
    readonly sendFollowUpMessage: (message: string) => Promise<boolean>
  }
}

function runtimeHarness(nativeActivationIsActive = false) {
  const postedMessages: unknown[] = []
  const listeners = new Map<string, Array<(event: { source?: unknown; data?: unknown }) => void>>()
  const parent = { postMessage: (message: unknown) => postedMessages.push(message) }
  class NativeUserActivation {
    get isActive() {
      return nativeActivationIsActive
    }
  }
  const navigator: { userActivation: { readonly isActive: boolean } } = {
    userActivation: new NativeUserActivation(),
  }
  const runtimeWindow: RuntimeWindow = {}
  const context = vm.createContext({
    crypto: { randomUUID: vi.fn(() => 'trusted-capability-1234567890') },
    parent,
    document: { addEventListener: vi.fn() },
    navigator,
    window: runtimeWindow,
    addEventListener: vi.fn(
      (type: string, listener: (event: { source?: unknown; data?: unknown }) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
    ),
    setTimeout,
    clearTimeout,
  })
  vm.runInContext(hostRuntime, context)
  const dispatchHostMessage = (data: unknown) => {
    for (const listener of listeners.get('message') ?? []) listener({ source: parent, data })
  }
  return { context, dispatchHostMessage, navigator, postedMessages, runtimeWindow }
}

describe('inline visualization host runtime', () => {
  it('rejects a follow-up when fragment code shadows navigator.userActivation', async () => {
    const { navigator, postedMessages, runtimeWindow } = runtimeHarness()
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true },
    })

    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')
    await expect(openai.sendFollowUpMessage('Untrusted automatic follow-up')).resolves.toBe(false)
    expect(postedMessages).not.toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:follow-up' }),
    )
  })

  it('allows a follow-up during genuine native user activation', async () => {
    const { dispatchHostMessage, postedMessages, runtimeWindow } = runtimeHarness(true)
    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')

    const result = openai.sendFollowUpMessage('Trusted interactive follow-up')
    const request = postedMessages.find(
      (message): message is { capability: string; requestId: string; type: string } =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'openwaggle:inline-visualization:follow-up',
    )
    expect(request).toBeDefined()
    dispatchHostMessage({
      type: 'openwaggle:inline-visualization:follow-up-result',
      requestId: request?.requestId,
      accepted: true,
    })

    await expect(result).resolves.toBe(true)
  })
})

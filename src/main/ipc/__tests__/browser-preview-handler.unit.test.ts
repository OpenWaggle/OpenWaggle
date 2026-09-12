import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const manager = vi.hoisted(() => ({
  open: vi.fn(),
  setBounds: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  replaceForCapacity: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
  zoom: vi.fn(),
  setCurrentPreview: vi.fn(),
  forgetOwnerSelection: vi.fn(),
  setAudioMuted: vi.fn(),
  setShortcutBindings: vi.fn(),
}))
const ownerRegistry = vi.hoisted(() => ({
  acknowledge: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
    on: vi.fn(),
  },
}))

vi.mock('../../browser-preview', () => ({ browserPreviewManager: manager }))
vi.mock('../../browser-preview-owner-registry', () => ({
  browserPreviewOwnerRegistry: ownerRegistry,
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))

import { registerBrowserPreviewHandlers } from '../browser-preview-handler'

const STATE = {
  previewId: 'preview-1',
  profileId: 'default',
  url: 'https://example.com/',
  title: '',
  loading: true,
  canGoBack: false,
  canGoForward: false,
  error: null,
}

function registeredHandler(channel: string) {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing handler for ${channel}.`)
  return handler
}

describe('browser preview IPC handlers', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    manager.open.mockReturnValue(STATE)
    manager.navigate.mockReturnValue(STATE)
    manager.goBack.mockReturnValue(STATE)
    manager.goForward.mockReturnValue(STATE)
    manager.reload.mockReturnValue(STATE)
    manager.stop.mockReturnValue(STATE)
    manager.close.mockResolvedValue(undefined)
    registerBrowserPreviewHandlers()
  })

  it('awaits native close and preserves the original rejection message', async () => {
    const native = Promise.withResolvers<void>()
    manager.close.mockReturnValueOnce(native.promise)
    const request = registeredHandler('browser-preview:close')({ sender: { id: 17 } }, 'preview-1')
    let settled = false
    const result = Promise.resolve(request).finally(() => {
      settled = true
    })
    const rejection = expect(result).rejects.toThrow('Exact native close failure')
    await Promise.resolve()
    expect(settled).toBe(false)
    native.reject(new Error('Exact native close failure'))
    await rejection
  })

  it('registers the complete browser preview command set', () => {
    expect([...handlers.keys()].sort()).toEqual([
      'browser-preview:ack-open-request',
      'browser-preview:cancel-pick-element',
      'browser-preview:capture-screenshot',
      'browser-preview:clear-cache',
      'browser-preview:clear-cookies',
      'browser-preview:clear-profile-data',
      'browser-preview:close',
      'browser-preview:close-picture-in-picture',
      'browser-preview:copy-screenshot',
      'browser-preview:go-back',
      'browser-preview:go-forward',
      'browser-preview:guided-import-cookies',
      'browser-preview:hard-reload',
      'browser-preview:import-cookies',
      'browser-preview:list-import-sources',
      'browser-preview:navigate',
      'browser-preview:open',
      'browser-preview:open-devtools',
      'browser-preview:open-full-disk-access-settings',
      'browser-preview:open-picture-in-picture',
      'browser-preview:pick-element',
      'browser-preview:register-owner',
      'browser-preview:reload',
      'browser-preview:replace-for-capacity',
      'browser-preview:respond-recording-request',
      'browser-preview:reveal-artifact',
      'browser-preview:save-recording',
      'browser-preview:set-appearance',
      'browser-preview:set-audio-muted',
      'browser-preview:set-bounds',
      'browser-preview:set-current',
      'browser-preview:set-shortcut-bindings',
      'browser-preview:set-viewport',
      'browser-preview:start-recording',
      'browser-preview:stop',
      'browser-preview:stop-recording',
      'browser-preview:unregister-owner',
      'browser-preview:zoom',
    ])
  })

  it('decodes and opens a bounded HTTP preview for the invoking sender', async () => {
    const sender = { id: 19 }
    const input = {
      previewId: 'preview-1',
      ownerKey: 'session-1',
      profileId: 'default',
      url: 'https://example.com',
      bounds: { x: 10, y: 20, width: 900, height: 700 },
      visible: true,
    }

    const result = await registeredHandler('browser-preview:open')({ sender }, input)

    expect(result).toEqual(STATE)
    expect(manager.open).toHaveBeenCalledWith(sender, input)
  })

  it('rejects non-HTTP URLs before they reach the native manager', async () => {
    const invocation = registeredHandler('browser-preview:open')(
      { sender: { id: 19 } },
      {
        previewId: 'preview-1',
        ownerKey: 'session-1',
        profileId: 'default',
        url: 'file:///etc/passwd',
        bounds: { x: 0, y: 0, width: 900, height: 700 },
        visible: true,
      },
    )

    await expect(invocation).rejects.toThrow('Must be a valid HTTP or HTTPS URL')
    expect(manager.open).not.toHaveBeenCalled()
  })

  it('rejects out-of-range bounds before they reach the native manager', async () => {
    const invocation = registeredHandler('browser-preview:set-bounds')(
      { sender: { id: 19 } },
      'preview-1',
      { x: 0, y: 0, width: 40_000, height: 700 },
    )

    await expect(invocation).rejects.toThrow('less than or equal to 32768')
    expect(manager.setBounds).not.toHaveBeenCalled()
  })

  it('uses null bounds as an explicit hide command', async () => {
    const sender = { id: 19 }

    await registeredHandler('browser-preview:set-bounds')({ sender }, 'preview-1', null)

    expect(manager.setBounds).toHaveBeenCalledWith(sender, 'preview-1', null)
  })

  it('releases pending selection when a renderer unregisters its session', async () => {
    const sender = { id: 19 }
    await registeredHandler('browser-preview:unregister-owner')({ sender }, 'session-1')
    expect(ownerRegistry.unregister).toHaveBeenCalledWith('session-1', sender)
    expect(manager.forgetOwnerSelection).toHaveBeenCalledWith(sender, 'session-1')
  })

  it('validates and registers the renderer shortcut chords for native previews', async () => {
    const sender = { id: 19 }
    const bindings = [
      { key: 'K', mod: true },
      { key: 'F8', ctrl: true, alt: true },
    ]

    await registeredHandler('browser-preview:set-shortcut-bindings')({ sender }, bindings)

    expect(manager.setShortcutBindings).toHaveBeenCalledWith(sender, bindings)
  })

  it('validates the open acknowledgment and current preview before routing them', async () => {
    const sender = { id: 19 }
    const acknowledgment = {
      requestId: 'request-1',
      generation: 1,
      ownerKey: 'session-1',
      previewId: 'preview-1',
      success: true,
    }

    await registeredHandler('browser-preview:ack-open-request')({ sender }, acknowledgment)
    await registeredHandler('browser-preview:set-current')({ sender }, 'session-1', 'preview-1')

    expect(ownerRegistry.acknowledge).toHaveBeenCalledWith(sender, acknowledgment)
    expect(manager.setCurrentPreview).toHaveBeenCalledWith(sender, 'session-1', 'preview-1')
  })

  it('rejects malformed open acknowledgments before they reach the owner registry', async () => {
    const invocation = registeredHandler('browser-preview:ack-open-request')(
      { sender: { id: 19 } },
      {
        requestId: 'request-1',
        generation: 0,
        ownerKey: 'session-1',
        previewId: 'preview-1',
        success: true,
      },
    )

    await expect(invocation).rejects.toThrow()
    expect(ownerRegistry.acknowledge).not.toHaveBeenCalled()
  })

  it('rejects unsafe open-request generations before they reach the owner registry', async () => {
    const invocation = registeredHandler('browser-preview:ack-open-request')(
      { sender: { id: 19 } },
      {
        requestId: 'request-1',
        generation: Number.MAX_SAFE_INTEGER + 1,
        ownerKey: 'session-1',
        previewId: 'preview-1',
        success: true,
      },
    )

    await expect(invocation).rejects.toThrow('generation:')
    expect(ownerRegistry.acknowledge).not.toHaveBeenCalled()
  })

  it('rejects an oversized native-preview shortcut registry', async () => {
    const bindings = Array.from({ length: 513 }, (_, index) => ({ key: String(index) }))

    const invocation = registeredHandler('browser-preview:set-shortcut-bindings')(
      { sender: { id: 19 } },
      bindings,
    )

    await expect(invocation).rejects.toThrow('Expected an array of at most 512 item(s)')
    expect(manager.setShortcutBindings).not.toHaveBeenCalled()
  })

  it('routes navigation and lifecycle actions through the invoking sender', async () => {
    const sender = { id: 19 }
    const replacement = {
      previewId: 'preview-2',
      ownerKey: 'session-1',
      profileId: 'default',
      url: 'https://openwaggle.dev',
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      visible: false,
      initialControls: {
        viewport: { mode: 'fill' },
        zoomFactor: 1.2,
        appearance: 'system',
      },
    }

    await registeredHandler('browser-preview:navigate')(
      { sender },
      'preview-1',
      'https://openwaggle.dev',
    )
    await registeredHandler('browser-preview:go-back')({ sender }, 'preview-1')
    await registeredHandler('browser-preview:go-forward')({ sender }, 'preview-1')
    await registeredHandler('browser-preview:reload')({ sender }, 'preview-1')
    await registeredHandler('browser-preview:stop')({ sender }, 'preview-1')
    await registeredHandler('browser-preview:close')({ sender }, 'preview-1')
    await registeredHandler('browser-preview:replace-for-capacity')(
      { sender },
      replacement,
      'preview-1',
    )
    await registeredHandler('browser-preview:zoom')({ sender }, 'preview-1', 'in')
    await registeredHandler('browser-preview:set-audio-muted')({ sender }, 'preview-1', true)

    expect(manager.navigate).toHaveBeenCalledWith(sender, 'preview-1', 'https://openwaggle.dev')
    expect(manager.goBack).toHaveBeenCalledWith(sender, 'preview-1')
    expect(manager.goForward).toHaveBeenCalledWith(sender, 'preview-1')
    expect(manager.reload).toHaveBeenCalledWith(sender, 'preview-1')
    expect(manager.stop).toHaveBeenCalledWith(sender, 'preview-1')
    expect(manager.close).toHaveBeenCalledWith(sender, 'preview-1')
    expect(manager.replaceForCapacity).toHaveBeenCalledWith(sender, replacement, 'preview-1')
    expect(manager.zoom).toHaveBeenCalledWith(sender, 'preview-1', 'in')
    expect(manager.setAudioMuted).toHaveBeenCalledWith(sender, 'preview-1', true)
  })
})

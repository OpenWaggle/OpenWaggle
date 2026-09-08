import { beforeEach, describe, expect, it } from 'vitest'
import {
  BrowserPreviewManager,
  createOwner,
  createWindow,
  firstView,
  getBrowserPreviewElectronMocks,
  openInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()

function openAudioPreview(audioMuted = false) {
  const ownerFixture = createOwner()
  const ownerWindow = createWindow()
  electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
  const manager = new BrowserPreviewManager()
  const state = manager.open(ownerFixture.owner, openInput({ audioMuted }))
  return { manager, ownerFixture, state, view: firstView() }
}

describe('browser preview tab audio', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
  })

  it('applies mute before first load and exposes the committed per-tab intent', () => {
    const { state, view } = openAudioPreview(true)

    expect(view.webContents.setAudioMuted).toHaveBeenCalledExactlyOnceWith(true)
    expect(state).toMatchObject({ audioMuted: true, audible: false })
  })

  it('tracks Chromium audibility independently from mute intent', () => {
    const { ownerFixture, view } = openAudioPreview(true)
    ownerFixture.send.mockClear()

    view.webContents.emit('audio-state-changed', { audible: true })

    expect(ownerFixture.send).toHaveBeenCalledWith(
      'browser-preview:state',
      expect.objectContaining({ audioMuted: true, audible: true }),
    )
  })

  it('publishes mute only after Chromium accepts it', () => {
    const { manager, ownerFixture, state, view } = openAudioPreview()
    ownerFixture.send.mockClear()
    view.webContents.setAudioMuted.mockImplementationOnce(() => {
      throw new Error('guest disappeared')
    })

    expect(() => manager.setAudioMuted(ownerFixture.owner, 'preview-1', true)).toThrow(
      'guest disappeared',
    )
    expect(state.audioMuted).toBe(false)
    expect(ownerFixture.send).not.toHaveBeenCalled()
  })
})

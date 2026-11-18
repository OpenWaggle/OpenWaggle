import { beforeEach, describe, expect, it } from 'vitest'
import {
  BrowserPreviewManager,
  createOwner,
  createWindow,
  getBrowserPreviewElectronMocks,
  getBrowserPreviewOwnerRegistryMock,
  openInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()
const ownerRegistry = getBrowserPreviewOwnerRegistryMock()

describe('browser preview capacity replacement', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
    ownerRegistry.assertRegistered.mockReset()
    ownerRegistry.notifyMaterialized.mockReset()
  })

  it('releases the authenticated same-owner victim before materializing a ninth preview', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    for (let index = 0; index < 8; index += 1) {
      manager.open(owner, openInput({ previewId: `preview-${String(index)}` }))
    }
    const victim = electronMocks.createdViews[0]
    if (!victim) throw new Error('Expected the capacity victim.')

    const result = manager.replaceForCapacity(
      owner,
      openInput({ previewId: 'preview-8', url: 'https://openwaggle.dev' }),
      'preview-0',
    )

    expect(result).toMatchObject({
      state: { previewId: 'preview-8', ownerKey: 'session-1' },
      replacedState: { previewId: 'preview-0', ownerKey: 'session-1' },
    })
    expect(victim.webContents.close).toHaveBeenCalledOnce()
    expect(manager.listOwnedPreviews('session-1').map((record) => record.previewId)).toEqual([
      'preview-1',
      'preview-2',
      'preview-3',
      'preview-4',
      'preview-5',
      'preview-6',
      'preview-7',
      'preview-8',
    ])
    expect(electronMocks.createdViews).toHaveLength(9)
  })

  it('never releases a victim owned by another Session', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput({ previewId: 'other-preview', ownerKey: 'session-2' }))

    const result = manager.replaceForCapacity(
      owner,
      openInput({ previewId: 'new-preview', ownerKey: 'session-1' }),
      'other-preview',
    )

    expect(result.replacedState).toBeNull()
    expect(manager.listOwnedPreviews('session-2')).toHaveLength(1)
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(1)
    expect(electronMocks.createdViews[0]?.webContents.close).not.toHaveBeenCalled()
  })

  it('restores the victim when native replacement materialization fails', () => {
    const { owner } = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(
      owner,
      openInput({
        previewId: 'victim',
        audioMuted: true,
        initialControls: {
          viewport: { mode: 'fixed', width: 390, height: 844, presetId: null },
          zoomFactor: 1.25,
          appearance: 'dark',
        },
      }),
    )
    ownerWindow.addChildView.mockImplementationOnce(() => {
      throw new Error('native attach failed')
    })

    expect(() =>
      manager.replaceForCapacity(owner, openInput({ previewId: 'replacement' }), 'victim'),
    ).toThrow('native attach failed')

    expect(manager.findOwnedPreview('session-1', 'replacement')).toBeUndefined()
    expect(manager.findOwnedPreview('session-1', 'victim')?.state).toMatchObject({
      audioMuted: true,
      controls: {
        viewport: { mode: 'fixed', width: 390, height: 844, presetId: null },
        zoomFactor: 1.25,
        appearance: 'dark',
      },
    })
    expect(electronMocks.createdViews).toHaveLength(3)
    expect(electronMocks.createdViews[0]?.webContents.close).toHaveBeenCalledOnce()
    expect(electronMocks.createdViews[1]?.webContents.close).toHaveBeenCalledOnce()
    expect(electronMocks.createdViews[2]?.webContents.close).not.toHaveBeenCalled()
  })
})

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

beforeEach(() => {
  electronMocks.createdViews.splice(0)
  electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
  ownerRegistry.assertRegistered.mockReset()
  ownerRegistry.notifyMaterialized.mockReset()
})

describe('browser selection before native creation', () => {
  it('accepts authenticated selection intent before the first native view exists', () => {
    const { owner } = createOwner()
    const manager = new BrowserPreviewManager()
    expect(() => manager.setCurrentPreview(owner, 'session-1', 'preview-1')).not.toThrow()
    expect(manager.findOwnedPreview('session-1')).toBeUndefined()
    manager.open(owner, openInput())
    expect(manager.findOwnedPreview('session-1')?.previewId).toBe('preview-1')
  })

  it('does not substitute an older tab while a newer selected tab is being created', () => {
    const { owner } = createOwner()
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    manager.setCurrentPreview(owner, 'session-1', 'preview-2')
    manager.open(owner, openInput())
    expect(manager.findOwnedPreview('session-1')).toBeUndefined()
    manager.open(owner, openInput({ previewId: 'preview-2' }))
    expect(manager.findOwnedPreview('session-1')?.previewId).toBe('preview-2')
  })

  it('rejects cross-session selection even when the renderer owns both sessions', () => {
    const { owner } = createOwner()
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    expect(() => manager.setCurrentPreview(owner, 'session-2', 'preview-1')).toThrow('not owned')
  })

  it('forgets canceled pending selection without changing a different renderer selection', () => {
    const { owner } = createOwner()
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    manager.setCurrentPreview(owner, 'session-1', 'preview-2')
    manager.forgetOwnerSelection(createOwner(2).owner, 'session-1')
    expect(manager.findOwnedPreview('session-1')).toBeUndefined()
    manager.forgetOwnerSelection(owner, 'session-1')
    expect(manager.findOwnedPreview('session-1')?.previewId).toBe('preview-1')
  })

  it('treats late hide as idempotent but still rejects showing a missing view', () => {
    const { owner } = createOwner()
    const manager = new BrowserPreviewManager()
    manager.open(owner, openInput())
    manager.close(owner, 'preview-1')
    expect(() => manager.setBounds(owner, 'preview-1', null)).not.toThrow()
    expect(() =>
      manager.setBounds(owner, 'preview-1', { x: 0, y: 0, width: 100, height: 100 }),
    ).toThrow('not found')
  })
})

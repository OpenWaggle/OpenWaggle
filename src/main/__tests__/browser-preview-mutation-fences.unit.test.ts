import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BrowserPreviewManager,
  createOwner,
  createWindow,
  firstView,
  getBrowserPreviewElectronMocks,
  getBrowserPreviewOwnerRegistryMock,
  openInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()

function setup() {
  const { owner } = createOwner()
  electronMocks.windowFromWebContents.mockReturnValue(createWindow().window)
  const manager = new BrowserPreviewManager()
  manager.open(owner, openInput())
  return { owner, manager, view: firstView() }
}

describe('native browser mutation admission', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
    getBrowserPreviewOwnerRegistryMock().assertRegistered.mockReset()
    getBrowserPreviewOwnerRegistryMock().notifyMaterialized.mockReset()
  })

  it('fences native open, replacement and existing interactions before acknowledging acquire', async () => {
    const { owner, manager, view } = setup()
    const acquiring = manager.acquireMutationFence({ kind: 'owner', ownerKey: 'session-1' })
    expect(() => manager.open(owner, openInput({ previewId: 'new' }))).toThrow('fenced')
    expect(() =>
      manager.replaceForCapacity(owner, openInput({ previewId: 'new' }), 'preview-1'),
    ).toThrow('fenced')
    expect(() => manager.reload(owner, 'preview-1')).toThrow('fenced')
    expect(view.webContents.close).not.toHaveBeenCalled()
    manager.open(owner, openInput({ previewId: 'other', ownerKey: 'session-2' }))

    const release = await acquiring
    release()
    manager.reload(owner, 'preview-1')
    expect(view.webContents.reload).toHaveBeenCalledOnce()
  })

  it('keeps overlapping exact owner fences until their own release', async () => {
    const { owner, manager } = setup()
    const first = await manager.acquireMutationFence({ kind: 'owner', ownerKey: 'session-1' })
    const second = await manager.acquireMutationFence({ kind: 'owner', ownerKey: 'session-1' })
    first()
    first()
    expect(() => manager.reload(owner, 'preview-1')).toThrow('fenced')
    second()
    manager.reload(owner, 'preview-1')
  })

  it('conservatively fences all materialization for a path without closing unrelated previews', async () => {
    const { owner, manager, view } = setup()
    const release = await manager.acquireMutationFence({
      kind: 'path',
      directoryPath: path.resolve('worktree'),
    })
    expect(() =>
      manager.open(owner, openInput({ previewId: 'other', ownerKey: 'session-2' })),
    ).toThrow('fenced')
    expect(view.webContents.close).not.toHaveBeenCalled()
    expect(manager.listOwnedPreviews('session-1')).toHaveLength(1)
    release()
    manager.open(owner, openInput({ previewId: 'other', ownerKey: 'session-2' }))
  })

  it('permits acknowledged internal deletion while the owner fence is held', async () => {
    const { owner, manager, view } = setup()
    const release = await manager.acquireMutationFence({ kind: 'owner', ownerKey: 'session-1' })
    await manager.closeForOwner('session-1')
    expect(view.webContents.destroyed).toBe(true)
    expect(() => manager.open(owner, openInput())).toThrow('fenced')
    release()
    manager.open(owner, openInput())
  })

  it('rejects invalid scope without leaving a fence behind', async () => {
    const { owner, manager } = setup()
    await expect(manager.acquireMutationFence({ kind: 'owner', ownerKey: ' ' })).rejects.toThrow(
      'invalid scope',
    )
    await expect(
      manager.acquireMutationFence({ kind: 'path', directoryPath: 'relative' }),
    ).rejects.toThrow('invalid scope')
    manager.reload(owner, 'preview-1')
  })
})

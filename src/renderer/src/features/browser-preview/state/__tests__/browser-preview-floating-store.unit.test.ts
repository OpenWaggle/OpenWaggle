import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectBrowserPreviewFloating,
  useBrowserPreviewFloatingStore,
} from '../browser-preview-floating-store'

const OWNER_A = 'session-a'
const OWNER_B = 'session-b'

describe('browser preview floating store', () => {
  beforeEach(() => useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} }))

  it('keeps one floating preview per owner', () => {
    const store = useBrowserPreviewFloatingStore.getState()
    store.open(OWNER_A, 'preview-a')
    store.open(OWNER_B, 'preview-b')

    expect(
      selectBrowserPreviewFloating(useBrowserPreviewFloatingStore.getState().byOwnerKey, OWNER_A),
    ).toMatchObject({ previewId: 'preview-a' })
    expect(
      selectBrowserPreviewFloating(useBrowserPreviewFloatingStore.getState().byOwnerKey, OWNER_B),
    ).toMatchObject({ previewId: 'preview-b' })
  })

  it('preserves owner layout while switching the floating preview', () => {
    const store = useBrowserPreviewFloatingStore.getState()
    store.open(OWNER_A, 'preview-a')
    store.move(OWNER_A, 'preview-a', { x: 24, y: 48 })
    store.resize(OWNER_A, 'preview-a', { width: 480, height: 300 })
    store.open(OWNER_A, 'preview-b')

    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER_A]).toEqual({
      previewId: 'preview-b',
      position: { x: 24, y: 48 },
      size: { width: 480, height: 300 },
    })
  })

  it('ignores stale drag, resize, and close operations after the preview changes', () => {
    const store = useBrowserPreviewFloatingStore.getState()
    store.open(OWNER_A, 'preview-a')
    store.open(OWNER_A, 'preview-b')
    store.move(OWNER_A, 'preview-a', { x: 100, y: 100 })
    store.resize(OWNER_A, 'preview-a', { width: 500, height: 400 })
    store.close(OWNER_A, 'preview-a')

    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER_A]).toEqual({
      previewId: 'preview-b',
      position: null,
      size: null,
    })
  })

  it('migrates draft ownership and cleans only the matching closed preview', () => {
    const store = useBrowserPreviewFloatingStore.getState()
    store.open('draft:/repo', 'preview-a')
    store.migrateOwner('draft:/repo', OWNER_A)

    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey['draft:/repo']).toBeUndefined()
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER_A]).toMatchObject({
      previewId: 'preview-a',
    })
    store.removePreview(OWNER_A, 'preview-b')
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER_A]).toBeDefined()
    store.removePreview(OWNER_A, 'preview-a')
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[OWNER_A]).toBeUndefined()
  })
})

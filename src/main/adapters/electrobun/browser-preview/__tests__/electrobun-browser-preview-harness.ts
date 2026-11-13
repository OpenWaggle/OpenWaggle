import { fromPartial } from '@total-typescript/shoehorn'
import { vi } from 'vitest'
import { FAKE_PNG, fakeCefBrowser } from './fake-cef-browser'
import { fakeElectrobun } from '../../__tests__/contracts/fake-electrobun'
import { makeElectrobunBrowserPreview } from '../electrobun-browser-preview-shape'
import { electrobunOwnerWindow } from '../electrobun-owner-windows'
import type { ElectrobunPreviewHost } from '../electrobun-preview-record-factory'
import type { NativeWebviewFrames } from '../electrobun-webview-frames'
import type { PrepareBrowserPreviewAnnotation } from '../../../browser-preview/annotation/browser-preview-annotation'
import type { BrowserPreviewArtifactStorage } from '../../../browser-preview/browser-preview-artifact-storage'

/**
 * The Electrobun Browser preview over a fake CEF browser and fake Electrobun windows. Tests that
 * use it mock `desktop-native-admission` (it admits every native call).
 */
export const OWNER_KEY = 'session:s-1'
export const BOUNDS = { x: 10, y: 20, width: 400, height: 300 }
const READY = { type: 'ready' } as const

export function setup(
  options: {
    readonly cdp?: boolean
    readonly ownerKey?: string
    /** Real artifact storage, for tests that read what the preview stores. */
    readonly storage?: BrowserPreviewArtifactStorage
    /** Commit annotations through the Session Host, as the app does, instead of a fake. */
    readonly sessionHostAttachments?: boolean
    /** WebView2's profiles: a partition unloads with its last view. */
    readonly unloadsPartitionWithLastView?: boolean
    /** The browser engine's state; ready unless a test installs it. */
    readonly engine?: ElectrobunPreviewHost['engine']
  } = {},
) {
  const electrobun = fakeElectrobun()
  const cef = fakeCefBrowser()
  const frames = {
    setFrame: vi.fn<NativeWebviewFrames['setFrame']>(),
    setHidden: vi.fn<NativeWebviewFrames['setHidden']>(),
  }
  const artifacts = {
    write: vi.fn(async (_kind: string, _extension: string, _data: Uint8Array) => ({
      id: 'shot',
      path: '/artifacts/shot.png',
    })),
    resolveOwnedArtifact: vi.fn(async (artifactPath: string) => artifactPath),
  }
  const revealInFolder = vi.fn<(artifactPath: string) => void>()
  const writeClipboardImage = vi.fn(async (_png: Uint8Array) => undefined)
  const prepareAnnotation = vi.fn<PrepareBrowserPreviewAnnotation>(async (entry) => ({
    id: 'attachment-1',
    kind: 'image',
    origin: 'browser-preview',
    name: 'shot.png',
    path: entry.path,
    mimeType: 'image/png',
    sizeBytes: FAKE_PNG.byteLength,
    extractedText: entry.browserAnnotationText,
    browserPreview: entry.browserPreview,
  }))
  const host: ElectrobunPreviewHost = {
    engine: options.engine ?? { status: () => READY, ensure: async () => READY },
    createView: cef.createView,
    frames,
    endpoint: () => (options.cdp === false ? null : cef.endpoint),
    openSocket: cef.openSocket,
    ownerWindowOf: (owner) =>
      electrobunOwnerWindow(
        {
          BrowserView: electrobun.module.BrowserView,
          BrowserWindow: electrobun.module.BrowserWindow,
          events: electrobun.events,
        },
        owner.id,
      ),
    maintenanceWindowId: () => new electrobun.module.BrowserWindow({ hidden: true }).id,
    artifacts: () => options.storage ?? fromPartial(artifacts),
    revealInFolder,
    writeClipboardImage,
    ...(options.sessionHostAttachments === true ? {} : { prepareAnnotation }),
    isMac: true,
    unloadsPartitionWithLastView: options.unloadsPartitionWithLastView === true,
  }
  const { views, automation } = makeElectrobunBrowserPreview(host)
  const page = electrobun.browserPreview.openOwnerPage()
  const sent: [string, unknown][] = []
  page.surface.send = (channel: string, payload: unknown) => void sent.push([channel, payload])
  views.registerOwner(options.ownerKey ?? OWNER_KEY, page.surface)
  return {
    views,
    automation,
    cef,
    frames,
    page,
    sent,
    artifacts,
    revealInFolder,
    writeClipboardImage,
    prepareAnnotation,
  }
}

export type Setup = ReturnType<typeof setup>

export function openPreview(
  { views, page }: Setup,
  previewId = 'p-1',
  url = 'https://example.com/',
) {
  return views.open(page.surface, {
    previewId,
    ownerKey: OWNER_KEY,
    profileId: 'default',
    url,
    bounds: BOUNDS,
    visible: true,
  })
}

export function lastState(sent: Setup['sent']) {
  return sent.filter(([channel]) => channel === 'browser-preview:state').at(-1)?.[1]
}

export function onlyView(harness: Setup) {
  const [view] = harness.cef.views()
  if (view === undefined) throw new Error('No preview view')
  return view
}

export const settle = () => vi.advanceTimersByTimeAsync(50)

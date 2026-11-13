import { type Mock, vi } from 'vitest'
import type {
  UpdateCheck,
  UpdateEngineShape,
  UpdateFeed,
} from '../ports/desktop-shell/update-engine'

/**
 * An UpdateEngine double for the update policy's tests (`updater.ts`, `update-cli.ts`). A test
 * mocks the binding with it:
 *
 *   const engine = await vi.hoisted(async () =>
 *     (await import('../test-support/fake-update-engine')).fakeUpdateEngine(),
 *   )
 *   vi.mock('../desktop-shell/update-engine', () => ({ updateEngine: engine }))
 *
 * It keeps what the policy configured (`settings`) and its listeners, and a test reports what
 * the engine would (`report`). `checkForUpdates` finds nothing until a test says otherwise
 * (`offer`, or its own `mockResolvedValue`).
 */

type Listener<Value> = (value: Value) => void

/** The listeners of one engine event. */
function listenerSet<Value>() {
  const listeners = new Set<Listener<Value>>()
  return {
    listeners,
    add: (listener: Listener<Value>) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    emit: (value: Value) => {
      for (const listener of [...listeners]) listener(value)
    },
  }
}

export interface FakeUpdateEngineSettings {
  feedChannel: string | null
  allowPrerelease: boolean
  autoDownload: boolean
  feed: UpdateFeed | null
  /** An engine may schedule an install for the next quit until `cancelInstallOnQuit`. */
  installOnQuit: boolean
}

export interface FakeUpdateEngine extends UpdateEngineShape {
  readonly configure: Mock<UpdateEngineShape['configure']>
  readonly setAutoDownload: Mock<UpdateEngineShape['setAutoDownload']>
  readonly metadataAssetName: Mock<UpdateEngineShape['metadataAssetName']>
  readonly setFeed: Mock<UpdateEngineShape['setFeed']>
  readonly cancelInstallOnQuit: Mock<UpdateEngineShape['cancelInstallOnQuit']>
  readonly checkForUpdates: Mock<UpdateEngineShape['checkForUpdates']>
  readonly quitAndInstall: Mock<UpdateEngineShape['quitAndInstall']>
  readonly settings: FakeUpdateEngineSettings
  /** Reports to the listeners registered now, as the engine would. */
  readonly report: {
    readonly checking: () => void
    readonly available: (version: string) => void
    readonly notAvailable: () => void
    readonly progress: (percent: number) => void
    readonly downloaded: (version: string) => void
    readonly error: (error: Error) => void
  }
  /** How many listeners each event has. */
  readonly listenerCounts: () => Readonly<Record<keyof FakeUpdateEngine['report'], number>>
  /** The next check finds `version`; its download resolves at once unless one is given. */
  readonly offer: (
    version: string,
    download?: Promise<unknown> | null,
  ) => { readonly cancelDownload: Mock<() => void> }
  /** Forgets the listeners, settings and calls, as a fresh engine has none. */
  readonly reset: () => void
}

function initialSettings() {
  const settings: FakeUpdateEngineSettings = {
    feedChannel: null,
    allowPrerelease: false,
    autoDownload: true,
    feed: null,
    installOnQuit: true,
  }
  return settings
}

export function fakeUpdateEngine() {
  const events = {
    checking: listenerSet<undefined>(),
    available: listenerSet<string>(),
    notAvailable: listenerSet<undefined>(),
    progress: listenerSet<number>(),
    downloaded: listenerSet<string>(),
    error: listenerSet<Error>(),
  }
  const settings = initialSettings()
  // `mockReset` restores these implementations (Vitest 3 and later).
  const mocks = {
    configure: vi.fn<UpdateEngineShape['configure']>(({ feedChannel, allowPrerelease }) => {
      settings.feedChannel = feedChannel
      settings.allowPrerelease = allowPrerelease
    }),
    setAutoDownload: vi.fn<UpdateEngineShape['setAutoDownload']>((autoDownload) => {
      settings.autoDownload = autoDownload
    }),
    metadataAssetName: vi.fn<UpdateEngineShape['metadataAssetName']>(
      ({ platform, arch }) => `update-${platform}-${arch}.json`,
    ),
    setFeed: vi.fn<UpdateEngineShape['setFeed']>((feed) => {
      settings.feed = feed
    }),
    cancelInstallOnQuit: vi.fn<UpdateEngineShape['cancelInstallOnQuit']>(() => {
      settings.installOnQuit = false
    }),
    checkForUpdates: vi.fn<UpdateEngineShape['checkForUpdates']>(async () => null),
    quitAndInstall: vi.fn<UpdateEngineShape['quitAndInstall']>(),
  }
  const engine: FakeUpdateEngine = {
    ...mocks,
    settings,
    onCheckingForUpdate: (listener) => events.checking.add(() => listener()),
    onUpdateAvailable: events.available.add,
    onUpdateNotAvailable: (listener) => events.notAvailable.add(() => listener()),
    onDownloadProgress: events.progress.add,
    onUpdateDownloaded: events.downloaded.add,
    onError: events.error.add,
    report: {
      checking: () => events.checking.emit(undefined),
      available: events.available.emit,
      notAvailable: () => events.notAvailable.emit(undefined),
      progress: events.progress.emit,
      downloaded: events.downloaded.emit,
      error: events.error.emit,
    },
    listenerCounts: () => ({
      checking: events.checking.listeners.size,
      available: events.available.listeners.size,
      notAvailable: events.notAvailable.listeners.size,
      progress: events.progress.listeners.size,
      downloaded: events.downloaded.listeners.size,
      error: events.error.listeners.size,
    }),
    offer: (version, download = Promise.resolve()) => {
      const cancelDownload = vi.fn<() => void>()
      const check: UpdateCheck = { version, download, cancelDownload }
      mocks.checkForUpdates.mockResolvedValueOnce(check)
      return { cancelDownload }
    },
    reset: () => {
      for (const event of Object.values(events)) event.listeners.clear()
      Object.assign(settings, initialSettings())
      for (const mock of Object.values(mocks)) mock.mockReset()
    },
  }
  return engine
}

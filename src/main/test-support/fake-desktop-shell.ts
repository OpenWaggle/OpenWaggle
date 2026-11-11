import { vi } from 'vitest'
import type { AppLifecycleShape } from '../ports/desktop-shell/app-lifecycle'
import type { AppPathsShape } from '../ports/desktop-shell/app-paths'
import type { BootShellShape } from '../ports/desktop-shell/boot-shell'
import type { ClipboardShape } from '../ports/desktop-shell/clipboard'
import type { NetworkFetchShape } from '../ports/desktop-shell/network-fetch'
import type { OsShellShape } from '../ports/desktop-shell/os-shell'
import type { SecureStorageShape } from '../ports/desktop-shell/secure-storage'
import type { SystemIntegrationShape } from '../ports/desktop-shell/system-integration'
import type {
  TrustedOriginDomain,
  TrustedOriginHandler,
  TrustedOriginsShape,
} from '../ports/desktop-shell/trusted-origins'
import { TRUSTED_ORIGIN_SCHEMES } from '../trusted-origin-schemes'

/**
 * Test doubles for the desktop shell bindings (`src/main/desktop-shell/*`), for unit tests of the
 * code above the ports. A test mocks the binding module with one of these, for example:
 *
 *   vi.mock('../desktop-shell/app-lifecycle', async () => ({
 *     appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle(),
 *   }))
 *
 * The members that return nothing are `vi.fn`s, so a test may read their calls; the others are
 * plain functions, so `vi.resetAllMocks()` leaves them answering. A test overrides any member.
 */

type Listener = (...args: never[]) => void

/** Collects the listeners of one `on…` registration and calls them. */
function listenerSet<L extends Listener>() {
  const listeners = new Set<L>()
  return {
    listeners,
    register: (listener: L) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

/** Calls each listener registered now; one added by a listener waits for the next emit. */
function callEach(listeners: ReadonlySet<() => void>) {
  for (const listener of [...listeners]) listener()
}

export function fakeAppLifecycle(overrides: Partial<AppLifecycleShape> = {}) {
  const beforeQuit = listenerSet<Parameters<AppLifecycleShape['onBeforeQuit']>[0]>()
  const willQuit = listenerSet<() => void>()
  const windowAllClosed = listenerSet<() => void>()
  const activate = listenerSet<() => void>()
  const beforeQuitForUpdate = listenerSet<() => void>()
  const lifecycle = {
    version: () => '1.0.0',
    name: () => 'OpenWaggle',
    isPackaged: () => false,
    whenReady: async () => undefined,
    quit: vi.fn<AppLifecycleShape['quit']>(),
    exit: vi.fn<AppLifecycleShape['exit']>(),
    relaunch: vi.fn<AppLifecycleShape['relaunch']>(),
    onBeforeQuit: beforeQuit.register,
    onWillQuit: willQuit.register,
    onWindowAllClosed: windowAllClosed.register,
    onActivate: activate.register,
    onBeforeQuitForUpdate: beforeQuitForUpdate.register,
    commandLine: {
      appendSwitch: vi.fn<AppLifecycleShape['commandLine']['appendSwitch']>(),
      hasSwitch: () => false,
      getSwitchValue: () => '',
    },
    disableHardwareAcceleration: vi.fn<AppLifecycleShape['disableHardwareAcceleration']>(),
    ...overrides,
  } satisfies AppLifecycleShape
  return Object.assign(lifecycle, {
    /** Runs the `onBeforeQuit` listeners; true when one of them held the quit. */
    emitBeforeQuit: () => {
      let held = false
      for (const listener of [...beforeQuit.listeners]) {
        listener({ preventDefault: () => void (held = true) })
      }
      return held
    },
    emitWillQuit: () => callEach(willQuit.listeners),
    emitWindowAllClosed: () => callEach(windowAllClosed.listeners),
    emitActivate: () => callEach(activate.listeners),
    emitBeforeQuitForUpdate: () => callEach(beforeQuitForUpdate.listeners),
  })
}

export function fakeAppPaths(userData = '/tmp/openwaggle-test-profile') {
  const paths = { userData, logs: `${userData}/logs` }
  return {
    applyBuildIdentity: vi.fn<AppPathsShape['applyBuildIdentity']>(),
    userData: () => paths.userData,
    logs: () => paths.logs,
    appData: () => '/tmp',
    appRoot: () => '/tmp/openwaggle-app',
    resources: () => '/tmp/openwaggle-app/resources',
    setUserData: (directory: string) => void (paths.userData = directory),
    setLogs: (directory: string) => void (paths.logs = directory),
    setWebProfileData: vi.fn<AppPathsShape['setWebProfileData']>(),
  } satisfies AppPathsShape
}

const noUnsubscribe = () => undefined

export function fakeSystemIntegration(overrides: Partial<SystemIntegrationShape> = {}) {
  return {
    requestSingleInstanceLock: () => true,
    hasSingleInstanceLock: () => true,
    releaseSingleInstanceLock: vi.fn<SystemIntegrationShape['releaseSingleInstanceLock']>(),
    onSecondInstance: () => noUnsubscribe,
    loginItemOpensAtLogin: () => false,
    setLoginItemOpensAtLogin: vi.fn<SystemIntegrationShape['setLoginItemOpensAtLogin']>(),
    setBadgeCount: vi.fn<SystemIntegrationShape['setBadgeCount']>(),
    setActivationPolicy: vi.fn<SystemIntegrationShape['setActivationPolicy']>(),
    setDockIcon: vi.fn<SystemIntegrationShape['setDockIcon']>(),
    setAppUserModelId: vi.fn<SystemIntegrationShape['setAppUserModelId']>(),
    onResume: () => noUnsubscribe,
    setAsDefaultProtocolClient: () => true,
    onOpenUrl: () => noUnsubscribe,
    onProcessGone: () => noUnsubscribe,
    ...overrides,
  } satisfies SystemIntegrationShape
}

/** The boot shim's view of the shell, from the same fakes. */
export function fakeBootShell(overrides: Partial<BootShellShape> = {}) {
  const lifecycle = fakeAppLifecycle()
  const paths = fakeAppPaths()
  return {
    applyBuildIdentity: paths.applyBuildIdentity,
    appRoot: paths.appRoot,
    userData: paths.userData,
    version: lifecycle.version,
    isPackaged: lifecycle.isPackaged,
    exit: lifecycle.exit,
    commandLine: lifecycle.commandLine,
    setActivationPolicy: vi.fn<BootShellShape['setActivationPolicy']>(),
    ...overrides,
  } satisfies BootShellShape
}

const TRUSTED_ORIGIN_DOMAINS: readonly TrustedOriginDomain[] = [
  'renderer',
  'extension-runtime',
  'extension-frame',
  'inline-visualization',
  'mcp-app-frame',
  'session-resource',
]

/**
 * TrustedOrigins as Electron's custom schemes serve them: a domain's origin is
 * `<scheme>://<host>`, the address its handler sees on every shell, so a test dispatches the
 * request a page would make and reads the URLs the code hands out unchanged.
 */
export function fakeTrustedOrigins() {
  const handlers = new Map<TrustedOriginDomain, TrustedOriginHandler>()
  const handlerOf = (domain: TrustedOriginDomain) => {
    const handler = handlers.get(domain)
    if (!handler) throw new Error(`Expected the ${domain} handler.`)
    return handler
  }
  const origins = {
    declare: vi.fn<TrustedOriginsShape['declare']>(),
    serve: vi.fn<TrustedOriginsShape['serve']>((domain, handler) => {
      handlers.set(domain, handler)
    }),
    originOf: (domain: TrustedOriginDomain, host: string) =>
      `${TRUSTED_ORIGIN_SCHEMES[domain]}://${host}`,
    sourcesOf: (domain: TrustedOriginDomain) => [`${TRUSTED_ORIGIN_SCHEMES[domain]}:`],
    release: vi.fn<TrustedOriginsShape['release']>(),
  } satisfies TrustedOriginsShape
  return Object.assign(origins, {
    handlers,
    /** The handler serving `domain`; it throws when nothing serves it yet. */
    handlerOf,
    /** Sends `url` to the handler serving `domain`, as a page request would arrive. */
    dispatch: (domain: TrustedOriginDomain, url: string, init?: RequestInit) =>
      handlerOf(domain)(new Request(url, init)),
    /** Sends `url` to the domain its scheme names, as the shell routes a page request. */
    dispatchUrl: (url: string, init?: RequestInit) => {
      const scheme = new URL(url).protocol.slice(0, -1)
      const domain = TRUSTED_ORIGIN_DOMAINS.find((key) => TRUSTED_ORIGIN_SCHEMES[key] === scheme)
      if (!domain) throw new Error(`No trusted origin domain serves ${scheme}:.`)
      return handlerOf(domain)(new Request(url, init))
    },
    /** Forgets every served handler, as a fresh module graph has none. */
    reset: () => {
      handlers.clear()
      origins.declare.mockClear()
      origins.serve.mockClear()
      origins.release.mockClear()
    },
  })
}

export function fakeNetworkFetch() {
  return {
    fetch: vi.fn<NetworkFetchShape['fetch']>(async () => new Response(null)),
    guardExtensionEgress: vi.fn<NetworkFetchShape['guardExtensionEgress']>(),
  } satisfies NetworkFetchShape
}

/** A clipboard that keeps what was written to it. */
export function fakeClipboard() {
  const contents: { text: string; image: Uint8Array | null } = { text: '', image: null }
  const clipboard = {
    readText: vi.fn<ClipboardShape['readText']>(() => contents.text),
    writeText: vi.fn<ClipboardShape['writeText']>((text) => void (contents.text = text)),
    writeImage: vi.fn<ClipboardShape['writeImage']>(async (encodedImage) => {
      contents.image = encodedImage
      return 'written'
    }),
  } satisfies ClipboardShape
  return Object.assign(clipboard, { contents })
}

/**
 * SecureStorage with a reversible stand-in seal (`fake:` + base64), never the keychain. Set
 * `available` false to model a machine without operating-system encryption.
 */
export function fakeSecureStorage(options: { available?: boolean } = {}) {
  const state = { available: options.available ?? true }
  const storage = {
    isEncryptionAvailable: () => state.available,
    encryptString: (plainText: string) =>
      Buffer.from(`fake:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (encrypted: Buffer) => {
      const sealed = encrypted.toString('utf8')
      if (!sealed.startsWith('fake:')) throw new Error('Not sealed by this SecureStorage.')
      return Buffer.from(sealed.slice('fake:'.length), 'base64').toString('utf8')
    },
    warm: async () => undefined,
  } satisfies SecureStorageShape
  return Object.assign(storage, { state })
}

/** An OS shell that opens, reveals and trashes nothing; each member is a `vi.fn` a test may read. */
export function fakeOsShell() {
  return {
    openExternal: vi.fn<OsShellShape['openExternal']>(async () => undefined),
    openPath: vi.fn<OsShellShape['openPath']>(async () => ''),
    showItemInFolder: vi.fn<OsShellShape['showItemInFolder']>(),
    trashItem: vi.fn<OsShellShape['trashItem']>(async () => undefined),
    beep: vi.fn<OsShellShape['beep']>(),
  } satisfies OsShellShape
}

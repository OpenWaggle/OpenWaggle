import { EventEmitter } from 'node:events'
import { FakeApp } from './fake-electron-app'
import {
  createWebContents,
  FakeBrowserWindow,
  FakeSession,
  webContentsFromId,
} from './fake-electron-pages'
import {
  FakeMenu,
  FakeNativeImage,
  FakeNotification,
  lastPopup,
  PNG_SIGNATURE,
} from './fake-electron-ui'

/**
 * A small, faithful stand-in for the Electron APIs the desktop shell adapters call, for running
 * the port contract suites against `src/main/adapters/electron/` without an Electron process.
 * `prepareElectronShell()` reloads these modules for every contract case, so each case starts
 * from a clean fake. It models observable behavior (paths, events, the clipboard, the
 * single-instance lock, windows and their pages), not Electron internals.
 */

const SAFE_STORAGE_PREFIX = 'fake-safe-storage:'

/** The module the runners hand to `vi.mock('electron')`, and handles to drive it. */
export function fakeElectron() {
  const app = new FakeApp()
  const powerMonitor = new EventEmitter()
  const autoUpdater = new EventEmitter()
  const clipboardState: { text: string; image: FakeNativeImage | null } = { text: '', image: null }
  const safeStorageState = { available: true }
  const handed: string[] = []
  const shellState = { handed, beeps: 0 }
  const dialogOwners: (FakeBrowserWindow | null)[] = []
  const errorBoxes: { readonly title: string; readonly content: string }[] = []
  const answeredPaths: readonly string[] = []
  const dialogState = { response: 0, filePaths: answeredPaths, owners: dialogOwners, errorBoxes }
  const privileged: unknown[] = []
  const protocolState = {
    privileged,
    handlers: new Map<string, (request: Request) => Response | Promise<Response>>(),
  }
  const ipcState = {
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    listeners: new Map<string, (event: unknown, ...args: unknown[]) => void>(),
  }
  const fetched: string[] = []
  const netState = { fetched }

  function ownerAndOptions(first: unknown, second: unknown) {
    return first instanceof FakeBrowserWindow
      ? { owner: first, options: second }
      : { owner: null, options: first }
  }

  function seal(plainText: string) {
    if (!safeStorageState.available) throw new Error('Encryption is not available.')
    return Buffer.from(`${SAFE_STORAGE_PREFIX}${Buffer.from(plainText).toString('base64')}`, 'utf8')
  }

  function open(encrypted: Buffer) {
    if (!safeStorageState.available) throw new Error('Encryption is not available.')
    const text = encrypted.toString('utf8')
    if (!text.startsWith(SAFE_STORAGE_PREFIX)) throw new Error('Error while decrypting.')
    return Buffer.from(text.slice(SAFE_STORAGE_PREFIX.length), 'base64').toString('utf8')
  }

  const module = {
    app,
    session: { defaultSession: new FakeSession() },
    autoUpdater,
    powerMonitor,
    BrowserWindow: FakeBrowserWindow,
    BaseWindow: FakeBrowserWindow,
    Menu: FakeMenu,
    Notification: FakeNotification,
    webContents: { fromId: webContentsFromId },
    nativeImage: {
      createFromBuffer: (buffer: Buffer) => new FakeNativeImage(buffer),
      createFromBitmap: (buffer: Buffer) =>
        new FakeNativeImage(Uint8Array.from([...PNG_SIGNATURE, ...buffer])),
    },
    clipboard: {
      readText: () => clipboardState.text,
      writeText: (text: string) => void (clipboardState.text = text),
      writeImage: (image: FakeNativeImage) => void (clipboardState.image = image),
    },
    safeStorage: {
      isEncryptionAvailable: () => safeStorageState.available,
      encryptString: seal,
      decryptString: open,
      // Electron 43 seals in the same format on another thread.
      isAsyncEncryptionAvailable: async () => safeStorageState.available,
      encryptStringAsync: async (plainText: string) => seal(plainText),
      decryptStringAsync: async (encrypted: Buffer) => ({
        result: open(encrypted),
        shouldReEncrypt: false,
      }),
    },
    shell: {
      openExternal: (url: string) => {
        shellState.handed.push(url)
        return Promise.resolve()
      },
      openPath: (target: string) => {
        if (target.includes('missing')) return Promise.resolve('Failed to open path')
        shellState.handed.push(target)
        return Promise.resolve('')
      },
      showItemInFolder: (target: string) => void shellState.handed.push(target),
      trashItem: (target: string) => {
        if (target.includes('missing')) return Promise.reject(new Error('No such item'))
        shellState.handed.push(target)
        return Promise.resolve()
      },
      beep: () => void (shellState.beeps += 1),
    },
    dialog: {
      showMessageBox: (first: unknown, second?: unknown) => {
        dialogState.owners.push(ownerAndOptions(first, second).owner)
        return Promise.resolve({ response: dialogState.response, checkboxChecked: false })
      },
      showOpenDialog: (first: unknown, second?: unknown) => {
        dialogState.owners.push(ownerAndOptions(first, second).owner)
        const canceled = dialogState.filePaths.length === 0
        return Promise.resolve({ canceled, filePaths: [...dialogState.filePaths] })
      },
      showSaveDialog: (first: unknown, second?: unknown) => {
        dialogState.owners.push(ownerAndOptions(first, second).owner)
        const filePath = dialogState.filePaths[0]
        return Promise.resolve(
          filePath === undefined ? { canceled: true } : { canceled: false, filePath },
        )
      },
      showErrorBox: (title: string, content: string) =>
        void dialogState.errorBoxes.push({ title, content }),
      showCertificateTrustDialog: () => Promise.resolve(),
      showMessageBoxSync: () => 0,
      showOpenDialogSync: () => undefined,
      showSaveDialogSync: () => undefined,
    },
    protocol: {
      registerSchemesAsPrivileged: (schemes: readonly unknown[]) =>
        void protocolState.privileged.push(...schemes),
      handle: (scheme: string, handler: (request: Request) => Response | Promise<Response>) =>
        void protocolState.handlers.set(scheme, handler),
    },
    net: {
      fetch: (input: string | Request) => {
        const url = typeof input === 'string' ? input : input.url
        netState.fetched.push(url)
        return Promise.resolve(new Response(`fetched ${url}`))
      },
      request: () => new EventEmitter(),
    },
    ipcMain: {
      handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
        void ipcState.handlers.set(channel, handler),
      on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) =>
        void ipcState.listeners.set(channel, listener),
      removeAllListeners: () => undefined,
    },
  }

  return {
    module,
    app,
    powerMonitor,
    autoUpdater,
    clipboardState,
    safeStorageState,
    shellState,
    dialogState,
    protocolState,
    ipcState,
    netState,
    lastPopup,
    notifications: FakeNotification,
    menus: FakeMenu,
    windows: FakeBrowserWindow,
    createWebContents,
  }
}

export const FAKE_PNG = Uint8Array.from([...PNG_SIGNATURE, 0x0d, 0x0a, 0x1a, 0x0a])

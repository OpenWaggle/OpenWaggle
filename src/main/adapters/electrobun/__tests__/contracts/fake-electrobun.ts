import { EventEmitter } from 'node:events'
import { fakeElectrobunBrowserPreview } from './fake-electrobun-browser-preview'
import { fakeElectrobunUpdater } from './fake-electrobun-updater'
import { fakeElectrobunWebview } from './fake-electrobun-webview'

/**
 * A small, faithful stand-in for the `electrobun/main` APIs the desktop shell adapters call, for
 * running the port contract suites against `src/main/adapters/electrobun/` without a native
 * Electrobun process. `prepareElectrobunShell()` reloads it for every contract case, so each case
 * starts from a clean fake. It models observable behavior (the clipboard, what the OS was handed,
 * dialogs and their answers, menus, notifications, the build configuration), not Electrobun
 * internals. Its event emitter carries Electrobun's app-level events as `{ data }` events.
 *
 * Each area of the shell keeps its fakes in its own `fake-electrobun-<area>.ts` and adds them to
 * `module` here.
 */
type BuildEnvironment = 'dev' | 'canary' | 'stable'
type Renderer = 'native' | 'cef'

export interface FakeMenuItem {
  readonly type?: string
  readonly label?: string
  readonly role?: string
  readonly action?: string
  readonly submenu?: readonly FakeMenuItem[]
}

interface MenuEventData {
  readonly action: string
}

/** The Electrobun event shape: listeners get `{ data }`, and a veto sets `response`. */
export class FakeElectrobunEvent<Data> {
  response: { allow: boolean } | undefined = undefined
  readonly name: string
  readonly data: Data
  constructor(name: string, data: Data) {
    this.name = name
    this.data = data
  }
}

function findByLabel(items: readonly FakeMenuItem[], label: string): FakeMenuItem | null {
  for (const item of items) {
    if (item.label === label) return item
    const nested = item.submenu ? findByLabel(item.submenu, label) : null
    if (nested) return nested
  }
  return null
}

export function fakeElectrobun() {
  const events = new EventEmitter()
  const clipboardState: { text: string | null; image: Uint8Array | null } = {
    text: null,
    image: null,
  }
  const handed: string[] = []
  const shellState = { handed, refuse: false }
  const availableRenderers: Renderer[] = ['native', 'cef']
  const buildEnvironment: BuildEnvironment = 'dev'
  const defaultRenderer: Renderer = 'native'
  const buildState = { buildEnvironment, defaultRenderer, availableRenderers }
  const raisedWindows: number[] = []
  const dialogOwners: (number | null)[] = []
  const answer: { button: number; paths: readonly string[] } = { button: 0, paths: [] }
  const dialogState = { raisedWindows, owners: dialogOwners, answer, shown: 0 }
  const shownNotifications: string[] = []
  const menuState: {
    application: readonly FakeMenuItem[] | null
    context: readonly FakeMenuItem[] | null
  } = { application: null, context: null }
  const lifecycleState = { quits: 0, dockIconVisible: true }

  /** The system refuses what does not exist; the contracts name such paths `missing`. */
  function handOver(target: string) {
    if (shellState.refuse || target.includes('missing')) return false
    shellState.handed.push(target)
    return true
  }

  /** A dialog appears over the window raised just before it, if any. */
  function openDialog() {
    dialogState.owners.push(dialogState.raisedWindows.pop() ?? null)
    dialogState.shown += 1
  }

  function emit<Data>(name: string, data: Data) {
    const event = new FakeElectrobunEvent(name, data)
    events.emit(name, event)
    return event
  }

  const Utils = {
    openExternal: handOver,
    openPath: handOver,
    showItemInFolder: (target: string) => void handOver(target),
    moveToTrash: handOver,
    clipboardReadText: () => clipboardState.text,
    clipboardWriteText: (text: string) => void (clipboardState.text = text),
    clipboardReadImage: () => clipboardState.image,
    clipboardWriteImage: (png: Uint8Array) => void (clipboardState.image = png),
    clipboardClear: () => {
      clipboardState.text = null
      clipboardState.image = null
    },
    showMessageBox: async () => {
      openDialog()
      return { response: dialogState.answer.button }
    },
    openFileDialog: async () => {
      openDialog()
      return [...dialogState.answer.paths]
    },
    showNotification: (options: { readonly title: string }) =>
      void shownNotifications.push(options.title),
    setDockIconVisible: (visible: boolean) => void (lifecycleState.dockIconVisible = visible),
    quit: () => {
      const veto = emit('before-quit', {})
      if (veto.response?.allow === false) return false
      lifecycleState.quits += 1
      return true
    },
  }

  const chromiumFlags: Record<string, string | boolean> = {}
  const BuildConfig = {
    getSync: () => ({
      ...buildState,
      isPackaged: buildState.buildEnvironment !== 'dev',
      runtime: {},
      chromiumFlags,
    }),
    get: async () => BuildConfig.getSync(),
  }

  // Windows and their webviews (fake-electrobun-webview.ts); a dialog opens over the window
  // raised just before it.
  const webview = fakeElectrobunWebview(events, {
    onRaise: (id) => void dialogState.raisedWindows.push(id),
  })

  const ApplicationMenu = {
    setApplicationMenu: (menu: readonly FakeMenuItem[]) =>
      void (menuState.application = menu.length === 0 ? null : menu),
  }
  const ContextMenu = {
    showContextMenu: (menu: readonly FakeMenuItem[]) => void (menuState.context = menu),
  }

  /** Chooses `label` in the context menu shown last, as Electrobun reports a click. */
  function chooseInContextMenu(label: string) {
    const item = menuState.context ? findByLabel(menuState.context, label) : null
    if (!item?.action) return false
    emit<MenuEventData>('context-menu-clicked', { action: item.action })
    return true
  }

  const browserPreview = fakeElectrobunBrowserPreview(webview)
  const updater = fakeElectrobunUpdater()
  const module = {
    Utils,
    BuildConfig,
    ...webview.module,
    ApplicationMenu,
    ContextMenu,
    Updater: updater.Updater,
  }
  return {
    module,
    updater,
    events,
    webview,
    browserPreview,
    emit,
    clipboardState,
    shellState,
    buildState,
    dialogState,
    shownNotifications,
    menuState,
    lifecycleState,
    chooseInContextMenu,
  }
}

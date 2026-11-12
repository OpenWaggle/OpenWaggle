import { EventEmitter } from 'node:events'

/** Electron's pages (`WebContents`), their web profiles and their windows. */
export class FakeSession {
  readonly clearedOrigins: string[] = []
  clearStorageData(input: { readonly origin?: string } = {}) {
    if (input.origin) this.clearedOrigins.push(input.origin)
    return Promise.resolve()
  }
}

let nextWebContentsId = 1

export class FakeWebContents extends EventEmitter {
  readonly id = nextWebContentsId++
  readonly sent: { readonly channel: string; readonly args: readonly unknown[] }[] = []
  readonly session = new FakeSession()
  destroyed = false
  url = 'openwaggle://app/index.html'
  focused = 0

  isDestroyed() {
    return this.destroyed
  }
  getURL() {
    return this.url
  }
  send(channel: string, ...args: unknown[]) {
    this.sent.push({ channel, args })
  }
  focus() {
    this.focused += 1
  }
  destroy() {
    this.destroyed = true
    allWebContents.delete(this.id)
    this.emit('destroyed')
  }
}

const allWebContents = new Map<number, FakeWebContents>()

export function webContentsFromId(id: number) {
  return allWebContents.get(id)
}

export function createWebContents() {
  const contents = new FakeWebContents()
  allWebContents.set(contents.id, contents)
  return contents
}

let nextWindowId = 1
const allWindows: FakeBrowserWindow[] = []
let focusedWindowId: number | null = null

export class FakeBrowserWindow extends EventEmitter {
  readonly id = nextWindowId++
  readonly webContents = createWebContents()
  readonly overlayIcons: ({ readonly description: string; readonly empty: boolean } | null)[] = []
  visible: boolean
  minimized = false
  destroyed = false

  readonly options: { readonly show?: boolean }

  constructor(options: { readonly show?: boolean } = {}) {
    super()
    this.options = options
    this.visible = options.show ?? true
    allWindows.push(this)
  }

  static getAllWindows() {
    return [...allWindows]
  }
  static getFocusedWindow() {
    return allWindows.find((window) => window.id === focusedWindowId) ?? null
  }
  static fromId(id: number) {
    return allWindows.find((window) => window.id === id) ?? null
  }
  static fromWebContents(contents: { readonly id: number }) {
    return allWindows.find((window) => window.webContents.id === contents.id) ?? null
  }

  isDestroyed() {
    return this.destroyed
  }
  isVisible() {
    return this.visible
  }
  isMinimized() {
    return this.minimized
  }
  minimize() {
    this.minimized = true
  }
  restore() {
    this.minimized = false
  }
  show() {
    this.visible = true
    focusedWindowId = this.id
  }
  showInactive() {
    this.visible = true
  }
  focus() {
    focusedWindowId = this.id
  }
  setOverlayIcon(image: { readonly isEmpty: () => boolean } | null, description: string) {
    this.overlayIcons.push(image ? { description, empty: image.isEmpty() } : null)
  }
  close() {
    this.destroyed = true
    allWindows.splice(allWindows.indexOf(this), 1)
    if (focusedWindowId === this.id) focusedWindowId = null
    this.webContents.destroy()
  }
}

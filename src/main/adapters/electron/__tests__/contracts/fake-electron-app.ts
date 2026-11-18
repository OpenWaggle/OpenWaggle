import { EventEmitter } from 'node:events'

/** Electron's `app`, as the contract runners drive it. */
export class FakeQuitEvent {
  defaultPrevented = false
  preventDefault() {
    this.defaultPrevented = true
  }
}

export class FakeApp extends EventEmitter {
  name = 'openwaggle'
  isPackaged = false
  readonly paths = new Map<string, string>([
    ['userData', '/fake/Application Support/openwaggle'],
    ['logs', '/fake/Logs/openwaggle'],
    ['appData', '/fake/Application Support'],
  ])
  readonly switches = new Map<string, string>()
  readonly exits: (number | undefined)[] = []
  quits = 0
  relaunches = 0
  hardwareAccelerationDisabled = false
  lockHeldByAnother = false
  lockHeld = false
  badgeCount = 0
  activationPolicy = 'regular'
  dockIcon: string | null = null
  appUserModelId: string | null = null
  readonly defaultProtocolClients: string[] = []
  readonly loginItems = new Map<string, boolean>()
  readonly dock = { setIcon: (icon: string) => void (this.dockIcon = icon) }
  readonly commandLine = {
    hasSwitch: (name: string) => this.switches.has(name),
    getSwitchValue: (name: string) => this.switches.get(name) ?? '',
    appendSwitch: (name: string, value?: string) => void this.switches.set(name, value ?? ''),
  }

  getVersion() {
    return '1.0.0-fake'
  }
  setName(name: string) {
    this.name = name
    this.paths.set('userData', `/fake/Application Support/${name}`)
  }
  getPath(name: string) {
    const value = this.paths.get(name)
    if (value === undefined) throw new Error(`Unknown path ${name}`)
    return value
  }
  setPath(name: string, value: string) {
    this.paths.set(name, value)
  }
  setAppLogsPath(directory: string) {
    this.paths.set('logs', directory)
  }
  getAppPath() {
    return '/fake/app'
  }
  whenReady() {
    return Promise.resolve()
  }
  quit() {
    const event = new FakeQuitEvent()
    this.emit('before-quit', event)
    if (event.defaultPrevented) return
    this.quits += 1
    this.emit('will-quit')
  }
  exit(code?: number) {
    this.exits.push(code)
  }
  relaunch() {
    this.relaunches += 1
  }
  disableHardwareAcceleration() {
    this.hardwareAccelerationDisabled = true
  }
  requestSingleInstanceLock() {
    if (this.lockHeldByAnother) return false
    this.lockHeld = true
    return true
  }
  hasSingleInstanceLock() {
    return this.lockHeld
  }
  releaseSingleInstanceLock() {
    this.lockHeld = false
  }
  getLoginItemSettings(item: { readonly path: string; readonly args: readonly string[] }) {
    return { openAtLogin: this.loginItems.get(`${item.path} ${item.args.join(' ')}`) ?? false }
  }
  setLoginItemSettings(item: {
    readonly path: string
    readonly args: readonly string[]
    readonly openAtLogin: boolean
  }) {
    this.loginItems.set(`${item.path} ${item.args.join(' ')}`, item.openAtLogin)
  }
  setBadgeCount(count: number) {
    this.badgeCount = count
    return true
  }
  setActivationPolicy(policy: string) {
    this.activationPolicy = policy
  }
  setAppUserModelId(id: string) {
    this.appUserModelId = id
  }
  setAsDefaultProtocolClient(scheme: string) {
    this.defaultProtocolClients.push(scheme)
    return true
  }
}
